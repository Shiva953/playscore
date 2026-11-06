//! Concentrated-liquidity maths (Uniswap v3 `SqrtPriceMath`, `SwapMath`, `LiquidityAmounts`),
//! ported to Q64.64 sqrt prices with the same rounding rules:
//! - amounts the pool receives round up, amounts it pays round down;
//! - the next price after an input moves the price less than the exact value (pool-favouring);
//! - liquidity derived from amounts rounds down.
//!
//! Token 0 is the player token (x), token 1 is USDC (y), price = y/x, sqrt price = sqrt(y/x)·2^64.
//! "Zero for one" means tokens in, USDC out: the price falls.

use crate::fixed::{div_round_up, mul_div, narrow, w, MAX_LIQUIDITY, MAX_SQRT_X64, MIN_SQRT_X64, Q64};
use crate::math::{MathError, BPS, R};

fn ordered(a: u128, b: u128) -> (u128, u128) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

fn check_sqrt(s: u128) -> R<()> {
    if (MIN_SQRT_X64..=MAX_SQRT_X64).contains(&s) {
        Ok(())
    } else {
        Err(MathError::Overflow)
    }
}

/// Token amount between two sqrt prices for liquidity `l`: L·(sb − sa)·2^64 / (sb·sa).
pub fn amount0_delta(a: u128, b: u128, l: u128, round_up: bool) -> R<u128> {
    let (sa, sb) = ordered(a, b);
    check_sqrt(sa)?;
    check_sqrt(sb)?;
    let n1 = w(l) << 64;
    let n2 = w(sb - sa);
    let v = if round_up {
        div_round_up(mul_div(n1, n2, w(sb), true)?, w(sa))?
    } else {
        mul_div(n1, n2, w(sb), false)? / w(sa)
    };
    narrow(v)
}

/// USDC amount between two sqrt prices for liquidity `l`: L·(sb − sa) / 2^64.
pub fn amount1_delta(a: u128, b: u128, l: u128, round_up: bool) -> R<u128> {
    let (sa, sb) = ordered(a, b);
    check_sqrt(sa)?;
    check_sqrt(sb)?;
    narrow(mul_div(w(l), w(sb - sa), w(Q64), round_up)?)
}

/// Price after adding `amount` of token 0 (price falls). Rounds up, so it falls less than exact.
/// sqrt' = L·2^64·sqrt / (L·2^64 + amount·sqrt).
pub fn next_sqrt_from_amount0(sqrt: u128, l: u128, amount: u128) -> R<u128> {
    if amount == 0 {
        return Ok(sqrt);
    }
    let n1: ruint::aliases::U256 = w(l) << 64;
    let den = n1.checked_add(w(amount).checked_mul(w(sqrt)).ok_or(MathError::Overflow)?).ok_or(MathError::Overflow)?;
    narrow(mul_div(n1, w(sqrt), den, true)?)
}

/// Price after adding `amount` of USDC (price rises). Rounds down, so it rises less than exact.
/// sqrt' = sqrt + amount·2^64 / L.
pub fn next_sqrt_from_amount1(sqrt: u128, l: u128, amount: u128) -> R<u128> {
    if l == 0 {
        return Err(MathError::DivZero);
    }
    let q = narrow((w(amount) << 64) / w(l))?;
    sqrt.checked_add(q).ok_or(MathError::Overflow)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Step {
    pub sqrt_next: u128,
    /// Input excluding the fee, rounded up.
    pub amount_in: u128,
    /// Output, rounded down.
    pub amount_out: u128,
    /// Fee taken from the input, in the input token.
    pub fee: u128,
}

/// One exact-input swap step from `cur` towards `target` within constant liquidity `l`, with the
/// fee charged on the input (Uniswap v3 `computeSwapStep`, exact-input branch).
/// Guarantees amount_in + fee <= remaining.
pub fn swap_step(cur: u128, target: u128, l: u128, remaining: u128, fee_bps: u128) -> R<Step> {
    let zero_for_one = cur >= target;
    let less_fee = narrow(mul_div(w(remaining), w(BPS - fee_bps), w(BPS), false)?)?;
    let to_target = if zero_for_one { amount0_delta(target, cur, l, true)? } else { amount1_delta(cur, target, l, true)? };
    let sqrt_next = if less_fee >= to_target {
        target
    } else if zero_for_one {
        next_sqrt_from_amount0(cur, l, less_fee)?
    } else {
        next_sqrt_from_amount1(cur, l, less_fee)?
    };
    let reached = sqrt_next == target;
    let (amount_in, amount_out) = if zero_for_one {
        (if reached { to_target } else { amount0_delta(sqrt_next, cur, l, true)? }, amount1_delta(sqrt_next, cur, l, false)?)
    } else {
        (if reached { to_target } else { amount1_delta(cur, sqrt_next, l, true)? }, amount0_delta(cur, sqrt_next, l, false)?)
    };
    let fee = if reached {
        narrow(mul_div(w(amount_in), w(fee_bps), w(BPS - fee_bps), true)?)?
    } else {
        // The whole remainder is consumed; what the price move didn't need is fee.
        remaining.checked_sub(amount_in).ok_or(MathError::Overflow)?
    };
    if amount_in.checked_add(fee).ok_or(MathError::Overflow)? > remaining {
        return Err(MathError::Overflow);
    }
    Ok(Step { sqrt_next, amount_in, amount_out, fee })
}

/// Liquidity for an amount of token 0 over [sa, sb]: x·sa·sb / ((sb − sa)·2^64), rounded down
/// and capped at `MAX_LIQUIDITY` (a cap only ever lowers what the depositor puts in).
pub fn liquidity_for_amount0(a: u128, b: u128, x: u128) -> R<u128> {
    let (sa, sb) = ordered(a, b);
    if sa == sb {
        return Ok(0);
    }
    let inter = mul_div(w(sa), w(sb), w(Q64), false)?;
    narrow(mul_div(w(x), inter, w(sb - sa), false)?.min(w(MAX_LIQUIDITY)))
}

/// Liquidity for an amount of USDC over [sa, sb]: y·2^64 / (sb − sa), rounded down and capped at
/// `MAX_LIQUIDITY`.
pub fn liquidity_for_amount1(a: u128, b: u128, y: u128) -> R<u128> {
    let (sa, sb) = ordered(a, b);
    if sa == sb {
        return Ok(0);
    }
    narrow(mul_div(w(y), w(Q64), w(sb - sa), false)?.min(w(MAX_LIQUIDITY)))
}

/// Largest liquidity that `x` tokens and `y` USDC can fund over [sa, sb] at price `sqrt`
/// (Uniswap v3 `getLiquidityForAmounts`), rounded down and capped at `MAX_LIQUIDITY`.
pub fn liquidity_for_amounts(sqrt: u128, sa: u128, sb: u128, x: u128, y: u128) -> R<u128> {
    if sqrt <= sa {
        liquidity_for_amount0(sa, sb, x)
    } else if sqrt < sb {
        Ok(liquidity_for_amount0(sqrt, sb, x)?.min(liquidity_for_amount1(sa, sqrt, y)?))
    } else {
        liquidity_for_amount1(sa, sb, y)
    }
}
