//! Concentrated-liquidity pool for one player (token 0 = player token, token 1 = USDC).
//!
//! Positions cover sqrt-price ranges [lower, upper). Where Uniswap v3 uses ticks, this pool keys
//! range boundaries by their exact sqrt price. `just_below` plays the role of v3's
//! `tick = tickNext - 1`: after a downward swap stops exactly on a boundary, the price is treated as
//! just below it.
//!
//! Swaps run in two phases: `sim_swap` works on a `Sim` copy of the hot state and records the
//! boundaries it crosses, without touching the pool; `apply` commits a finished `Sim`. A failed
//! slippage check therefore never leaves a half-applied trade.
//!
//! Fees: v3-style fee growth per unit of liquidity (Q64.64, wrapping), charged on the input token.
//! Pool reserves hold everything paid in; every amount paid out rounds down, so reserves always
//! cover every position's withdrawable amounts plus accrued fees (checked by `solvency`).

use std::collections::BTreeMap;
use std::ops::Bound::{Excluded, Included, Unbounded};

use borsh::{BorshDeserialize, BorshSerialize};

use crate::clmm::{amount0_delta, amount1_delta, swap_step};
use crate::fixed::{narrow, w, MAX_LIQUIDITY, MAX_SQRT_X64, MIN_SQRT_X64};
use crate::math::{MathError, LP_FEE_BPS, R};

#[derive(Debug, Clone, Default, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Boundary {
    /// Total liquidity referencing this boundary.
    pub gross: u128,
    /// Liquidity added when crossing upward (removed when crossing downward).
    pub net: i128,
    /// Fee growth on the far side of this boundary from the current price (v3 "outside").
    pub outside0: u128,
    pub outside1: u128,
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Pool {
    pub sqrt: u128,
    /// Liquidity active at the current price.
    pub liquidity: u128,
    pub just_below: bool,
    /// Global fee growth per unit liquidity, Q64.64, wrapping (token 0 and USDC).
    pub fg0: u128,
    pub fg1: u128,
    pub reserve0: u64,
    pub reserve1: u64,
    pub boundaries: BTreeMap<u128, Boundary>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Crossing {
    pub at: u128,
    pub fg0: u128,
    pub fg1: u128,
}

/// Working copy of the pool's hot state during a swap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sim {
    pub sqrt: u128,
    pub liquidity: u128,
    pub just_below: bool,
    pub fg0: u128,
    pub fg1: u128,
    pub crossings: Vec<Crossing>,
    /// Gross flows into / out of the reserves.
    pub in0: u128,
    pub out0: u128,
    pub in1: u128,
    pub out1: u128,
}

/// Is a price state (sqrt, just_below) at or above boundary `b`?
#[inline]
pub fn at_or_above(sqrt: u128, just_below: bool, b: u128) -> bool {
    sqrt > b || (sqrt == b && !just_below)
}

fn add_net(l: u128, net: i128, upward: bool) -> R<u128> {
    // Crossing upward adds `net`; crossing downward subtracts it.
    let add = (net >= 0) == upward;
    let mag = net.unsigned_abs();
    if add {
        l.checked_add(mag).filter(|v| *v <= MAX_LIQUIDITY).ok_or(MathError::Overflow)
    } else {
        l.checked_sub(mag).ok_or(MathError::Overflow)
    }
}

/// Fee owed for `l` liquidity over a growth delta (Q64.64): floor(l·delta / 2^64).
pub fn fee_owed(l: u128, delta: u128) -> R<u128> {
    narrow((w(l) * w(delta)) >> 64)
}

impl Pool {
    pub fn new(sqrt: u128) -> R<Self> {
        if !(MIN_SQRT_X64 < sqrt && sqrt < MAX_SQRT_X64) {
            return Err(MathError::Overflow);
        }
        Ok(Pool { sqrt, liquidity: 0, just_below: false, fg0: 0, fg1: 0, reserve0: 0, reserve1: 0, boundaries: BTreeMap::new() })
    }

    pub fn at_or_above(&self, b: u128) -> bool {
        at_or_above(self.sqrt, self.just_below, b)
    }

    pub fn is_active(&self, lower: u128, upper: u128) -> bool {
        self.at_or_above(lower) && !self.at_or_above(upper)
    }

    pub fn sim(&self) -> Sim {
        Sim {
            sqrt: self.sqrt,
            liquidity: self.liquidity,
            just_below: self.just_below,
            fg0: self.fg0,
            fg1: self.fg1,
            crossings: Vec::new(),
            in0: 0,
            out0: 0,
            in1: 0,
            out1: 0,
        }
    }

    fn next_boundary(&self, s: &Sim, upward: bool) -> Option<u128> {
        if upward {
            let lo = if s.just_below { Included(s.sqrt) } else { Excluded(s.sqrt) };
            self.boundaries.range((lo, Unbounded)).next().map(|(k, _)| *k)
        } else {
            let hi = if s.just_below { Excluded(s.sqrt) } else { Included(s.sqrt) };
            self.boundaries.range((Unbounded, hi)).next_back().map(|(k, _)| *k)
        }
    }

    /// Exact-input swap leg on `s`, moving at most to `limit`. `tokens_in`: player tokens in (price
    /// falls), else USDC in (price rises). Returns (input consumed including fees, output).
    /// Stops when the input is used up or the price reaches `limit`.
    pub fn sim_swap(&self, s: &mut Sim, tokens_in: bool, amount: u128, limit: u128) -> R<(u128, u128)> {
        if !(MIN_SQRT_X64..=MAX_SQRT_X64).contains(&limit) {
            return Err(MathError::Overflow);
        }
        let upward = !tokens_in;
        if (upward && limit < s.sqrt) || (!upward && limit > s.sqrt) {
            return Ok((0, 0));
        }
        let mut rem = amount;
        let mut out = 0u128;
        while rem > 0 && s.sqrt != limit {
            let nb = self.next_boundary(s, upward);
            let target = match nb {
                Some(b) if upward => b.min(limit),
                Some(b) => b.max(limit),
                None => limit,
            };
            let st = swap_step(s.sqrt, target, s.liquidity, rem, LP_FEE_BPS)?;
            rem -= st.amount_in + st.fee;
            out += st.amount_out;
            if st.fee > 0 {
                // swap_step only charges a fee when liquidity is non-zero.
                let g = narrow((w(st.fee) << 64) / w(s.liquidity))?;
                if tokens_in {
                    s.fg0 = s.fg0.wrapping_add(g);
                } else {
                    s.fg1 = s.fg1.wrapping_add(g);
                }
            }
            let moved = st.sqrt_next != s.sqrt;
            s.sqrt = st.sqrt_next;
            if nb == Some(st.sqrt_next) {
                let b = &self.boundaries[&st.sqrt_next];
                s.liquidity = add_net(s.liquidity, b.net, upward)?;
                s.crossings.push(Crossing { at: st.sqrt_next, fg0: s.fg0, fg1: s.fg1 });
                s.just_below = !upward;
            } else if moved {
                s.just_below = false;
            }
        }
        let used = amount - rem;
        if tokens_in {
            s.in0 += used;
            s.out1 += out;
        } else {
            s.in1 += used;
            s.out0 += out;
        }
        Ok((used, out))
    }

    /// Commit a finished simulation. Checks reserves before changing anything.
    pub fn apply(&mut self, s: Sim) -> R<()> {
        let r0 = (self.reserve0 as u128 + s.in0).checked_sub(s.out0).ok_or(MathError::Overflow)?;
        let r1 = (self.reserve1 as u128 + s.in1).checked_sub(s.out1).ok_or(MathError::Overflow)?;
        let (r0, r1) = (u64::try_from(r0).map_err(|_| MathError::Overflow)?, u64::try_from(r1).map_err(|_| MathError::Overflow)?);
        for c in &s.crossings {
            let b = self.boundaries.get_mut(&c.at).ok_or(MathError::Overflow)?;
            b.outside0 = c.fg0.wrapping_sub(b.outside0);
            b.outside1 = c.fg1.wrapping_sub(b.outside1);
        }
        self.sqrt = s.sqrt;
        self.liquidity = s.liquidity;
        self.just_below = s.just_below;
        self.fg0 = s.fg0;
        self.fg1 = s.fg1;
        self.reserve0 = r0;
        self.reserve1 = r1;
        Ok(())
    }

    fn outside(&self, b: u128) -> (u128, u128) {
        match self.boundaries.get(&b) {
            Some(x) => (x.outside0, x.outside1),
            // An uninitialised boundary behaves as if initialised now.
            None if self.at_or_above(b) => (self.fg0, self.fg1),
            None => (0, 0),
        }
    }

    /// Fee growth inside [lower, upper) (v3 `getFeeGrowthInside`), wrapping.
    pub fn fee_inside(&self, lower: u128, upper: u128) -> (u128, u128) {
        let (lo0, lo1) = self.outside(lower);
        let (up0, up1) = self.outside(upper);
        let (below0, below1) = if self.at_or_above(lower) { (lo0, lo1) } else { (self.fg0.wrapping_sub(lo0), self.fg1.wrapping_sub(lo1)) };
        let (above0, above1) = if self.at_or_above(upper) { (self.fg0.wrapping_sub(up0), self.fg1.wrapping_sub(up1)) } else { (up0, up1) };
        (self.fg0.wrapping_sub(below0).wrapping_sub(above0), self.fg1.wrapping_sub(below1).wrapping_sub(above1))
    }

    /// (tokens, usdc) that liquidity `l` over [lower, upper) represents at the current price.
    /// Deposits round up; withdrawals and valuations round down.
    pub fn amounts_for(&self, lower: u128, upper: u128, l: u128, round_up: bool) -> R<(u128, u128)> {
        if !self.at_or_above(lower) {
            Ok((amount0_delta(lower, upper, l, round_up)?, 0))
        } else if !self.at_or_above(upper) {
            Ok((amount0_delta(self.sqrt, upper, l, round_up)?, amount1_delta(lower, self.sqrt, l, round_up)?))
        } else {
            Ok((0, amount1_delta(lower, upper, l, round_up)?))
        }
    }

    /// Validate a liquidity change of `delta` over [lower, upper) without applying it.
    pub fn check_modify(&self, lower: u128, upper: u128, delta: i128) -> R<()> {
        if !(MIN_SQRT_X64 <= lower && lower < upper && upper <= MAX_SQRT_X64) {
            return Err(MathError::Overflow);
        }
        let mag = delta.unsigned_abs();
        for b in [lower, upper] {
            let gross = self.boundaries.get(&b).map_or(0, |x| x.gross);
            if delta >= 0 {
                gross.checked_add(mag).filter(|v| *v <= MAX_LIQUIDITY).ok_or(MathError::Overflow)?;
            } else {
                gross.checked_sub(mag).ok_or(MathError::Overflow)?;
            }
        }
        if self.is_active(lower, upper) {
            if delta >= 0 {
                self.liquidity.checked_add(mag).filter(|v| *v <= MAX_LIQUIDITY).ok_or(MathError::Overflow)?;
            } else {
                self.liquidity.checked_sub(mag).ok_or(MathError::Overflow)?;
            }
        }
        Ok(())
    }

    /// Apply a liquidity change. Validates everything first (`check_modify`), then writes with no
    /// further failure points. Initialises new boundaries (outside growth = global if at or below
    /// the price, else 0) and clears boundaries nobody references.
    pub fn modify(&mut self, lower: u128, upper: u128, delta: i128) -> R<()> {
        self.check_modify(lower, upper, delta)?;
        let mag = delta.unsigned_abs();
        let active = self.is_active(lower, upper);
        for (b, sign) in [(lower, 1i128), (upper, -1i128)] {
            let init = if self.at_or_above(b) { (self.fg0, self.fg1) } else { (0, 0) };
            let e = self.boundaries.entry(b).or_insert_with(|| Boundary { gross: 0, net: 0, outside0: init.0, outside1: init.1 });
            e.gross = if delta >= 0 { e.gross + mag } else { e.gross - mag };
            // |net| <= gross <= MAX_LIQUIDITY = 2^96, so this cannot overflow i128.
            e.net += sign * delta;
            if e.gross == 0 {
                self.boundaries.remove(&b);
            }
        }
        if active {
            self.liquidity = if delta >= 0 { self.liquidity + mag } else { self.liquidity - mag };
        }
        Ok(())
    }
}
