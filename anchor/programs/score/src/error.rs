use anchor_lang::prelude::*;

#[error_code]
pub enum ScoreError {
    #[msg("Paused")]
    Paused,
    #[msg("The program is in exit mode")]
    ExitMode,
    #[msg("The program is not in exit mode")]
    NotExitMode,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Math,
    #[msg("Invalid limits")]
    BadLimits,
    #[msg("Missing ed25519 voucher signature instruction")]
    MissingSignature,
    #[msg("Voucher signature does not match")]
    BadSignature,
    #[msg("Voucher expired")]
    VoucherExpired,
    #[msg("Voucher valid for too long")]
    VoucherTooLong,
    #[msg("Voucher already used")]
    VoucherUsed,
    #[msg("Wrong voucher page")]
    WrongPage,
    #[msg("Withdrawal exceeds the exposure cap; record it with request_withdrawal")]
    OverCap,
    #[msg("Request not payable yet: wait for the next batch")]
    NotYet,
    #[msg("Batch out of sequence")]
    BadSequence,
    #[msg("Batch does not extend the committed state")]
    BadPrevRoot,
    #[msg("Batch deposit cut does not match the chain")]
    BadDeposits,
    #[msg("Batch payout cut does not match the chain")]
    BadPayouts,
    #[msg("Batch forced-request count invalid")]
    BadForced,
    #[msg("Custody does not cover liabilities")]
    Undercollateralised,
    #[msg("A treasury withdrawal is waiting for the next batch")]
    TreasuryPending,
    #[msg("Treasury balance too low")]
    TreasuryLow,
    #[msg("Not allowed")]
    Unauthorized,
    #[msg("A pauser can only add pause flags")]
    PauserCannotUnpause,
    #[msg("Exit mode conditions not met")]
    ExitNotAllowed,
    #[msg("Wrong forced request")]
    WrongForcedRequest,
    #[msg("Invalid exit proof")]
    BadProof,
    #[msg("Too many items")]
    TooMany,
    #[msg("No pending admin")]
    NoPendingAdmin,
    #[msg("Too many deposits or payouts since the last batch: retry after the next batch")]
    TooManyPending,
    #[msg("Withdrawal request does not match the exit lock")]
    WrongRequest,
    #[msg("Batch lowers the treasury: only withdraw_treasury takes money out of it")]
    TreasuryDecrease,
    #[msg("Only a forced withdrawal can pay, and no more than it asked for")]
    ForcedAmount,
}
