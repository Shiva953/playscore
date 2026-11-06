use anchor_lang::prelude::*;

use crate::constants::PAGE_SEED;
use crate::state::VoucherPage;

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct InitVoucherPage<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + std::mem::size_of::<VoucherPage>(), seeds = [PAGE_SEED, &index.to_le_bytes()], bump)]
    pub page: AccountLoader<'info, VoucherPage>,
    pub system_program: Program<'info, System>,
}

/// Create the bitmap for voucher ids `index * 8192 ..`. Permissionless; the payer pays the rent.
pub fn handle_init_voucher_page(ctx: Context<InitVoucherPage>, index: u64) -> Result<()> {
    ctx.accounts.page.load_init()?.page = index;
    Ok(())
}
