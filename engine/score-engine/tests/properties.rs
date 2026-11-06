//! Random command sequences over every command type: the full invariant set must hold after every
//! command, rejected commands must change nothing, and the log must replay to the same state root.
mod common;

use std::collections::BTreeMap;

use common::*;
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use score_engine::state_root::state_root;
use score_engine::wal::Sequencer;
use score_engine::*;

const P: PlayerId = 1;
/// Curve buyers 1..=6 hold tokens; 1000..1004 start with USDC only.
const HOLDERS: u16 = 6;
const FRESH: u16 = 4;
const USERS: u16 = HOLDERS + FRESH;

#[derive(Debug, Clone)]
enum Op {
    Deposit(u16, u64),
    Buy(u16, u64, u8),
    Sell(u16, u8, u8),
    Bid(u16, u8, u64, bool),
    Ask(u16, u8, u8, bool),
    Cancel(u16, u8),
    AddLp(u16, u8, u8, u64, u8),
    RemoveLp(u16, u8, u8),
    Lock(u16, u64),
    Paid(u8),
    Release(u8, bool),
    Round(u64),
    Finalize(u8),
    Claim(u16, bool),
    Pause(bool),
    SeedFees,
}

fn op() -> impl Strategy<Value = Op> {
    let u = 0..USERS;
    prop_oneof![
        1 => (u.clone(), 1u64..3_000).prop_map(|(u, a)| Op::Deposit(u, a * USDC)),
        4 => (u.clone(), 1u64..3_000, 0u8..30).prop_map(|(u, a, l)| Op::Buy(u, a * USDC, l)),
        4 => (u.clone(), 1u8..=100, 0u8..30).prop_map(|(u, f, l)| Op::Sell(u, f, l)),
        3 => (u.clone(), 50u8..115, 1u64..500, any::<bool>()).prop_map(|(u, p, a, po)| Op::Bid(u, p, a * USDC, po)),
        3 => (u.clone(), 85u8..200, 1u8..=100, any::<bool>()).prop_map(|(u, p, f, po)| Op::Ask(u, p, f, po)),
        2 => (u.clone(), any::<u8>()).prop_map(|(u, k)| Op::Cancel(u, k)),
        3 => (u.clone(), 0u8..100, 0u8..150, 1u64..2_000, 0u8..=100).prop_map(|(u, lo, w, a, f)| Op::AddLp(u, lo, w, a * USDC, f)),
        2 => (u.clone(), any::<u8>(), 1u8..=100).prop_map(|(u, k, f)| Op::RemoveLp(u, k, f)),
        1 => (u.clone(), 1u64..500).prop_map(|(u, a)| Op::Lock(u, a * USDC)),
        1 => any::<u8>().prop_map(Op::Paid),
        1 => (any::<u8>(), any::<bool>()).prop_map(|(k, ahead)| Op::Release(k, ahead)),
        1 => (1u64..2_000).prop_map(|a| Op::Round(a * USDC)),
        2 => any::<u8>().prop_map(Op::Finalize),
        2 => (u.clone(), any::<bool>()).prop_map(|(u, t)| Op::Claim(u, t)),
        1 => (0u8..10).prop_map(|x| Op::Pause(x == 0)),
        1 => Just(Op::SeedFees),
    ]
}

#[derive(Default, Debug)]
struct Seen(BTreeMap<&'static str, u32>);

fn kind(c: &Cmd) -> &'static str {
    match c {
        Cmd::Buy { .. } => "buy",
        Cmd::Sell { .. } => "sell",
        Cmd::PlaceOrder { side: Side::Bid, .. } => "bid",
        Cmd::PlaceOrder { side: Side::Ask, .. } => "ask",
        Cmd::CancelOrder { .. } => "cancel",
        Cmd::AddLiquidity { .. } => "add_lp",
        Cmd::RemoveLiquidity { .. } => "remove_lp",
        Cmd::LockWithdraw { .. } => "lock",
        Cmd::WithdrawPaid { .. } => "paid",
        Cmd::ReleaseLock { .. } => "release",
        Cmd::RoundResult { .. } => "result",
        Cmd::BatchFinalized { .. } => "finalized",
        Cmd::Claim { take_tokens: true, .. } => "claim_tokens",
        Cmd::Claim { .. } => "claim_usdc",
        Cmd::CollectSeedFees { .. } => "seed_fees",
        _ => "other",
    }
}

fn run(ops: Vec<Op>) -> Result<Seen, TestCaseError> {
    let mut h = H::new();
    h.graduate(0, P, 1);
    let users: Vec<UserId> = (0..USERS).map(|i| if i < HOLDERS { h.user(i + 1) } else { h.user(1000 + i) }).collect();
    for u in &users[HOLDERS as usize..] {
        h.deposit(1, *u, 5_000 * USDC).unwrap();
    }
    let mut seen = Seen::default();
    let mut lock_id = 0u64;
    let mut round = 0u32;
    for (i, o) in ops.into_iter().enumerate() {
        // Hours pass between commands, so hold age (and the sell tax) varies.
        let ts = 10 + i as i64 * 3_600;
        let px = h.px(P);
        let mut cmds: Vec<(i64, Cmd)> = vec![];
        let uid = |k: u16| users[k as usize];
        match o {
            Op::Deposit(u, a) => {
                h.deposit(ts, uid(u), a).unwrap();
            }
            Op::Buy(u, a, l) => {
                let limit_px = if l == 0 { 0 } else { px * (100 + l as u64) / 100 };
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::Buy { user: uid(u), nonce, player: P, usdc_in: a, min_tokens: 0, limit_px }));
            }
            Op::Sell(u, f, l) => {
                let amt = h.e().holding(&uid(u), P).amount as u128 * f as u128 / 100;
                let limit_px = if l == 0 { 0 } else { px * (100 - l as u64) / 100 };
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::Sell { user: uid(u), nonce, player: P, tokens_in: amt as u64, min_usdc: 0, limit_px }));
            }
            Op::Bid(u, p, a, po) => {
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::PlaceOrder { user: uid(u), nonce, player: P, side: Side::Bid, px: px * p as u64 / 100, amount: a, post_only: po }));
            }
            Op::Ask(u, p, f, po) => {
                let amt = h.e().holding(&uid(u), P).amount as u128 * f as u128 / 100;
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::PlaceOrder { user: uid(u), nonce, player: P, side: Side::Ask, px: px * p as u64 / 100, amount: amt as u64, post_only: po }));
            }
            Op::Cancel(u, k) => {
                let mine: Vec<u64> = h.e().orders().filter(|(_, o)| o.user == uid(u)).map(|(id, _)| *id).collect();
                if mine.is_empty() { continue; }
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::CancelOrder { user: uid(u), nonce, order: mine[k as usize % mine.len()] }));
            }
            Op::AddLp(u, lo, wd, a, f) => {
                let tokens = h.e().holding(&uid(u), P).amount as u128 * f as u128 / 100;
                let (lower_px, upper_px) = if wd == 0 { (0, 0) } else { (px * (lo as u64 + 1) / 100, px * (lo as u64 + 1 + wd as u64) / 100) };
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::AddLiquidity { user: uid(u), nonce, player: P, lower_px, upper_px, max_usdc: a, max_tokens: tokens as u64, min_liquidity: 0 }));
            }
            Op::RemoveLp(u, k, f) => {
                let mine: Vec<(u64, u128)> = h.e().lps().filter(|(_, l)| l.owner == uid(u)).map(|(id, l)| (*id, l.liquidity)).collect();
                if mine.is_empty() { continue; }
                let (id, l) = mine[k as usize % mine.len()];
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::RemoveLiquidity { user: uid(u), nonce, position: id, liquidity: (l * f as u128 / 100).max(1), min_usdc: 0, min_tokens: 0 }));
            }
            Op::Lock(u, a) => {
                lock_id += 1;
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::LockWithdraw { user: uid(u), nonce, amount: a, id: lock_id, expiry: ts + 7_200 }));
            }
            Op::Paid(k) => cmds.push((ts, Cmd::WithdrawPaid { id: 1 + k as u64 % lock_id.max(1), seq: h.e().payouts() + 1 })),
            // `ahead`: the watcher saw a payout the engine hasn't applied yet; must be refused.
            Op::Release(k, ahead) => {
                cmds.push((ts, Cmd::ReleaseLock { id: 1 + k as u64 % lock_id.max(1), payouts_through: h.e().payouts() + ahead as u64 }))
            }
            Op::Finalize(k) => {
                let (lo, hi) = (h.e().finalized_cut(), h.e().applied());
                cmds.push((ts, Cmd::BatchFinalized { cut: lo + k as u64 % (hi - lo + 1) }));
            }
            Op::Round(pay) => {
                round += 1;
                cmds.push((ts, Cmd::PublishCalendar { round, lock_ts: ts + 1 }));
                cmds.push((ts + 1, Cmd::Snapshot { round }));
                cmds.push((ts + 2, Cmd::RoundResult { round, payouts: vec![(P, pay.min(h.e().vault() / 2))] }));
            }
            Op::Claim(u, take) => {
                if round == 0 { continue; }
                let r = (1..=round).find(|r| h.e().claim_amount(&uid(u), *r, P) > 0).unwrap_or(round);
                let nonce = h.nonce(&uid(u));
                cmds.push((ts, Cmd::Claim { user: uid(u), nonce, round: r, player: P, take_tokens: take }));
            }
            Op::Pause(p) => cmds.push((ts, Cmd::SetPaused { paused: p })),
            Op::SeedFees => cmds.push((ts, Cmd::CollectSeedFees { player: P })),
        }
        for (ts, c) in cmds {
            let before_root = state_root(h.e());
            let before_seq = h.s.seq;
            let k = kind(&c);
            match h.run(ts, c) {
                Ok(_) => *seen.0.entry(k).or_default() += 1,
                Err(_) => {
                    prop_assert_eq!(h.s.seq, before_seq, "rejected command was logged");
                    prop_assert_eq!(state_root(h.e()), before_root, "rejected {} changed state", k);
                }
            }
            if let Err(e) = h.e().check_invariants() {
                return Err(TestCaseError::fail(format!("after {k}: {e}")));
            }
        }
    }
    let r = Sequencer::replay(&h.recs).map_err(TestCaseError::fail)?;
    prop_assert_eq!(r.head, h.s.head);
    prop_assert_eq!(state_root(&r.engine), state_root(h.e()));
    Ok(seen)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(96))]
    #[test]
    fn invariants_hold_under_random_trading(ops in proptest::collection::vec(op(), 1..120)) {
        run(ops)?;
    }
}

/// Guard against the property test passing because commands are mostly rejected.
#[test]
fn random_runs_exercise_every_path() {
    let mut runner = proptest::test_runner::TestRunner::deterministic();
    let mut total: BTreeMap<&'static str, u32> = BTreeMap::new();
    for _ in 0..12 {
        let ops = proptest::collection::vec(op(), 120).new_tree(&mut runner).unwrap().current();
        for (k, v) in run(ops).unwrap().0 {
            *total.entry(k).or_default() += v;
        }
    }
    for k in ["buy", "sell", "bid", "ask", "cancel", "add_lp", "remove_lp", "lock", "paid", "release", "result", "finalized", "claim_usdc", "claim_tokens", "seed_fees"] {
        assert!(total.get(k).copied().unwrap_or(0) >= 3, "path {k} barely exercised: {total:?}");
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]
    /// From launch through graduation: random curve buys (some large enough to cross $25k and
    /// continue into the new pool) and sells, then pool trades. Invariants after every command.
    #[test]
    fn invariants_hold_through_graduation(ops in proptest::collection::vec((0u16..40, 1u64..6_000, 0u8..4), 1..200)) {
        let mut h = H::new();
        h.run(0, Cmd::ListPlayer { player: P }).unwrap();
        let users: Vec<UserId> = (0..40u16).map(|i| h.user(2000 + i)).collect();
        for u in &users {
            h.deposit(1, *u, 20_000 * USDC).unwrap();
        }
        let mut graduations = 0;
        for (i, (k, amt, kind)) in ops.into_iter().enumerate() {
            let ts = 10 + i as i64 * 600;
            let u = users[k as usize];
            let bonded = h.e().market(P).unwrap().state == MarketState::Bonded;
            let nonce = h.nonce(&u);
            let cmd = match (bonded, kind) {
                (false, 0) => {
                    let held = h.e().holding(&u, P).amount / 2 / 1_000 * 1_000;
                    Cmd::SellCurve { user: u, nonce, player: P, tokens: held, min_usdc: 0 }
                }
                (false, _) => Cmd::BuyCurve { user: u, nonce, player: P, usdc_in: amt * USDC, min_tokens: 1 },
                (true, 0) => {
                    let held = h.e().holding(&u, P).amount / 2;
                    Cmd::Sell { user: u, nonce, player: P, tokens_in: held, min_usdc: 0, limit_px: 0 }
                }
                (true, _) => Cmd::Buy { user: u, nonce, player: P, usdc_in: amt * USDC, min_tokens: 0, limit_px: 0 },
            };
            let before = state_root(h.e());
            match h.run(ts, cmd) {
                Ok(Outcome::Bought { graduated: true, .. }) => graduations += 1,
                Ok(_) => {}
                Err(_) => prop_assert_eq!(state_root(h.e()), before),
            }
            if let Err(e) = h.e().check_invariants() {
                return Err(TestCaseError::fail(e));
            }
        }
        prop_assert!(graduations <= 1);
        let r = Sequencer::replay(&h.recs).map_err(TestCaseError::fail)?;
        prop_assert_eq!(state_root(&r.engine), state_root(h.e()));
    }
}
