use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::events::Paid;
use crate::shared::{accept_voucher, check_exposure, pay_out, record_payout};
use crate::state::{Config, Pending, State, VoucherPage};

#[derive(Accounts)]
#[instruction(amount: u64, id: u64)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,
    #[account(address = CONFIG_ADDRESS, has_one = usdc_mint, has_one = custody, has_one = pending)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    #[account(mut)]
    pub pending: AccountLoader<'info, Pending>,
    /// Checked by `accept_voucher`: its stored page index must be `id / PAGE_BITS`. Pages are only
    /// created by `init_voucher_page`, at their own PDA, so the index identifies the account.
    #[account(mut)]
    pub page: AccountLoader<'info, VoucherPage>,
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub custody: Account<'info, TokenAccount>,
    /// CHECK: custody authority PDA (signs via seeds).
    #[account(address = CUSTODY_AUTH_ADDRESS)]
    pub custody_auth: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    /// CHECK: the instructions sysvar, pinned by address.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Instant withdrawal against an engine voucher, paid in this transaction, within the cap.
pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64, id: u64, expiry: i64) -> Result<()> {
    let a = &ctx.accounts;
    let user = a.user.key();
    let limits = accept_voucher(&a.state, &*a.config.load()?, &a.page, &a.instructions, &user, amount, id, expiry)?;
    let (seq, hash) = {
        let mut st = a.state.load_mut()?;
        check_exposure(&st, &limits, a.custody.amount, amount)?;
        record_payout(&mut st, &mut *a.pending.load_mut()?, PAYOUT_VOUCHER, id, &user, amount)?
    };
    pay_out(&a.token_program, &a.custody, &a.user_usdc, &a.usdc_mint, &a.custody_auth, CUSTODY_AUTH_BUMP, amount)?;
    emit!(Paid { seq, kind: PAYOUT_VOUCHER, id, to: user, amount, hash });
    Ok(())
}
