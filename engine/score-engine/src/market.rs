//! Bonded markets: the router (order book + pool), limit orders, and range liquidity.
//!
//! Routing: a taker is always filled from the cheaper venue. The
//! pool is swapped only until its price reaches the next resting order's price (or the taker's
//! limit), then that order is filled, and so on. At equal prices the book goes first. Each taker
//! order is planned read-only (`plan_buy` / `plan_sell`), checked against its slippage bound, and
//! only then committed, so a rejected order changes nothing.
//!
//! Fees: the 5 bps buy fee is charged on the USDC actually routed (equal to the spec's
//! ceil(usdc_in × 5 bps) whenever the order fills completely). The 0.25% LP fee applies to pool
//! legs only. The time-weighted sell tax follows the seller in every venue: a taker seller pays it
//! on the gross USDC received, a maker seller (resting ask) on each fill. Makers pay no other fee.
//! Self-trade prevention: when a taker reaches one of its own resting orders, that order is
//! cancelled and refunded (cancel-resting), so a user never trades with themself and the book never
//! ends up crossed against the pool.

use crate::clmm::liquidity_for_amounts;
use crate::engine::{add64, sub64, t, to64, u, Engine, Res, Tx};
use crate::error::Error;
use crate::fixed::{px_from_sqrt, sqrt_from_px, tokens_at_px, usdc_at_px, MAX_SQRT_X64, MIN_SQRT_X64};
use crate::math as m;
use crate::pool::{fee_owed, Sim};
use crate::types::*;

pub(crate) struct Fill {
    pub order: u64,
    pub qty: u128,
    pub usdc: u128,
    /// Sell tax a maker seller pays on this fill (asks only).
    pub maker_tax: u128,
}

pub(crate) struct Plan {
    pub sim: Sim,
    pub fills: Vec<Fill>,
    /// Orders cancelled and refunded on commit: the taker's own orders it reached, and bids left
    /// unable to buy a single base unit.
    pub cancels: Vec<u64>,
    /// Buy: tokens received. Sell: tokens sold.
    pub tokens: u128,
    /// Buy: USDC spent. Sell: gross USDC received.
    pub usdc: u128,
    /// Unused input (USDC for a buy, tokens for a sell).
    pub rem: u128,
    /// Stopped at `max_fills`.
    pub capped: bool,
}

fn limit_of(px: u64) -> Option<u128> {
    (px != 0).then_some(px as u128)
}

/// Can a bid with `usdc` left at `px` still pay at least 1 micro-USDC for some tokens? With floor
/// rounding a tiny remainder can "buy" base units for 0 USDC, which no seller should accept.
fn bid_fillable(usdc: u128, px: u128) -> Res<bool> {
    Ok(usdc_at_px(tokens_at_px(usdc, px)?, px, false)? > 0)
}

impl Engine {
    fn age(&self, ts: i64, user: &UserId, p: PlayerId) -> u128 {
        t(ts).saturating_sub(t(self.holding(user, p).entry_ts))
    }

    /// Plan a taker buy of `budget` USDC (fee excluded) up to `limit` px.
    pub(crate) fn plan_buy(&self, ts: i64, user: &UserId, player: PlayerId, budget: u128, limit: Option<u128>) -> Res<Plan> {
        let pool = self.pools.get(&player).ok_or(Error::WrongState)?;
        let empty = Book::default();
        let book = self.books.get(&player).unwrap_or(&empty);
        let mut asks = book
            .asks
            .iter()
            .take_while(|(px, _)| limit.is_none_or(|l| u(**px) <= l))
            .flat_map(|(px, ids)| ids.iter().map(move |id| (*px, *id)))
            .peekable();
        let mut p = Plan { sim: pool.sim(), fills: vec![], cancels: vec![], tokens: 0, usdc: 0, rem: budget, capped: false };
        let mut head_used = 0u128;
        while p.rem > 0 {
            if p.fills.len() + p.cancels.len() >= self.params.max_fills as usize {
                p.capped = true;
                break;
            }
            let next = asks.peek().copied();
            let target = match (next, limit) {
                (Some((px, _)), Some(l)) => Some(u(px).min(l)),
                (Some((px, _)), None) => Some(u(px)),
                (None, l) => l,
            };
            // Round down: the pool must not sell above the resting order's (or the limit's) price.
            let lim = match target {
                Some(px) => sqrt_from_px(px, false)?,
                None => MAX_SQRT_X64,
            };
            if p.sim.sqrt < lim {
                let before = p.sim.clone();
                let (used, out) = pool.sim_swap(&mut p.sim, false, p.rem, lim)?;
                if p.sim.sqrt != lim && out == 0 {
                    // Dust left: don't charge the user for a leg that buys nothing.
                    p.sim = before;
                    break;
                }
                p.rem -= used;
                p.usdc += used;
                p.tokens += out;
                continue;
            }
            let Some((px, id)) = next else { break };
            let o = self.orders.get(&id).ok_or(Error::Math)?;
            if o.user == *user {
                p.cancels.push(id);
                asks.next();
                head_used = 0;
                continue;
            }
            let avail = u(o.remaining) - head_used;
            let q = avail.min(tokens_at_px(p.rem, u(px))?);
            if q == 0 {
                break; // can't afford one unit here, nor at any higher price
            }
            let cost = usdc_at_px(q, u(px), true)?;
            let maker_tax = m::fee(cost, m::tax_bps(self.age(ts, &o.user, player)))?;
            p.fills.push(Fill { order: id, qty: q, usdc: cost, maker_tax });
            p.rem -= cost;
            p.usdc += cost;
            p.tokens += q;
            if q == avail {
                asks.next();
                head_used = 0;
            } else {
                head_used += q;
            }
        }
        Ok(p)
    }

    /// Plan a taker sell of `amount` tokens down to `limit` px.
    pub(crate) fn plan_sell(&self, user: &UserId, player: PlayerId, amount: u128, limit: Option<u128>) -> Res<Plan> {
        let pool = self.pools.get(&player).ok_or(Error::WrongState)?;
        let empty = Book::default();
        let book = self.books.get(&player).unwrap_or(&empty);
        let mut bids = book
            .bids
            .iter()
            .rev()
            .take_while(|(px, _)| limit.is_none_or(|l| u(**px) >= l))
            .flat_map(|(px, ids)| ids.iter().map(move |id| (*px, *id)))
            .peekable();
        let mut p = Plan { sim: pool.sim(), fills: vec![], cancels: vec![], tokens: 0, usdc: 0, rem: amount, capped: false };
        let mut head_used = 0u128;
        while p.rem > 0 {
            if p.fills.len() + p.cancels.len() >= self.params.max_fills as usize {
                p.capped = true;
                break;
            }
            let next = bids.peek().copied();
            let target = match (next, limit) {
                (Some((px, _)), Some(l)) => Some(u(px).max(l)),
                (Some((px, _)), None) => Some(u(px)),
                (None, l) => l,
            };
            // Round up: the pool must not buy below the resting order's (or the limit's) price.
            let lim = match target {
                Some(px) => sqrt_from_px(px, true)?,
                None => MIN_SQRT_X64,
            };
            if p.sim.sqrt > lim {
                let before = p.sim.clone();
                let (used, out) = pool.sim_swap(&mut p.sim, true, p.rem, lim)?;
                if p.sim.sqrt != lim && out == 0 {
                    p.sim = before;
                    break;
                }
                p.rem -= used;
                p.tokens += used;
                p.usdc += out;
                continue;
            }
            let Some((px, id)) = next else { break };
            let o = self.orders.get(&id).ok_or(Error::Math)?;
            let avail = u(o.remaining) - head_used;
            if o.user == *user || !bid_fillable(avail, u(px))? {
                // The taker's own bid, or a bid too small to pay even 1 micro-USDC: refund it.
                p.cancels.push(id);
                bids.next();
                head_used = 0;
                continue;
            }
            let q = p.rem.min(tokens_at_px(avail, u(px))?);
            let usdc = usdc_at_px(q, u(px), false)?;
            if usdc == 0 {
                // The bid is fillable, so q was limited by the taker: what's left is dust here.
                break;
            }
            p.fills.push(Fill { order: id, qty: q, usdc, maker_tax: 0 });
            p.rem -= q;
            p.tokens += q;
            p.usdc += usdc;
            let left = avail - usdc;
            if !bid_fillable(left, u(px))? {
                if left > 0 {
                    p.cancels.push(id);
                }
                bids.next();
                head_used = 0;
            } else {
                head_used += usdc;
            }
        }
        Ok(p)
    }

    /// Stage a taker buy. Returns (plan, usdc spent incl. fee, fee, tokens received).
    fn take_buy(&self, ts: i64, tx: &mut Tx, user: &UserId, player: PlayerId, usdc_in: u64, limit: Option<u128>) -> Res<(Plan, u64, u64, u64)> {
        let f0 = m::fee(u(usdc_in), m::BUY_FEE_BPS)?;
        let plan = self.plan_buy(ts, user, player, u(usdc_in) - f0, limit)?;
        let fee = if plan.rem == 0 { f0 } else { m::fee(plan.usdc, m::BUY_FEE_BPS)? };
        let (spent, fee, got) = (to64(plan.usdc)?, to64(fee)?, to64(plan.tokens)?);
        let paid = add64(spent, fee)?;
        let a = self.acct(tx, user);
        a.free = sub64(a.free, paid)?;
        if got > 0 {
            let h = self.hold(tx, user, player);
            h.entry_ts = m::new_entry_ts(t(h.entry_ts), u(h.amount) + u(h.locked), u(got), t(ts))? as i64;
            h.amount = add64(h.amount, got)?;
        }
        tx.treasury = add64(tx.treasury, fee)?;
        for f in &plan.fills {
            let mut o = self.tx_order(tx, f.order).ok_or(Error::Math)?;
            o.remaining = o.remaining.checked_sub(to64(f.qty)?).ok_or(Error::Math)?;
            let maker = o.user;
            let mh = self.hold(tx, &maker, player);
            mh.locked = mh.locked.checked_sub(to64(f.qty)?).ok_or(Error::Math)?;
            let ma = self.acct(tx, &maker);
            ma.free = add64(ma.free, to64(f.usdc - f.maker_tax)?)?;
            if o.remaining == 0 {
                ma.open_orders = ma.open_orders.checked_sub(1).ok_or(Error::Math)?;
                tx.orders.insert(f.order, None);
            } else {
                tx.orders.insert(f.order, Some(o));
            }
            let (tv, tt) = m::split(f.maker_tax);
            tx.vault = add64(tx.vault, to64(tv)?)?;
            tx.treasury = add64(tx.treasury, to64(tt)?)?;
        }
        for id in &plan.cancels {
            self.stage_cancel(tx, *id)?;
        }
        Ok((plan, paid, fee, got))
    }

    /// Stage a taker sell. Returns (plan, tokens sold, USDC received after tax, tax).
    fn take_sell(&self, ts: i64, tx: &mut Tx, user: &UserId, player: PlayerId, tokens_in: u64, limit: Option<u128>) -> Res<(Plan, u64, u64, u64)> {
        if self.holding(user, player).amount < tokens_in {
            return Err(Error::InsufficientTokens);
        }
        let plan = self.plan_sell(user, player, u(tokens_in), limit)?;
        let tax = m::fee(plan.usdc, m::tax_bps(self.age(ts, user, player)))?;
        let (sold, gross, tax) = (to64(plan.tokens)?, to64(plan.usdc)?, to64(tax)?);
        let net = gross - tax;
        let h = self.hold(tx, user, player);
        h.amount = sub64(h.amount, sold)?;
        let a = self.acct(tx, user);
        a.free = add64(a.free, net)?;
        let (tv, tt) = m::split(u(tax));
        tx.vault = add64(tx.vault, to64(tv)?)?;
        tx.treasury = add64(tx.treasury, to64(tt)?)?;
        for f in &plan.fills {
            let mut o = self.tx_order(tx, f.order).ok_or(Error::Math)?;
            let usdc = to64(f.usdc)?;
            o.remaining = o.remaining.checked_sub(usdc).ok_or(Error::Math)?;
            let maker = o.user;
            let ma = self.acct(tx, &maker);
            ma.in_orders = ma.in_orders.checked_sub(usdc).ok_or(Error::Math)?;
            let mh = self.hold(tx, &maker, player);
            mh.entry_ts = m::new_entry_ts(t(mh.entry_ts), u(mh.amount) + u(mh.locked), f.qty, t(ts))? as i64;
            mh.amount = add64(mh.amount, to64(f.qty)?)?;
            if o.remaining == 0 {
                let ma = self.acct(tx, &maker);
                ma.open_orders = ma.open_orders.checked_sub(1).ok_or(Error::Math)?;
                tx.orders.insert(f.order, None);
            } else {
                tx.orders.insert(f.order, Some(o));
            }
        }
        for id in &plan.cancels {
            self.stage_cancel(tx, *id)?;
        }
        Ok((plan, sold, net, tax))
    }

    /// Stage cancelling an order (as currently staged in `tx`) and refunding what it still locks.
    pub(crate) fn stage_cancel(&self, tx: &mut Tx, id: u64) -> Res<()> {
        let Some(o) = self.tx_order(tx, id) else { return Ok(()) };
        match o.side {
            Side::Bid => {
                let a = self.acct(tx, &o.user);
                a.in_orders = a.in_orders.checked_sub(o.remaining).ok_or(Error::Math)?;
                a.free = add64(a.free, o.remaining)?;
            }
            Side::Ask => {
                let h = self.hold(tx, &o.user, o.player);
                h.locked = h.locked.checked_sub(o.remaining).ok_or(Error::Math)?;
                h.amount = add64(h.amount, o.remaining)?;
            }
        }
        let a = self.acct(tx, &o.user);
        a.open_orders = a.open_orders.checked_sub(1).ok_or(Error::Math)?;
        tx.orders.insert(id, None);
        Ok(())
    }

    /// Commit a staged trade: pool first (its own checks run before it changes anything), then the
    /// staged accounts. Nothing after this point can fail.
    fn finish_trade(&mut self, player: PlayerId, sim: Sim, tx: Tx) -> Res<()> {
        self.pools.get_mut(&player).ok_or(Error::WrongState)?.apply(sim)?;
        self.commit(tx);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn market_buy(&mut self, ts: i64, user: &UserId, nonce: u64, player: PlayerId, usdc_in: u64, min_tokens: u64, limit_px: u64) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        self.market_in(player, MarketState::Bonded)?;
        if usdc_in == 0 {
            return Err(Error::BadAmount);
        }
        let mut tx = self.begin();
        let (plan, paid, fee, got) = self.take_buy(ts, &mut tx, user, player, usdc_in, limit_of(limit_px))?;
        if got == 0 {
            return Err(Error::NoFill);
        }
        if got < min_tokens {
            return Err(Error::Slippage);
        }
        self.acct(&mut tx, user).nonce = nonce;
        self.finish_trade(player, plan.sim, tx)?;
        Ok(Outcome::Traded { tokens: got, usdc: paid, fee, tax: 0, order: None })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn market_sell(&mut self, ts: i64, user: &UserId, nonce: u64, player: PlayerId, tokens_in: u64, min_usdc: u64, limit_px: u64) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        self.market_in(player, MarketState::Bonded)?;
        if tokens_in == 0 {
            return Err(Error::BadAmount);
        }
        let mut tx = self.begin();
        let (plan, sold, net, tax) = self.take_sell(ts, &mut tx, user, player, tokens_in, limit_of(limit_px))?;
        if sold == 0 {
            return Err(Error::NoFill);
        }
        if net < min_usdc {
            return Err(Error::Slippage);
        }
        self.acct(&mut tx, user).nonce = nonce;
        self.finish_trade(player, plan.sim, tx)?;
        Ok(Outcome::Traded { tokens: sold, usdc: net, fee: 0, tax, order: None })
    }

    /// After a taker phase described by `plan`, may the remainder rest at `px`? Only if nothing on
    /// the book or in the pool still crosses it: every crossing order was filled or cancelled, and the
    /// pool reached the price. Keeps the book uncrossed even when routing stopped early.
    fn rest_ok(&self, player: PlayerId, side: Side, px: u64, plan: Option<&Plan>) -> Res<bool> {
        let pool = self.pools.get(&player).ok_or(Error::WrongState)?;
        let sqrt = plan.map_or(pool.sqrt, |p| p.sim.sqrt);
        let mut used: std::collections::BTreeMap<u64, u128> = std::collections::BTreeMap::new();
        let mut gone: std::collections::BTreeSet<u64> = std::collections::BTreeSet::new();
        if let Some(p) = plan {
            for f in &p.fills {
                *used.entry(f.order).or_default() += if side == Side::Bid { f.qty } else { f.usdc };
            }
            gone.extend(p.cancels.iter().copied());
        }
        let open = |id: &u64| -> bool {
            !gone.contains(id) && self.orders.get(id).is_some_and(|o| used.get(id).copied().unwrap_or(0) < u(o.remaining))
        };
        let empty = Book::default();
        let book = self.books.get(&player).unwrap_or(&empty);
        Ok(match side {
            Side::Bid => sqrt >= sqrt_from_px(u(px), false)? && !book.asks.range(..=px).any(|(_, ids)| ids.iter().any(open)),
            Side::Ask => sqrt <= sqrt_from_px(u(px), true)? && !book.bids.range(px..).any(|(_, ids)| ids.iter().any(open)),
        })
    }

    /// Would a resting order at `px` trade immediately (against the pool or any resting order,
    /// including the user's own)?
    fn crosses(&self, player: PlayerId, side: Side, px: u128) -> Res<bool> {
        let pool = self.pools.get(&player).ok_or(Error::WrongState)?;
        let book = self.books.get(&player);
        Ok(match side {
            Side::Bid => {
                book.and_then(|b| b.asks.keys().next()).is_some_and(|a| u(*a) <= px) || pool.sqrt < sqrt_from_px(px, false)?
            }
            Side::Ask => {
                book.and_then(|b| b.bids.keys().next_back()).is_some_and(|b| u(*b) >= px) || pool.sqrt > sqrt_from_px(px, true)?
            }
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn place_order(&mut self, ts: i64, user: &UserId, nonce: u64, player: PlayerId, side: Side, px: u64, amount: u64, post_only: bool) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        self.market_in(player, MarketState::Bonded)?;
        let max_px = px_from_sqrt(MAX_SQRT_X64, false)?;
        if px == 0 || u(px) >= max_px || u(px) <= px_from_sqrt(MIN_SQRT_X64, true)? {
            return Err(Error::BadPrice);
        }
        if amount == 0 {
            return Err(Error::BadAmount);
        }
        let value = match side {
            Side::Bid => u(amount),
            Side::Ask => usdc_at_px(u(amount), u(px), false)?,
        };
        if value < u(self.params.min_order_usdc) {
            return Err(Error::BadAmount);
        }
        if self.account(user).open_orders >= self.params.max_open_orders {
            return Err(Error::TooManyOrders);
        }
        if post_only && self.crosses(player, side, u(px))? {
            return Err(Error::WouldCross);
        }
        let id = self.next_order + 1;
        let mut tx = self.begin();
        let pool = self.pools.get(&player).ok_or(Error::WrongState)?;
        let (sim, traded, usdc, fee, tax, rested) = match side {
            Side::Bid => {
                if self.account(user).free < amount {
                    return Err(Error::InsufficientFunds);
                }
                let (sim, paid, fee, got, capped, ok) = if post_only {
                    (pool.sim(), 0, 0, 0, false, self.rest_ok(player, side, px, None)?)
                } else {
                    let (plan, paid, fee, got) = self.take_buy(ts, &mut tx, user, player, amount, Some(u(px)))?;
                    let ok = self.rest_ok(player, side, px, Some(&plan))?;
                    (plan.sim, paid, fee, got, plan.capped, ok)
                };
                let left = amount - paid;
                let rest = ok && !capped && left >= self.params.min_order_usdc && bid_fillable(u(left), u(px))?;
                if rest {
                    let a = self.acct(&mut tx, user);
                    a.free = sub64(a.free, left)?;
                    a.in_orders = add64(a.in_orders, left)?;
                    a.open_orders += 1;
                    tx.orders.insert(id, Some(Order { user: *user, player, side, px, remaining: left }));
                }
                (sim, got, paid, fee, 0, rest)
            }
            Side::Ask => {
                if self.holding(user, player).amount < amount {
                    return Err(Error::InsufficientTokens);
                }
                let (sim, sold, net, tax, capped, ok) = if post_only {
                    (pool.sim(), 0, 0, 0, false, self.rest_ok(player, side, px, None)?)
                } else {
                    let (plan, sold, net, tax) = self.take_sell(ts, &mut tx, user, player, amount, Some(u(px)))?;
                    let ok = self.rest_ok(player, side, px, Some(&plan))?;
                    (plan.sim, sold, net, tax, plan.capped, ok)
                };
                let left = amount - sold;
                let rest = ok && !capped && usdc_at_px(u(left), u(px), false)? >= u(self.params.min_order_usdc);
                if rest {
                    let h = self.hold(&mut tx, user, player);
                    h.amount = sub64(h.amount, left)?;
                    h.locked = add64(h.locked, left)?;
                    self.acct(&mut tx, user).open_orders += 1;
                    tx.orders.insert(id, Some(Order { user: *user, player, side, px, remaining: left }));
                }
                (sim, sold, net, 0, tax, rest)
            }
        };
        if traded == 0 && !rested {
            return Err(Error::NoFill);
        }
        self.acct(&mut tx, user).nonce = nonce;
        self.finish_trade(player, sim, tx)?;
        if rested {
            self.next_order = id;
        }
        Ok(Outcome::Traded { tokens: traded, usdc, fee, tax, order: rested.then_some(id) })
    }

    pub(crate) fn cancel_order(&mut self, user: &UserId, nonce: u64, id: u64) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        let o = self.orders.get(&id).ok_or(Error::UnknownOrder)?.clone();
        if o.user != *user {
            return Err(Error::NotOwner);
        }
        let mut tx = self.begin();
        self.stage_cancel(&mut tx, id)?;
        self.acct(&mut tx, user).nonce = nonce;
        self.commit(tx);
        Ok(Outcome::Cancelled { order: id })
    }

    // ---- range liquidity ----

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn add_liquidity(
        &mut self,
        ts: i64,
        user: &UserId,
        nonce: u64,
        player: PlayerId,
        lower_px: u64,
        upper_px: u64,
        max_usdc: u64,
        max_tokens: u64,
        min_liquidity: u128,
    ) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        self.market_in(player, MarketState::Bonded)?;
        let pool = self.pools.get(&player).ok_or(Error::WrongState)?;
        let (lower, upper) = if lower_px == 0 && upper_px == 0 {
            (MIN_SQRT_X64, MAX_SQRT_X64)
        } else {
            if lower_px == 0 || lower_px >= upper_px {
                return Err(Error::BadPrice);
            }
            (sqrt_from_px(u(lower_px), false)?, sqrt_from_px(u(upper_px), true)?)
        };
        if lower >= upper {
            return Err(Error::BadPrice);
        }
        let l = liquidity_for_amounts(pool.sqrt, lower, upper, u(max_tokens), u(max_usdc))?;
        if l == 0 || l < min_liquidity {
            return Err(Error::Slippage);
        }
        let (a0, a1) = pool.amounts_for(lower, upper, l, true)?;
        // Proven by tests: liquidity rounded down never needs more than offered.
        if a0 > u(max_tokens) || a1 > u(max_usdc) {
            return Err(Error::Math);
        }
        let (a0, a1) = (to64(a0)?, to64(a1)?);
        let spot = px_from_sqrt(pool.sqrt, false)?;
        let token_value = usdc_at_px(u(a0), spot, false)?;
        if token_value + u(a1) < u(self.params.min_lp_usdc) {
            return Err(Error::BadAmount);
        }
        let acct = self.account(user);
        if acct.lp_positions >= self.params.max_lp_positions {
            return Err(Error::TooManyPositions);
        }
        let delta = i128::try_from(l).map_err(|_| Error::Math)?;
        pool.check_modify(lower, upper, delta)?;
        let (r0, r1) = (add64(pool.reserve0, a0)?, add64(pool.reserve1, a1)?);
        let (inside0, inside1) = pool.fee_inside(lower, upper);

        let mut tx = self.begin();
        let h = self.hold(&mut tx, user, player);
        if h.amount < a0 {
            return Err(Error::InsufficientTokens);
        }
        // The position's hold age blends the tokens' age with "now" for the USDC side, by value,
        // so pooling can't reset (or launder) the sell tax.
        let entry = if a0 == 0 { ts } else { m::new_entry_ts(t(h.entry_ts), token_value, u(a1), t(ts))? as i64 };
        h.amount -= a0;
        let a = self.acct(&mut tx, user);
        a.free = sub64(a.free, a1)?;
        a.lp_positions += 1;
        a.nonce = nonce;

        let pool = self.pools.get_mut(&player).expect("checked above");
        pool.modify(lower, upper, delta)?;
        pool.reserve0 = r0;
        pool.reserve1 = r1;
        self.commit(tx);
        self.next_lp += 1;
        let id = self.next_lp;
        self.lps.insert(id, LpPosition { owner: *user, player, lower, upper, liquidity: l, inside0, inside1, owed0: 0, owed1: 0, entry_ts: entry, protocol: false });
        Ok(Outcome::Liquidity { position: id, liquidity: l, tokens: a0, usdc: a1 })
    }

    pub(crate) fn remove_liquidity(&mut self, user: &UserId, nonce: u64, id: u64, liquidity: u128, min_usdc: u64, min_tokens: u64) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        let mut pos = self.lps.get(&id).ok_or(Error::UnknownPosition)?.clone();
        if pos.protocol {
            return Err(Error::SeedFloor);
        }
        if pos.owner != *user {
            return Err(Error::NotOwner);
        }
        if liquidity == 0 || liquidity > pos.liquidity {
            return Err(Error::BadAmount);
        }
        let pool = self.pools.get(&pos.player).ok_or(Error::WrongState)?;
        // Credit fees earned so far, then withdraw principal (rounded down) plus all owed fees.
        let (in0, in1) = pool.fee_inside(pos.lower, pos.upper);
        pos.owed0 = pos.owed0.checked_add(fee_owed(pos.liquidity, in0.wrapping_sub(pos.inside0))?).ok_or(Error::Math)?;
        pos.owed1 = pos.owed1.checked_add(fee_owed(pos.liquidity, in1.wrapping_sub(pos.inside1))?).ok_or(Error::Math)?;
        pos.inside0 = in0;
        pos.inside1 = in1;
        let (a0, a1) = pool.amounts_for(pos.lower, pos.upper, liquidity, false)?;
        if a0 < u(min_tokens) || a1 < u(min_usdc) {
            return Err(Error::Slippage);
        }
        let (out0, out1) = (to64(a0 + pos.owed0)?, to64(a1 + pos.owed1)?);
        let r0 = pool.reserve0.checked_sub(out0).ok_or(Error::Math)?;
        let r1 = pool.reserve1.checked_sub(out1).ok_or(Error::Math)?;
        let delta = -i128::try_from(liquidity).map_err(|_| Error::Math)?;
        pool.check_modify(pos.lower, pos.upper, delta)?;

        let mut tx = self.begin();
        let h = self.hold(&mut tx, user, pos.player);
        if out0 > 0 {
            // Returned tokens carry the position's age, so pooling can't reset the sell tax.
            h.entry_ts = m::new_entry_ts(t(h.entry_ts), u(h.amount) + u(h.locked), u(out0), t(pos.entry_ts))? as i64;
            h.amount = add64(h.amount, out0)?;
        }
        let a = self.acct(&mut tx, user);
        a.free = add64(a.free, out1)?;
        a.nonce = nonce;
        let closed = liquidity == pos.liquidity;
        if closed {
            a.lp_positions = a.lp_positions.checked_sub(1).ok_or(Error::Math)?;
        }

        let pool = self.pools.get_mut(&pos.player).expect("checked above");
        pool.modify(pos.lower, pos.upper, delta)?;
        pool.reserve0 = r0;
        pool.reserve1 = r1;
        self.commit(tx);
        if closed {
            self.lps.remove(&id);
        } else {
            pos.liquidity -= liquidity;
            pos.owed0 = 0;
            pos.owed1 = 0;
            self.lps.insert(id, pos);
        }
        Ok(Outcome::Liquidity { position: id, liquidity, tokens: out0, usdc: out1 })
    }

    // ---- protocol seed fees ----

    /// Collect what the three protocol seed slices have earned. Their principal stays locked
    /// forever; the fees become protocol revenue. USDC goes to the treasury (withdrawable on-chain
    /// by the multisig) or, for `seed_fee_vault_bps`, to the dividend vault. Token fees are burned:
    /// tokens can't leave the platform, and the protocol never holds a position.
    pub(crate) fn collect_seed_fees(&mut self, player: PlayerId) -> Res<Outcome> {
        let mk = self.market_in(player, MarketState::Bonded)?;
        let pool = self.pools.get(&player).ok_or(Error::WrongState)?;
        let (mut f0, mut f1) = (0u128, 0u128);
        let mut updated = Vec::with_capacity(3);
        for (id, lp) in self.lps.iter().filter(|(_, l)| l.protocol && l.player == player) {
            let (in0, in1) = pool.fee_inside(lp.lower, lp.upper);
            f0 += lp.owed0 + fee_owed(lp.liquidity, in0.wrapping_sub(lp.inside0))?;
            f1 += lp.owed1 + fee_owed(lp.liquidity, in1.wrapping_sub(lp.inside1))?;
            let mut n = lp.clone();
            (n.inside0, n.inside1, n.owed0, n.owed1) = (in0, in1, 0, 0);
            updated.push((*id, n));
        }
        let (tokens, usdc) = (to64(f0)?, to64(f1)?);
        let r0 = pool.reserve0.checked_sub(tokens).ok_or(Error::Math)?;
        let r1 = pool.reserve1.checked_sub(usdc).ok_or(Error::Math)?;
        let minted = mk.minted.checked_sub(tokens).ok_or(Error::Math)?;
        let bps = u(self.params.seed_fee_vault_bps as u64).min(m::BPS);
        let to_vault = to64(u(usdc) * bps / m::BPS)?;
        let vault = add64(self.vault, to_vault)?;
        let treasury = add64(self.treasury, usdc - to_vault)?;

        let pool = self.pools.get_mut(&player).expect("checked above");
        pool.reserve0 = r0;
        pool.reserve1 = r1;
        self.markets.get_mut(&player).expect("checked above").minted = minted;
        self.lps.extend(updated);
        self.vault = vault;
        self.treasury = treasury;
        Ok(Outcome::SeedFees { usdc, tokens_burned: tokens })
    }
}
