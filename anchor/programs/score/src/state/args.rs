//! Instruction argument types.

use anchor_lang::prelude::*;

/// What the operator commits each batch (Phase 1: signed by the operator; Phase 2 adds a proof).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Batch {
    pub seq: u64,
    pub prev_state_root: [u8; 32],
    pub state_root: [u8; 32],
    pub exit_root: [u8; 32],
    pub log_head: [u8; 32],
    /// Deposits / payouts the engine has consumed, and the chain hashes at those counts.
    pub deposits: u64,
    pub deposit_hash: [u8; 32],
    pub payouts: u64,
    pub payout_hash: [u8; 32],
    pub forced_served: u64,
    /// Everything the engine owes (it equals the engine's custody figure at the cut).
    pub liabilities: u64,
    /// The engine's vault and treasury figures at the cut. The batch moves the difference from the
    /// last batch between custody and those accounts.
    pub vault: u64,
    pub treasury: u64,
}

/// A pending withdrawal lock in an exit leaf (same bytes as the engine's `(id, amount)` pair).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExitLock {
    pub id: u64,
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProofNode {
    pub sibling: [u8; 32],
    /// The sibling sits to the right of the running hash.
    pub right: bool,
}
