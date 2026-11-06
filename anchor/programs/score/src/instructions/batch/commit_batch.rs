use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ScoreError;
use crate::events::BatchCommitted;
use crate::shared::transfer_signed;
use crate::state::{Batch, Config, State};

#[derive(Accounts)]
pub struct CommitBatch<'info> {
    pub operator: Signer<'info>,
    #[account(address = CONFIG_ADDRESS, has_one = custody, has_one = vault, has_one = treasury, has_one = usdc_mint,
        constraint = config.load()?.keys.operator == operator.key() @ ScoreError::Unauthorized)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    #[account(mut)]
    pub custody: Box<Account<'info, TokenAccount>>,
    /// CHECK: custody authority PDA (signs via seeds).
    #[account(address = CUSTODY_AUTH_ADDRESS)]
    pub custody_auth: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: vault authority PDA (signs via seeds).
    #[account(address = VAULT_AUTH_ADDRESS)]
    pub vault_auth: UncheckedAccount<'info>,
    #[account(mut)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

/// The operator posts the new state root and exit root. The program checks the deposit and
/// payout cuts against its own chains, then syncs the money: it moves the change in the engine's
/// vault and treasury figures since the last batch between custody and those accounts, and checks
/// custody still covers everything owed to users at that cut. Phase 2 adds a validity proof here.
pub fn handle_commit_batch(ctx: Context<CommitBatch>, b: Batch) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let custody_balance = ctx.accounts.custody.amount;
    let (to_vault, to_treasury) = {
        let mut st = ctx.accounts.state.load_mut()?;
        st.require_live()?;
        require!(b.seq == st.batch_seq.checked_add(1).ok_or(ScoreError::Math)?, ScoreError::BadSequence);
        require!(b.prev_state_root == st.state_root, ScoreError::BadPrevRoot);

        // The cuts must be real points on the on-chain chains, and never move backwards.
        require!(b.deposits >= st.committed_deposits && b.deposits <= st.deposit_count, ScoreError::BadDeposits);
        let (dep_total, dep_hash) =
            State::lookup(&st.deposit_ring, (st.deposit_count, st.deposit_total, st.deposit_hash), b.deposits).ok_or(ScoreError::BadDeposits)?;
        require!(dep_hash == b.deposit_hash, ScoreError::BadDeposits);
        require!(b.payouts >= st.committed_payouts && b.payouts <= st.payout_count, ScoreError::BadPayouts);
        let (pay_total, pay_hash) =
            State::lookup(&st.payout_ring, (st.payout_count, st.payout_total, st.payout_hash), b.payouts).ok_or(ScoreError::BadPayouts)?;
        require!(pay_hash == b.payout_hash, ScoreError::BadPayouts);
        // A treasury withdrawal must be in this cut, so the engine's figure already excludes it.
        if let Some(payout) = st.uncovered_treasury_payout() {
            require!(b.payouts >= payout, ScoreError::TreasuryPending);
        }
        // Only `serve_forced` marks forced requests served.
        require!(b.forced_served == st.forced_served, ScoreError::BadForced);

        // Money sync: the vault moves either way (fees in, dividends out to holders' balances);
        // the treasury only grows here, and only `withdraw_treasury` takes money out of it.
        require!(b.treasury >= st.committed_treasury, ScoreError::TreasuryDecrease);
        let to_treasury = b.treasury - st.committed_treasury;
        let to_vault = b.vault as i128 - st.committed_vault as i128;

        // Reserves: custody after the sweep, adjusted back to the batch's cut, covers everything
        // the engine owes users (all liabilities except its vault and treasury figures).
        let owed_users = (b.liabilities as u128).checked_sub(b.vault as u128 + b.treasury as u128).ok_or(ScoreError::Undercollateralised)?;
        let paid_since = st.payout_total.checked_sub(pay_total).ok_or(ScoreError::Math)?;
        let deposited_since = st.deposit_total.checked_sub(dep_total).ok_or(ScoreError::Math)?;
        let after_sweep = custody_balance as i128 - to_vault - to_treasury as i128;
        require!(after_sweep >= 0, ScoreError::Undercollateralised);
        let at_cut = after_sweep + paid_since as i128 - deposited_since as i128;
        require!(at_cut >= owed_users as i128, ScoreError::Undercollateralised);

        st.batch_seq = b.seq;
        st.state_root = b.state_root;
        st.exit_root = b.exit_root;
        st.log_head = b.log_head;
        st.committed_deposits = b.deposits;
        st.committed_payouts = b.payouts;
        st.committed_payout_total = pay_total;
        st.committed_treasury = b.treasury;
        st.committed_vault = b.vault;
        st.set_uncovered_treasury_payout(None);
        st.last_commit_ts = now;
        (to_vault, to_treasury)
    };

    let a = &ctx.accounts;
    if to_vault > 0 {
        transfer_signed(&a.token_program, &a.custody, &a.vault, &a.usdc_mint, &a.custody_auth, CUSTODY_AUTH_SEED, CUSTODY_AUTH_BUMP, to_vault as u64)?;
    } else if to_vault < 0 {
        transfer_signed(&a.token_program, &a.vault, &a.custody, &a.usdc_mint, &a.vault_auth, VAULT_AUTH_SEED, VAULT_AUTH_BUMP, (-to_vault) as u64)?;
    }
    if to_treasury > 0 {
        transfer_signed(&a.token_program, &a.custody, &a.treasury, &a.usdc_mint, &a.custody_auth, CUSTODY_AUTH_SEED, CUSTODY_AUTH_BUMP, to_treasury)?;
    }
    emit!(BatchCommitted { seq: b.seq, state_root: b.state_root, exit_root: b.exit_root, deposits: b.deposits, payouts: b.payouts, vault: b.vault, treasury: b.treasury });
    Ok(())
}
