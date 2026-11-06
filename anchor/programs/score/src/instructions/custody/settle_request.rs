use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ScoreError;
use crate::events::Paid;
use crate::shared::{check_exposure, pay_out, record_payout};
use crate::state::{Config, Pending, State, WithdrawRequest};

#[derive(Accounts)]
pub struct SettleRequest<'info> {
    #[account(address = CONFIG_ADDRESS, has_one = usdc_mint, has_one = custody, has_one = pending)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    #[account(mut)]
    pub pending: AccountLoader<'info, Pending>,
    /// Requests are only created by `request_withdrawal`, at their own PDA (one per voucher id).
    #[account(mut, close = rent_to)]
    pub withdraw_request: Account<'info, WithdrawRequest>,
    /// The request's payer gets the rent back.
    #[account(mut, address = withdraw_request.payer @ ScoreError::Unauthorized)]
    pub rent_to: SystemAccount<'info>,
    #[account(mut, token::mint = usdc_mint, token::authority = withdraw_request.user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub custody: Account<'info, TokenAccount>,
    /// CHECK: custody authority PDA (signs via seeds).
    #[account(address = CUSTODY_AUTH_ADDRESS)]
    pub custody_auth: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    /// The operator's approval, needed to pay above the cap: a stolen permit key alone stays capped.
    pub operator: Option<Signer<'info>>,
}

/// Pay a recorded request once a later batch has been committed. Without the operator's approval:
/// permissionless, within the cap. With it: above the cap, and kept out of the instant cap.
/// Not in exit mode: there, `exit_withdraw` pays a request only if the last exit table still holds
/// its lock (otherwise the money is already in the user's committed balance, and paying the
/// request too would pay it twice).
pub fn handle_settle_request(ctx: Context<SettleRequest>) -> Result<()> {
    let a = &ctx.accounts;
    let (id, user, amount) = (a.withdraw_request.id, a.withdraw_request.user, a.withdraw_request.amount);
    let (seq, hash) = {
        let mut st = a.state.load_mut()?;
        st.require_live()?;
        require!(st.batch_seq > a.withdraw_request.batch_seq, ScoreError::NotYet);
        require!(!st.withdrawals_paused(), ScoreError::Paused);
        let cfg = a.config.load()?;
        let approved = match &a.operator {
            Some(op) => {
                require_keys_eq!(op.key(), cfg.keys.operator, ScoreError::Unauthorized);
                true
            }
            None => false,
        };
        if !approved {
            check_exposure(&st, &cfg.limits, a.custody.amount, amount)?;
        }
        let r = record_payout(&mut st, &mut *a.pending.load_mut()?, PAYOUT_VOUCHER, id, &user, amount)?;
        if approved {
            // Approved by both keys: don't let it use up the users' instant-withdrawal cap.
            st.committed_payout_total = st.committed_payout_total.checked_add(amount).ok_or(ScoreError::Math)?;
        }
        r
    };
    pay_out(&a.token_program, &a.custody, &a.user_usdc, &a.usdc_mint, &a.custody_auth, CUSTODY_AUTH_BUMP, amount)?;
    emit!(Paid { seq, kind: PAYOUT_VOUCHER, id, to: user, amount, hash });
    Ok(())
}
