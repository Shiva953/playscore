use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ScoreError;
use crate::events::Paid;
use crate::shared::{record_payout, transfer_signed};
use crate::state::{Config, Pending, State};

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    pub admin: Signer<'info>,
    #[account(address = CONFIG_ADDRESS, has_one = admin @ ScoreError::Unauthorized, has_one = usdc_mint, has_one = treasury, has_one = pending)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    #[account(mut)]
    pub pending: AccountLoader<'info, Pending>,
    #[account(mut, token::mint = usdc_mint, constraint = to.key() != treasury.key() @ ScoreError::Unauthorized)]
    pub to: Account<'info, TokenAccount>,
    /// The treasury token account: the only one this instruction can sign for.
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    /// CHECK: treasury authority PDA (signs via seeds).
    #[account(address = TREASURY_AUTH_ADDRESS)]
    pub treasury_auth: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Pays out of the treasury account (never custody), up to the treasury figure the last batch
/// committed, one withdrawal per batch.
pub fn handle_withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
    require!(amount > 0, ScoreError::ZeroAmount);
    let to = ctx.accounts.to.key();
    let (seq, hash) = {
        let mut st = ctx.accounts.state.load_mut()?;
        st.require_live()?;
        require!(st.uncovered_treasury_payout().is_none(), ScoreError::TreasuryPending);
        require!(amount <= st.committed_treasury, ScoreError::TreasuryLow);
        st.committed_treasury -= amount;
        let r = record_payout(&mut st, &mut *ctx.accounts.pending.load_mut()?, PAYOUT_TREASURY, 0, &to, amount)?;
        // Not a custody payout: keep it out of the users' instant-withdrawal cap.
        st.committed_payout_total = st.committed_payout_total.checked_add(amount).ok_or(ScoreError::Math)?;
        // The next batch must show the engine consumed this withdrawal before another one.
        st.set_uncovered_treasury_payout(Some(r.0));
        r
    };
    let a = &ctx.accounts;
    transfer_signed(&a.token_program, &a.treasury, &a.to, &a.usdc_mint, &a.treasury_auth, TREASURY_AUTH_SEED, TREASURY_AUTH_BUMP, amount)?;
    emit!(Paid { seq, kind: PAYOUT_TREASURY, id: 0, to, amount, hash });
    Ok(())
}
