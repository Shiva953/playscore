use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ScoreError;
use crate::events::ExitModeEntered;
use crate::state::{Config, ForcedRequest, State};

#[derive(Accounts)]
pub struct EnterExitMode<'info> {
    #[account(address = CONFIG_ADDRESS)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    /// The oldest unserved forced request, when that is the reason.
    /// Forced requests are only created by `force_request`, one per index; the index is checked below.
    pub oldest: Option<Account<'info, ForcedRequest>>,
}

/// Permissionless and irreversible: the oldest unserved forced request is past its deadline, or
/// no batch has been committed for `liveness_deadline`.
pub fn handle_enter_exit_mode(ctx: Context<EnterExitMode>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let limits = ctx.accounts.config.load()?.limits;
    let mut st = ctx.accounts.state.load_mut()?;
    st.require_live()?;
    let mut reason = None;
    if st.forced_count > st.forced_served {
        if let Some(r) = &ctx.accounts.oldest {
            require!(r.index == st.forced_served + 1, ScoreError::WrongForcedRequest);
            if now.saturating_sub(r.ts) > limits.forced_deadline {
                reason = Some(0);
            }
        }
    }
    if reason.is_none() && now.saturating_sub(st.last_commit_ts) > limits.liveness_deadline {
        reason = Some(1);
    }
    let reason = reason.ok_or(ScoreError::ExitNotAllowed)?;
    st.set_exit_mode();
    st.exit_payouts = st.payout_count;
    emit!(ExitModeEntered { reason });
    Ok(())
}
