//! score trading engine.
//!
//! `Engine::apply(ts, &Cmd)` is a pure, deterministic state transition: the same log in gives the
//! same state out, byte for byte. Integer maths only. The crate is meant to compile for the server,
//! a zkVM (Phase 2 validity proofs) and WASM (frontend quotes), so the core has no I/O. `wal` adds
//! the sequencer, the hash-chained log and the file WAL around it.
//!
//! - `math`: the spec's maths (curve, fees, tax, hold age).
//! - `fixed`, `clmm`, `pool`: concentrated liquidity (Q64.64, Uniswap v3 rounding).
//! - `engine`: state, dispatch, custody, curve, graduation into the seed ladder.
//! - `market`: router (book + pool), limit orders, range liquidity.
//! - `rounds`: calendar, snapshots, results, claims.
//! - `invariants`, `state_root`: full consistency check and the Merkle commitment.
//! - `exit`: per-user exit table and its root, for the program's exit mode.

pub mod auth;
pub mod clmm;
pub mod engine;
pub mod error;
pub mod exit;
pub mod fixed;
pub mod invariants;
pub mod market;
pub mod math;
pub mod pool;
pub mod rounds;
pub mod state_root;
pub mod types;
pub mod wal;

pub use engine::{Engine, Params};
pub use error::Error;
pub use types::*;
