use anchor_lang::prelude::*;

// One distinct, fixed prefix per PDA role (no PDA sharing, no seed collisions).
pub const CONFIG_SEED: &[u8] = b"config";
pub const STATE_SEED: &[u8] = b"state";
pub const CUSTODY_SEED: &[u8] = b"custody";
pub const CUSTODY_AUTH_SEED: &[u8] = b"custody_auth";
pub const VAULT_SEED: &[u8] = b"vault";
pub const VAULT_AUTH_SEED: &[u8] = b"vault_auth";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const TREASURY_AUTH_SEED: &[u8] = b"treasury_auth";
pub const PAGE_SEED: &[u8] = b"voucher_page";
pub const REQUEST_SEED: &[u8] = b"withdraw_request";
pub const FORCE_SEED: &[u8] = b"forced_request";
pub const EXITED_SEED: &[u8] = b"exited";

// The fixed program accounts, precomputed for this program id (checked by `tests/addresses.rs`).
// Checking an account against a constant costs a 32-byte compare; re-deriving a PDA from its
// seeds costs ~1,500 CU (`create_program_address`) or more (`find_program_address`).
pub const CONFIG_ADDRESS: Pubkey = pubkey!("fkGqYX7mVEByCJm3A7ZBHCmQ3HfRT5rRCnf4FYwnmv9");
pub const STATE_ADDRESS: Pubkey = pubkey!("3qp5fMusLQznsDKXpoYM17sannNy9Zd6SiVkE7Uyyh9y");
pub const CUSTODY_AUTH_ADDRESS: Pubkey = pubkey!("6f9huAVGgnL6Z5XpD4dsZxjM2S6t7zQktD6kC1AC1GqS");
pub const CUSTODY_AUTH_BUMP: u8 = 255;
pub const VAULT_AUTH_ADDRESS: Pubkey = pubkey!("GJy7T85PWFqriTzPvuNmcEcwse2aHM3giQpQRZZiwaDY");
pub const VAULT_AUTH_BUMP: u8 = 251;
pub const TREASURY_AUTH_ADDRESS: Pubkey = pubkey!("58xruE2FRQcGdEcUgwaRAC32TDQToJ8uoKu8GRP5Ntnc");
pub const TREASURY_AUTH_BUMP: u8 = 255;

/// Voucher ids per bitmap page (1,024 bytes).
pub const PAGE_BITS: u64 = 8192;
/// Recent deposit / payout checkpoints kept for batch verification.
pub const RING: usize = 32;

pub const PAUSE_DEPOSITS: u8 = 1;
pub const PAUSE_WITHDRAWALS: u8 = 2;
pub const PAUSE_ALL: u8 = PAUSE_DEPOSITS | PAUSE_WITHDRAWALS;

pub const PAYOUT_VOUCHER: u8 = 0;
pub const PAYOUT_TREASURY: u8 = 1;
pub const PAYOUT_EXIT: u8 = 2;

pub const BPS: u64 = 10_000;

/// Forced-request kinds (`force_request`'s `kind`; the engine uses the same values).
/// Withdraw: `data[0..8]` = amount (u64 LE); 0 = everything (the user's open orders are cancelled
/// first). Cancel: `data[0..8]` = order id. Any other kind is answered with no effect.
pub const FORCED_WITHDRAW: u8 = 0;
pub const FORCED_CANCEL: u8 = 1;
/// The engine's hold for forced request `index` has id `FORCED_ID_BIT | index`, so it can never
/// collide with a voucher id (vouchers with this bit set are refused).
pub const FORCED_ID_BIT: u64 = 1 << 63;

/// Deposits / payouts the `Pending` log keeps since the last committed batch. Exit mode settles
/// each user against them, so neither may run further ahead of the last batch than this.
pub const PENDING_DEPOSITS: u64 = 1024;
pub const PENDING_PAYOUTS: u64 = 1024;

/// Bounds on `exit_withdraw` inputs.
pub const MAX_EXIT_LOCKS: usize = 16;
pub const MAX_PROOF: usize = 64;
