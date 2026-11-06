//! Helpers shared by several instructions: paying out of custody, the payout chain, the exposure
//! cap, and voucher acceptance.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::ScoreError;
use crate::state::{Checkpoint, Config, Limits, PayoutSlot, Pending, State, VoucherPage};
use crate::verify::{check_ed25519, payout_link, voucher_message};

/// Pay `amount` out of custody, signed by the custody authority PDA.
pub fn pay_out<'info>(
    token_program: &Program<'info, Token>,
    custody: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    custody_auth: &UncheckedAccount<'info>,
    bump: u8,
    amount: u64,
) -> Result<()> {
    transfer_signed(token_program, custody, to, mint, custody_auth, CUSTODY_AUTH_SEED, bump, amount)
}

/// Move `amount` out of a program-held token account, signed by its authority PDA `[seed, bump]`.
#[allow(clippy::too_many_arguments)]
pub fn transfer_signed<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    authority: &UncheckedAccount<'info>,
    seed: &[u8],
    bump: u8,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[seed, &[bump]];
    let accounts = TransferChecked { from: from.to_account_info(), mint: mint.to_account_info(), to: to.to_account_info(), authority: authority.to_account_info() };
    token::transfer_checked(CpiContext::new_with_signer(token_program.key(), accounts, &[seeds]), amount, mint.decimals)
}

/// Record a payout outside exit mode: the payout chain, plus the `Pending` log (which exit mode
/// settles against). Refuses to run more than `PENDING_PAYOUTS` ahead of the last batch.
pub fn record_payout(st: &mut State, pending: &mut Pending, kind: u8, id: u64, to: &Pubkey, amount: u64) -> Result<(u64, [u8; 32])> {
    let r = chain_payout(st, kind, id, to, amount)?;
    require!(r.0 - st.committed_payouts <= PENDING_PAYOUTS, ScoreError::TooManyPending);
    pending.payouts[((r.0 - 1) % PENDING_PAYOUTS) as usize] = PayoutSlot { to: *to, id, amount, kind, _pad: [0; 7] };
    Ok(r)
}

/// Append to the payout chain only (exit-mode payouts). Returns (count, hash).
pub fn chain_payout(st: &mut State, kind: u8, id: u64, to: &Pubkey, amount: u64) -> Result<(u64, [u8; 32])> {
    let count = st.payout_count.checked_add(1).ok_or(ScoreError::Math)?;
    let total = st.payout_total.checked_add(amount).ok_or(ScoreError::Math)?;
    let hash = payout_link(&st.payout_hash, count, kind, id, to, amount);
    st.payout_count = count;
    st.payout_total = total;
    st.payout_hash = hash;
    st.payout_ring[(count % RING as u64) as usize] = Checkpoint { count, total, hash };
    Ok((count, hash))
}

/// Instant payouts not yet reflected in a committed batch may not exceed the cap.
pub fn check_exposure(st: &State, limits: &Limits, custody_balance: u64, amount: u64) -> Result<()> {
    let pct = (custody_balance as u128 * limits.exposure_cap_bps as u128 / BPS as u128) as u64;
    let cap = limits.exposure_cap_min.max(pct);
    let unproven = st.payout_total.checked_sub(st.committed_payout_total).ok_or(ScoreError::Math)?;
    require!(unproven.checked_add(amount).ok_or(ScoreError::Math)? <= cap, ScoreError::OverCap);
    Ok(())
}

/// Checks shared by `withdraw` and `request_withdrawal`: live, not paused, voucher valid and unused.
/// Returns the limits, so callers don't read the config twice.
#[allow(clippy::too_many_arguments)]
pub fn accept_voucher(
    state: &AccountLoader<State>,
    config: &Config,
    page: &AccountLoader<VoucherPage>,
    instructions: &AccountInfo,
    user: &Pubkey,
    amount: u64,
    id: u64,
    expiry: i64,
) -> Result<Limits> {
    {
        let st = state.load()?;
        st.require_live()?;
        require!(!st.withdrawals_paused(), ScoreError::Paused);
    }
    require!(amount > 0, ScoreError::ZeroAmount);
    require!(id & FORCED_ID_BIT == 0, ScoreError::WrongPage); // that id space is forced holds'
    let now = Clock::get()?.unix_timestamp;
    require!(now <= expiry, ScoreError::VoucherExpired);
    require!(expiry.saturating_sub(now) <= config.limits.voucher_max_ttl, ScoreError::VoucherTooLong);
    check_ed25519(instructions, &config.keys.voucher_signer, &voucher_message(&crate::ID, user, amount, id, expiry))?;
    let mut p = page.load_mut()?;
    require!(p.page == id / PAGE_BITS, ScoreError::WrongPage);
    require!(!p.test_and_set(id), ScoreError::VoucherUsed);
    Ok(config.limits)
}
