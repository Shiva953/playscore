//! Test harness: deterministic user keys, automatic signing and nonces, and the accepted log.
#![allow(dead_code)]

use std::collections::BTreeMap;

use ed25519_dalek::{Signer, SigningKey};
use score_engine::auth::{order_message, Sig};
use score_engine::math as m;
use score_engine::wal::{Record, Sequencer};
use score_engine::*;

pub const USDC: u64 = 1_000_000;
pub const TOKEN: u64 = 1_000_000;

#[derive(Default)]
pub struct H {
    pub s: Sequencer,
    pub recs: Vec<Record>,
    keys: BTreeMap<UserId, SigningKey>,
    nonces: BTreeMap<UserId, u64>,
    deposits: u64,
}

pub fn key(n: u16) -> SigningKey {
    let mut seed = [7u8; 32];
    seed[..2].copy_from_slice(&n.to_le_bytes());
    SigningKey::from_bytes(&seed)
}

pub fn sign(k: &SigningKey, cmd: &Cmd) -> Sig {
    k.sign(&order_message(cmd)).to_bytes()
}

impl H {
    pub fn new() -> Self {
        Self::default()
    }

    /// The user id (wallet public key) for test user `n`.
    pub fn user(&mut self, n: u16) -> UserId {
        let k = key(n);
        let id = k.verifying_key().to_bytes();
        self.keys.insert(id, k);
        id
    }

    /// Next nonce for `user`.
    pub fn nonce(&mut self, user: &UserId) -> u64 {
        let n = self.nonces.entry(*user).or_default();
        *n += 1;
        *n
    }

    /// Submit, signing with the signer's key when the command needs one.
    pub fn run(&mut self, ts: i64, cmd: Cmd) -> Result<Outcome, Error> {
        let sig = cmd.signer().map(|u| sign(&self.keys[u], &cmd));
        let (out, rec) = self.s.submit(ts, cmd, sig)?;
        self.recs.push(rec);
        Ok(out)
    }

    pub fn deposit(&mut self, ts: i64, user: UserId, amount: u64) -> Result<Outcome, Error> {
        let r = self.run(ts, Cmd::Deposit { user, amount, seq: self.deposits + 1 });
        if r.is_ok() {
            self.deposits += 1;
        }
        r
    }

    pub fn e(&self) -> &Engine {
        &self.s.engine
    }

    pub fn check(&self) {
        if let Err(e) = self.e().check_invariants() {
            panic!("invariant broken: {e}");
        }
    }

    // ---- user commands with automatic nonces ----
    pub fn buy(&mut self, ts: i64, user: UserId, player: PlayerId, usdc_in: u64) -> Result<Outcome, Error> {
        let nonce = self.nonce(&user);
        self.run(ts, Cmd::Buy { user, nonce, player, usdc_in, min_tokens: 0, limit_px: 0 })
    }
    pub fn sell(&mut self, ts: i64, user: UserId, player: PlayerId, tokens_in: u64) -> Result<Outcome, Error> {
        let nonce = self.nonce(&user);
        self.run(ts, Cmd::Sell { user, nonce, player, tokens_in, min_usdc: 0, limit_px: 0 })
    }
    #[allow(clippy::too_many_arguments)]
    pub fn order(&mut self, ts: i64, user: UserId, player: PlayerId, side: Side, px: u64, amount: u64, post_only: bool) -> Result<Outcome, Error> {
        let nonce = self.nonce(&user);
        self.run(ts, Cmd::PlaceOrder { user, nonce, player, side, px, amount, post_only })
    }
    pub fn cancel(&mut self, ts: i64, user: UserId, order: u64) -> Result<Outcome, Error> {
        let nonce = self.nonce(&user);
        self.run(ts, Cmd::CancelOrder { user, nonce, order })
    }
    #[allow(clippy::too_many_arguments)]
    pub fn add_lp(&mut self, ts: i64, user: UserId, player: PlayerId, lower_px: u64, upper_px: u64, max_usdc: u64, max_tokens: u64) -> Result<Outcome, Error> {
        let nonce = self.nonce(&user);
        self.run(ts, Cmd::AddLiquidity { user, nonce, player, lower_px, upper_px, max_usdc, max_tokens, min_liquidity: 0 })
    }
    pub fn remove_lp(&mut self, ts: i64, user: UserId, position: u64, liquidity: u128) -> Result<Outcome, Error> {
        let nonce = self.nonce(&user);
        self.run(ts, Cmd::RemoveLiquidity { user, nonce, position, liquidity, min_usdc: 0, min_tokens: 0 })
    }
    pub fn claim(&mut self, ts: i64, user: UserId, round: u32, player: PlayerId, take_tokens: bool) -> Result<Outcome, Error> {
        let nonce = self.nonce(&user);
        self.run(ts, Cmd::Claim { user, nonce, round, player, take_tokens })
    }

    /// List `player` and drive it to graduation with fresh users from `first_user`, each buying just
    /// under the 240k per-account cap. Returns the next unused user number.
    pub fn graduate(&mut self, ts: i64, player: PlayerId, first_user: u16) -> u16 {
        self.run(ts, Cmd::ListPlayer { player }).unwrap();
        let mut n = first_user;
        loop {
            let u = self.user(n);
            n += 1;
            self.deposit(ts, u, 5_000 * USDC).unwrap();
            let sold = self.e().market(player).unwrap().sold as u128;
            let cost = m::curve_cost(sold, m::MAX_BUY_BASE - 5_000).unwrap();
            let usdc_in = (cost + m::fee(cost, m::ICO_FEE_BPS).unwrap()) as u64;
            let nonce = self.nonce(&u);
            let out = self.run(ts, Cmd::BuyCurve { user: u, nonce, player, usdc_in, min_tokens: 1 }).unwrap();
            self.check();
            if matches!(out, Outcome::Bought { graduated: true, .. }) {
                return n;
            }
            assert!(n < first_user + 200, "never graduated");
        }
    }

    /// Spot price of a bonded player's pool, in px units.
    pub fn px(&self, player: PlayerId) -> u64 {
        score_engine::fixed::px_from_sqrt(self.e().pool(player).unwrap().sqrt, false).unwrap() as u64
    }
}
