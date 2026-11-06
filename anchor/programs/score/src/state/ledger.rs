use anchor_lang::prelude::*;

use crate::constants::{PAUSE_DEPOSITS, PAUSE_WITHDRAWALS, RING};
use crate::error::ScoreError;

#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Checkpoint {
    pub count: u64,
    pub total: u64,
    pub hash: [u8; 32],
}

/// Hot state (zero-copy: no per-call deserialisation of ~3.5 KB).
#[account(zero_copy)]
#[derive(Debug)]
pub struct State {
    pub batch_seq: u64,
    pub last_commit_ts: i64,
    // running deposit chain
    pub deposit_count: u64,
    pub deposit_total: u64,
    // running payout chain (vouchers, treasury, exits)
    pub payout_count: u64,
    pub payout_total: u64,
    // what the last committed batch consumed
    pub committed_deposits: u64,
    pub committed_payouts: u64,
    /// payout_total at the last committed cut: payouts since are not yet in a committed root.
    pub committed_payout_total: u64,
    /// The engine's treasury figure at the last batch, less treasury withdrawals since: what the
    /// treasury account owes the protocol. Bounds `withdraw_treasury`.
    pub committed_treasury: u64,
    /// The engine's vault figure at the last batch: what the vault account holds for holders.
    pub committed_vault: u64,
    /// Payout index of an unconsumed treasury withdrawal (0 = none).
    pub treasury_pending: u64,
    pub forced_count: u64,
    pub forced_served: u64,
    /// payout_count when exit mode began: exit settlement looks at payouts up to here.
    pub exit_payouts: u64,
    pub state_root: [u8; 32],
    pub exit_root: [u8; 32],
    pub log_head: [u8; 32],
    pub deposit_hash: [u8; 32],
    pub payout_hash: [u8; 32],
    pub deposit_ring: [Checkpoint; RING],
    pub payout_ring: [Checkpoint; RING],
    pub paused: u8,
    pub exit_mode: u8,
    pub _pad: [u8; 6],
}

/// Typed views of `State`'s plain fields (the account layout is unchanged).
impl State {
    pub fn in_exit_mode(&self) -> bool {
        self.exit_mode != 0
    }
    /// Every instruction outside exit mode starts with this.
    pub fn require_live(&self) -> Result<()> {
        require!(!self.in_exit_mode(), ScoreError::ExitMode);
        Ok(())
    }
    /// Irreversible.
    pub fn set_exit_mode(&mut self) {
        self.exit_mode = 1;
    }
    pub fn deposits_paused(&self) -> bool {
        self.paused & PAUSE_DEPOSITS != 0
    }
    pub fn withdrawals_paused(&self) -> bool {
        self.paused & PAUSE_WITHDRAWALS != 0
    }
    /// The payout number of a treasury withdrawal no committed batch covers yet, if any.
    pub fn uncovered_treasury_payout(&self) -> Option<u64> {
        (self.treasury_pending != 0).then_some(self.treasury_pending)
    }
    pub fn set_uncovered_treasury_payout(&mut self, payout: Option<u64>) {
        self.treasury_pending = payout.unwrap_or(0);
    }
    /// (total, hash) of a chain at `count`, if it is the current head, genesis, or still in the ring.
    pub fn lookup(ring: &[Checkpoint; RING], head: (u64, u64, [u8; 32]), count: u64) -> Option<(u64, [u8; 32])> {
        if count == head.0 {
            return Some((head.1, head.2));
        }
        if count == 0 {
            return Some((0, [0u8; 32]));
        }
        let c = ring[(count % RING as u64) as usize];
        (c.count == count).then_some((c.total, c.hash))
    }
}
