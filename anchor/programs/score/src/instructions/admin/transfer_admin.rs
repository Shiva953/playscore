//! Two-step admin transfer: the current admin nominates, the nominee accepts.

use anchor_lang::prelude::*;

use super::AdminOnly;
use crate::constants::CONFIG_ADDRESS;
use crate::error::ScoreError;
use crate::state::Config;

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, address = CONFIG_ADDRESS,
        constraint = config.load()?.nominee() == Some(new_admin.key()) @ ScoreError::Unauthorized)]
    pub config: AccountLoader<'info, Config>,
}

pub fn handle_nominate_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.load_mut()?.set_nominee(Some(new_admin));
    Ok(())
}

pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let mut c = ctx.accounts.config.load_mut()?;
    c.admin = c.nominee().ok_or(ScoreError::NoPendingAdmin)?;
    c.set_nominee(None);
    Ok(())
}
