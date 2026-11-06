use anchor_lang::prelude::*;

use crate::constants::{PENDING_DEPOSITS, PENDING_PAYOUTS};

#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DepositSlot {
    pub user: Pubkey,
    pub amount: u64,
}

#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PayoutSlot {
    /// The user for voucher payouts; the destination token account for treasury payouts.
    pub to: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub kind: u8,
    pub _pad: [u8; 7],
}

/// What happened on-chain since the last committed batch, which that batch's exit table can't
/// know about. Deposit `seq` lives at `deposits[(seq - 1) % PENDING_DEPOSITS]`, payout `seq` at
/// `payouts[(seq - 1) % PENDING_PAYOUTS]`. `deposit` and `record_payout` refuse to run more than
/// that many entries ahead of the last batch, so every entry after the batch's cut is still here.
///
/// Larger than a program may create (~98 KB), so it's created by the client in the `initialize`
/// transaction (`#[account(zero)]`) and its address is stored in `Config`.
#[account(zero_copy)]
pub struct Pending {
    pub deposits: [DepositSlot; PENDING_DEPOSITS as usize],
    pub payouts: [PayoutSlot; PENDING_PAYOUTS as usize],
}

impl Pending {
    pub fn deposit(&self, seq: u64) -> &DepositSlot {
        &self.deposits[((seq - 1) % PENDING_DEPOSITS) as usize]
    }
    pub fn payout(&self, seq: u64) -> &PayoutSlot {
        &self.payouts[((seq - 1) % PENDING_PAYOUTS) as usize]
    }
}
