mod common;

use common::*;
use score_engine::math as m;
use score_engine::wal::{FileWal, Sequencer};
use score_engine::*;

#[test]
fn curve_vectors_from_the_spec() {
    // Start price $0.00039; closing price about $0.01094 (spec section 5).
    assert_eq!(m::price_micro(0).unwrap(), 390);
    let p = m::price_micro(6_400_040 * m::MICRO).unwrap();
    assert!((10_900..=10_980).contains(&p), "closing price {p}");
    // First buyer, $50: 126,180 tokens.
    let net = 50 * m::MICRO * m::BPS / (m::BPS + m::ICO_FEE_BPS);
    let tokens = m::curve_tokens_for(0, net).unwrap();
    assert_eq!(tokens / m::MICRO, 126_180);
    // I8: a curve buy followed by a sell never returns more than was paid.
    let cost = m::curve_cost(0, tokens).unwrap();
    let paid = cost + m::fee(cost, m::ICO_FEE_BPS).unwrap();
    let refund = m::curve_refund(tokens, tokens).unwrap();
    assert!(refund - m::fee(refund, m::ICO_FEE_BPS).unwrap() < paid);
}

#[test]
fn tax_schedule() {
    assert_eq!(m::tax_bps(0), 500);
    assert_eq!(m::tax_bps(45 * m::DAY), 275);
    assert_eq!(m::tax_bps(90 * m::DAY), 50);
    assert_eq!(m::tax_bps(900 * m::DAY), 50);
}

#[test]
fn entry_ts_argument_order_matches_reference() {
    // (old_ts, old_weight, new_weight, new_ts): 10k tokens at day 0 + 10k at day 60 -> day 30.
    let d = m::DAY;
    assert_eq!(m::new_entry_ts(0, 10_000, 10_000, 60 * d).unwrap(), 30 * d);
    assert_eq!(m::new_entry_ts(0, 30_000, 10_000, 60 * d).unwrap(), 15 * d);
}

#[test]
fn signatures_are_required_and_checked() {
    let mut h = H::new();
    h.run(0, Cmd::ListPlayer { player: 1 }).unwrap();
    let alice = h.user(1);
    h.deposit(1, alice, 100 * USDC).unwrap();
    let buy = Cmd::BuyCurve { user: alice, nonce: 1, player: 1, usdc_in: 10 * USDC, min_tokens: 1 };
    // unsigned
    assert_eq!(h.s.submit(2, buy.clone(), None).unwrap_err(), Error::BadSignature);
    // signed by someone else: the operator (or anyone) can't trade on alice's behalf
    assert_eq!(h.s.submit(2, buy.clone(), Some(sign(&key(2), &buy))).unwrap_err(), Error::BadSignature);
    // alice's signature on a different order can't be reused
    let other = Cmd::BuyCurve { user: alice, nonce: 1, player: 1, usdc_in: 99 * USDC, min_tokens: 1 };
    assert_eq!(h.s.submit(2, other, Some(sign(&key(1), &buy))).unwrap_err(), Error::BadSignature);
    // a signature on a system command is rejected
    assert_eq!(
        h.s.submit(2, Cmd::SetPaused { paused: true }, Some(sign(&key(1), &buy))).unwrap_err(),
        Error::BadSignature
    );
    assert_eq!(h.e().account(&alice).free, 100 * USDC);
    // a correctly signed order goes through
    h.run(2, buy).unwrap();
}

#[test]
fn nonce_replay_and_atomic_failure() {
    let mut h = H::new();
    h.run(0, Cmd::ListPlayer { player: 1 }).unwrap();
    let u = h.user(1);
    h.deposit(1, u, 100 * USDC).unwrap();
    // A replayed (or skipped) chain deposit is rejected by its sequence number.
    assert_eq!(h.run(1, Cmd::Deposit { user: u, amount: 100 * USDC, seq: 1 }).unwrap_err(), Error::BadSequence);
    assert_eq!(h.run(1, Cmd::Deposit { user: u, amount: 100 * USDC, seq: 3 }).unwrap_err(), Error::BadSequence);
    let buy = Cmd::BuyCurve { user: u, nonce: 1, player: 1, usdc_in: 10 * USDC, min_tokens: 1 };
    h.run(2, buy.clone()).unwrap();
    assert_eq!(h.run(3, buy).unwrap_err(), Error::BadNonce);
    // A failed order changes nothing and logs nothing.
    let (seq, before) = (h.s.seq, h.e().account(&u));
    assert!(h.run(4, Cmd::BuyCurve { user: u, nonce: 2, player: 1, usdc_in: 10_000 * USDC, min_tokens: 1 }).is_err());
    assert_eq!(h.s.seq, seq);
    assert_eq!(h.e().account(&u), before);
    h.e().check_invariants().unwrap();
}

#[test]
fn time_must_not_go_backwards() {
    let mut h = H::new();
    h.run(100, Cmd::ListPlayer { player: 1 }).unwrap();
    assert_eq!(h.run(99, Cmd::ListPlayer { player: 2 }).unwrap_err(), Error::BadTime);
    assert_eq!(h.run(-1, Cmd::ListPlayer { player: 2 }).unwrap_err(), Error::BadTime);
    h.run(100, Cmd::ListPlayer { player: 2 }).unwrap();
}

#[test]
fn withdraw_lock_paid_and_released() {
    let mut h = H::new();
    let u = h.user(1);
    h.deposit(0, u, 100 * USDC).unwrap();
    h.run(1, Cmd::LockWithdraw { user: u, nonce: 1, amount: 60 * USDC, id: 1, expiry: 100 }).unwrap();
    h.run(1, Cmd::LockWithdraw { user: u, nonce: 2, amount: 20 * USDC, id: 2, expiry: 100 }).unwrap();
    // Locked money can't be spent or locked twice.
    assert_eq!(
        h.run(2, Cmd::LockWithdraw { user: u, nonce: 3, amount: 40 * USDC, id: 3, expiry: 100 }).unwrap_err(),
        Error::InsufficientFunds
    );
    h.e().check_invariants().unwrap();
    // Payout reports must come in the program's order: no gaps, no repeats.
    assert_eq!(h.run(5, Cmd::WithdrawPaid { id: 1, seq: 2 }).unwrap_err(), Error::BadSequence);
    // The program paid voucher 1 (payout 1, finalized): the money leaves custody.
    h.run(5, Cmd::WithdrawPaid { id: 1, seq: 1 }).unwrap();
    assert_eq!(h.run(5, Cmd::WithdrawPaid { id: 1, seq: 1 }).unwrap_err(), Error::BadSequence);
    assert_eq!(h.e().custody(), 40 * USDC);
    h.e().check_invariants().unwrap();
    // Voucher 2 can't come back before expiry + grace; then it can.
    assert_eq!(h.run(100, Cmd::ReleaseLock { id: 2, payouts_through: 1 }).unwrap_err(), Error::LockNotExpired);
    // The watcher saw finalized state with 2 payouts, but the engine has applied only 1: payout 2
    // could be this very voucher, so it can't be released until that report arrives.
    assert_eq!(h.run(161, Cmd::ReleaseLock { id: 2, payouts_through: 2 }).unwrap_err(), Error::BadSequence);
    h.run(161, Cmd::ReleaseLock { id: 2, payouts_through: 1 }).unwrap();
    assert_eq!(h.e().account(&u).free, 40 * USDC);
    // A released voucher can't also be paid.
    assert_eq!(h.run(162, Cmd::WithdrawPaid { id: 2, seq: 2 }).unwrap_err(), Error::UnknownLock);
    h.e().check_invariants().unwrap();
}

#[test]
fn trading_pause_never_traps_funds() {
    let mut h = H::new();
    h.run(0, Cmd::ListPlayer { player: 1 }).unwrap();
    let u = h.user(1);
    h.deposit(0, u, 100 * USDC).unwrap();
    h.run(1, Cmd::SetPaused { paused: true }).unwrap();
    assert_eq!(h.run(2, Cmd::BuyCurve { user: u, nonce: 1, player: 1, usdc_in: 10 * USDC, min_tokens: 1 }).unwrap_err(), Error::Paused);
    // deposits and withdrawals still work
    h.deposit(3, u, 5 * USDC).unwrap();
    h.run(4, Cmd::LockWithdraw { user: u, nonce: 2, amount: 105 * USDC, id: 9, expiry: 100 }).unwrap();
    h.run(5, Cmd::WithdrawPaid { id: 9, seq: 1 }).unwrap();
    assert_eq!(h.e().custody(), 0);
    h.e().check_invariants().unwrap();
}

#[test]
fn replay_detects_tampering() {
    let mut h = H::new();
    h.run(0, Cmd::ListPlayer { player: 1 }).unwrap();
    let u = h.user(1);
    h.deposit(1, u, 100 * USDC).unwrap();
    h.run(2, Cmd::BuyCurve { user: u, nonce: 1, player: 1, usdc_in: 30 * USDC, min_tokens: 1 }).unwrap();
    let r = Sequencer::replay(&h.recs).unwrap();
    assert_eq!(r.head, h.s.head);
    assert_eq!(r.engine.holding(&u, 1), h.e().holding(&u, 1));

    // Shifting a timestamp breaks the hash chain.
    let mut bad = h.recs.clone();
    bad[2].ts += 1;
    assert!(Sequencer::replay(&bad).is_err());
    // Changing the order and re-hashing still fails: the user's signature doesn't cover it.
    let mut forged = h.recs.clone();
    if let Cmd::BuyCurve { usdc_in, .. } = &mut forged[2].cmd {
        *usdc_in = 90 * USDC;
    }
    assert!(Sequencer::replay(&forged).unwrap_err().contains("BadSignature"));
}

fn temp_path(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("score-wal-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("log.wal")
}

fn small_log() -> H {
    let mut h = H::new();
    h.run(0, Cmd::ListPlayer { player: 1 }).unwrap();
    let u = h.user(1);
    h.deposit(1, u, 5 * USDC).unwrap();
    h.run(2, Cmd::BuyCurve { user: u, nonce: 1, player: 1, usdc_in: USDC, min_tokens: 1 }).unwrap();
    h
}

#[test]
fn file_wal_roundtrip_and_resume() {
    let path = temp_path("roundtrip");
    let h = small_log();
    let (mut w, existing) = FileWal::recover(&path).unwrap();
    assert!(existing.is_empty());
    w.append_batch(&h.recs[..2]).unwrap();
    w.append_batch(&h.recs[2..]).unwrap();
    drop(w);
    let (_, back) = FileWal::recover(&path).unwrap();
    assert_eq!(back, h.recs);
    assert_eq!(Sequencer::replay(&back).unwrap().head, h.s.head);
}

#[test]
fn file_wal_truncates_a_torn_tail_and_keeps_appending() {
    let path = temp_path("torn");
    let h = small_log();
    let (mut w, _) = FileWal::recover(&path).unwrap();
    w.append_batch(&h.recs).unwrap();
    drop(w);
    // Simulate a crash partway through writing the third frame.
    let bytes = std::fs::read(&path).unwrap();
    std::fs::write(&path, &bytes[..bytes.len() - 7]).unwrap();

    let (mut w, recovered) = FileWal::recover(&path).unwrap();
    assert_eq!(recovered, h.recs[..2].to_vec());
    // The torn bytes are gone, so new frames land on a clean boundary.
    w.append_batch(&h.recs[2..]).unwrap();
    drop(w);
    assert_eq!(FileWal::read_all(&path).unwrap(), h.recs);
}

#[test]
fn file_wal_rejects_corruption_before_the_tail() {
    let path = temp_path("corrupt");
    let h = small_log();
    let (mut w, _) = FileWal::recover(&path).unwrap();
    w.append_batch(&h.recs).unwrap();
    drop(w);
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[12] ^= 0xff; // inside the first frame's payload
    std::fs::write(&path, &bytes).unwrap();
    assert!(FileWal::recover(&path).is_err());
}

/// A restart snapshot (`borsh(Sequencer)`) restores the exact state, and the restored copy carries
/// on identically: same state root, same hash chain, same results.
#[test]
fn snapshot_round_trips_and_continues_identically() {
    use score_engine::state_root::state_root;
    use score_engine::wal::Sequencer;
    let mut h = H::new();
    h.graduate(0, 1, 1);
    let u = h.user(500);
    h.deposit(10, u, 2_000 * USDC).unwrap();
    h.buy(11, u, 1, 300 * USDC).unwrap();
    let bytes = borsh::to_vec(&h.s).unwrap();
    let mut copy: Sequencer = borsh::from_slice(&bytes).unwrap();
    assert_eq!(state_root(&copy.engine), state_root(h.e()));
    assert_eq!((copy.seq, copy.head, copy.last_ts), (h.s.seq, h.s.head, h.s.last_ts));
    // Both apply the same next command and stay identical.
    let next = Cmd::Deposit { user: u, amount: USDC, seq: h.e().deposits() + 1 };
    let a = h.s.submit(12, next.clone(), None).unwrap();
    let b = copy.submit(12, next, None).unwrap();
    assert_eq!(a.1.hash, b.1.hash);
    assert_eq!(state_root(&copy.engine), state_root(h.e()));
    copy.engine.check_invariants().unwrap();
}

fn forced_cmd(index: u64, user: UserId, kind: u8, arg: u64) -> Cmd {
    let mut data = [0u8; 32];
    data[..8].copy_from_slice(&arg.to_le_bytes());
    Cmd::Forced { index, user, kind, data }
}

/// A forced withdrawal holds min(asked, free) under its own id; the payout consumes the hold.
#[test]
fn forced_withdrawal_holds_then_is_paid() {
    let mut h = H::new();
    let u = h.user(700);
    h.deposit(1, u, 500 * USDC).unwrap();
    // Out of order: refused (the watcher applies them in the program's order).
    assert_eq!(h.run(2, forced_cmd(2, u, FORCED_WITHDRAW, 0)).unwrap_err(), Error::BadSequence);
    // Asks for more than is free: holds what is free.
    let out = h.run(2, forced_cmd(1, u, FORCED_WITHDRAW, 900 * USDC)).unwrap();
    assert_eq!(out, Outcome::Locked { id: FORCED_ID_BIT | 1, amount: 500 * USDC });
    assert_eq!((h.e().account(&u).free, h.e().account(&u).locked), (0, 500 * USDC));
    assert_eq!(h.e().forced(), 1);
    h.check();
    // Never expires, and an ordinary release can't touch it.
    assert_eq!(h.run(i64::MAX / 2, Cmd::ReleaseLock { id: FORCED_ID_BIT | 1, payouts_through: 0 }).unwrap_err(), Error::LockNotExpired);
    // serve_forced paid it: the watcher reports the payout like any other.
    h.run(3, Cmd::WithdrawPaid { id: FORCED_ID_BIT | 1, seq: 1 }).unwrap();
    assert_eq!((h.e().account(&u).locked, h.e().custody()), (0, 0));
    h.check();
}

/// Requests that can't do anything are still consumed (so the counter, and the chain, move on).
#[test]
fn forced_requests_never_stall() {
    let mut h = H::new();
    let u = h.user(701);
    let nobody = h.user(702);
    h.deposit(1, u, 100 * USDC).unwrap();
    assert_eq!(h.run(2, forced_cmd(1, nobody, FORCED_WITHDRAW, 0)).unwrap(), Outcome::None); // no balance
    assert_eq!(h.run(2, forced_cmd(2, u, 77, 5)).unwrap(), Outcome::None); // unknown kind
    assert_eq!(h.run(2, forced_cmd(3, u, FORCED_CANCEL, 12345)).unwrap(), Outcome::None); // no such order
    assert_eq!(h.run(2, forced_cmd(4, PROTOCOL, FORCED_WITHDRAW, 0)).unwrap(), Outcome::None);
    assert_eq!(h.e().forced(), 4);
    assert_eq!(h.e().account(&u).free, 100 * USDC);
    h.check();
}

/// A forced cancel cancels the user's own order only; then a forced withdrawal of "all" takes the
/// freed balance.
#[test]
fn forced_cancel_then_withdraw_all() {
    let mut h = H::new();
    h.graduate(0, 1, 1);
    let u = h.user(703);
    let other = h.user(704);
    h.deposit(10, u, 1_000 * USDC).unwrap();
    h.deposit(10, other, 1_000 * USDC).unwrap();
    let px = h.px(1) / 2;
    let Outcome::Traded { order: Some(mine), .. } = h.order(11, u, 1, Side::Bid, px, 400 * USDC, true).unwrap() else { panic!() };
    let Outcome::Traded { order: Some(theirs), .. } = h.order(11, other, 1, Side::Bid, px, 400 * USDC, true).unwrap() else { panic!() };
    // u can't cancel someone else's order this way.
    h.run(12, forced_cmd(1, u, FORCED_CANCEL, theirs)).unwrap();
    assert!(h.e().orders().any(|(id, _)| *id == theirs));
    h.run(12, forced_cmd(2, u, FORCED_CANCEL, mine)).unwrap();
    assert!(!h.e().orders().any(|(id, _)| *id == mine));
    assert_eq!(h.e().account(&u).free, 1_000 * USDC);
    let out = h.run(12, forced_cmd(3, u, FORCED_WITHDRAW, 0)).unwrap();
    assert_eq!(out, Outcome::Locked { id: FORCED_ID_BIT | 3, amount: 1_000 * USDC });
    h.check();
}

/// Answered on-chain without payment: the hold goes back; only once, and only for real requests.
#[test]
fn forced_unpaid_returns_the_hold() {
    let mut h = H::new();
    let u = h.user(705);
    h.deposit(1, u, 300 * USDC).unwrap();
    h.run(2, forced_cmd(1, u, FORCED_WITHDRAW, 100 * USDC)).unwrap();
    assert_eq!(h.run(3, Cmd::ForcedUnpaid { index: 2 }).unwrap_err(), Error::BadSequence);
    h.run(3, Cmd::ForcedUnpaid { index: 1 }).unwrap();
    assert_eq!((h.e().account(&u).free, h.e().account(&u).locked), (300 * USDC, 0));
    assert_eq!(h.run(3, Cmd::ForcedUnpaid { index: 1 }).unwrap_err(), Error::UnknownLock);
    h.check();
}

/// Each kind of hold ends only the ways it can: a request never expires, a forced hold has no
/// permit (so it can't become a request) and is returned only by `ForcedUnpaid`.
#[test]
fn hold_kinds_only_end_their_own_way() {
    let mut h = H::new();
    let u = h.user(706);
    h.deposit(1, u, 500 * USDC).unwrap();
    h.run(1, Cmd::LockWithdraw { user: u, nonce: 1, amount: 100 * USDC, id: 1, expiry: 100 }).unwrap();
    h.run(2, Cmd::WithdrawRequested { id: 1 }).unwrap();
    assert_eq!(h.e().locks().find(|(id, _)| **id == 1).unwrap().1.kind, LockKind::Requested);
    assert_eq!(h.run(i64::MAX / 2, Cmd::ReleaseLock { id: 1, payouts_through: 0 }).unwrap_err(), Error::LockNotExpired);
    h.run(i64::MAX / 2, forced_cmd(1, u, FORCED_WITHDRAW, 50 * USDC)).unwrap();
    assert_eq!(h.run(i64::MAX / 2, Cmd::WithdrawRequested { id: FORCED_ID_BIT | 1 }).unwrap_err(), Error::WrongState);
    h.check();
}
