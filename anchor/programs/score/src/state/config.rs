use anchor_lang::prelude::*;

use crate::constants::BPS;

/// Keys the admin can rotate.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
#[repr(C)]
pub struct Keys {
    /// Signs `commit_batch` (the engine's batch key).
    pub operator: Pubkey,
    /// Signs withdrawal vouchers (ed25519, verified through the Ed25519 program).
    pub voucher_signer: Pubkey,
    /// May pause (never unpause).
    pub pauser: Pubkey,
}

/// All fields 8 bytes wide, so the zero-copy layout has no padding.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, bytemuck::Pod, bytemuck::Zeroable)]
#[repr(C)]
pub struct Limits {
    /// Instant withdrawals since the last committed batch may total at most
    /// max(exposure_cap_min, custody × exposure_cap_bps / 10,000).
    pub exposure_cap_min: u64,
    pub exposure_cap_bps: u64,
    /// A voucher may not be valid for longer than this (seconds).
    pub voucher_max_ttl: i64,
    /// A forced request not served within this time allows exit mode (seconds).
    pub forced_deadline: i64,
    /// No batch committed for this long allows exit mode (seconds).
    pub liveness_deadline: i64,
}

/// Typed views of `Config`'s plain fields (the account layout is unchanged).
impl Config {
    /// The admin nominated by `nominate_admin`, not yet accepted.
    pub fn nominee(&self) -> Option<Pubkey> {
        (self.pending_admin != Pubkey::default()).then_some(self.pending_admin)
    }
    pub fn set_nominee(&mut self, who: Option<Pubkey>) {
        self.pending_admin = who.unwrap_or_default();
    }
}

impl Limits {
    pub fn valid(&self) -> bool {
        self.exposure_cap_bps <= BPS && self.voucher_max_ttl > 0 && self.forced_deadline > 0 && self.liveness_deadline > 0
    }
}

/// Read by every instruction, so zero-copy: no deserialization, the fields are read in place.
#[account(zero_copy)]
pub struct Config {
    pub admin: Pubkey,
    /// Nominated by `nominate_admin`; `Pubkey::default()` when none.
    pub pending_admin: Pubkey,
    pub keys: Keys,
    pub limits: Limits,
    pub usdc_mint: Pubkey,
    /// User money only: balances, orders, pools, unclaimed dividends.
    pub custody: Pubkey,
    /// Dividend vault USDC, swept from custody by each batch.
    pub vault: Pubkey,
    /// Protocol revenue, swept from custody by each batch; only `withdraw_treasury` takes it out.
    pub treasury: Pubkey,
    /// The `Pending` log account.
    pub pending: Pubkey,
}
