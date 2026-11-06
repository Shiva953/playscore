use anchor_lang::prelude::*;

/// A withdrawal above the exposure cap, paid after the next committed batch.
#[account]
#[derive(InitSpace)]
pub struct WithdrawRequest {
    pub id: u64,
    pub user: Pubkey,
    pub amount: u64,
    /// The batch sequence when recorded; payable once a later batch is committed.
    pub batch_seq: u64,
    /// Receives the rent back when the request is paid.
    pub payer: Pubkey,
}

impl WithdrawRequest {
    /// Settled by `exit_withdraw`: exit mode keeps the account, with its amount zeroed (a request
    /// is never recorded for 0). Outside exit mode a settled request is closed instead.
    pub fn settled_in_exit(&self) -> bool {
        self.amount == 0
    }
    pub fn mark_settled_in_exit(&mut self) {
        self.amount = 0;
    }
}

/// A user's on-chain request the operator must serve (censorship escape hatch).
#[account]
#[derive(InitSpace)]
pub struct ForcedRequest {
    pub index: u64,
    pub user: Pubkey,
    pub kind: u8,
    pub data: [u8; 32],
    pub ts: i64,
}

/// Marks a user as already paid out in exit mode.
#[account]
#[derive(InitSpace)]
pub struct Exited {
    pub user: Pubkey,
    pub amount: u64,
}
