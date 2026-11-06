use anchor_lang::prelude::*;

use super::AdminOnly;
use crate::state::Keys;

/// Rotate the operator, voucher and pauser keys.
pub fn handle_set_keys(ctx: Context<AdminOnly>, keys: Keys) -> Result<()> {
    ctx.accounts.config.load_mut()?.keys = keys;
    Ok(())
}
