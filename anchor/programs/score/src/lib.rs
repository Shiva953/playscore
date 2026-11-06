//! score custody program (Phase 1). Holds all user USDC; trading runs in the off-chain engine.
//! Deposits and withdrawals are on-chain and instant (withdrawals against engine-signed permits,
//! capped since the last batch). Batches post the engine's roots and are checked against the
//! program's own deposit/payout chains and reserves. If the operator stops committing or ignores a
//! forced request, anyone can switch on exit mode and every user withdraws their committed share.

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod shared;
pub mod state;
pub mod verify;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("3tP3HKuoPDYKvUuGUYeRXbNQZHQeHU5BabRCwZwcXELo");

#[program]
pub mod score {
    use super::*;


    /// One-time setup. Only the program's upgrade authority may call it, so it can't be
    /// front-run after deployment.
    pub fn initialize(ctx: Context<Initialize>, admin: Pubkey, keys: Keys, limits: Limits) -> Result<()> {
        instructions::admin::initialize::handle_initialize(ctx, admin, keys, limits)
    }

    pub fn set_keys(ctx: Context<AdminOnly>, keys: Keys) -> Result<()> {
        instructions::admin::set_keys::handle_set_keys(ctx, keys)
    }

    pub fn set_limits(ctx: Context<AdminOnly>, limits: Limits) -> Result<()> {
        instructions::admin::set_limits::handle_set_limits(ctx, limits)
    }

    /// Two-step admin transfer, step 1: the current admin nominates.
    pub fn nominate_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::transfer_admin::handle_nominate_admin(ctx, new_admin)
    }

    /// Two-step admin transfer, step 2: the nominee accepts.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::transfer_admin::handle_accept_admin(ctx)
    }

    /// The admin may set any flags; the pauser may only add flags.
    pub fn set_pause(ctx: Context<SetPause>, flags: u8) -> Result<()> {
        instructions::admin::set_pause::handle_set_pause(ctx, flags)
    }

    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        instructions::admin::withdraw_treasury::handle_withdraw_treasury(ctx, amount)
    }


    pub fn init_voucher_page(ctx: Context<InitVoucherPage>, index: u64) -> Result<()> {
        instructions::custody::init_voucher_page::handle_init_voucher_page(ctx, index)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::custody::deposit::handle_deposit(ctx, amount)
    }

    /// Instant withdrawal against an engine voucher, paid in this transaction.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64, id: u64, expiry: i64) -> Result<()> {
        instructions::custody::withdraw::handle_withdraw(ctx, amount, id, expiry)
    }

    /// Record a voucher withdrawal (typically one above the exposure cap) for payment after the
    /// next committed batch.
    pub fn request_withdrawal(ctx: Context<RequestWithdrawal>, amount: u64, id: u64, expiry: i64) -> Result<()> {
        instructions::custody::request_withdrawal::handle_request_withdrawal(ctx, amount, id, expiry)
    }

    /// Pay a recorded request once a later batch has been committed. Not in exit mode, where
    /// `exit_withdraw` settles requests.
    pub fn settle_request(ctx: Context<SettleRequest>) -> Result<()> {
        instructions::custody::settle_request::handle_settle_request(ctx)
    }


    pub fn commit_batch(ctx: Context<CommitBatch>, b: Batch) -> Result<()> {
        instructions::batch::commit_batch::handle_commit_batch(ctx, b)
    }


    /// A request the operator must include in a batch within `forced_deadline`, or exit mode opens.
    pub fn force_request(ctx: Context<ForceRequest>, index: u64, kind: u8, data: [u8; 32]) -> Result<()> {
        instructions::escape::force_request::handle_force_request(ctx, index, kind, data)
    }

    /// Operator: answer the oldest unserved forced request (in order), paying a forced withdrawal
    /// to the user. The request's rent goes back to the user.
    pub fn serve_forced(ctx: Context<ServeForced>, index: u64, amount: u64) -> Result<()> {
        instructions::escape::serve_forced::handle_serve_forced(ctx, index, amount)
    }

    /// Permissionless and irreversible, once the operator has stopped committing or ignored a
    /// forced request.
    pub fn enter_exit_mode(ctx: Context<EnterExitMode>) -> Result<()> {
        instructions::escape::enter_exit_mode::handle_enter_exit_mode(ctx)
    }

    /// Exit mode only: pay the user once: their committed exit-table entry, plus deposits after
    /// that batch, minus withdrawals already paid after it.
    pub fn exit_withdraw<'info>(ctx: Context<'info, ExitWithdraw<'info>>, usdc: u64, locks: Vec<ExitLock>, proof: Vec<ProofNode>) -> Result<()> {
        instructions::escape::exit_withdraw::handle_exit_withdraw(ctx, usdc, locks, proof)
    }
}
