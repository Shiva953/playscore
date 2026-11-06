use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ScoreError;
use crate::events::ForceRequested;
use crate::state::{Config, ForcedRequest, State};

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct ForceRequest<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(address = CONFIG_ADDRESS)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    #[account(init, payer = user, space = 8 + ForcedRequest::INIT_SPACE, seeds = [FORCE_SEED, &index.to_le_bytes()], bump)]
    pub forced_request: Account<'info, ForcedRequest>,
    pub system_program: Program<'info, System>,
}

/// A request the operator must include in a batch within `forced_deadline`, or exit mode opens.
/// Paid for by the user: it is the path for when our relayer won't help.
pub fn handle_force_request(ctx: Context<ForceRequest>, index: u64, kind: u8, data: [u8; 32]) -> Result<()> {
    let user = ctx.accounts.user.key();
    {
        let mut st = ctx.accounts.state.load_mut()?;
        st.require_live()?;
        require!(index == st.forced_count.checked_add(1).ok_or(ScoreError::Math)?, ScoreError::WrongForcedRequest);
        st.forced_count = index;
    }
    let r = &mut ctx.accounts.forced_request;
    r.index = index;
    r.user = user;
    r.kind = kind;
    r.data = data;
    r.ts = Clock::get()?.unix_timestamp;
    emit!(ForceRequested { index, user, kind, data });
    Ok(())
}
