use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::ScoreError;
use crate::events::Deposited;
use crate::state::{Checkpoint, Config, DepositSlot, Pending, State};
use crate::verify::deposit_link;

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    #[account(address = CONFIG_ADDRESS, has_one = usdc_mint, has_one = custody, has_one = pending)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    #[account(mut)]
    pub pending: AccountLoader<'info, Pending>,
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub custody: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// USDC wallet -> custody. Extends the deposit hash chain the next batch must consume exactly, and
/// records the deposit in `Pending` so exit mode can return it if no batch ever includes it.
pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ScoreError::ZeroAmount);
    let user = ctx.accounts.user.key();
    let (seq, hash) = {
        let mut st = ctx.accounts.state.load_mut()?;
        st.require_live()?;
        require!(!st.deposits_paused(), ScoreError::Paused);
        let count = st.deposit_count.checked_add(1).ok_or(ScoreError::Math)?;
        // The slot this deposit overwrites must already be in a committed batch.
        require!(count - st.committed_deposits <= PENDING_DEPOSITS, ScoreError::TooManyPending);
        let total = st.deposit_total.checked_add(amount).ok_or(ScoreError::Math)?;
        let hash = deposit_link(&st.deposit_hash, count, &user, amount);
        st.deposit_count = count;
        st.deposit_total = total;
        st.deposit_hash = hash;
        st.deposit_ring[(count % RING as u64) as usize] = Checkpoint { count, total, hash };
        ctx.accounts.pending.load_mut()?.deposits[((count - 1) % PENDING_DEPOSITS) as usize] = DepositSlot { user, amount };
        (count, hash)
    };
    let a = &ctx.accounts;
    let accounts = TransferChecked {
        from: a.user_usdc.to_account_info(),
        mint: a.usdc_mint.to_account_info(),
        to: a.custody.to_account_info(),
        authority: a.user.to_account_info(),
    };
    token::transfer_checked(CpiContext::new(a.token_program.key(), accounts), amount, a.usdc_mint.decimals)?;
    emit!(Deposited { seq, user, amount, hash });
    Ok(())
}
