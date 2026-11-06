use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ScoreError;
use crate::state::{Config, State};

#[derive(Accounts)]
pub struct SetPause<'info> {
    pub signer: Signer<'info>,
    #[account(address = CONFIG_ADDRESS)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
}

/// The admin may set any flags; the pauser may only add flags.
pub fn handle_set_pause(ctx: Context<SetPause>, flags: u8) -> Result<()> {
    require!(flags & !PAUSE_ALL == 0, ScoreError::Unauthorized);
    let signer = ctx.accounts.signer.key();
    let cfg = *ctx.accounts.config.load()?;
    require!(signer == cfg.admin || signer == cfg.keys.pauser, ScoreError::Unauthorized);
    let mut st = ctx.accounts.state.load_mut()?;
    if signer != cfg.admin {
        require!(flags & st.paused == st.paused, ScoreError::PauserCannotUnpause);
    }
    st.paused = flags;
    Ok(())
}
