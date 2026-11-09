//! Engine state and the command dispatcher, plus custody, the bonding curve and graduation.
//! The order book, the router and liquidity live in `market.rs`; rounds and claims in `rounds.rs`.

use std::collections::BTreeMap;

use crate::clmm::liquidity_for_amounts;
use crate::error::Error;
use crate::fixed::{isqrt, narrow, w, MAX_SQRT_X64, MIN_SQRT_X64};
use crate::math as m;
use crate::pool::Pool;
use crate::types::*;

pub(crate) type Res<T> = Result<T, Error>;

#[inline]
pub(crate) fn u(x: u64) -> u128 {
    x as u128
}
#[inline]
pub(crate) fn to64(x: u128) -> Res<u64> {
    u64::try_from(x).map_err(|_| Error::Math)
}
#[inline]
pub(crate) fn sub64(a: u64, b: u64) -> Res<u64> {
    a.checked_sub(b).ok_or(Error::InsufficientFunds)
}
#[inline]
pub(crate) fn add64(a: u64, b: u64) -> Res<u64> {
    a.checked_add(b).ok_or(Error::Math)
}
/// Timestamps reaching the maths are validated non-negative by the sequencer.
#[inline]
pub(crate) fn t(ts: i64) -> u128 {
    ts.max(0) as u128
}

#[derive(Debug, Clone, PartialEq, Eq, borsh::BorshSerialize, borsh::BorshDeserialize, serde::Serialize, serde::Deserialize)]
pub struct Params {
    /// Seconds after a lock's expiry before it can be released (clock-skew margin vs the program).
    pub lock_grace_secs: i64,
    /// Smallest resting order, in USDC value.
    pub min_order_usdc: u64,
    /// Smallest liquidity deposit, in USDC value.
    pub min_lp_usdc: u64,
    pub max_open_orders: u32,
    pub max_lp_positions: u32,
    /// Most maker orders one taker order may touch (bounds per-command latency).
    pub max_fills: u32,
    /// Share of the protocol seed's USDC fees sent to the dividend vault; the rest goes to the
    /// (withdrawable) treasury. 0 = all to the treasury.
    pub seed_fee_vault_bps: u16,
}
impl Params {
    pub fn valid(&self) -> bool {
        self.lock_grace_secs >= 0
            && self.min_order_usdc > 0
            && self.min_lp_usdc > 0
            && self.max_open_orders > 0
            && self.max_lp_positions > 0
            && self.max_fills > 0
            && self.seed_fee_vault_bps as u128 <= m::BPS
    }
}

impl Default for Params {
    fn default() -> Self {
        Params { lock_grace_secs: 60, min_order_usdc: 1_000_000, min_lp_usdc: 1_000_000, max_open_orders: 64, max_lp_positions: 32, max_fills: 256, seed_fee_vault_bps: 0 }
    }
}

/// Engine state. Every transition goes through `apply`, which is atomic: handlers validate and
/// compute first (into locals, a `Sim`, or a `Tx` overlay) and only write state after the last
/// fallible step. Serialisable (borsh, deterministic: ordered maps only) for restart snapshots.
#[derive(Debug, Clone, Default, borsh::BorshSerialize, borsh::BorshDeserialize)]
pub struct Engine {
    pub params: Params,
    pub(crate) paused: bool,
    /// USDC the engine believes sits in on-chain custody.
    pub(crate) custody: u64,
    pub(crate) vault: u64,
    pub(crate) treasury: u64,
    pub(crate) claimable: u64,
    /// On-chain deposits consumed so far.
    pub(crate) deposits: u64,
    /// On-chain payouts (vouchers and treasury withdrawals) consumed so far.
    pub(crate) payouts: u64,
    /// On-chain forced requests consumed so far.
    pub(crate) forced: u64,
    /// Commands applied so far: the log sequence number of the last one.
    pub(crate) applied: u64,
    /// The latest log sequence number covered by a batch finalized on Solana.
    pub(crate) finalized_cut: u64,
    /// Dividends set aside from the vault, waiting for their batch to be finalized.
    pub(crate) reserved: u64,
    pub(crate) pending_rounds: BTreeMap<u32, PendingRound>,
    pub(crate) accounts: BTreeMap<UserId, Account>,
    pub(crate) holdings: BTreeMap<(UserId, PlayerId), Holding>,
    pub(crate) markets: BTreeMap<PlayerId, Market>,
    pub(crate) pools: BTreeMap<PlayerId, Pool>,
    pub(crate) books: BTreeMap<PlayerId, Book>,
    pub(crate) orders: BTreeMap<u64, Order>,
    pub(crate) lps: BTreeMap<u64, LpPosition>,
    pub(crate) next_order: u64,
    pub(crate) next_lp: u64,
    pub(crate) locks: BTreeMap<u64, Lock>,
    pub(crate) calendar: BTreeMap<u32, i64>,
    pub(crate) last_snapshot: u32,
    pub(crate) last_result: u32,
    pub(crate) snapshots: BTreeMap<(u32, PlayerId), Snapshot>,
    pub(crate) election_px: BTreeMap<(u32, PlayerId), u64>,
    pub(crate) claims: BTreeMap<(UserId, u32, PlayerId), u64>,
}

/// Staged writes for one command. Loaded lazily from the engine, written back by `commit`.
#[derive(Debug)]
pub(crate) struct Tx {
    pub accts: BTreeMap<UserId, Account>,
    pub holds: BTreeMap<(UserId, PlayerId), Holding>,
    /// `None` deletes the order.
    pub orders: BTreeMap<u64, Option<Order>>,
    pub vault: u64,
    pub treasury: u64,
    pub claimable: u64,
}

impl Engine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn paused(&self) -> bool {
        self.paused
    }
    pub fn custody(&self) -> u64 {
        self.custody
    }
    pub fn vault(&self) -> u64 {
        self.vault
    }
    pub fn treasury(&self) -> u64 {
        self.treasury
    }
    pub fn claimable(&self) -> u64 {
        self.claimable
    }
    pub fn reserved(&self) -> u64 {
        self.reserved
    }
    /// Deposits and payouts consumed: the counts a batch reports to the program.
    pub fn deposits(&self) -> u64 {
        self.deposits
    }
    pub fn payouts(&self) -> u64 {
        self.payouts
    }
    pub fn forced(&self) -> u64 {
        self.forced
    }
    /// Log sequence number of the last applied command.
    pub fn applied(&self) -> u64 {
        self.applied
    }
    pub fn finalized_cut(&self) -> u64 {
        self.finalized_cut
    }
    /// (last round snapshotted, last round with a result).
    pub fn rounds(&self) -> (u32, u32) {
        (self.last_snapshot, self.last_result)
    }
    pub fn account(&self, user: &UserId) -> Account {
        self.accounts.get(user).cloned().unwrap_or_default()
    }
    pub fn market(&self, p: PlayerId) -> Option<&Market> {
        self.markets.get(&p)
    }
    pub fn pool(&self, p: PlayerId) -> Option<&Pool> {
        self.pools.get(&p)
    }
    pub fn book(&self, p: PlayerId) -> Option<&Book> {
        self.books.get(&p)
    }
    pub fn holding(&self, user: &UserId, p: PlayerId) -> Holding {
        self.holdings.get(&(*user, p)).cloned().unwrap_or_default()
    }
    pub fn order(&self, id: u64) -> Option<&Order> {
        self.orders.get(&id)
    }
    pub fn lp(&self, id: u64) -> Option<&LpPosition> {
        self.lps.get(&id)
    }
    pub fn lps(&self) -> impl Iterator<Item = (&u64, &LpPosition)> {
        self.lps.iter()
    }
    pub fn orders(&self) -> impl Iterator<Item = (&u64, &Order)> {
        self.orders.iter()
    }
    pub fn locks(&self) -> impl Iterator<Item = (&u64, &Lock)> {
        self.locks.iter()
    }
    pub fn holdings(&self) -> impl Iterator<Item = (&(UserId, PlayerId), &Holding)> {
        self.holdings.iter()
    }
    /// One user's holdings, by player.
    pub fn holdings_of(&self, user: &UserId) -> impl Iterator<Item = (PlayerId, &Holding)> {
        self.holdings.range((*user, 0)..=(*user, PlayerId::MAX)).map(|((_, p), h)| (*p, h))
    }
    pub fn markets(&self) -> impl Iterator<Item = (&PlayerId, &Market)> {
        self.markets.iter()
    }
    pub fn claims(&self) -> impl Iterator<Item = (&(UserId, u32, PlayerId), &u64)> {
        self.claims.iter()
    }
    pub fn kickoff_snapshot(&self, round: u32, p: PlayerId) -> Option<&Snapshot> {
        self.snapshots.get(&(round, p))
    }
    pub fn pending_rounds(&self) -> impl Iterator<Item = (&u32, &PendingRound)> {
        self.pending_rounds.iter()
    }
    pub fn claim_amount(&self, user: &UserId, round: u32, p: PlayerId) -> u64 {
        self.claims.get(&(*user, round, p)).copied().unwrap_or(0)
    }
    /// The price a round's token elections use for `p` (set when the round's result is applied).
    pub fn election_px(&self, round: u32, p: PlayerId) -> Option<u64> {
        self.election_px.get(&(round, p)).copied()
    }
    /// The published lock (kickoff) time of a round.
    pub fn calendar(&self, round: u32) -> Option<i64> {
        self.calendar.get(&round).copied()
    }

    /// A throwaway copy of one market for quotes: the market, its pool, book and resting orders,
    /// its liquidity positions, and the accounts and holdings of `user` and every maker on the
    /// book. `apply` on the copy runs the real code path, so a quote is exactly what the command
    /// would do now. `user`'s free USDC and tokens are topped up to at least `min_usdc` /
    /// `min_tokens`, so a quote doesn't depend on (or reveal) the balance; hold age is kept.
    /// Never part of consensus: the result is discarded.
    pub fn sandbox(&self, player: PlayerId, user: &UserId, min_usdc: u64, min_tokens: u64) -> Engine {
        let mut e = Engine {
            params: self.params.clone(),
            paused: self.paused,
            custody: self.custody,
            vault: self.vault,
            treasury: self.treasury,
            claimable: self.claimable,
            applied: self.applied,
            next_order: self.next_order,
            next_lp: self.next_lp,
            ..Default::default()
        };
        let mut users: Vec<UserId> = vec![*user];
        if let Some(m) = self.markets.get(&player) {
            e.markets.insert(player, m.clone());
        }
        if let Some(p) = self.pools.get(&player) {
            e.pools.insert(player, p.clone());
        }
        if let Some(b) = self.books.get(&player) {
            for id in b.bids.values().chain(b.asks.values()).flatten() {
                if let Some(o) = self.orders.get(id) {
                    users.push(o.user);
                    e.orders.insert(*id, o.clone());
                }
            }
            e.books.insert(player, b.clone());
        }
        for (id, lp) in self.lps.iter().filter(|(_, l)| l.player == player) {
            e.lps.insert(*id, lp.clone());
        }
        for u in users {
            if let Some(a) = self.accounts.get(&u) {
                e.accounts.insert(u, a.clone());
            }
            if let Some(h) = self.holdings.get(&(u, player)) {
                e.holdings.insert((u, player), h.clone());
            }
        }
        let a = e.accounts.entry(*user).or_default();
        a.free = a.free.max(min_usdc);
        if min_tokens > 0 {
            let h = e.holdings.entry((*user, player)).or_default();
            h.amount = h.amount.max(min_tokens);
        }
        e
    }

    pub(crate) fn begin(&self) -> Tx {
        Tx { accts: BTreeMap::new(), holds: BTreeMap::new(), orders: BTreeMap::new(), vault: self.vault, treasury: self.treasury, claimable: self.claimable }
    }
    pub(crate) fn acct<'t>(&self, tx: &'t mut Tx, user: &UserId) -> &'t mut Account {
        tx.accts.entry(*user).or_insert_with(|| self.account(user))
    }
    pub(crate) fn hold<'t>(&self, tx: &'t mut Tx, user: &UserId, p: PlayerId) -> &'t mut Holding {
        tx.holds.entry((*user, p)).or_insert_with(|| self.holding(user, p))
    }
    /// Current view of an order inside a transaction (`None` if absent or deleted in `tx`).
    pub(crate) fn tx_order(&self, tx: &Tx, id: u64) -> Option<Order> {
        match tx.orders.get(&id) {
            Some(o) => o.clone(),
            None => self.orders.get(&id).cloned(),
        }
    }

    /// Write a transaction back. Infallible: every check happened while staging.
    pub(crate) fn commit(&mut self, tx: Tx) {
        for (k, a) in tx.accts {
            self.accounts.insert(k, a);
        }
        for (k, h) in tx.holds {
            if h == Holding::default() || (h.amount == 0 && h.locked == 0 && h.cap_bought == 0) {
                self.holdings.remove(&k);
            } else {
                self.holdings.insert(k, h);
            }
        }
        for (id, o) in tx.orders {
            let old = self.orders.get(&id).cloned();
            match (old, o) {
                (None, Some(new)) => {
                    let book = self.books.entry(new.player).or_default();
                    let side = if new.side == Side::Bid { &mut book.bids } else { &mut book.asks };
                    side.entry(new.px).or_default().push_back(id);
                    self.orders.insert(id, new);
                }
                (Some(_), Some(upd)) => {
                    self.orders.insert(id, upd);
                }
                (Some(gone), None) => {
                    let book = self.books.entry(gone.player).or_default();
                    let side = if gone.side == Side::Bid { &mut book.bids } else { &mut book.asks };
                    if let Some(level) = side.get_mut(&gone.px) {
                        level.retain(|x| *x != id);
                        if level.is_empty() {
                            side.remove(&gone.px);
                        }
                    }
                    self.orders.remove(&id);
                }
                (None, None) => {}
            }
        }
        self.vault = tx.vault;
        self.treasury = tx.treasury;
        self.claimable = tx.claimable;
    }

    pub(crate) fn check_nonce(&self, user: &UserId, nonce: u64) -> Res<()> {
        if nonce > self.accounts.get(user).map_or(0, |a| a.nonce) {
            Ok(())
        } else {
            Err(Error::BadNonce)
        }
    }

    fn trading_open(&self) -> Res<()> {
        if self.paused {
            Err(Error::Paused)
        } else {
            Ok(())
        }
    }

    pub(crate) fn market_in(&self, p: PlayerId, want: MarketState) -> Res<&Market> {
        let mk = self.markets.get(&p).ok_or(Error::UnknownPlayer)?;
        if mk.state != want {
            return Err(Error::WrongState);
        }
        Ok(mk)
    }

    /// Apply one sequenced command at time `ts`. Atomic: on `Err` the state is unchanged.
    /// Signatures and timestamp order are checked by the caller (`wal::Sequencer`).
    pub fn apply(&mut self, ts: i64, cmd: &Cmd) -> Res<Outcome> {
        let out = self.dispatch(ts, cmd)?;
        // Only successful commands are logged, so this equals the command's log sequence number.
        self.applied += 1;
        Ok(out)
    }

    fn dispatch(&mut self, ts: i64, cmd: &Cmd) -> Res<Outcome> {
        // A trading pause stops price-moving commands only. Deposits, withdrawals, cancels, LP
        // removal and claims keep working, so a halt never traps funds.
        if matches!(
            cmd,
            Cmd::BuyCurve { .. } | Cmd::SellCurve { .. } | Cmd::Buy { .. } | Cmd::Sell { .. } | Cmd::PlaceOrder { .. } | Cmd::AddLiquidity { .. }
        ) {
            self.trading_open()?;
        }
        if let Some(user) = cmd.signer() {
            if *user == PROTOCOL {
                return Err(Error::BadSignature);
            }
        }
        match cmd {
            Cmd::Deposit { user, amount, seq } => self.deposit(user, *amount, *seq),
            Cmd::WithdrawPaid { id, seq } => self.withdraw_paid(*id, *seq),
            Cmd::LockWithdraw { user, nonce, amount, id, expiry } => self.lock_withdraw(ts, user, *nonce, *amount, *id, *expiry),
            Cmd::BuyCurve { user, nonce, player, usdc_in, min_tokens } => self.buy_curve(ts, user, *nonce, *player, *usdc_in, *min_tokens),
            Cmd::SellCurve { user, nonce, player, tokens, min_usdc } => self.sell_curve(user, *nonce, *player, *tokens, *min_usdc),
            Cmd::Buy { user, nonce, player, usdc_in, min_tokens, limit_px } => {
                self.market_buy(ts, user, *nonce, *player, *usdc_in, *min_tokens, *limit_px)
            }
            Cmd::Sell { user, nonce, player, tokens_in, min_usdc, limit_px } => {
                self.market_sell(ts, user, *nonce, *player, *tokens_in, *min_usdc, *limit_px)
            }
            Cmd::PlaceOrder { user, nonce, player, side, px, amount, post_only } => {
                self.place_order(ts, user, *nonce, *player, *side, *px, *amount, *post_only)
            }
            Cmd::CancelOrder { user, nonce, order } => self.cancel_order(user, *nonce, *order),
            Cmd::AddLiquidity { user, nonce, player, lower_px, upper_px, max_usdc, max_tokens, min_liquidity } => {
                self.add_liquidity(ts, user, *nonce, *player, *lower_px, *upper_px, *max_usdc, *max_tokens, *min_liquidity)
            }
            Cmd::RemoveLiquidity { user, nonce, position, liquidity, min_usdc, min_tokens } => {
                self.remove_liquidity(user, *nonce, *position, *liquidity, *min_usdc, *min_tokens)
            }
            Cmd::Claim { user, nonce, round, player, take_tokens } => self.claim(ts, user, *nonce, *round, *player, *take_tokens),
            Cmd::ClaimAll { user, nonce, take_tokens } => self.claim_all(ts, user, *nonce, *take_tokens),
            Cmd::ReleaseLock { id, payouts_through } => self.release_lock(ts, *id, *payouts_through),
            Cmd::ListPlayer { player } => self.list_player(*player),
            Cmd::PublishCalendar { round, lock_ts } => self.publish_calendar(ts, *round, *lock_ts),
            Cmd::Snapshot { round } => self.snapshot(ts, *round),
            Cmd::RoundResult { round, payouts } => self.round_result(*round, payouts),
            Cmd::SetPaused { paused } => {
                self.paused = *paused;
                Ok(Outcome::None)
            }
            Cmd::WithdrawTreasury { amount, seq } => self.withdraw_treasury(*amount, *seq),
            Cmd::WithdrawRequested { id } => {
                let lk = self.locks.get_mut(id).ok_or(Error::UnknownLock)?;
                match lk.kind {
                    LockKind::Permit { .. } | LockKind::Requested => lk.kind = LockKind::Requested,
                    LockKind::Forced => return Err(Error::WrongState), // forced holds have no permit
                }
                Ok(Outcome::None)
            }
            Cmd::CollectSeedFees { player } => self.collect_seed_fees(*player),
            Cmd::SetParams { params } => {
                if !params.valid() {
                    return Err(Error::BadAmount);
                }
                self.params = params.clone();
                Ok(Outcome::None)
            }
            Cmd::BatchFinalized { cut } => self.batch_finalized(*cut),
            Cmd::Forced { index, user, kind, data } => self.apply_forced(*index, user, *kind, data),
            Cmd::ForcedUnpaid { index } => self.forced_unpaid(*index),
        }
    }

    fn apply_forced(&mut self, index: u64, user: &UserId, kind: u8, data: &[u8; 32]) -> Res<Outcome> {
        if index != self.forced + 1 {
            return Err(Error::BadSequence);
        }
        let arg = u64::from_le_bytes(data[..8].try_into().expect("8 bytes"));
        // Whatever it asks, the request is consumed: one that can't do anything is a no-op.
        let staged = if *user == PROTOCOL { None } else { self.stage_forced(user, kind, arg).ok() };
        let mut out = Outcome::None;
        if let Some((tx, held)) = staged {
            self.commit(tx);
            if held > 0 {
                let id = FORCED_ID_BIT | index;
                self.locks.insert(id, Lock { user: *user, amount: held, kind: LockKind::Forced });
                out = Outcome::Locked { id, amount: held };
            }
        }
        self.forced = index;
        Ok(out)
    }

    /// Stage what a forced request does. Bounded work: one order, or one balance.
    fn stage_forced(&self, user: &UserId, kind: u8, arg: u64) -> Res<(Tx, u64)> {
        let mut tx = self.begin();
        let mut held = 0;
        match kind {
            FORCED_CANCEL => {
                if self.orders.get(&arg).is_some_and(|o| o.user == *user) {
                    self.stage_cancel(&mut tx, arg)?;
                }
            }
            FORCED_WITHDRAW => {
                let a = self.acct(&mut tx, user);
                held = if arg == 0 { a.free } else { arg.min(a.free) };
                a.free -= held;
                a.locked = add64(a.locked, held)?;
            }
            _ => {}
        }
        Ok((tx, held))
    }

    fn forced_unpaid(&mut self, index: u64) -> Res<Outcome> {
        if index == 0 || index > self.forced {
            return Err(Error::BadSequence);
        }
        let id = FORCED_ID_BIT | index;
        let lk = self.locks.get(&id).filter(|l| l.kind == LockKind::Forced).ok_or(Error::UnknownLock)?.clone();
        let a = self.accounts.get(&lk.user).ok_or(Error::UnknownLock)?;
        let locked = sub64(a.locked, lk.amount)?;
        let free = add64(a.free, lk.amount)?;

        let acc = self.accounts.get_mut(&lk.user).expect("checked above");
        acc.locked = locked;
        acc.free = free;
        self.locks.remove(&id);
        Ok(Outcome::None)
    }

    fn deposit(&mut self, user: &UserId, amount: u64, seq: u64) -> Res<Outcome> {
        if amount == 0 || *user == PROTOCOL {
            return Err(Error::BadAmount);
        }
        if seq != self.deposits + 1 {
            return Err(Error::BadSequence);
        }
        let custody = add64(self.custody, amount)?;
        let free = add64(self.account(user).free, amount)?;

        self.deposits = seq;
        self.custody = custody;
        self.accounts.entry(*user).or_default().free = free;
        Ok(Outcome::None)
    }

    fn lock_withdraw(&mut self, ts: i64, user: &UserId, nonce: u64, amount: u64, id: u64, expiry: i64) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        if amount == 0 || expiry <= ts {
            return Err(Error::BadAmount);
        }
        if self.locks.contains_key(&id) {
            return Err(Error::DuplicateLock);
        }
        let a = self.account(user);
        let free = sub64(a.free, amount)?;
        let locked = add64(a.locked, amount)?;

        let acc = self.accounts.entry(*user).or_default();
        acc.free = free;
        acc.locked = locked;
        acc.nonce = nonce;
        self.locks.insert(id, Lock { user: *user, amount, kind: LockKind::Permit { expiry } });
        Ok(Outcome::Locked { id, amount })
    }

    fn release_lock(&mut self, ts: i64, id: u64, payouts_through: u64) -> Res<Outcome> {
        let lk = self.locks.get(&id).ok_or(Error::UnknownLock)?.clone();
        // Only a permit's hold expires; requests and forced holds are paid or returned on-chain.
        let LockKind::Permit { expiry } = lk.kind else { return Err(Error::LockNotExpired) };
        if ts < expiry.saturating_add(self.params.lock_grace_secs) {
            return Err(Error::LockNotExpired);
        }
        // Every payout up to the finalized point the watcher checked must already be applied here.
        // If this voucher had been paid, that payout would have removed the lock (UnknownLock).
        if payouts_through > self.payouts {
            return Err(Error::BadSequence);
        }
        let a = self.accounts.get(&lk.user).ok_or(Error::UnknownLock)?;
        let locked = sub64(a.locked, lk.amount)?;
        let free = add64(a.free, lk.amount)?;

        let acc = self.accounts.get_mut(&lk.user).expect("checked above");
        acc.locked = locked;
        acc.free = free;
        self.locks.remove(&id);
        Ok(Outcome::None)
    }

    fn next_payout(&self, seq: u64) -> Res<()> {
        if seq == self.payouts + 1 {
            Ok(())
        } else {
            Err(Error::BadSequence)
        }
    }

    fn withdraw_paid(&mut self, id: u64, seq: u64) -> Res<Outcome> {
        self.next_payout(seq)?;
        let lk = self.locks.get(&id).ok_or(Error::UnknownLock)?.clone();
        let custody = sub64(self.custody, lk.amount)?;
        let locked = sub64(self.accounts.get(&lk.user).ok_or(Error::UnknownLock)?.locked, lk.amount)?;

        self.accounts.get_mut(&lk.user).expect("checked above").locked = locked;
        self.custody = custody;
        self.locks.remove(&id);
        self.payouts = seq;
        Ok(Outcome::None)
    }

    fn withdraw_treasury(&mut self, amount: u64, seq: u64) -> Res<Outcome> {
        self.next_payout(seq)?;
        let treasury = sub64(self.treasury, amount)?;
        let custody = sub64(self.custody, amount)?;

        self.treasury = treasury;
        self.custody = custody;
        self.payouts = seq;
        Ok(Outcome::None)
    }

    fn list_player(&mut self, player: PlayerId) -> Res<Outcome> {
        if self.markets.contains_key(&player) {
            return Err(Error::PlayerExists);
        }
        self.markets.insert(player, Market { state: MarketState::IcoLive, sold: 0, raised: 0, reserve_left: m::RESERVE_BASE as u64, minted: 0 });
        Ok(Outcome::None)
    }

    // ---- bonding curve (spec section 5) ----

    /// Fixes a bug in the reference program: there, a buy that overshoots $25k by about $0.50 or
    /// more makes `graduate` fail its own `sold + pool_tokens <= 8M` check, so the market can't
    /// graduate. Here the curve part of the crossing buy stops at the first milli-token step that
    /// reaches the threshold, the market graduates in the same command, and the rest of the order
    /// buys from the new pool at its opening price.
    fn buy_curve(&mut self, ts: i64, user: &UserId, nonce: u64, player: PlayerId, usdc_in: u64, min_tokens: u64) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        let mut mk = self.market_in(player, MarketState::IcoLive)?.clone();
        let pos = self.holding(user, player);
        let acc = self.account(user);

        let net = u(usdc_in) * m::BPS / (m::BPS + m::ICO_FEE_BPS);
        let mut tokens = m::curve_tokens_for(u(mk.sold), net)?;
        let remaining = m::THRESHOLD.saturating_sub(u(mk.raised));
        if let Some(to_threshold) = m::curve_tokens_to_reach(u(mk.sold), remaining)? {
            tokens = tokens.min(to_threshold);
        }
        // `min_tokens` is checked on the whole fill below (a crossing buy continues into the pool).
        if tokens == 0 {
            return Err(Error::Slippage);
        }
        if tokens > m::MAX_BUY_BASE {
            return Err(Error::PurchaseLimit);
        }
        if u(pos.cap_bought) + tokens > m::MAX_BUY_BASE {
            return Err(Error::AccountLimit);
        }
        let cost = m::curve_cost(u(mk.sold), tokens)?;
        let fee = m::fee(cost, m::ICO_FEE_BPS)?;
        if cost + fee > u(usdc_in) {
            return Err(Error::Slippage);
        }
        let (cost, fee, curve_tokens) = (to64(cost)?, to64(fee)?, to64(tokens)?);

        mk.sold = add64(mk.sold, curve_tokens)?;
        mk.raised = add64(mk.raised, cost)?;
        mk.minted = add64(mk.minted, curve_tokens)?;
        let mut vault = self.vault;
        let mut treasury = add64(self.treasury, fee)?;

        let graduated = u(mk.raised) >= m::THRESHOLD;
        let mut seeded = None;
        // (USDC spent incl. the buy fee, buy fee, tokens) bought from the new pool.
        let mut pool_leg = (0u64, 0u64, 0u64);
        if graduated {
            let (seed, pool_tokens, v, tr) = m::graduation(u(mk.raised), u(mk.sold))?;
            if u(mk.sold) + pool_tokens > m::FLOAT_BASE || seed == 0 || pool_tokens == 0 {
                return Err(Error::Math);
            }
            let (mut pool, slices) = seed_ladder(to64(seed)?, to64(pool_tokens)?)?;
            // Rounding dust of the seed that no slice could use goes to the dividend vault; unused
            // seed tokens are simply never minted.
            let dust = to64(seed)? - pool.reserve1;
            vault = add64(add64(vault, to64(v)?)?, dust)?;
            treasury = add64(treasury, to64(tr)?)?;
            mk.state = MarketState::Bonded;
            mk.raised = 0;
            mk.minted = add64(mk.minted, pool.reserve0)?;

            // The rest of the crossing order buys from the new pool at its opening price.
            let left = u(usdc_in) - u(cost) - u(fee);
            let f0 = m::fee(left, m::BUY_FEE_BPS)?;
            let budget = left - f0;
            if budget > 0 {
                let mut s = pool.sim();
                let (used, out) = pool.sim_swap(&mut s, false, budget, MAX_SQRT_X64)?;
                if out > 0 {
                    let pool_fee = if used == budget { f0 } else { m::fee(used, m::BUY_FEE_BPS)? };
                    pool.apply(s)?;
                    pool_leg = (to64(used + pool_fee)?, to64(pool_fee)?, to64(out)?);
                    treasury = add64(treasury, pool_leg.1)?;
                }
            }
            seeded = Some((pool, slices));
        }

        let tokens = add64(curve_tokens, pool_leg.2)?;
        if tokens < min_tokens {
            return Err(Error::Slippage);
        }
        let free = sub64(acc.free, add64(add64(cost, fee)?, pool_leg.0)?)?;
        let entry = m::new_entry_ts(t(pos.entry_ts), u(pos.amount), u(tokens), t(ts))? as i64;
        // Only curve purchases count against the per-account curve cap.
        let new_pos = Holding { amount: add64(pos.amount, tokens)?, entry_ts: entry, cap_bought: add64(pos.cap_bought, curve_tokens)?, ..pos };
        let (cost, fee) = (add64(cost, pool_leg.0 - pool_leg.1)?, add64(fee, pool_leg.1)?);

        let a = self.accounts.entry(*user).or_default();
        a.free = free;
        a.nonce = nonce;
        self.holdings.insert((*user, player), new_pos);
        self.markets.insert(player, mk);
        self.vault = vault;
        self.treasury = treasury;
        if let Some((pool, slices)) = seeded {
            for (lower, upper, liquidity) in slices {
                self.next_lp += 1;
                self.lps.insert(
                    self.next_lp,
                    LpPosition { owner: PROTOCOL, player, lower, upper, liquidity, inside0: 0, inside1: 0, owed0: 0, owed1: 0, entry_ts: ts, protocol: true },
                );
            }
            self.pools.insert(player, pool);
            self.books.insert(player, Book::default());
        }
        Ok(Outcome::Bought { tokens, cost, fee, graduated })
    }

    /// Curve sells must be whole milli-tokens: curve buys only ever credit whole milli-tokens, and a
    /// fractional sell would leave `sold` off the curve's milli-token grid.
    fn sell_curve(&mut self, user: &UserId, nonce: u64, player: PlayerId, tokens: u64, min_usdc: u64) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        if tokens == 0 || !u(tokens).is_multiple_of(m::MILLI) {
            return Err(Error::BadAmount);
        }
        let mut mk = self.market_in(player, MarketState::IcoLive)?.clone();
        let mut pos = self.holding(user, player);
        if pos.amount < tokens || mk.sold < tokens {
            return Err(Error::InsufficientTokens);
        }
        let refund = m::curve_refund(u(mk.sold), u(tokens))?;
        let fee = m::fee(refund, m::ICO_FEE_BPS)?;
        let payout = refund - fee;
        if payout < u(min_usdc) {
            return Err(Error::Slippage);
        }
        let (fv, ft) = m::split(fee);
        let (refund, fee, payout) = (to64(refund)?, to64(fee)?, to64(payout)?);
        // The reference saturates here; failing is stricter and keeps I1 exact.
        mk.raised = mk.raised.checked_sub(refund).ok_or(Error::Math)?;
        mk.sold -= tokens;
        mk.minted -= tokens;
        pos.amount -= tokens;
        pos.cap_bought = pos.cap_bought.saturating_sub(tokens);
        let free = add64(self.account(user).free, payout)?;
        let vault = add64(self.vault, to64(fv)?)?;
        let treasury = add64(self.treasury, to64(ft)?)?;

        self.markets.insert(player, mk);
        self.holdings.insert((*user, player), pos);
        let a = self.accounts.entry(*user).or_default();
        a.free = free;
        a.nonce = nonce;
        self.vault = vault;
        self.treasury = treasury;
        Ok(Outcome::Sold { usdc_out: payout, fee })
    }
}

/// The protocol seed at graduation, as a fixed liquidity ladder around the opening price p0:
/// 30% in [0.75·p0, 1.33·p0], 30% in [0.4·p0, 2.5·p0], and the rest
/// (~40%) full range. Each range is geometric around p0, so each slice takes USDC and tokens in
/// the ratio p0. Returns the pool (reserves = amounts actually used) and the slices
/// (lower, upper, liquidity). Never asks for more than `seed` USDC and `pool_tokens` tokens.
/// One seed slice: (lower sqrt, upper sqrt, liquidity).
pub(crate) type Slice = (u128, u128, u128);

pub(crate) fn seed_ladder(seed: u64, pool_tokens: u64) -> Res<(Pool, Vec<Slice>)> {
    let sqrt0 = narrow(isqrt((w(u(seed)) << 128) / w(u(pool_tokens))))?;
    let mut pool = Pool::new(sqrt0)?;
    let p = w(sqrt0) * w(sqrt0);
    let bound = |num: u64, den: u64| -> Res<u128> {
        let b = narrow(isqrt(p * w(num as u128) / w(den as u128)))?;
        if b <= MIN_SQRT_X64 || b >= MAX_SQRT_X64 {
            return Err(Error::Math);
        }
        Ok(b)
    };
    let ranges = [(30u128, bound(3, 4)?, bound(4, 3)?), (30u128, bound(2, 5)?, bound(5, 2)?)];
    let (mut used0, mut used1) = (0u128, 0u128);
    let mut slices = Vec::with_capacity(3);
    let mut add = |pool: &mut Pool, lo: u128, hi: u128, x: u128, y: u128| -> Res<(u128, u128)> {
        let l = liquidity_for_amounts(pool.sqrt, lo, hi, x, y)?;
        if l == 0 {
            return Err(Error::Math);
        }
        let (a0, a1) = pool.amounts_for(lo, hi, l, true)?;
        if a0 > x || a1 > y {
            return Err(Error::Math);
        }
        pool.modify(lo, hi, i128::try_from(l).map_err(|_| Error::Math)?)?;
        slices.push((lo, hi, l));
        Ok((a0, a1))
    };
    for (pct, lo, hi) in ranges {
        let (a0, a1) = add(&mut pool, lo, hi, u(pool_tokens) * pct / 100, u(seed) * pct / 100)?;
        used0 += a0;
        used1 += a1;
    }
    let (a0, a1) = add(&mut pool, MIN_SQRT_X64, MAX_SQRT_X64, u(pool_tokens) - used0, u(seed) - used1)?;
    used0 += a0;
    used1 += a1;
    pool.reserve0 = to64(used0)?;
    pool.reserve1 = to64(used1)?;
    Ok((pool, slices))
}
