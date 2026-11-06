use anchor_lang::prelude::*;

#[event]
pub struct Deposited {
    pub seq: u64,
    pub user: Pubkey,
    pub amount: u64,
    pub hash: [u8; 32],
}

#[event]
pub struct Paid {
    pub seq: u64,
    pub kind: u8,
    pub id: u64,
    pub to: Pubkey,
    pub amount: u64,
    pub hash: [u8; 32],
}

#[event]
pub struct WithdrawalRequested {
    pub id: u64,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BatchCommitted {
    pub seq: u64,
    pub state_root: [u8; 32],
    pub exit_root: [u8; 32],
    pub deposits: u64,
    pub payouts: u64,
    pub vault: u64,
    pub treasury: u64,
}

#[event]
pub struct ForceRequested {
    pub index: u64,
    pub user: Pubkey,
    pub kind: u8,
    pub data: [u8; 32],
}

/// The operator answered forced request `index`. `amount` > 0 only for a withdrawal, which was
/// paid to the user in the same instruction (a `Paid` event with id `FORCED_ID_BIT | index`).
#[event]
pub struct ForcedServed {
    pub index: u64,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ExitModeEntered {
    /// 0 = forced request ignored, 1 = no batch for too long.
    pub reason: u8,
}

#[event]
pub struct ExitPaid {
    pub user: Pubkey,
    pub amount: u64,
}
