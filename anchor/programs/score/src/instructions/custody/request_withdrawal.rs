use anchor_lang::prelude::*;

use crate::constants::*;
use crate::events::WithdrawalRequested;
use crate::shared::accept_voucher;
use crate::state::{Config, State, VoucherPage, WithdrawRequest};

#[derive(Accounts)]
#[instruction(amount: u64, id: u64)]
pub struct RequestWithdrawal<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    #[account(address = CONFIG_ADDRESS)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    /// Checked by `accept_voucher`: its stored page index must be `id / PAGE_BITS`. Pages are only
    /// created by `init_voucher_page`, at their own PDA, so the index identifies the account.
    #[account(mut)]
    pub page: AccountLoader<'info, VoucherPage>,
    #[account(init, payer = payer, space = 8 + WithdrawRequest::INIT_SPACE, seeds = [REQUEST_SEED, &id.to_le_bytes()], bump)]
    pub withdraw_request: Account<'info, WithdrawRequest>,
    /// CHECK: the instructions sysvar, pinned by address.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Record a voucher withdrawal (typically one above the exposure cap) for payment after the next
/// committed batch. The voucher is marked used now, so it can't also be paid instantly.
pub fn handle_request_withdrawal(ctx: Context<RequestWithdrawal>, amount: u64, id: u64, expiry: i64) -> Result<()> {
    let a = &ctx.accounts;
    let user = a.user.key();
    accept_voucher(&a.state, &*a.config.load()?, &a.page, &a.instructions, &user, amount, id, expiry)?;
    let batch_seq = a.state.load()?.batch_seq;
    let r = &mut ctx.accounts.withdraw_request;
    r.id = id;
    r.user = user;
    r.amount = amount;
    r.batch_seq = batch_seq;
    r.payer = ctx.accounts.payer.key();
    emit!(WithdrawalRequested { id, user, amount });
    Ok(())
}
