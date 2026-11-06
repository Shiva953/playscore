//! One file per instruction: its `#[derive(Accounts)]` struct and its `handle_*` function.
//!
//! - `admin`: initialize, keys, limits, admin transfer, pause, treasury
//! - `custody`: voucher pages, deposit, withdraw, request / settle above-cap withdrawals
//! - `batch`: commit_batch
//! - `escape`: forced requests, exit mode, exit payouts

pub mod admin;
pub mod batch;
pub mod custody;
pub mod escape;

pub use admin::*;
pub use batch::*;
pub use custody::*;
pub use escape::*;
