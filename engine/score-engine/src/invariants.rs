//! Full consistency check of the engine state (spec section 17.3, plus the book and the pool).
//! O(state): for tests, the watchtower and batch commits, not the hot path.

use std::collections::BTreeMap;

use crate::engine::{u, Engine};
use crate::fixed::{sqrt_from_px, MAX_LIQUIDITY, MAX_SQRT_X64, MIN_SQRT_X64};
use crate::math as m;
use crate::pool::{at_or_above, fee_owed};
use crate::types::*;

macro_rules! ensure {
    ($c:expr, $($arg:tt)*) => {
        if !$c {
            return Err(format!($($arg)*));
        }
    };
}

impl Engine {
    pub fn check_invariants(&self) -> Result<(), String> {
        let e = |x: crate::math::MathError| format!("math error in check: {x:?}");

        // ---- USDC: I1. The engine knows custody exactly, so this is an equality. ----
        let mut liabilities: u128 = u(self.vault) + u(self.treasury) + u(self.claimable) + u(self.reserved);
        for a in self.accounts.values() {
            liabilities += u(a.free) + u(a.locked) + u(a.in_orders);
        }
        for (p, mk) in &self.markets {
            match mk.state {
                MarketState::IcoLive => {
                    liabilities += u(mk.raised);
                    ensure!(!self.pools.contains_key(p), "ICO market {p} has a pool");
                }
                MarketState::Bonded => {
                    ensure!(mk.raised == 0, "bonded market {p} still has raised");
                    liabilities += u(self.pools.get(p).ok_or(format!("bonded market {p} has no pool"))?.reserve1);
                }
            }
        }
        ensure!(liabilities == u(self.custody), "I1: custody {} != liabilities {liabilities}", self.custody);

        // ---- withdrawal locks ----
        let mut locked: BTreeMap<UserId, u128> = BTreeMap::new();
        for l in self.locks.values() {
            *locked.entry(l.user).or_default() += u(l.amount);
        }
        for (k, a) in &self.accounts {
            ensure!(locked.get(k).copied().unwrap_or(0) == u(a.locked), "locked balance != its locks");
        }

        // ---- orders and the book ----
        let mut in_orders: BTreeMap<UserId, u128> = BTreeMap::new();
        let mut ask_locked: BTreeMap<(UserId, PlayerId), u128> = BTreeMap::new();
        let mut open: BTreeMap<UserId, u32> = BTreeMap::new();
        for (id, o) in &self.orders {
            ensure!(o.remaining > 0, "order {id} is empty");
            ensure!(*id <= self.next_order, "order id {id} beyond counter");
            *open.entry(o.user).or_default() += 1;
            match o.side {
                Side::Bid => *in_orders.entry(o.user).or_default() += u(o.remaining),
                Side::Ask => *ask_locked.entry((o.user, o.player)).or_default() += u(o.remaining),
            }
            let level = self.books.get(&o.player).and_then(|b| if o.side == Side::Bid { b.bids.get(&o.px) } else { b.asks.get(&o.px) });
            ensure!(level.is_some_and(|l| l.contains(id)), "order {id} missing from the book");
        }
        let mut booked = 0usize;
        for (p, b) in &self.books {
            for (px, level) in b.bids.iter().map(|(k, v)| (k, (v, Side::Bid))).chain(b.asks.iter().map(|(k, v)| (k, (v, Side::Ask)))) {
                ensure!(!level.0.is_empty(), "empty level kept");
                let mut prev = 0u64;
                for id in level.0 {
                    let o = self.orders.get(id).ok_or(format!("book has unknown order {id}"))?;
                    ensure!(o.player == *p && o.px == *px && o.side == level.1, "order {id} filed in the wrong level");
                    ensure!(*id > prev, "level not in time priority");
                    prev = *id;
                    booked += 1;
                }
            }
            if let (Some(bid), Some(ask)) = (b.bids.keys().next_back(), b.asks.keys().next()) {
                ensure!(bid < ask, "book {p} crossed: bid {bid} >= ask {ask}");
            }
            if let Some(pool) = self.pools.get(p) {
                if let Some(bid) = b.bids.keys().next_back() {
                    ensure!(sqrt_from_px(u(*bid), false).map_err(e)? <= pool.sqrt, "book {p}: bid {bid} above the pool");
                }
                if let Some(ask) = b.asks.keys().next() {
                    ensure!(sqrt_from_px(u(*ask), true).map_err(e)? >= pool.sqrt, "book {p}: ask {ask} below the pool");
                }
            }
        }
        ensure!(booked == self.orders.len(), "book and orders disagree");
        for (k, a) in &self.accounts {
            ensure!(in_orders.get(k).copied().unwrap_or(0) == u(a.in_orders), "in_orders != resting bids");
            ensure!(open.get(k).copied().unwrap_or(0) == a.open_orders, "open order count wrong");
        }
        for (k, h) in &self.holdings {
            ensure!(ask_locked.get(k).copied().unwrap_or(0) == u(h.locked), "locked tokens != resting asks");
        }
        ensure!(open.keys().all(|k| self.accounts.contains_key(k)), "order owner without an account");

        // ---- tokens: I4 supply and I5 conservation ----
        let mut held: BTreeMap<PlayerId, u128> = BTreeMap::new();
        for ((_, p), h) in &self.holdings {
            *held.entry(*p).or_default() += u(h.amount) + u(h.locked);
        }
        for (p, mk) in &self.markets {
            ensure!(u(mk.sold) <= m::FLOAT_BASE, "I4: sold > float for {p}");
            ensure!(u(mk.reserve_left) <= m::RESERVE_BASE, "reserve above 2M for {p}");
            ensure!(u(mk.minted) + u(mk.reserve_left) <= m::FLOAT_BASE + m::RESERVE_BASE, "I4: supply > 10M for {p}");
            let in_pool = self.pools.get(p).map_or(0, |x| u(x.reserve0));
            let h = held.get(p).copied().unwrap_or(0);
            ensure!(h + in_pool == u(mk.minted), "I5: tokens {h} + pool {in_pool} != minted {} for {p}", mk.minted);
        }

        // ---- pools: liquidity bookkeeping and solvency ----
        let mut lp_count: BTreeMap<UserId, u32> = BTreeMap::new();
        for (p, pool) in &self.pools {
            ensure!(MIN_SQRT_X64 < pool.sqrt && pool.sqrt < MAX_SQRT_X64, "pool {p} price out of bounds");
            ensure!(pool.liquidity <= MAX_LIQUIDITY, "pool {p} liquidity too large");
            let mut active = 0u128;
            let mut gross: BTreeMap<u128, u128> = BTreeMap::new();
            let mut net: BTreeMap<u128, i128> = BTreeMap::new();
            let (mut owe0, mut owe1) = (0u128, 0u128);
            let mut protocol = 0;
            for lp in self.lps.values().filter(|l| l.player == *p) {
                ensure!(lp.liquidity > 0, "empty LP position");
                if lp.protocol {
                    protocol += 1;
                } else {
                    *lp_count.entry(lp.owner).or_default() += 1;
                }
                if at_or_above(pool.sqrt, pool.just_below, lp.lower) && !at_or_above(pool.sqrt, pool.just_below, lp.upper) {
                    active += lp.liquidity;
                }
                *gross.entry(lp.lower).or_default() += lp.liquidity;
                *gross.entry(lp.upper).or_default() += lp.liquidity;
                *net.entry(lp.lower).or_default() += lp.liquidity as i128;
                *net.entry(lp.upper).or_default() -= lp.liquidity as i128;
                // What the position could withdraw now, plus every fee it has earned.
                let (a0, a1) = pool.amounts_for(lp.lower, lp.upper, lp.liquidity, false).map_err(e)?;
                let (in0, in1) = pool.fee_inside(lp.lower, lp.upper);
                owe0 += a0 + lp.owed0 + fee_owed(lp.liquidity, in0.wrapping_sub(lp.inside0)).map_err(e)?;
                owe1 += a1 + lp.owed1 + fee_owed(lp.liquidity, in1.wrapping_sub(lp.inside1)).map_err(e)?;
            }
            ensure!(protocol == 3, "pool {p} should keep its 3 seed slices, has {protocol}");
            ensure!(active == pool.liquidity, "pool {p}: active liquidity {active} != {}", pool.liquidity);
            ensure!(gross.len() == pool.boundaries.len(), "pool {p}: boundary set mismatch");
            for (b, x) in &pool.boundaries {
                ensure!(gross.get(b) == Some(&x.gross) && net.get(b) == Some(&x.net), "pool {p}: boundary {b} mismatch");
            }
            ensure!(owe0 <= u(pool.reserve0), "pool {p} insolvent in tokens: owes {owe0} > {}", pool.reserve0);
            ensure!(owe1 <= u(pool.reserve1), "pool {p} insolvent in USDC: owes {owe1} > {}", pool.reserve1);
        }
        for (k, a) in &self.accounts {
            ensure!(lp_count.get(k).copied().unwrap_or(0) == a.lp_positions, "LP position count wrong");
        }

        // ---- claims, and dividends set aside but not yet credited ----
        let claims: u128 = self.claims.values().map(|v| u(*v)).sum();
        ensure!(claims == u(self.claimable), "claims {claims} != claimable {}", self.claimable);
        let mut set_aside = 0u128;
        for (round, r) in &self.pending_rounds {
            let sum: u128 = r.credits.iter().map(|(_, a)| u(*a)).sum();
            ensure!(sum == u(r.total) && r.total > 0, "pending round {round}: credits {sum} != total {}", r.total);
            ensure!(r.at > self.finalized_cut && r.at <= self.applied, "pending round {round} should have been credited");
            ensure!(*round <= self.last_result, "pending round {round} beyond the last result");
            set_aside += u(r.total);
        }
        ensure!(set_aside == u(self.reserved), "pending rounds {set_aside} != reserved {}", self.reserved);
        ensure!(self.finalized_cut <= self.applied, "finalized beyond the log");
        ensure!(self.last_result <= self.last_snapshot, "result ahead of snapshot");

        // ---- exit mode: the exit table is fully backed by custody (vault and treasury aside) ----
        let table = crate::exit::exit_table(self).map_err(|x| format!("exit table: {x:?}"))?;
        let pays: u128 = table.values().map(|x| u(x.usdc) + x.locks.iter().map(|l| u(l.1)).sum::<u128>()).sum();
        ensure!(pays + u(self.vault) + u(self.treasury) <= u(self.custody), "exit table pays {pays} beyond custody");
        Ok(())
    }
}
