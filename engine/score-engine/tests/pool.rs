//! The concentrated-liquidity pool in isolation: agreement with x·y=k at full range, and
//! solvency / no-free-lunch properties under random positions and swaps.
use proptest::prelude::*;
use score_engine::clmm::liquidity_for_amounts;
use score_engine::fixed::{isqrt, narrow, w, MAX_SQRT_X64, MIN_SQRT_X64};
use score_engine::math as m;
use score_engine::pool::{fee_owed, Pool};

/// A pool at price y/x with one full-range position funded by (x, y).
fn full_range(x: u128, y: u128) -> (Pool, u128) {
    let sqrt = narrow(isqrt((w(y) << 128) / w(x))).unwrap();
    let mut p = Pool::new(sqrt).unwrap();
    let l = liquidity_for_amounts(sqrt, MIN_SQRT_X64, MAX_SQRT_X64, x, y).unwrap();
    let (a0, a1) = p.amounts_for(MIN_SQRT_X64, MAX_SQRT_X64, l, true).unwrap();
    p.modify(MIN_SQRT_X64, MAX_SQRT_X64, l as i128).unwrap();
    p.reserve0 = a0 as u64;
    p.reserve1 = a1 as u64;
    (p, l)
}

fn swap(p: &mut Pool, tokens_in: bool, amount: u128) -> (u128, u128) {
    let mut s = p.sim();
    let lim = if tokens_in { MIN_SQRT_X64 } else { MAX_SQRT_X64 };
    let r = p.sim_swap(&mut s, tokens_in, amount, lim).unwrap();
    p.apply(s).unwrap();
    r
}

#[test]
fn full_range_matches_constant_product() {
    // The opening pool from the spec: $17,500 and ~1.6M tokens.
    let (x, y) = (1_599_828_000_000u128, 17_500_000_000u128);
    for usdc in [1_000_000u128, 100_000_000, 1_000_000_000, 5_000_000_000, 20_000_000_000] {
        let (mut p, _) = full_range(x, y);
        let (used, out) = swap(&mut p, false, usdc);
        assert_eq!(used, usdc);
        let (cp_out, _, _) = m::swap_lp(y, x, usdc).unwrap();
        let diff = cp_out.abs_diff(out) as f64 / cp_out as f64;
        // Full range spans 2^-48..2^48, not 0..inf, and v3 charges the fee as ceil(in·f/(1-f)):
        // both differences are tiny.
        assert!(diff < 1e-4, "buy {usdc}: clmm {out} vs x·y=k {cp_out} ({diff:e})");
    }
    for tokens in [10_000_000u128, 1_000_000_000, 100_000_000_000, 800_000_000_000] {
        let (mut p, _) = full_range(x, y);
        let (_, out) = swap(&mut p, true, tokens);
        let (cp_out, _, _) = m::swap_lp(x, y, tokens).unwrap();
        let diff = cp_out.abs_diff(out) as f64 / cp_out as f64;
        assert!(diff < 1e-4, "sell {tokens}: clmm {out} vs x·y=k {cp_out} ({diff:e})");
    }
}

#[derive(Debug, Clone)]
struct Pos {
    lower: u128,
    upper: u128,
    l: u128,
    in0: u128,
    in1: u128,
}

#[derive(Debug, Clone)]
enum Op {
    Add { lo_pct: u32, hi_pct: u32, usdc: u64, tokens: u64 },
    Remove(usize),
    Swap { tokens_in: bool, amount: u64 },
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (1u32..400, 1u32..400, 1u64..1_000_000_000_000, 1u64..100_000_000_000_000)
            .prop_map(|(a, b, usdc, tokens)| Op::Add { lo_pct: a, hi_pct: b, usdc, tokens }),
        (0usize..64).prop_map(Op::Remove),
        (any::<bool>(), 1u64..50_000_000_000_000).prop_map(|(tokens_in, amount)| Op::Swap { tokens_in, amount }),
    ]
}

/// Σ (withdrawable + earned fees) over positions must never exceed the reserves.
fn solvent(p: &Pool, pos: &[Pos]) -> Result<(), TestCaseError> {
    let (mut o0, mut o1) = (0u128, 0u128);
    let mut active = 0u128;
    for q in pos {
        let (a0, a1) = p.amounts_for(q.lower, q.upper, q.l, false).unwrap();
        let (i0, i1) = p.fee_inside(q.lower, q.upper);
        o0 += a0 + fee_owed(q.l, i0.wrapping_sub(q.in0)).unwrap();
        o1 += a1 + fee_owed(q.l, i1.wrapping_sub(q.in1)).unwrap();
        if p.is_active(q.lower, q.upper) {
            active += q.l;
        }
    }
    prop_assert!(o0 <= p.reserve0 as u128, "tokens owed {o0} > reserve {}", p.reserve0);
    prop_assert!(o1 <= p.reserve1 as u128, "usdc owed {o1} > reserve {}", p.reserve1);
    prop_assert_eq!(active, p.liquidity);
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// Random ranges, deposits, withdrawals and swaps: the pool always covers every position's
    /// principal and fees, tracks active liquidity exactly, and when everyone leaves, nothing is
    /// owed and only rounding dust remains.
    #[test]
    fn pool_stays_solvent(ops in proptest::collection::vec(op(), 1..80)) {
        let (mut p, l0) = full_range(1_600_000_000_000, 17_500_000_000);
        let mut pos = vec![Pos { lower: MIN_SQRT_X64, upper: MAX_SQRT_X64, l: l0, in0: 0, in1: 0 }];
        for o in ops {
            match o {
                Op::Add { lo_pct, hi_pct, usdc, tokens } => {
                    // range from lo_pct% to (lo_pct + hi_pct)% of the current price (sqrt scaled)
                    let lower = (p.sqrt / 100 * lo_pct as u128).clamp(MIN_SQRT_X64, MAX_SQRT_X64 - 1);
                    let upper = (lower + p.sqrt / 100 * hi_pct as u128).clamp(lower + 1, MAX_SQRT_X64);
                    let l = liquidity_for_amounts(p.sqrt, lower, upper, tokens as u128, usdc as u128).unwrap();
                    if l == 0 || p.check_modify(lower, upper, l as i128).is_err() { continue; }
                    let (a0, a1) = p.amounts_for(lower, upper, l, true).unwrap();
                    prop_assert!(a0 <= tokens as u128 && a1 <= usdc as u128);
                    let (in0, in1) = p.fee_inside(lower, upper);
                    p.modify(lower, upper, l as i128).unwrap();
                    p.reserve0 += a0 as u64;
                    p.reserve1 += a1 as u64;
                    pos.push(Pos { lower, upper, l, in0, in1 });
                }
                Op::Remove(i) => {
                    if pos.len() <= 1 { continue; }
                    let q = pos.remove(1 + i % (pos.len() - 1));
                    let (a0, a1) = p.amounts_for(q.lower, q.upper, q.l, false).unwrap();
                    let (i0, i1) = p.fee_inside(q.lower, q.upper);
                    let out0 = a0 + fee_owed(q.l, i0.wrapping_sub(q.in0)).unwrap();
                    let out1 = a1 + fee_owed(q.l, i1.wrapping_sub(q.in1)).unwrap();
                    p.modify(q.lower, q.upper, -(q.l as i128)).unwrap();
                    p.reserve0 = p.reserve0.checked_sub(out0 as u64).expect("token reserve underflow");
                    p.reserve1 = p.reserve1.checked_sub(out1 as u64).expect("usdc reserve underflow");
                }
                Op::Swap { tokens_in, amount } => {
                    let before = p.sqrt;
                    let (used, out) = swap(&mut p, tokens_in, amount as u128);
                    prop_assert!(used <= amount as u128);
                    if tokens_in { prop_assert!(p.sqrt <= before); } else { prop_assert!(p.sqrt >= before); }
                    let _ = out;
                }
            }
            solvent(&p, &pos)?;
        }
        // Everyone leaves (including the full-range seed): every withdrawal succeeds.
        for q in pos.drain(..) {
            let (a0, a1) = p.amounts_for(q.lower, q.upper, q.l, false).unwrap();
            let (i0, i1) = p.fee_inside(q.lower, q.upper);
            let out0 = a0 + fee_owed(q.l, i0.wrapping_sub(q.in0)).unwrap();
            let out1 = a1 + fee_owed(q.l, i1.wrapping_sub(q.in1)).unwrap();
            p.modify(q.lower, q.upper, -(q.l as i128)).unwrap();
            p.reserve0 = p.reserve0.checked_sub(out0 as u64).expect("token reserve underflow at exit");
            p.reserve1 = p.reserve1.checked_sub(out1 as u64).expect("usdc reserve underflow at exit");
        }
        prop_assert_eq!(p.liquidity, 0);
        prop_assert!(p.boundaries.is_empty());
    }

    /// No free lunch: buying and immediately selling everything back never returns more USDC.
    #[test]
    fn round_trip_never_profits(usdc in 1u64..20_000_000_000, extra in 0u32..3) {
        let (mut p, _) = full_range(1_600_000_000_000, 17_500_000_000);
        // optional extra concentrated liquidity around the price
        for i in 0..extra {
            let lower = p.sqrt / 10 * (8 - i as u128);
            let upper = p.sqrt / 10 * (12 + i as u128);
            let l = liquidity_for_amounts(p.sqrt, lower, upper, 500_000_000_000, 5_000_000_000).unwrap();
            let (a0, a1) = p.amounts_for(lower, upper, l, true).unwrap();
            p.modify(lower, upper, l as i128).unwrap();
            p.reserve0 += a0 as u64;
            p.reserve1 += a1 as u64;
        }
        let (_, tokens) = swap(&mut p, false, usdc as u128);
        let (_, back) = swap(&mut p, true, tokens);
        prop_assert!(back < usdc as u128 || usdc < 2, "bought {usdc}, sold back for {back}");
    }

    /// Splitting a trade never beats doing it in one go (beyond a unit of rounding per step).
    #[test]
    fn splitting_never_beats_one_trade(a in 1u64..5_000_000_000, b in 1u64..5_000_000_000, tokens_in in any::<bool>()) {
        let (base, _) = full_range(1_600_000_000_000, 17_500_000_000);
        let (a, b) = if tokens_in { (a as u128 * 100, b as u128 * 100) } else { (a as u128, b as u128) };
        let mut one = base.clone();
        let (_, whole) = swap(&mut one, tokens_in, a + b);
        let mut two = base;
        let (_, o1) = swap(&mut two, tokens_in, a);
        let (_, o2) = swap(&mut two, tokens_in, b);
        prop_assert!(o1 + o2 <= whole + 2, "split {o1}+{o2} > whole {whole}");
    }

    /// More input never gives less output.
    #[test]
    fn output_is_monotonic(a in 1u64..10_000_000_000, d in 1u64..1_000_000_000, tokens_in in any::<bool>()) {
        let (base, _) = full_range(1_600_000_000_000, 17_500_000_000);
        let (mut p1, mut p2) = (base.clone(), base);
        let (_, o1) = swap(&mut p1, tokens_in, a as u128);
        let (_, o2) = swap(&mut p2, tokens_in, a as u128 + d as u128);
        prop_assert!(o2 >= o1);
    }
}

mod exact {
    use super::*;
    use num_bigint::BigUint;
    use num_integer::Integer;

    fn b(x: u128) -> BigUint {
        BigUint::from(x)
    }

    /// Exact (tokens, usdc) value of liquidity `l` over [lo, hi) at price `s`, as rationals n/d.
    fn exact(s: u128, below: bool, lo: u128, hi: u128, l: u128) -> ((BigUint, BigUint), (BigUint, BigUint)) {
        let q: BigUint = BigUint::from(1u8) << 64;
        let a0 = |x: u128, y: u128| (b(l) * b(y - x) * &q, b(x) * b(y));
        let a1 = |x: u128, y: u128| (b(l) * b(y - x), q.clone());
        let zero = (BigUint::from(0u8), BigUint::from(1u8));
        let at_lo = s > lo || (s == lo && !below);
        let at_hi = s > hi || (s == hi && !below);
        if !at_lo {
            (a0(lo, hi), zero)
        } else if !at_hi {
            (a0(s, hi), a1(lo, s))
        } else {
            (zero, a1(lo, hi))
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(5000))]
        /// Withdrawals and valuations are exactly the floor of the true value; deposits exactly
        /// the ceiling — in all three regimes, including sitting exactly on a boundary.
        #[test]
        fn amounts_for_rounds_exactly(lo in (1u128 << 50)..(1u128 << 70), w_ in 1u128..(1u128 << 66), pos in 0u8..5, l in 1u128..(1u128 << 90)) {
            let hi = lo + w_;
            // price below, at lower, inside, at upper, above
            let s = match pos { 0 => lo - 1, 1 => lo, 2 => lo + w_ / 2, 3 => hi, _ => hi + 1 };
            for below in [false, true] {
                let mut p = Pool::new(s).unwrap();
                p.just_below = below;
                let ((n0, d0), (n1, d1)) = exact(s, below, lo, hi, l);
                let (f0, f1) = p.amounts_for(lo, hi, l, false).unwrap();
                let (c0, c1) = p.amounts_for(lo, hi, l, true).unwrap();
                prop_assert_eq!(b(f0), &n0 / &d0);
                prop_assert_eq!(b(f1), &n1 / &d1);
                prop_assert_eq!(b(c0), n0.div_ceil(&d0));
                prop_assert_eq!(b(c1), n1.div_ceil(&d1));
            }
        }
    }
}
