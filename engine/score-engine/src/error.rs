use crate::math::MathError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Paused,
    WrongState,
    UnknownPlayer,
    PlayerExists,
    Slippage,
    PurchaseLimit,
    AccountLimit,
    InsufficientFunds,
    InsufficientTokens,
    BadAmount,
    BadPrice,
    BadNonce,
    /// Missing, malformed or wrong signature on a user command (or a signature on a system command).
    BadSignature,
    /// Timestamp negative or earlier than the previous accepted command.
    BadTime,
    /// Deposit sequence number is not the next one.
    BadSequence,
    SeedFloor,
    DuplicateLock,
    UnknownLock,
    LockNotExpired,
    UnknownOrder,
    UnknownPosition,
    NotOwner,
    /// A post-only order would have traded immediately.
    WouldCross,
    TooManyOrders,
    TooManyPositions,
    /// Nothing could be filled within the limits.
    NoFill,
    BadRound,
    /// A calendar lock time that has passed can't be moved.
    Locked,
    NothingToClaim,
    ReserveLow,
    NoVault,
    Math,
}

impl From<MathError> for Error {
    fn from(_: MathError) -> Self {
        Error::Math
    }
}
