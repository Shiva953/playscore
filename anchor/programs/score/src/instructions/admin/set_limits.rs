use anchor_lang::prelude::*;

use super::AdminOnly;
use crate::error::ScoreError;
use crate::state::Limits;

pub fn handle_set_limits(ctx: Context<AdminOnly>, limits: Limits) -> Result<()> {
    require!(limits.valid(), ScoreError::BadLimits);
    ctx.accounts.config.load_mut()?.limits = limits;
    Ok(())
}
