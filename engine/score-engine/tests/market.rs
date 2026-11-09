//! Bonded markets end to end: seed ladder, router, limit orders, self-trade prevention, range
//! liquidity, rounds and claims, and the state root.
mod common;

use common::*;
use score_engine::fixed::{px_from_sqrt, sqrt_from_px, usdc_at_px, PX_SCALE};
use score_engine::math as m;
use score_engine::state_root::{leaf, leaves, proof, root_of, state_root, verify, TAG_ACCOUNT};
use score_engine::wal::Sequencer;
use score_engine::*;

const P: PlayerId = 1;

/// A graduated market plus a few funded users. Returns (harness, next free user number).
fn setup() -> (H, u16) {
    let mut h = H::new();
    let next = h.graduate(0, P, 1);
    (h, next)
}

/// A curve buyer (they hold ~240k tokens and have USDC left).
fn holder(h: &mut H) -> UserId {
    h.user(1)
}

#[test]
fn graduation_builds_the_seed_ladder() {
    let (h, _) = setup();
    let e = h.e();
    let seeds: Vec<_> = e.lps().filter(|(_, l)| l.protocol).collect();
    assert_eq!(seeds.len(), 3);
    let pool = e.pool(P).unwrap();
    let mk = e.market(P).unwrap();
    // The ladder is centred on the curve's closing price (to within 0.01%): each slice is geometric
    // around the opening price, so sqrt(lower·upper) recovers it. (The graduating buy then moved
    // the price on.)
    let close_px = m::price_micro(mk.sold as u128).unwrap() * (PX_SCALE / m::MICRO);
    let tight = seeds.iter().map(|(_, l)| l).min_by_key(|l| l.upper - l.lower).unwrap();
    let centre = score_engine::fixed::narrow(score_engine::fixed::isqrt(score_engine::fixed::w(tight.lower) * score_engine::fixed::w(tight.upper))).unwrap();
    let px = px_from_sqrt(centre, false).unwrap();
    assert!(px.abs_diff(close_px) * 10_000 <= close_px, "ladder centre {px} vs close {close_px}");
    // Valued at the opening price, the slices use (almost) the whole 70% seed; only rounding dust is
    // left over (sent to the vault).
    let seed = 25_000 * USDC as u128 * 70 / 100;
    let at_open = score_engine::pool::Pool::new(centre).unwrap();
    let used: u128 = seeds.iter().map(|(_, l)| at_open.amounts_for(l.lower, l.upper, l.liquidity, true).unwrap().1).sum();
    assert!(used <= seed + 100 * USDC as u128 && used * 10_000 >= seed * 9_990, "slices use {used} of seed {seed}");
    // Slices: 30% tight, 30% wide, rest full range; all ranges contain the price.
    for (_, l) in &seeds {
        assert!(l.lower < pool.sqrt && pool.sqrt < l.upper);
    }
    h.check();
}

#[test]
fn ladder_is_deeper_than_constant_product() {
    let (mut h, next) = setup();
    let u = h.user(next);
    h.deposit(10, u, 20_000 * USDC).unwrap();
    let px0 = h.px(P);
    let Outcome::Traded { tokens, .. } = h.buy(11, u, P, 1_000 * USDC).unwrap() else { panic!() };
    let px1 = h.px(P);
    let impact = (px1 - px0) as f64 / px0 as f64;
    // Plain x·y=k on the same seed: 86,232 tokens and +11.7%.
    assert!(tokens / TOKEN > 86_232, "got {}", tokens / TOKEN);
    assert!(impact < 0.05, "impact {impact}");
    h.check();
}

#[test]
fn router_fills_from_the_cheaper_venue() {
    let (mut h, next) = setup();
    let maker = holder(&mut h);
    let taker = h.user(next);
    h.deposit(10, taker, 5_000 * USDC).unwrap();
    // The maker rests an ask 2% above the pool.
    let ask_px = h.px(P) * 102 / 100;
    let Outcome::Traded { order: Some(ask), .. } = h.order(11, maker, P, Side::Ask, ask_px, 50_000 * TOKEN, false).unwrap() else { panic!() };
    h.check();
    // Same buy against a copy of the market without the ask.
    let mut without = H::new();
    let next2 = without.graduate(0, P, 1);
    let t2 = without.user(next2);
    without.deposit(10, t2, 5_000 * USDC).unwrap();
    let Outcome::Traded { tokens: pool_only, .. } = without.buy(12, t2, P, 3_000 * USDC).unwrap() else { panic!() };

    let maker_before = h.e().account(&maker).free;
    let Outcome::Traded { tokens, .. } = h.buy(12, taker, P, 3_000 * USDC).unwrap() else { panic!() };
    assert!(tokens > pool_only, "with book {tokens} <= pool only {pool_only}");
    // The ask was filled in full at its price; the maker paid the sell tax on it.
    assert!(h.e().order(ask).is_none());
    let proceeds = usdc_at_px(50_000 * TOKEN as u128, ask_px as u128, true).unwrap() as u64;
    let maker_got = h.e().account(&maker).free - maker_before;
    assert!(maker_got < proceeds && maker_got > proceeds * 94 / 100, "maker got {maker_got} of {proceeds}");
    // The pool kept going past the ask.
    assert!(h.px(P) > ask_px);
    h.check();
}

#[test]
fn resting_bid_fills_when_sellers_come() {
    let (mut h, next) = setup();
    let bidder = h.user(next);
    let seller = holder(&mut h);
    h.deposit(10, bidder, 500 * USDC).unwrap();
    let bid_px = h.px(P) * 95 / 100;
    let Outcome::Traded { tokens: 0, order: Some(bid), .. } = h.order(11, bidder, P, Side::Bid, bid_px, 100 * USDC, false).unwrap() else {
        panic!("bid should rest")
    };
    assert_eq!(h.e().account(&bidder).in_orders, 100 * USDC);
    h.check();
    // A big sell pushes the pool down through the bid; the bid fills at its price.
    h.sell(12, seller, P, 200_000 * TOKEN).unwrap();
    assert!(h.e().order(bid).is_none() || h.e().order(bid).unwrap().remaining < 100 * USDC);
    assert!(h.e().holding(&bidder, P).amount > 0);
    assert!(h.px(P) <= bid_px);
    h.check();
}

#[test]
fn post_only_never_takes() {
    let (mut h, next) = setup();
    let u = h.user(next);
    let s = holder(&mut h);
    h.deposit(10, u, 500 * USDC).unwrap();
    let px = h.px(P);
    assert_eq!(h.order(11, u, P, Side::Bid, px * 101 / 100, 10 * USDC, true).unwrap_err(), Error::WouldCross);
    assert_eq!(h.order(11, s, P, Side::Ask, px * 99 / 100, 10_000 * TOKEN, true).unwrap_err(), Error::WouldCross);
    h.order(11, u, P, Side::Bid, px * 99 / 100, 10 * USDC, true).unwrap();
    h.order(11, s, P, Side::Ask, px * 101 / 100, 10_000 * TOKEN, true).unwrap();
    h.check();
}

#[test]
fn own_resting_order_is_cancelled_not_traded() {
    let (mut h, _) = setup();
    let u = holder(&mut h);
    let ask_px = h.px(P) * 101 / 100;
    let Outcome::Traded { order: Some(ask), .. } = h.order(11, u, P, Side::Ask, ask_px, 10_000 * TOKEN, false).unwrap() else { panic!() };
    let before = h.e().holding(&u, P);
    h.deposit(12, u, 2_000 * USDC).unwrap();
    // Buying through their own ask cancels it and unlocks the tokens instead of trading with self.
    h.buy(13, u, P, 1_000 * USDC).unwrap();
    assert!(h.e().order(ask).is_none());
    let after = h.e().holding(&u, P);
    assert_eq!(after.locked, 0);
    assert!(after.amount > before.amount + before.locked);
    h.check();
}

#[test]
fn cancel_refunds_and_checks_owner() {
    let (mut h, next) = setup();
    let u = h.user(next);
    let other = h.user(next + 1);
    h.deposit(10, u, 100 * USDC).unwrap();
    let Outcome::Traded { order: Some(id), .. } = h.order(11, u, P, Side::Bid, h.px(P) / 2, 50 * USDC, true).unwrap() else { panic!() };
    assert_eq!(h.cancel(12, other, id).unwrap_err(), Error::NotOwner);
    h.cancel(12, u, id).unwrap();
    assert_eq!(h.e().account(&u).free, 100 * USDC);
    assert_eq!(h.e().account(&u).in_orders, 0);
    assert_eq!(h.cancel(13, u, id).unwrap_err(), Error::UnknownOrder);
    h.check();
}

#[test]
fn range_liquidity_earns_fees_and_seed_is_locked() {
    let (mut h, next) = setup();
    let lp = holder(&mut h);
    let trader = h.user(next);
    h.deposit(10, trader, 20_000 * USDC).unwrap();
    h.deposit(10, lp, 2_000 * USDC).unwrap();
    let px = h.px(P);
    let Outcome::Liquidity { position, liquidity, .. } = h.add_lp(11, lp, P, px * 80 / 100, px * 125 / 100, 1_000 * USDC, 100_000 * TOKEN).unwrap() else {
        panic!()
    };
    h.check();
    // Volume back and forth through the range.
    for i in 0..10 {
        let Outcome::Traded { tokens, .. } = h.buy(20 + i, trader, P, 1_000 * USDC).unwrap() else { panic!() };
        h.sell(20 + i, trader, P, tokens).unwrap();
    }
    h.check();
    let pos = h.e().lp(position).unwrap().clone();
    let pool = h.e().pool(P).unwrap();
    let (p0, p1) = pool.amounts_for(pos.lower, pos.upper, pos.liquidity, false).unwrap();
    let Outcome::Liquidity { tokens, usdc, .. } = h.remove_lp(40, lp, position, liquidity).unwrap() else { panic!() };
    // Out = principal + fees earned in both assets.
    assert!(tokens as u128 > p0 && usdc as u128 > p1, "no fees: {tokens}/{p0} {usdc}/{p1}");
    assert!(h.e().lp(position).is_none());
    // Nobody can pull the protocol seed.
    let seed = *h.e().lps().find(|(_, l)| l.protocol).unwrap().0;
    assert_eq!(h.remove_lp(41, lp, seed, 1).unwrap_err(), Error::SeedFloor);
    h.check();
}

#[test]
fn pause_stops_trading_but_not_exits() {
    let (mut h, next) = setup();
    let u = h.user(next);
    let lp = holder(&mut h);
    h.deposit(10, u, 100 * USDC).unwrap();
    h.deposit(10, lp, 1_000 * USDC).unwrap();
    let px = h.px(P);
    let Outcome::Traded { order: Some(id), .. } = h.order(11, u, P, Side::Bid, px / 2, 50 * USDC, true).unwrap() else { panic!() };
    let Outcome::Liquidity { position, liquidity, .. } = h.add_lp(11, lp, P, 0, 0, 100 * USDC, 100_000 * TOKEN).unwrap() else { panic!() };
    h.run(12, Cmd::SetPaused { paused: true }).unwrap();
    assert_eq!(h.buy(13, u, P, 10 * USDC).unwrap_err(), Error::Paused);
    assert_eq!(h.order(13, u, P, Side::Bid, px / 2, 10 * USDC, true).unwrap_err(), Error::Paused);
    h.cancel(14, u, id).unwrap();
    h.remove_lp(14, lp, position, liquidity).unwrap();
    h.check();
}

#[test]
fn rounds_snapshot_result_and_claims() {
    let (mut h, next) = setup();
    let a = holder(&mut h);
    let b = h.user(2);
    let lp = h.user(3);
    // lp moves half their tokens into a full-range position: it still counts for dividends.
    h.deposit(5, lp, 3_000 * USDC).unwrap();
    let half = h.e().holding(&lp, P).amount / 2;
    h.add_lp(6, lp, P, 0, 0, 3_000 * USDC, half).unwrap();
    h.run(7, Cmd::PublishCalendar { round: 1, lock_ts: 100 }).unwrap();
    assert_eq!(h.run(50, Cmd::Snapshot { round: 1 }).unwrap_err(), Error::BadRound); // before kickoff
    // A passed lock can't be moved.
    h.run(100, Cmd::Snapshot { round: 1 }).unwrap();
    assert_eq!(h.run(101, Cmd::PublishCalendar { round: 1, lock_ts: 200 }).unwrap_err(), Error::BadRound);
    // Trades after kickoff don't change entitlements.
    let after = h.user(next);
    h.deposit(101, after, 1_000 * USDC).unwrap();
    h.buy(102, after, P, 500 * USDC).unwrap();

    let vault0 = h.e().vault();
    let payout = 1_000 * USDC;
    let before_result = h.e().applied();
    h.run(200, Cmd::RoundResult { round: 1, payouts: vec![(P, payout)] }).unwrap();
    let at = h.e().applied();
    let credited = vault0 - h.e().vault();
    assert!(credited <= payout && credited > payout - 1_000, "credited {credited}");
    // Step 1 only sets the money aside: nobody can claim until the batch that moves it into
    // custody is finalized on Solana.
    assert_eq!((h.e().reserved(), h.e().claimable()), (credited, 0));
    assert_eq!(h.claim(200, a, 1, P, false).unwrap_err(), Error::NothingToClaim);
    h.check();
    // A batch cut before the result, or one beyond the log, credits nothing / is refused.
    h.run(200, Cmd::BatchFinalized { cut: before_result }).unwrap();
    assert_eq!(h.e().claimable(), 0);
    let beyond = h.e().applied() + 1;
    assert_eq!(h.run(200, Cmd::BatchFinalized { cut: beyond }).unwrap_err(), Error::BadSequence);
    // The batch covering the result is final: step 2 credits the holders.
    h.run(200, Cmd::BatchFinalized { cut: at }).unwrap();
    assert_eq!((h.e().reserved(), h.e().claimable()), (0, credited));
    assert_eq!(h.run(200, Cmd::BatchFinalized { cut: before_result }).unwrap_err(), Error::BadSequence, "never backwards");
    assert_eq!(h.e().claim_amount(&after, 1, P), 0);
    let (ca, cb, cl) = (h.e().claim_amount(&a, 1, P), h.e().claim_amount(&b, 1, P), h.e().claim_amount(&lp, 1, P));
    assert!(ca > 0 && cb > 0 && cl > 0);
    // a and b bought nearly the same on the curve; lp's LP side still earns about the same.
    assert!(ca.abs_diff(cb) * 100 < ca && cl.abs_diff(ca) * 20 < ca, "{ca} {cb} {cl}");
    h.check();

    // USDC claim
    let free0 = h.e().account(&a).free;
    h.claim(201, a, 1, P, false).unwrap();
    assert_eq!(h.e().account(&a).free, free0 + ca);
    assert_eq!(h.claim(202, a, 1, P, false).unwrap_err(), Error::NothingToClaim);
    // Token claim: +10% at the snapshot price, from the reserve; the USDC stays in the vault.
    let reserve0 = h.e().market(P).unwrap().reserve_left;
    let vault1 = h.e().vault();
    let Outcome::Claimed { tokens, .. } = h.claim(203, b, 1, P, true).unwrap() else { panic!() };
    assert_eq!(h.e().market(P).unwrap().reserve_left, reserve0 - tokens);
    assert_eq!(h.e().vault(), vault1 + cb);
    let expect = m::emit_tokens(cb as u128, snapshot_px(&h)).unwrap();
    assert_eq!(tokens as u128, expect);
    h.check();
    // ClaimAll: every row of the user in one signed command, same rules as Claim.
    let reserve1 = h.e().market(P).unwrap().reserve_left;
    let n = h.nonce(&lp);
    let Outcome::ClaimedAll { rows } = h.run(204, Cmd::ClaimAll { user: lp, nonce: n, take_tokens: true }).unwrap() else { panic!() };
    assert_eq!(rows.len(), 1);
    let (r, p, usdc, t_) = rows[0];
    assert_eq!((r, p, usdc), (1, P, 0));
    assert_eq!(t_ as u128, m::emit_tokens(cl as u128, snapshot_px(&h)).unwrap());
    assert_eq!(h.e().market(P).unwrap().reserve_left, reserve1 - t_);
    assert_eq!(h.e().claim_amount(&lp, 1, P), 0);
    let n = h.nonce(&lp);
    assert_eq!(h.run(205, Cmd::ClaimAll { user: lp, nonce: n, take_tokens: false }).unwrap_err(), Error::NothingToClaim);
    h.check();
}

/// The pool price at the round-1 snapshot (the election price), found by replaying the log.
fn snapshot_px(h: &H) -> u128 {
    let mut s = Sequencer::new();
    for r in &h.recs {
        s.submit(r.ts, r.cmd.clone(), r.sig).unwrap();
        if matches!(r.cmd, Cmd::Snapshot { .. }) {
            return px_from_sqrt(s.engine.pool(P).unwrap().sqrt, false).unwrap();
        }
    }
    panic!("no snapshot");
}

#[test]
fn state_root_is_reproducible_and_proves_balances() {
    let (mut h, next) = setup();
    let u = h.user(next);
    h.deposit(10, u, 777 * USDC).unwrap();
    h.buy(11, u, P, 100 * USDC).unwrap();
    h.order(12, u, P, Side::Bid, h.px(P) / 2, 50 * USDC, true).unwrap();
    let root = state_root(h.e());
    let replayed = Sequencer::replay(&h.recs).unwrap();
    assert_eq!(state_root(&replayed.engine), root);
    // u proves their account against the root.
    let ls = leaves(h.e());
    let mine = leaf(TAG_ACCOUNT, &u, &h.e().account(&u));
    let idx = ls.iter().position(|x| *x == mine).unwrap();
    let path = proof(&ls, idx);
    assert!(verify(&root, &mine, &path));
    // A false balance doesn't verify.
    let mut fake = h.e().account(&u);
    fake.free += 1;
    assert!(!verify(&root, &leaf(TAG_ACCOUNT, &u, &fake), &path));
    assert_eq!(root_of(&ls), root);
    // Any state change moves the root.
    h.buy(13, u, P, 10 * USDC).unwrap();
    assert_ne!(state_root(h.e()), root);
}

#[test]
fn sqrt_px_round_trip_sanity() {
    for px in [390_000u128, 10_939_000, 1_000_000_000, 123_456_789_012] {
        let d = sqrt_from_px(px, false).unwrap();
        let u = sqrt_from_px(px, true).unwrap();
        assert!(px_from_sqrt(d, false).unwrap() <= px && px_from_sqrt(u, true).unwrap() >= px);
    }
}

#[test]
fn exit_table_is_fully_backed_and_provable() {
    use score_engine::exit::{exit_leaf, exit_proof, exit_root, exit_table};
    let (mut h, next) = setup();
    let lp = holder(&mut h);
    let u = h.user(next);
    h.deposit(10, u, 3_000 * USDC).unwrap();
    h.deposit(10, lp, 3_000 * USDC).unwrap();
    h.buy(11, u, P, 1_000 * USDC).unwrap();
    let px = h.px(P);
    h.add_lp(12, lp, P, px * 80 / 100, px * 120 / 100, 500 * USDC, 50_000 * TOKEN).unwrap();
    h.order(13, u, P, Side::Bid, px / 2, 100 * USDC, true).unwrap();
    let n = h.nonce(&u);
    h.run(14, Cmd::LockWithdraw { user: u, nonce: n, amount: 200 * USDC, id: 1, expiry: 100 }).unwrap();
    h.run(15, Cmd::WithdrawRequested { id: 1 }).unwrap();
    // A requested lock never expires.
    assert_eq!(h.run(10_000, Cmd::ReleaseLock { id: 1, payouts_through: 0 }).unwrap_err(), Error::LockNotExpired);
    h.check();
    let table = exit_table(h.e()).unwrap();
    // Everything the table pays (plus pending locks) fits in custody minus vault and treasury.
    let total: u128 = table.values().map(|x| x.usdc as u128 + x.locks.iter().map(|l| l.1 as u128).sum::<u128>()).sum();
    let protocol = h.e().vault() as u128 + h.e().treasury() as u128;
    assert!(total <= h.e().custody() as u128 - protocol, "exit pays {total} > {}", h.e().custody() as u128 - protocol);
    // ...and it pays out nearly all of it (only rounding dust and protocol seed tokens' share stay).
    assert!(table[&u].locks == vec![(1, 200 * USDC)]);
    let root = exit_root(h.e()).unwrap();
    let (entry, path) = exit_proof(&table, &u).unwrap();
    assert!(score_engine::state_root::verify(&root, &exit_leaf(&u, &entry), &path));
}

#[test]
fn crossing_buy_fills_completely_through_the_new_pool() {
    let mut h = H::new();
    h.run(0, Cmd::ListPlayer { player: P }).unwrap();
    // Fill the curve to within ~$1,000 of the threshold.
    let mut n = 1u16;
    loop {
        let mk = h.e().market(P).unwrap().clone();
        let cost = m::curve_cost(mk.sold as u128, m::MAX_BUY_BASE - 5_000).unwrap();
        if mk.raised as u128 + cost + 1_000 * USDC as u128 >= m::THRESHOLD {
            break;
        }
        let u = h.user(n);
        n += 1;
        h.deposit(1, u, 5_000 * USDC).unwrap();
        let usdc_in = (cost + m::fee(cost, m::ICO_FEE_BPS).unwrap()) as u64;
        let nonce = h.nonce(&u);
        h.run(1, Cmd::BuyCurve { user: u, nonce, player: P, usdc_in, min_tokens: 1 }).unwrap();
    }
    let whale = h.user(n);
    h.deposit(2, whale, 10_000 * USDC).unwrap();
    // Asking for too many tokens fails atomically: still on the curve, nothing spent.
    let nonce = h.nonce(&whale);
    let r = h.run(3, Cmd::BuyCurve { user: whale, nonce, player: P, usdc_in: 5_000 * USDC, min_tokens: 10_000_000 * TOKEN });
    assert_eq!(r.unwrap_err(), Error::Slippage);
    assert_eq!(h.e().market(P).unwrap().state, MarketState::IcoLive);
    // The real buy: curve up to $25k, graduation, the rest from the new pool, in one command.
    let nonce = h.nonce(&whale);
    let Outcome::Bought { tokens, cost, fee, graduated } =
        h.run(3, Cmd::BuyCurve { user: whale, nonce, player: P, usdc_in: 5_000 * USDC, min_tokens: 1 }).unwrap()
    else {
        panic!()
    };
    assert!(graduated);
    assert_eq!(h.e().market(P).unwrap().state, MarketState::Bonded);
    let spent = 10_000 * USDC - h.e().account(&whale).free;
    assert_eq!(spent, cost + fee);
    assert!(5_000 * USDC - spent <= 2, "left {} unspent", 5_000 * USDC - spent);
    let hold = h.e().holding(&whale, P);
    assert_eq!(hold.amount, tokens);
    // Only the curve part counts against the 240k curve cap; the pool part is uncapped.
    assert!((hold.cap_bought as u128) < m::MAX_BUY_BASE && hold.amount > hold.cap_bought);
    h.check();
}

#[test]
fn seed_fees_are_collectable_and_withdrawable() {
    let (mut h, next) = setup();
    let trader = h.user(next);
    h.deposit(10, trader, 20_000 * USDC).unwrap();
    for i in 0..10 {
        let Outcome::Traded { tokens, .. } = h.buy(20 + i, trader, P, 1_000 * USDC).unwrap() else { panic!() };
        h.sell(20 + i, trader, P, tokens).unwrap();
    }
    let (t0, r1, minted) = (h.e().treasury(), h.e().pool(P).unwrap().reserve1, h.e().market(P).unwrap().minted);
    let Outcome::SeedFees { usdc, tokens_burned } = h.run(40, Cmd::CollectSeedFees { player: P }).unwrap() else { panic!() };
    // ~0.25% of ~$10k bought plus ~$10k sold, nearly all earned by the seed (it is the only LP).
    assert!(usdc > 20 * USDC && tokens_burned > 0, "usdc {usdc}, tokens {tokens_burned}");
    assert_eq!(h.e().treasury(), t0 + usdc);
    assert_eq!(h.e().pool(P).unwrap().reserve1, r1 - usdc);
    assert_eq!(h.e().market(P).unwrap().minted, minted - tokens_burned);
    h.check();
    // Nothing more until more trading happens.
    assert_eq!(h.run(41, Cmd::CollectSeedFees { player: P }).unwrap(), Outcome::SeedFees { usdc: 0, tokens_burned: 0 });
    // The treasury can now withdraw it.
    let t = h.e().treasury();
    let seq = h.e().payouts() + 1;
    h.run(42, Cmd::WithdrawTreasury { amount: t, seq }).unwrap();
    assert_eq!(h.e().treasury(), 0);
    h.check();
    // Optional: route the seed's USDC fees to the dividend vault instead.
    let params = Params { seed_fee_vault_bps: 10_000, ..h.e().params.clone() };
    h.run(49, Cmd::SetParams { params }).unwrap();
    let Outcome::Traded { tokens, .. } = h.buy(50, trader, P, 1_000 * USDC).unwrap() else { panic!() };
    h.sell(50, trader, P, tokens).unwrap();
    let (v0, t0) = (h.e().vault(), h.e().treasury());
    let Outcome::SeedFees { usdc, .. } = h.run(51, Cmd::CollectSeedFees { player: P }).unwrap() else { panic!() };
    assert_eq!(h.e().vault(), v0 + usdc);
    assert_eq!(h.e().treasury(), t0);
    h.check();
    // Parameter changes are logged, so replay reproduces them.
    let r = Sequencer::replay(&h.recs).unwrap();
    assert_eq!(state_root(&r.engine), state_root(h.e()));
}

/// A quote on the sandbox copy gives exactly what the real command then does, including fills
/// against resting orders and the seller's hold-age tax, and leaves the real engine untouched.
#[test]
fn sandbox_quotes_match_execution() {
    let (mut h, next) = setup();
    let (maker, taker) = (holder(&mut h), h.user(next + 1));
    h.deposit(11, taker, 5_000 * USDC).unwrap();
    let px = h.px(P);
    h.order(20, maker, P, Side::Ask, px * 101 / 100, 20_000 * TOKEN, true).unwrap();
    h.order(21, maker, P, Side::Bid, px * 99 / 100, 30 * USDC, true).unwrap();
    let root = state_root(h.e());

    let quote = |h: &H, cmd: &Cmd, user: &UserId| {
        let mut s = h.e().sandbox(P, user, 0, 0);
        s.apply(100, cmd).unwrap()
    };
    let buy = Cmd::Buy { user: taker, nonce: 1, player: P, usdc_in: 900 * USDC, min_tokens: 0, limit_px: 0 };
    let q = quote(&h, &buy, &taker);
    assert_eq!(state_root(h.e()), root, "quoting changed the engine");
    assert_eq!(h.run(100, buy).unwrap(), q);

    let held = h.e().holding(&taker, P).amount;
    let sell = Cmd::Sell { user: taker, nonce: 2, player: P, tokens_in: held, min_usdc: 0, limit_px: 0 };
    let q = quote(&h, &sell, &taker);
    assert_eq!(h.run(5_000, sell).unwrap(), q);

    // Signed out: a fresh key with a topped-up balance still gets the real routing.
    let nobody = [9u8; 32];
    let mut s = h.e().sandbox(P, &nobody, 1_000 * USDC, 0);
    assert!(matches!(s.apply(6_000, &Cmd::Buy { user: nobody, nonce: 1, player: P, usdc_in: 100 * USDC, min_tokens: 0, limit_px: 0 }), Ok(Outcome::Traded { .. })));
    h.check();
}
