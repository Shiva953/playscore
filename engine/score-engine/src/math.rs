//! Integer maths for score, ported from the spec (scorespecification.pdf v3.0, sections 2, 5, 6, 7, 13)
//! and shaped after the reference program's calls into `score_math` (docs/concept/scorefunv1.rs).
//!
//! UNVERIFIED against the client's `score_math` crate (not supplied). Every rounding choice follows
//! the spec text: fees round up, everything else rounds down unless stated. Function names and
//! argument orders match the reference program's call sites so the real crate can be dropped in.
//! When it arrives, port its test vectors into `tests/` and reconcile.
//!
//! Choices the spec text doesn't pin down (check against `score_math`):
//! - `split`: vault share rounds down, treasury takes the remainder.
//! - `tax_bps`: the age discount rounds down, so the tax rounds up.
//!
//! No floats anywhere. All intermediates are u128 with checked arithmetic.

pub const MICRO: u128 = 1_000_000;
/// Curve constant Q from spec section 5.
pub const Q: u128 = 3_883_000_000;
/// 80% of 10M tokens, in base units.
pub const FLOAT_BASE: u128 = 8_000_000 * MICRO;
/// Dividend reserve (20%), base units.
pub const RESERVE_BASE: u128 = 2_000_000 * MICRO;
/// 25,000 USDC raised triggers graduation (micro-USDC).
pub const THRESHOLD: u128 = 25_000 * MICRO;
pub const ICO_FEE_BPS: u128 = 125;
pub const BUY_FEE_BPS: u128 = 5;
pub const LP_FEE_BPS: u128 = 25;
/// 3% of the float: per-purchase and per-account cap on the curve (base units).
pub const MAX_BUY_BASE: u128 = FLOAT_BASE * 300 / BPS;
pub const BPS: u128 = 10_000;
pub const DAY: u128 = 86_400;
pub const TAX_MAX_BPS: u128 = 500;
pub const TAX_SPAN_BPS: u128 = 450;
pub const TAX_DAYS: u128 = 90;
/// Curve works in milli-tokens (1,000 base units) so cubes fit in u128.
pub const MILLI: u128 = 1_000;

const THREE_Q: u128 = 3 * Q;
const CURVE_DEN: u128 = THREE_Q * 1_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    DivZero,
}
pub type R<T> = Result<T, MathError>;

#[inline]
pub fn mul(a: u128, b: u128) -> R<u128> {
    a.checked_mul(b).ok_or(MathError::Overflow)
}
#[inline]
pub fn add(a: u128, b: u128) -> R<u128> {
    a.checked_add(b).ok_or(MathError::Overflow)
}
#[inline]
pub fn sub(a: u128, b: u128) -> R<u128> {
    a.checked_sub(b).ok_or(MathError::Overflow)
}
#[inline]
pub fn div(a: u128, b: u128) -> R<u128> {
    a.checked_div(b).ok_or(MathError::DivZero)
}
#[inline]
pub fn div_ceil(a: u128, b: u128) -> R<u128> {
    if b == 0 {
        return Err(MathError::DivZero);
    }
    Ok(a.div_ceil(b))
}

/// fee(amount, bps) = ceil(amount * bps / 10_000). Always rounds up.
pub fn fee(amount: u128, bps: u128) -> R<u128> {
    div_ceil(mul(amount, bps)?, BPS)
}

/// Sell-side fees and taxes: 90% to the dividend vault, 10% to the treasury. Returns (vault, treasury).
pub fn split(amount: u128) -> (u128, u128) {
    let vault = amount * 90 / 100;
    (vault, amount - vault)
}

/// Numerator of the curve integral from `su` to `su + du` (milli-tokens), over `CURVE_DEN`:
/// 390·du·3Q·10^6 + ((su+du)³ − su³).
fn curve_numer(su: u128, du: u128) -> R<u128> {
    let hi = add(su, du)?;
    let cube = sub(mul(mul(hi, hi)?, hi)?, mul(mul(su, su)?, su)?)?;
    add(mul(mul(mul(390, du)?, THREE_Q)?, MICRO)?, cube)
}

/// cost(s, d): micro-USDC to buy `d` base units from `s` sold, rounded up. Inputs floor to milli-tokens.
pub fn curve_cost(sold: u128, d: u128) -> R<u128> {
    div_ceil(curve_numer(sold / MILLI, d / MILLI)?, CURVE_DEN)
}

/// refund(s, d) = floor(cost(s − d, d)).
pub fn curve_refund(sold: u128, d: u128) -> R<u128> {
    div(curve_numer(sub(sold, d)? / MILLI, d / MILLI)?, CURVE_DEN)
}

/// tokens_for(s, usdc): largest du (milli-tokens, up to the remaining float) with cost <= usdc. Base units.
pub fn curve_tokens_for(sold: u128, usdc: u128) -> R<u128> {
    let room = FLOAT_BASE.saturating_sub(sold) / MILLI;
    let (mut lo, mut hi) = (0u128, room);
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if curve_cost(sold, mid * MILLI)? <= usdc {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    Ok(lo * MILLI)
}

/// Smallest du (milli-tokens) with cost >= `usdc`, in base units; `None` if the whole remaining float
/// costs less. Not in the spec: used to clip the buy that crosses the graduation threshold (see
/// `Engine::buy_curve`).
pub fn curve_tokens_to_reach(sold: u128, usdc: u128) -> R<Option<u128>> {
    let room = FLOAT_BASE.saturating_sub(sold) / MILLI;
    if curve_cost(sold, room * MILLI)? < usdc {
        return Ok(None);
    }
    let (mut lo, mut hi) = (0u128, room);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if curve_cost(sold, mid * MILLI)? >= usdc {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    Ok(Some(lo * MILLI))
}

/// price_micro(s) = 390 + su² / (Q·10^6): micro-USDC per whole token.
pub fn price_micro(sold: u128) -> R<u128> {
    let su = sold / MILLI;
    add(390, div(mul(su, su)?, Q * MICRO)?)
}

/// Graduation split: (seed, pool_tokens, vault, treasury). Spec section 5.
pub fn graduation(raised: u128, sold: u128) -> R<(u128, u128, u128, u128)> {
    let seed = mul(raised, 70)? / 100;
    let vault = mul(raised, 20)? / 100;
    let treasury = raised - seed - vault;
    let pool_tokens = div(mul(seed, MICRO)?, price_micro(sold)?)?;
    Ok((seed, pool_tokens, vault, treasury))
}

/// swap_lp(r_in, r_out, amount_in) -> (out, new_r_in, new_r_out). Spec section 6.
/// The LP fee stays in the pool (r_in grows by the full amount), so k rises.
/// The engine trades on the concentrated-liquidity pool (`pool`); this constant-product primitive is
/// kept as the reference a full-range position must agree with (see tests).
pub fn swap_lp(r_in: u128, r_out: u128, amount_in: u128) -> R<(u128, u128, u128)> {
    let lp_fee = mul(amount_in, LP_FEE_BPS)? / BPS;
    let net = amount_in - lp_fee;
    let out = div(mul(net, r_out)?, add(r_in, net)?)?;
    Ok((out, add(r_in, amount_in)?, r_out - out))
}

/// tax_bps(age) = 500 − 450 · min(age, 90 days) / 90 days.
pub fn tax_bps(age_secs: u128) -> u128 {
    let span = TAX_DAYS * DAY;
    TAX_MAX_BPS - TAX_SPAN_BPS * age_secs.min(span) / span
}

/// Weighted entry time: (old_ts·old_w + new_ts·new_w) / (old_w + new_w), floor.
/// Argument order matches the reference program: (old_ts, old_weight, new_weight, new_ts).
pub fn new_entry_ts(old_ts: u128, old_w: u128, new_w: u128, new_ts: u128) -> R<u128> {
    let total = add(old_w, new_w)?;
    if total == 0 {
        return Ok(new_ts);
    }
    div(add(mul(old_ts, old_w)?, mul(new_ts, new_w)?)?, total)
}

/// Token election: tokens = amount · 1.10 / price, in base units, at order-book price `px`
/// (`fixed::PX_SCALE`). Rounds down. Not capped: the caller requires tokens <= reserve_left and
/// otherwise fails, so the holder takes USDC instead (spec section 13).
pub fn emit_tokens(amount: u128, px: u128) -> R<u128> {
    div(mul(mul(amount, 11)?, crate::fixed::PX_SCALE)?, mul(10, px)?)
}
