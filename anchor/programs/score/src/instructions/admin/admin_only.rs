use anchor_lang::prelude::*;

use crate::constants::CONFIG_ADDRESS;
use crate::error::ScoreError;
use crate::state::Config;

/// Accounts for admin-only config changes (`set_keys`, `set_limits`, `nominate_admin`).
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, address = CONFIG_ADDRESS, has_one = admin @ ScoreError::Unauthorized)]
    pub config: AccountLoader<'info, Config>,
}
