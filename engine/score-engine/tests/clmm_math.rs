//! Every fixed-point / CLMM primitive checked against exact rational arithmetic (num-bigint):
//! the rounded result must be exactly floor or ceil of the true value, in the stated direction.
use num_bigint::BigUint;
use num_integer::Integer;
use proptest::prelude::*;
use ruint::aliases::U256;
use score_engine::clmm::*;
use score_engine::fixed::*;
use score_engine::math::BPS;

fn b(x: u128) -> BigUint {
    BigUint::from(x)
}
fn q64() -> BigUint {
    BigUint::from(1u8) << 64
}
fn floor_div(n: &BigUint, d: &BigUint) -> BigUint {
    n / d
}
fn ceil_div(n: &BigUint, d: &BigUint) -> BigUint {
    n.div_ceil(d)
}
fn to_big(x: U256) -> BigUint {
    BigUint::from_bytes_le(&x.to_le_bytes::<32>())
}

fn sqrt_s() -> impl Strategy<Value = u128> {
    prop_oneof![
        MIN_SQRT_X64..=MAX_SQRT_X64,
        // dense around realistic prices ($1e-7 .. $1e4): sqrt in ~[2^52, 2^71]
        (1u128 << 52)..(1u128 << 71),
        Just(MIN_SQRT_X64),
        Just(MAX_SQRT_X64),
    ]
}
fn liq() -> impl Strategy<Value = u128> {
    prop_oneof![1u128..1_000, 1u128..(1u128 << 64), 1u128..MAX_LIQUIDITY, Just(MAX_LIQUIDITY)]
}
fn amount() -> impl Strategy<Value = u128> {
    prop_oneof![0u128..1_000, 0u128..(u64::MAX as u128)]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(4000))]

    #[test]
    fn isqrt_is_exact_floor(n in any::<[u64; 4]>()) {
        let v = U256::from_limbs(n);
        let r = isqrt(v);
        let (rb, vb) = (to_big(r), to_big(v));
        prop_assert!(&rb * &rb <= vb);
        prop_assert!((&rb + 1u8) * (&rb + 1u8) > vb);
    }

    #[test]
    fn amount0_delta_rounds_exactly(a in sqrt_s(), c in sqrt_s(), l in liq()) {
        let (sa, sb) = if a <= c { (a, c) } else { (c, a) };
        let num = b(l) * b(sb - sa) * q64();
        let den = b(sb) * b(sa);
        let down = amount0_delta(sa, sb, l, false);
        let up = amount0_delta(sa, sb, l, true);
        // v3 rounds up in two steps (ceil of ceil), which equals the single ceil for positive integers.
        if let (Ok(d), Ok(u)) = (down, up) {
            prop_assert_eq!(b(d), floor_div(&num, &den));
            prop_assert_eq!(b(u), ceil_div(&num, &den));
        } else {
            // Only allowed to fail when the result doesn't fit u128.
            prop_assert!(ceil_div(&num, &den) > b(u128::MAX));
        }
    }

    #[test]
    fn amount1_delta_rounds_exactly(a in sqrt_s(), c in sqrt_s(), l in liq()) {
        let (sa, sb) = if a <= c { (a, c) } else { (c, a) };
        let num = b(l) * b(sb - sa);
        prop_assert_eq!(b(amount1_delta(sa, sb, l, false).unwrap()), floor_div(&num, &q64()));
        prop_assert_eq!(b(amount1_delta(sa, sb, l, true).unwrap()), ceil_div(&num, &q64()));
    }

    #[test]
    fn next_price_from_token_input_is_exact_ceil(s in sqrt_s(), l in liq(), a in amount()) {
        let r = next_sqrt_from_amount0(s, l, a).unwrap();
        if a == 0 { prop_assert_eq!(r, s); } else {
            let num = b(l) * q64() * b(s);
            let den = b(l) * q64() + b(a) * b(s);
            prop_assert_eq!(b(r), ceil_div(&num, &den));
            prop_assert!(r <= s);
        }
    }

    #[test]
    fn next_price_from_usdc_input_is_exact_floor(s in sqrt_s(), l in liq(), a in amount()) {
        let r = next_sqrt_from_amount1(s, l, a);
        let exact = b(s) + floor_div(&(b(a) * q64()), &b(l));
        match r {
            Ok(v) => { prop_assert_eq!(b(v), exact); prop_assert!(v >= s); }
            Err(_) => prop_assert!(exact > b(u128::MAX)),
        }
    }

    /// Swap step: never takes more than offered, never pays more than the exact curve, and the
    /// price never moves past the target or further than the input justifies.
    #[test]
    fn swap_step_is_pool_favouring(cur in sqrt_s(), target in sqrt_s(), l in liq(), rem in amount(), fee in prop_oneof![Just(0u128), Just(25u128), 1u128..1000]) {
        let Ok(st) = swap_step(cur, target, l, rem, fee) else {
            // Overflow is only acceptable when the token-side amount to the target can't fit u128.
            prop_assert!(amount0_delta(cur.min(target), cur.max(target), l, true).is_err() || next_sqrt_from_amount1(cur, l, rem).is_err());
            return Ok(());
        };
        prop_assert!(st.amount_in + st.fee <= rem);
        let zfo = cur >= target;
        let (lo, hi) = if zfo { (target, cur) } else { (cur, target) };
        prop_assert!(st.sqrt_next >= lo && st.sqrt_next <= hi);
        // Exact amounts for the realised move cur -> next.
        let (sa, sb) = if zfo { (st.sqrt_next, cur) } else { (cur, st.sqrt_next) };
        let (in_num, in_den, out_num, out_den) = if zfo {
            (b(l) * b(sb - sa) * q64(), b(sb) * b(sa), b(l) * b(sb - sa), q64())
        } else {
            (b(l) * b(sb - sa), q64(), b(l) * b(sb - sa) * q64(), b(sb) * b(sa))
        };
        // input covers the exact required input (rounded up), output never exceeds exact output
        prop_assert!(b(st.amount_in) * &in_den >= in_num);
        prop_assert!(b(st.amount_out) * &out_den <= out_num);
        let less_fee = b(rem) * b(BPS - fee) / b(BPS);
        if st.sqrt_next != target {
            // didn't reach target: all input consumed, and the move needed no more than the net input
            prop_assert_eq!(st.amount_in + st.fee, rem);
            prop_assert!(b(st.amount_in) <= less_fee);
        } else {
            // reached target: fee is at least fee_bps of the gross input
            prop_assert!(b(st.fee) * b(BPS) >= b(st.amount_in + st.fee) * b(fee));
        }
    }

    /// Liquidity from amounts (rounded down) never asks for more than was offered once the amounts
    /// are rounded back up: ceil(f(floor(L))) <= ceil(f(L_exact)) = offer.
    #[test]
    fn liquidity_for_amounts_fits_offer(s in sqrt_s(), a in sqrt_s(), c in sqrt_s(), x in amount(), y in amount()) {
        let (sa, sb) = if a < c { (a, c) } else if a > c { (c, a) } else if a < MAX_SQRT_X64 { (a, a + 1) } else { (a - 1, a) };
        let l = liquidity_for_amounts(s, sa, sb, x, y).unwrap();
        let (dx, dy) = if s <= sa {
            (amount0_delta(sa, sb, l, true).unwrap(), 0)
        } else if s < sb {
            (amount0_delta(s, sb, l, true).unwrap(), amount1_delta(sa, s, l, true).unwrap())
        } else {
            (0, amount1_delta(sa, sb, l, true).unwrap())
        };
        prop_assert!(dx <= x && dy <= y, "dx {dx} > {x} or dy {dy} > {y}");
    }

    #[test]
    fn px_sqrt_conversions_bracket_the_true_value(px in 1u128..(1u128 << 64)) {
        let d = sqrt_from_px(px, false).unwrap();
        let u = sqrt_from_px(px, true).unwrap();
        let target = b(px) << 128;
        if d > MIN_SQRT_X64 && u < MAX_SQRT_X64 {
            prop_assert!(b(d) * b(d) * b(PX_SCALE) <= target);
            prop_assert!(b(u) * b(u) * b(PX_SCALE) >= target);
            prop_assert!(u - d <= 1);
        }
        // and back: px_from_sqrt(down) <= px <= px_from_sqrt(up)
        if d > MIN_SQRT_X64 && u < MAX_SQRT_X64 {
            prop_assert!(px_from_sqrt(d, false).unwrap() <= px);
            prop_assert!(px_from_sqrt(u, true).unwrap() >= px);
        }
    }

    #[test]
    fn mul_div_matches_bigint(a in any::<u128>(), c in any::<u128>(), d in 1u128..) {
        let exact_f = b(a) * b(c) / b(d);
        let exact_c = (b(a) * b(c)).div_ceil(&b(d));
        match mul_div_u128(a, c, d, false) {
            Ok(v) => prop_assert_eq!(b(v), exact_f),
            Err(_) => prop_assert!(exact_f > b(u128::MAX)),
        }
        match mul_div_u128(a, c, d, true) {
            Ok(v) => prop_assert_eq!(b(v), exact_c),
            Err(_) => prop_assert!(exact_c > b(u128::MAX)),
        }
    }
}
