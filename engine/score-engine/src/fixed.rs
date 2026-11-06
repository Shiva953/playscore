//! Fixed-point helpers: 256-bit mul-div with explicit rounding, integer square root, and conversions
//! between sqrt prices (Q64.64) and order-book prices.
//!
//! No floats. Every function states its rounding direction, and callers pick the direction that
//! favours the pool or the protocol.

use ruint::aliases::U256;

use crate::math::{MathError, R};

/// 2^64, the Q64.64 unit.
pub const Q64: u128 = 1 << 64;
/// Order-book price scale: `px` = (USDC base units per token base unit) × 10^9. Both assets use
/// 6 decimals, so this is also USD per whole token × 10^9.
pub const PX_SCALE: u128 = 1_000_000_000;

/// Sqrt price bounds (Q64.64). Prices from 2^-48 (~3.6e-15) to 2^48 (~2.8e14) USD per token:
/// effectively full range, and narrow enough that every intermediate fits in 256 bits:
/// (L << 64) × sqrt < 2^96 · 2^64 · 2^88 = 2^248.
pub const MIN_SQRT_X64: u128 = 1 << 40;
pub const MAX_SQRT_X64: u128 = 1 << 88;
/// Upper bound on any pool's or position's liquidity (keeps the bound above true).
pub const MAX_LIQUIDITY: u128 = 1 << 96;

#[inline]
pub fn w(x: u128) -> U256 {
    U256::from(x)
}

#[inline]
pub fn narrow(x: U256) -> R<u128> {
    if x.bit_len() > 128 {
        return Err(MathError::Overflow);
    }
    let l = x.as_limbs();
    Ok(l[0] as u128 | (l[1] as u128) << 64)
}

/// floor or ceil of a·b/d with a 256-bit product. Errors on overflow or d = 0.
pub fn mul_div(a: U256, b: U256, d: U256, round_up: bool) -> R<U256> {
    if d.is_zero() {
        return Err(MathError::DivZero);
    }
    let p = a.checked_mul(b).ok_or(MathError::Overflow)?;
    let q = p / d;
    if round_up && !(p % d).is_zero() {
        q.checked_add(U256::from(1u8)).ok_or(MathError::Overflow)
    } else {
        Ok(q)
    }
}

/// u128 convenience wrapper for `mul_div`.
pub fn mul_div_u128(a: u128, b: u128, d: u128, round_up: bool) -> R<u128> {
    narrow(mul_div(w(a), w(b), w(d), round_up)?)
}

pub fn div_round_up(a: U256, d: U256) -> R<U256> {
    mul_div(a, U256::from(1u8), d, true)
}

/// floor(sqrt(n)), pure integer Newton iteration from an over-estimate.
pub fn isqrt(n: U256) -> U256 {
    if n < U256::from(2u8) {
        return n;
    }
    // 2^ceil(bits/2) >= sqrt(n), so the iteration decreases monotonically to floor(sqrt(n)).
    let mut x = U256::from(1u8) << n.bit_len().div_ceil(2);
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// Sqrt price (Q64.64) for an order-book price, clamped into [MIN, MAX].
/// Exact value: sqrt(px · 2^128 / PX_SCALE).
pub fn sqrt_from_px(px: u128, round_up: bool) -> R<u128> {
    let num = w(px) << 128;
    let v = num / w(PX_SCALE);
    let mut r = isqrt(v);
    if round_up && r * r * w(PX_SCALE) != num {
        r += U256::from(1u8);
    }
    Ok(narrow(r)?.clamp(MIN_SQRT_X64, MAX_SQRT_X64))
}

/// Order-book price for a sqrt price: sqrt² · PX_SCALE / 2^128.
pub fn px_from_sqrt(sqrt_x64: u128, round_up: bool) -> R<u128> {
    narrow(mul_div(w(sqrt_x64) * w(sqrt_x64), w(PX_SCALE), U256::from(1u8) << 128, round_up)?)
}

/// USDC for `qty` token base units at `px`.
pub fn usdc_at_px(qty: u128, px: u128, round_up: bool) -> R<u128> {
    mul_div_u128(qty, px, PX_SCALE, round_up)
}

/// Token base units that `usdc` buys at `px`, rounded down.
pub fn tokens_at_px(usdc: u128, px: u128) -> R<u128> {
    mul_div_u128(usdc, PX_SCALE, px, false)
}
