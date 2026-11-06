use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ScoreError;
use crate::events::{ForcedServed, Paid};
use crate::shared::{pay_out, record_payout};
use crate::state::{Config, ForcedRequest, Pending, State};

#[derive(Accounts)]
pub struct ServeForced<'info> {
    pub operator: Signer<'info>,
    #[account(address = CONFIG_ADDRESS, has_one = usdc_mint, has_one = custody, has_one = pending,
        constraint = config.load()?.keys.operator == operator.key() @ ScoreError::Unauthorized)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    #[account(mut)]
    pub pending: AccountLoader<'info, Pending>,
    /// Only `force_request` creates these, at their own PDA, so the stored index identifies it.
    #[account(mut, close = user)]
    pub forced_request: Account<'info, ForcedRequest>,
    /// The requester: gets the rent back.
    #[account(mut, address = forced_request.user @ ScoreError::Unauthorized)]
    pub user: SystemAccount<'info>,
    /// Where a forced withdrawal is paid (only needed when `amount` > 0).
    #[account(mut, token::mint = usdc_mint, token::authority = forced_request.user)]
    pub user_usdc: Option<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub custody: Account<'info, TokenAccount>,
    /// CHECK: custody authority PDA (signs via seeds).
    #[account(address = CUSTODY_AUTH_ADDRESS)]
    pub custody_auth: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Answer the oldest unserved forced request. A withdrawal pays `amount` (at most what was asked)
/// as payout id `FORCED_ID_BIT | index`, outside the instant cap; anything else answers with 0.
pub fn handle_serve_forced(ctx: Context<ServeForced>, index: u64, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    let r = &a.forced_request;
    require!(r.index == index, ScoreError::WrongForcedRequest);
    let paid = {
        let mut st = a.state.load_mut()?;
        st.require_live()?;
        require!(index == st.forced_served.checked_add(1).ok_or(ScoreError::Math)?, ScoreError::WrongForcedRequest);
        st.forced_served = index;
        if amount > 0 {
            require!(r.kind == FORCED_WITHDRAW, ScoreError::ForcedAmount);
            let asked = u64::from_le_bytes(r.data[..8].try_into().unwrap());
            require!(asked == 0 || amount <= asked, ScoreError::ForcedAmount);
            require!(!st.withdrawals_paused(), ScoreError::Paused);
            let id = FORCED_ID_BIT | index;
            let (seq, hash) = record_payout(&mut st, &mut *a.pending.load_mut()?, PAYOUT_VOUCHER, id, &r.user, amount)?;
            // Approved by the operator key: don't let it use up the users' instant-withdrawal cap.
            st.committed_payout_total = st.committed_payout_total.checked_add(amount).ok_or(ScoreError::Math)?;
            Some((seq, hash, id))
        } else {
            None
        }
    };
    let user = r.user;
    if let Some((seq, hash, id)) = paid {
        let to = a.user_usdc.as_ref().ok_or(ScoreError::ForcedAmount)?;
        pay_out(&a.token_program, &a.custody, to, &a.usdc_mint, &a.custody_auth, CUSTODY_AUTH_BUMP, amount)?;
        emit!(Paid { seq, kind: PAYOUT_VOUCHER, id, to: user, amount, hash });
    }
    emit!(ForcedServed { index, user, amount });
    Ok(())
}
