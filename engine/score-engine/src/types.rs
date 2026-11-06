use std::collections::{BTreeMap, VecDeque};

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

/// A user is their Solana wallet's ed25519 public key.
pub type UserId = [u8; 32];
pub type PlayerId = u32;
/// Owner of the protocol's seed liquidity. The all-zero key has no private key, so no one can
/// sign as it.
pub const PROTOCOL: UserId = [0u8; 32];

/// Forced-request kinds (the program's `force_request`; same values on-chain).
/// Withdraw: `data[0..8]` = amount (u64 LE), 0 = all of the user's free balance.
/// Cancel: `data[0..8]` = the user's order id. Any other kind is answered with no effect.
pub const FORCED_WITHDRAW: u8 = 0;
pub const FORCED_CANCEL: u8 = 1;
/// The hold for forced request `index` has id `FORCED_ID_BIT | index` (never a voucher id).
pub const FORCED_ID_BIT: u64 = 1 << 63;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum MarketState {
    IcoLive,
    Bonded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum Side {
    /// Buy: locks USDC.
    Bid,
    /// Sell: locks player tokens.
    Ask,
}

/// One command to the engine. Its borsh encoding is the canonical byte form: users sign it (see
/// `auth`), and the log hashes it.
///
/// Variant order is part of the encoding. Append new variants at the end; never reorder.
///
/// Units: USDC and tokens in base units (6 decimals). `px` is an order-book price (see
/// `fixed::PX_SCALE`); `0` as a limit means "no limit".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum Cmd {
    // ---- facts observed on Solana: submitted only once FINALIZED; `seq` counters refuse gaps ----
    /// A finalized on-chain deposit. `seq` is the program's deposit counter and must be the next one,
    /// which deduplicates deposits and matches the batch's on-chain deposit hash.
    Deposit { user: UserId, amount: u64, seq: u64 },
    /// A finalized voucher payout: the locked funds have left custody. `seq` is the program's payout
    /// counter (vouchers and treasury withdrawals share it) and must be the next one.
    WithdrawPaid { id: u64, seq: u64 },

    // ---- user commands (must carry the user's signature) ----
    /// Take `amount` off the trading balance for an on-chain withdrawal voucher.
    LockWithdraw { user: UserId, nonce: u64, amount: u64, id: u64, expiry: i64 },
    /// Bonding curve (state IcoLive).
    BuyCurve { user: UserId, nonce: u64, player: PlayerId, usdc_in: u64, min_tokens: u64 },
    SellCurve { user: UserId, nonce: u64, player: PlayerId, tokens: u64, min_usdc: u64 },
    /// Market buy on a bonded player, routed across the order book and the pool. Fill-or-kill on
    /// `min_tokens`; anything not filled (limit reached, dust) stays in the wallet.
    Buy { user: UserId, nonce: u64, player: PlayerId, usdc_in: u64, min_tokens: u64, limit_px: u64 },
    Sell { user: UserId, nonce: u64, player: PlayerId, tokens_in: u64, min_usdc: u64, limit_px: u64 },
    /// Limit order: `amount` is USDC for a bid, tokens for an ask. Crosses as a taker up to `px`
    /// (unless `post_only`), and the rest rests on the book.
    PlaceOrder { user: UserId, nonce: u64, player: PlayerId, side: Side, px: u64, amount: u64, post_only: bool },
    CancelOrder { user: UserId, nonce: u64, order: u64 },
    /// Range liquidity. `lower_px = upper_px = 0` means full range.
    AddLiquidity { user: UserId, nonce: u64, player: PlayerId, lower_px: u64, upper_px: u64, max_usdc: u64, max_tokens: u64, min_liquidity: u128 },
    /// Removes liquidity and collects all fees the position has earned.
    RemoveLiquidity { user: UserId, nonce: u64, position: u64, liquidity: u128, min_usdc: u64, min_tokens: u64 },
    /// Take a credited dividend as USDC, or as tokens at +10% from the reserve.
    Claim { user: UserId, nonce: u64, round: u32, player: PlayerId, take_tokens: bool },

    // ---- system, oracle and admin (unsigned here; only the operator/admin channel may submit) ----
    /// Return an expired, never-used permit hold. Submitted only when finalized state past expiry
    /// shows the voucher unused at payout count `payouts_through`, which the engine must already
    /// have applied (so a payout of it can't still be on its way).
    ReleaseLock { id: u64, payouts_through: u64 },
    ListPlayer { player: PlayerId },
    /// Kickoff time of a round. A lock time that has passed can't be moved.
    PublishCalendar { round: u32, lock_ts: i64 },
    /// Record every holder's kickoff balance for `round` (sequenced at or after its lock time).
    Snapshot { round: u32 },
    /// Oracle result: USDC payout per player for `round`. Step 1 of 2: the payout is set aside from
    /// the vault (computed pro rata to the snapshot) but credited to no one yet. The next batch moves
    /// it from the vault account into custody; `BatchFinalized` then credits the holders.
    RoundResult { round: u32, payouts: Vec<(PlayerId, u64)> },
    /// Pauses trading only. Deposits, withdrawal locks and claims keep working.
    SetPaused { paused: bool },
    /// A finalized treasury withdrawal (same rule and payout counter as `WithdrawPaid`).
    WithdrawTreasury { amount: u64, seq: u64 },
    /// The voucher was recorded on-chain above the exposure cap and will be paid after the next
    /// batch: its lock must never be released on expiry.
    WithdrawRequested { id: u64 },
    /// Move the fees the protocol seed has earned out of the pool: USDC to the treasury (part to
    /// the vault if `Params::seed_fee_vault_bps` > 0), token fees burned. The seed principal stays.
    CollectSeedFees { player: PlayerId },
    /// Admin: change engine parameters (logged, so replay reproduces every change).
    SetParams { params: crate::engine::Params },
    /// The batch covering the log up to `cut` (a log sequence number) is FINALIZED on Solana, so
    /// every vault → custody move it made is final. Credits each set-aside round that batch funded.
    BatchFinalized { cut: u64 },
    /// A user's on-chain forced request (escape hatch), in the program's order. Never refused for
    /// its content, so it can't stall the watcher. Withdraw holds min(asked, free) as
    /// `FORCED_ID_BIT | index`, paid by `serve_forced`; cancel cancels the user's own order.
    Forced { index: u64, user: UserId, kind: u8, data: [u8; 32] },
    /// Forced request `index` was answered on-chain without payment: its hold goes back to free.
    ForcedUnpaid { index: u64 },
}

impl Cmd {
    /// The user who must sign this command, or `None` for system, oracle and admin commands.
    pub fn signer(&self) -> Option<&UserId> {
        match self {
            Cmd::LockWithdraw { user, .. }
            | Cmd::BuyCurve { user, .. }
            | Cmd::SellCurve { user, .. }
            | Cmd::Buy { user, .. }
            | Cmd::Sell { user, .. }
            | Cmd::PlaceOrder { user, .. }
            | Cmd::CancelOrder { user, .. }
            | Cmd::AddLiquidity { user, .. }
            | Cmd::RemoveLiquidity { user, .. }
            | Cmd::Claim { user, .. } => Some(user),
            Cmd::Deposit { .. }
            | Cmd::WithdrawPaid { .. }
            | Cmd::ReleaseLock { .. }
            | Cmd::ListPlayer { .. }
            | Cmd::PublishCalendar { .. }
            | Cmd::Snapshot { .. }
            | Cmd::RoundResult { .. }
            | Cmd::SetPaused { .. }
            | Cmd::WithdrawTreasury { .. }
            | Cmd::WithdrawRequested { .. }
            | Cmd::CollectSeedFees { .. }
            | Cmd::SetParams { .. }
            | Cmd::BatchFinalized { .. }
            | Cmd::Forced { .. }
            | Cmd::ForcedUnpaid { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    None,
    /// Curve buy.
    Bought { tokens: u64, cost: u64, fee: u64, graduated: bool },
    /// Curve sell.
    Sold { usdc_out: u64, fee: u64 },
    /// Routed trade (taker part). Buy: tokens received, USDC spent. Sell: tokens sold, USDC received
    /// after tax. `order` is the resting remainder, if any.
    Traded { tokens: u64, usdc: u64, fee: u64, tax: u64, order: Option<u64> },
    Cancelled { order: u64 },
    Liquidity { position: u64, liquidity: u128, tokens: u64, usdc: u64 },
    Locked { id: u64, amount: u64 },
    Claimed { usdc: u64, tokens: u64 },
    SeedFees { usdc: u64, tokens_burned: u64 },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Account {
    /// Spendable USDC.
    pub free: u64,
    /// USDC locked for pending withdrawal vouchers.
    pub locked: u64,
    /// USDC locked in resting bids.
    pub in_orders: u64,
    pub nonce: u64,
    pub open_orders: u32,
    pub lp_positions: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Holding {
    /// Free player tokens.
    pub amount: u64,
    /// Tokens locked in resting asks (still owned: they count for dividends and hold age).
    pub locked: u64,
    pub entry_ts: i64,
    /// Curve purchases counted against the per-account cap.
    pub cap_bought: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Market {
    pub state: MarketState,
    pub sold: u64,
    pub raised: u64,
    pub reserve_left: u64,
    /// Tokens in circulation (curve net + pool seed + emitted). Conservation check.
    pub minted: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct LpPosition {
    pub owner: UserId,
    pub player: PlayerId,
    pub lower: u128,
    pub upper: u128,
    pub liquidity: u128,
    /// Fee growth inside the range at the last update (Q64.64, wrapping).
    pub inside0: u128,
    pub inside1: u128,
    /// Fees credited but not yet collected (tokens, USDC).
    pub owed0: u128,
    pub owed1: u128,
    pub entry_ts: i64,
    /// Protocol seed liquidity: never withdrawable, excluded from dividends.
    pub protocol: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Order {
    pub user: UserId,
    pub player: PlayerId,
    pub side: Side,
    pub px: u64,
    /// USDC for a bid, tokens for an ask.
    pub remaining: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Book {
    /// px -> order ids in time priority.
    pub bids: BTreeMap<u64, VecDeque<u64>>,
    pub asks: BTreeMap<u64, VecDeque<u64>>,
}

/// A withdrawal hold: USDC moved out of the user's free balance until it is paid on-chain (or
/// returned).
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Lock {
    pub user: UserId,
    pub amount: u64,
    pub kind: LockKind,
}

/// What a hold is waiting for, and how it can end.
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum LockKind {
    /// A permit was issued for it. Ends when the permit is paid (`WithdrawPaid`), recorded as a
    /// large request (→ `Requested`), or, never used by `expiry`, released (`ReleaseLock`).
    Permit { expiry: i64 },
    /// Recorded on-chain as a large-withdrawal request: paid after a batch; never released.
    Requested,
    /// A forced withdrawal: paid by the program's `serve_forced` (`WithdrawPaid`), or answered
    /// without payment and returned (`ForcedUnpaid`); never released on a timer.
    Forced,
}

/// A round's dividends, set aside from the vault and waiting for the batch that moves them into
/// custody to be finalized. `at` is the log sequence number of the `RoundResult` that set them aside.
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct PendingRound {
    pub at: u64,
    pub total: u64,
    /// ((user, player), amount), in key order.
    pub credits: Vec<((UserId, PlayerId), u64)>,
}

/// Kickoff balances for one player in one round.
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Snapshot {
    /// Pool price at the snapshot, used for that round's token elections.
    pub px: u64,
    pub circulating: u64,
    pub holders: BTreeMap<UserId, u64>,
}
