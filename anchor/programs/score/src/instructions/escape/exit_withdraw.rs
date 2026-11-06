use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ScoreError;
use crate::events::{ExitPaid, Paid};
use crate::shared::{chain_payout, pay_out};
use crate::state::{Config, ExitLock, Exited, Pending, ProofNode, State, VoucherPage, WithdrawRequest};
use crate::verify::{exit_leaf, verify_proof};

#[derive(Accounts)]
pub struct ExitWithdraw<'info> {
    pub user: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(address = CONFIG_ADDRESS, has_one = usdc_mint, has_one = custody, has_one = pending)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, address = STATE_ADDRESS)]
    pub state: AccountLoader<'info, State>,
    pub pending: AccountLoader<'info, Pending>,
    /// Exists once the user has exited: `init` fails the second time.
    #[account(init, payer = payer, space = 8 + Exited::INIT_SPACE, seeds = [EXITED_SEED, user.key().as_ref()], bump)]
    pub marker: Account<'info, Exited>,
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub custody: Account<'info, TokenAccount>,
    /// CHECK: custody authority PDA (signs via seeds).
    #[account(address = CUSTODY_AUTH_ADDRESS)]
    pub custody_auth: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Exit mode only: settle the user once, against the last committed exit table plus everything
/// that happened on-chain after that batch's cut. The user is paid:
/// - their committed USDC (`usdc`, proven by the exit root),
/// - plus the pending withdrawal locks from the same leaf, unless already paid on-chain,
/// - plus their deposits after the cut (no batch credited them),
/// - minus their voucher payouts after the cut whose lock isn't in the leaf (the lock came after
///   the cut, so that money is still inside `usdc`).
///
/// A user with no committed entry, or who only wants their later deposits back, passes
/// `usdc = 0` and no locks; that needs no proof, because it can never pay more than the full
/// settlement. Remaining accounts, writable, two per lock in order: the lock's voucher page, then
/// its withdrawal-request PDA (either may not exist).
pub fn handle_exit_withdraw<'info>(ctx: Context<'info, ExitWithdraw<'info>>, usdc: u64, locks: Vec<ExitLock>, proof: Vec<ProofNode>) -> Result<()> {
    require!(locks.len() <= MAX_EXIT_LOCKS && proof.len() <= MAX_PROOF, ScoreError::TooMany);
    let user = ctx.accounts.user.key();
    let (root, committed_deposits, deposit_count, committed_payouts, exit_payouts) = {
        let st = ctx.accounts.state.load()?;
        require!(st.in_exit_mode(), ScoreError::NotExitMode);
        (st.exit_root, st.committed_deposits, st.deposit_count, st.committed_payouts, st.exit_payouts)
    };
    if usdc > 0 || !locks.is_empty() {
        require!(verify_proof(&root, exit_leaf(&user, usdc, &locks), &proof), ScoreError::BadProof);
    }
    require!(ctx.remaining_accounts.len() == 2 * locks.len(), ScoreError::WrongPage);

    // On-chain activity after the cut. `deposit` and `record_payout` keep both within the log.
    let mut owed_after = 0u128;
    let mut paid_after = 0u128;
    let mut forced_paid = [false; MAX_EXIT_LOCKS];
    {
        let p = ctx.accounts.pending.load()?;
        for seq in committed_deposits + 1..=deposit_count {
            let d = p.deposit(seq);
            if d.user == user {
                owed_after += d.amount as u128;
            }
        }
        for seq in committed_payouts + 1..=exit_payouts {
            let o = p.payout(seq);
            if o.kind == PAYOUT_VOUCHER && o.to == user {
                match locks.iter().position(|l| l.id == o.id) {
                    // A forced hold in the leaf, paid after the cut by `serve_forced`.
                    Some(i) if o.id & FORCED_ID_BIT != 0 => forced_paid[i] = true,
                    Some(_) => {} // a voucher lock in the leaf: its page bit settles it below
                    None => paid_after += o.amount as u128,
                }
            }
        }
    }

    let mut total = usdc as u128;
    for (i, (lock, accs)) in locks.iter().zip(ctx.remaining_accounts.chunks(2)).enumerate() {
        let unpaid = if lock.id & FORCED_ID_BIT != 0 {
            // A forced hold has no voucher page: only `serve_forced` pays it, on the payout chain.
            // Paid at or before the cut, the engine would have dropped it from the leaf.
            !forced_paid[i]
        } else {
            lock_unpaid(ctx.program_id, &user, lock, &accs[0], &accs[1])?
        };
        if unpaid {
            total += lock.amount as u128;
        }
    }
    // Floored at zero: someone who withdrew gains made after the cut can't be charged back here.
    // That loss is bounded by the exposure cap.
    let total = (total + owed_after).saturating_sub(paid_after);
    let total = u64::try_from(total).map_err(|_| ScoreError::Math)?;

    let (seq, hash) = {
        let mut st = ctx.accounts.state.load_mut()?;
        chain_payout(&mut st, PAYOUT_EXIT, 0, &user, total)?
    };
    let m = &mut ctx.accounts.marker;
    m.user = user;
    m.amount = total;
    let a = &ctx.accounts;
    if total > 0 {
        pay_out(&a.token_program, &a.custody, &a.user_usdc, &a.usdc_mint, &a.custody_auth, CUSTODY_AUTH_BUMP, total)?;
    }
    emit!(Paid { seq, kind: PAYOUT_EXIT, id: 0, to: user, amount: total, hash });
    emit!(ExitPaid { user, amount: total });
    Ok(())
}

/// Whether a lock from the user's exit leaf is still owed, marking it settled if so. Owed when its
/// voucher was never used, or when it was recorded as a withdrawal request that was never paid
/// (a request marks the voucher used, and `settle_request` is off in exit mode).
fn lock_unpaid<'info>(program_id: &Pubkey, user: &Pubkey, lock: &ExitLock, page_acc: &'info AccountInfo<'info>, req_acc: &'info AccountInfo<'info>) -> Result<bool> {
    // Remaining accounts are unchecked by Anchor: verify owner, type and identity here.
    if page_acc.owner != program_id || page_acc.data_len() == 0 {
        // "Never created, so no voucher in it was ever used" needs proof that this is the page's
        // canonical address (the only place `init_voucher_page` could have created it).
        let (page_key, _) = Pubkey::find_program_address(&[PAGE_SEED, &(lock.id / PAGE_BITS).to_le_bytes()], program_id);
        require_keys_eq!(page_acc.key(), page_key, ScoreError::WrongPage);
        require!(page_acc.data_len() == 0, ScoreError::WrongPage);
        return Ok(true);
    }
    require!(page_acc.is_writable, ScoreError::WrongPage);
    let loader = AccountLoader::<VoucherPage>::try_from(page_acc)?;
    let mut page = loader.load_mut()?;
    // A page records its own index, and exists only at that index's PDA.
    require!(page.page == lock.id / PAGE_BITS, ScoreError::WrongPage);
    if !page.test_and_set(lock.id) {
        return Ok(true); // never used; now it can't be
    }
    drop(page);

    // Requests exist only at their voucher id's PDA, so the stored id identifies the request. A
    // missing or foreign account here can only lower what this user is paid.
    if req_acc.owner != program_id || req_acc.data_len() == 0 {
        return Ok(false); // paid instantly, or the request was already settled and closed
    }
    require!(req_acc.is_writable, ScoreError::WrongRequest);
    let mut req = Account::<WithdrawRequest>::try_from(req_acc)?;
    if req.settled_in_exit() {
        return Ok(false); // settled here before
    }
    require!(req.user == *user && req.id == lock.id && req.amount == lock.amount, ScoreError::WrongRequest);
    req.mark_settled_in_exit();
    req.exit(program_id)?;
    Ok(true)
}
