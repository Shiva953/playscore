//! Read model for the app: a second copy of the engine on its own background thread, fed by the
//! saved log stream, plus the indexes the engine itself doesn't keep (trades, price history, cost
//! basis, activity, value history, kickoff snapshots after their round settles). Every app read
//! and every quote runs here, never on the engine thread, so the trading path is untouched.
//!
//! Startup replays the whole log into this copy (indexes need the full history). Quotes run the
//! real command on `Engine::sandbox`, a throwaway copy of one market, so they are exact.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use score_engine::fixed::{px_from_sqrt, usdc_at_px};
use score_engine::math::{price_micro, THRESHOLD};
use score_engine::pool::fee_owed;
use score_engine::wal::{FileWal, Record};
use score_engine::{Cmd, Engine, LockKind, MarketState, Outcome, PlayerId, Side, UserId};
use serde_json::{json, Value};
use tokio::sync::broadcast;

const TRADES_PER_MARKET: usize = 300;
const TAPE: usize = 300;
const ACTIVITY: usize = 400;
const POINTS_PER_MARKET: usize = 30_000; // one-minute buckets: ~3 weeks
const VALUE_POINTS: usize = 6_000;
const SAMPLE_EVERY: Duration = Duration::from_secs(60);
const DAY: i64 = 86_400;

pub type Shared = Arc<RwLock<Views>>;

#[derive(Clone, Debug)]
pub struct Trade {
    pub seq: u64,
    pub ts: i64,
    pub player: PlayerId,
    pub user: UserId,
    pub buy: bool,
    pub curve: bool,
    pub usdc: u64,
    pub tokens: u64,
    pub fee: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct Pt {
    pub t: i64,
    pub px: u64,
    pub vol: u64,
}

#[derive(Default)]
pub struct MarketIdx {
    pub listed_ts: i64,
    pub bonded_ts: Option<i64>,
    pub trades: VecDeque<Trade>,
    pub pts: VecDeque<Pt>,
    /// Total USDC traded.
    pub volume: u64,
}

#[derive(Default, Clone, Copy)]
pub struct Cost {
    /// Tokens the cost basis covers.
    pub tokens: u64,
    /// Their total cost in USDC base units (fees included).
    pub usdc: u128,
}

#[derive(Clone)]
pub struct Act {
    pub seq: u64,
    pub ts: i64,
    pub kind: &'static str,
    pub player: Option<PlayerId>,
    pub usdc: i64,
    pub tokens: i64,
    pub detail: String,
}

#[derive(Default)]
pub struct UserIdx {
    pub cost: BTreeMap<PlayerId, Cost>,
    pub realized: BTreeMap<PlayerId, i128>,
    pub fees: u64,
    pub dividends: u64,
    pub deposits: u64,
    pub withdrawals: u64,
    /// LP position id → USDC value put in (cost basis of the tokens moved in + USDC).
    pub lp_in: BTreeMap<u64, u128>,
    /// LP position id → pool price when it was opened.
    pub lp_px: BTreeMap<u64, u64>,
    pub orders: BTreeSet<u64>,
    pub activity: VecDeque<Act>,
    pub value: VecDeque<(i64, i64, i64)>,
    pub last_seq: u64,
}

#[derive(Clone, Default)]
pub struct SnapView {
    pub px: u64,
    pub circulating: u64,
    pub holders: BTreeMap<UserId, u64>,
}

#[derive(Clone, Default)]
pub struct RoundRes {
    pub ts: i64,
    pub payouts: Vec<(PlayerId, u64)>,
    pub credits: BTreeMap<(UserId, PlayerId), u64>,
    pub credited: bool,
}

pub struct Views {
    pub engine: Engine,
    pub seq: u64,
    pub last_ts: i64,
    pub markets: BTreeMap<PlayerId, MarketIdx>,
    pub tape: VecDeque<Trade>,
    pub users: HashMap<UserId, UserIdx>,
    pub snaps: BTreeMap<u32, (i64, BTreeMap<PlayerId, SnapView>)>,
    pub results: BTreeMap<u32, RoundRes>,
    pub paid_out: u64,
    /// Fees the protocol has taken (curve fee, buy fee, sell tax, curve sell fee).
    pub fees: u64,
    pub ready: bool,
    pub events: broadcast::Sender<Value>,
}

pub fn bs(u: &UserId) -> String {
    bs58::encode(u).into_string()
}

/// Spot price in PX_SCALE: the curve price while launching, the pool price once bonded.
pub fn spot(e: &Engine, p: PlayerId) -> u64 {
    match (e.market(p), e.pool(p)) {
        (Some(m), _) if m.state == MarketState::IcoLive => price_micro(m.sold as u128).map(|x| (x * 1000) as u64).unwrap_or(0),
        (_, Some(pool)) => px_from_sqrt(pool.sqrt, false).map(|x| x as u64).unwrap_or(0),
        _ => 0,
    }
}

fn val(qty: u64, px: u64) -> u128 {
    usdc_at_px(qty as u128, px as u128, false).unwrap_or(0)
}

/// What one command might change, captured before it is applied.
struct Before {
    player: Option<PlayerId>,
    state: Option<MarketState>,
    px: u64,
    /// Per affected user: (tokens owned incl. in asks, USDC incl. in bids).
    users: BTreeMap<UserId, (u64, u64)>,
    lock: Option<(UserId, u64)>,
    credits: Vec<(u32, Vec<((UserId, PlayerId), u64)>)>,
    lp: Option<(UserId, u128)>,
    vault: u64,
    treasury: u64,
}

fn player_of(c: &Cmd) -> Option<PlayerId> {
    match c {
        Cmd::BuyCurve { player, .. }
        | Cmd::SellCurve { player, .. }
        | Cmd::Buy { player, .. }
        | Cmd::Sell { player, .. }
        | Cmd::PlaceOrder { player, .. }
        | Cmd::AddLiquidity { player, .. }
        | Cmd::Claim { player, .. }
        | Cmd::ListPlayer { player }
        | Cmd::CollectSeedFees { player } => Some(*player),
        _ => None,
    }
}

fn owned(e: &Engine, u: &UserId, p: PlayerId) -> (u64, u64) {
    let h = e.holding(u, p);
    let a = e.account(u);
    (h.amount + h.locked, a.free + a.in_orders)
}

impl Views {
    fn new(events: broadcast::Sender<Value>) -> Self {
        Views {
            engine: Engine::new(),
            seq: 0,
            last_ts: 0,
            markets: BTreeMap::new(),
            tape: VecDeque::new(),
            users: HashMap::new(),
            snaps: BTreeMap::new(),
            results: BTreeMap::new(),
            paid_out: 0,
            fees: 0,
            ready: false,
            events,
        }
    }

    fn before(&self, cmd: &Cmd) -> Before {
        let e = &self.engine;
        let mut player = player_of(cmd);
        if let Cmd::CancelOrder { order, .. } = cmd {
            player = e.order(*order).map(|o| o.player);
        }
        if let Cmd::RemoveLiquidity { position, .. } = cmd {
            player = e.lp(*position).map(|l| l.player);
        }
        let mut users = BTreeMap::new();
        if let Some(p) = player {
            if let Some(u) = cmd.signer() {
                users.insert(*u, owned(e, u, p));
            }
            // Makers who may be filled by a taker on this market.
            if matches!(cmd, Cmd::Buy { .. } | Cmd::Sell { .. } | Cmd::PlaceOrder { .. }) {
                if let Some(b) = e.book(p) {
                    for id in b.bids.values().chain(b.asks.values()).flatten() {
                        if let Some(o) = e.order(*id) {
                            users.entry(o.user).or_insert_with(|| owned(e, &o.user, p));
                        }
                    }
                }
            }
        }
        let lock = match cmd {
            Cmd::WithdrawPaid { id, .. } | Cmd::ReleaseLock { id, .. } => e.locks().find(|(k, _)| *k == id).map(|(_, l)| (l.user, l.amount)),
            Cmd::ForcedUnpaid { index } => {
                let id = score_engine::FORCED_ID_BIT | index;
                e.locks().find(|(k, _)| **k == id).map(|(_, l)| (l.user, l.amount))
            }
            _ => None,
        };
        let credits = match cmd {
            Cmd::BatchFinalized { cut } => e.pending_rounds().filter(|(_, r)| r.at <= *cut).map(|(k, r)| (*k, r.credits.clone())).collect(),
            _ => vec![],
        };
        let lp = match cmd {
            Cmd::RemoveLiquidity { position, .. } => e.lp(*position).map(|l| (l.owner, l.liquidity)),
            _ => None,
        };
        Before {
            player,
            state: player.and_then(|p| e.market(p).map(|m| m.state)),
            px: player.map(|p| spot(e, p)).unwrap_or(0),
            users,
            lock,
            credits,
            lp,
            vault: e.vault(),
            treasury: e.treasury(),
        }
    }

    fn fee(&mut self, u: &UserId, amount: u64) {
        self.user(u).fees += amount;
        self.fees += amount;
    }

    fn user(&mut self, u: &UserId) -> &mut UserIdx {
        self.users.entry(*u).or_default()
    }

    fn act(&mut self, u: &UserId, a: Act) {
        let ui = self.user(u);
        ui.last_seq = a.seq;
        ui.activity.push_front(a);
        ui.activity.truncate(ACTIVITY);
    }

    fn emit(&self, v: Value) {
        if self.ready {
            let _ = self.events.send(v);
        }
    }

    /// Cost basis: buys add their full cost; sells remove the average cost and realise the rest.
    fn bought(&mut self, u: &UserId, p: PlayerId, tokens: u64, usdc: u128) {
        let c = self.user(u).cost.entry(p).or_default();
        c.tokens += tokens;
        c.usdc += usdc;
    }
    fn sold(&mut self, u: &UserId, p: PlayerId, tokens: u64, proceeds: u128) -> u128 {
        let ui = self.user(u);
        let c = ui.cost.entry(p).or_default();
        let part = if c.tokens == 0 { 0 } else { c.usdc * tokens.min(c.tokens) as u128 / c.tokens as u128 };
        c.usdc -= part;
        c.tokens = c.tokens.saturating_sub(tokens);
        *ui.realized.entry(p).or_default() += proceeds as i128 - part as i128;
        part
    }

    fn trade(&mut self, t: Trade) {
        let m = self.markets.entry(t.player).or_default();
        m.volume += t.usdc;
        m.trades.push_front(t.clone());
        m.trades.truncate(TRADES_PER_MARKET);
        self.tape.push_front(t.clone());
        self.tape.truncate(TAPE);
        self.emit(json!({"type": "trade", "seq": t.seq, "ts": t.ts, "player": t.player, "user": bs(&t.user), "side": if t.buy {"buy"} else {"sell"}, "venue": if t.curve {"curve"} else {"pool"}, "usdc": t.usdc, "tokens": t.tokens, "fee": t.fee}));
    }

    fn point(&mut self, p: PlayerId, ts: i64, vol: u64) {
        let px = spot(&self.engine, p);
        if px == 0 {
            return;
        }
        let bucket = ts - ts.rem_euclid(60);
        let m = self.markets.entry(p).or_default();
        match m.pts.back_mut() {
            Some(last) if last.t == bucket => {
                last.px = px;
                last.vol += vol;
            }
            _ => {
                m.pts.push_back(Pt { t: bucket, px, vol });
                if m.pts.len() > POINTS_PER_MARKET {
                    m.pts.pop_front();
                }
            }
        }
    }

    /// Apply one logged record and update every index. The engine already accepted it.
    pub fn apply(&mut self, r: &Record) {
        let b = self.before(&r.cmd);
        let out = match self.engine.apply(r.ts, &r.cmd) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("views: #{} replay refused a logged command: {e:?}", r.seq);
                Outcome::None
            }
        };
        self.seq = r.seq;
        self.last_ts = r.ts;
        let (seq, ts) = (r.seq, r.ts);
        let mut touched: BTreeSet<UserId> = BTreeSet::new();
        let mut market_changed = false;
        let a = |kind: &'static str, player: Option<PlayerId>, usdc: i64, tokens: i64, detail: String| Act { seq, ts, kind, player, usdc, tokens, detail };

        match (&r.cmd, &out) {
            (Cmd::Deposit { user, amount, .. }, _) => {
                self.user(user).deposits += amount;
                self.act(user, a("deposit", None, *amount as i64, 0, "Deposit from your wallet".into()));
                touched.insert(*user);
            }
            (Cmd::WithdrawPaid { .. }, _) => {
                if let Some((user, amount)) = b.lock {
                    self.user(&user).withdrawals += amount;
                    self.act(&user, a("withdraw", None, -(amount as i64), 0, "Withdrawal to your wallet".into()));
                    touched.insert(user);
                }
            }
            (Cmd::LockWithdraw { user, .. }, _) => {
                touched.insert(*user);
            }
            (Cmd::ReleaseLock { .. } | Cmd::ForcedUnpaid { .. }, _) => {
                if let Some((user, amount)) = b.lock {
                    self.act(&user, a("withdraw-returned", None, amount as i64, 0, "Unused withdrawal returned to your balance".into()));
                    touched.insert(user);
                }
            }
            (Cmd::Forced { user, .. }, _) => {
                touched.insert(*user);
            }
            (Cmd::ListPlayer { player }, _) => {
                self.markets.entry(*player).or_default().listed_ts = ts;
                self.point(*player, ts, 0);
                self.emit(json!({"type": "listed", "seq": seq, "player": player}));
            }
            (Cmd::BuyCurve { user, player, .. }, Outcome::Bought { tokens, cost, fee, graduated }) => {
                self.fee(user, *fee);
                self.bought(user, *player, *tokens, (*cost + *fee) as u128);
                self.trade(Trade { seq, ts, player: *player, user: *user, buy: true, curve: true, usdc: cost + fee, tokens: *tokens, fee: *fee });
                self.act(user, a("buy", Some(*player), -((cost + fee) as i64), *tokens as i64, if *graduated { "Launch buy · bonded the player".into() } else { "Launch curve buy".into() }));
                touched.insert(*user);
                if *graduated {
                    self.markets.entry(*player).or_default().bonded_ts = Some(ts);
                    let v = self.engine.vault().saturating_sub(b.vault);
                    let pool = self.engine.pool(*player).map(|p| p.reserve1).unwrap_or(0);
                    let tr = self.engine.treasury().saturating_sub(b.treasury);
                    self.emit(json!({"type": "bonded", "seq": seq, "player": player, "user": bs(user), "split": {"pool": pool, "vault": v, "treasury": tr}}));
                }
                market_changed = true;
                self.point(*player, ts, cost + fee);
            }
            (Cmd::SellCurve { user, player, tokens, .. }, Outcome::Sold { usdc_out, fee }) => {
                self.fee(user, *fee);
                self.sold(user, *player, *tokens, *usdc_out as u128);
                self.trade(Trade { seq, ts, player: *player, user: *user, buy: false, curve: true, usdc: *usdc_out, tokens: *tokens, fee: *fee });
                self.act(user, a("sell", Some(*player), *usdc_out as i64, -(*tokens as i64), format!("Launch curve sell · fee {}", usd(*fee))));
                touched.insert(*user);
                market_changed = true;
                self.point(*player, ts, *usdc_out);
            }
            (Cmd::Buy { user, player, .. } | Cmd::Sell { user, player, .. } | Cmd::PlaceOrder { user, player, .. }, Outcome::Traded { tokens, usdc, fee, tax, order }) => {
                let buy = match &r.cmd {
                    Cmd::Buy { .. } => true,
                    Cmd::PlaceOrder { side, .. } => *side == Side::Bid,
                    _ => false,
                };
                if *tokens > 0 {
                    if buy {
                        self.fee(user, *fee);
                        self.bought(user, *player, *tokens, *usdc as u128);
                        self.act(user, a("buy", Some(*player), -(*usdc as i64), *tokens as i64, format!("Pool buy · fee {}", usd(*fee))));
                    } else {
                        self.fee(user, *tax);
                        self.sold(user, *player, *tokens, *usdc as u128);
                        self.act(user, a("sell", Some(*player), *usdc as i64, -(*tokens as i64), format!("Pool sell · sell tax {}", usd(*tax))));
                    }
                    self.trade(Trade { seq, ts, player: *player, user: *user, buy, curve: false, usdc: *usdc, tokens: *tokens, fee: fee + tax });
                    market_changed = true;
                }
                if let Some(id) = order {
                    self.user(user).orders.insert(*id);
                    if let Cmd::PlaceOrder { amount, px, .. } = &r.cmd {
                        let what = if buy { format!("{} at ${:.6}", usd(*amount), *px as f64 / 1e9) } else { format!("{} tokens at ${:.6}", tok(*amount), *px as f64 / 1e9) };
                        self.act(user, a("order", Some(*player), 0, 0, format!("Limit {} {what}", if buy { "buy" } else { "sell" })));
                    }
                }
                touched.insert(*user);
                // Makers filled by this taker: their owned tokens and USDC moved.
                for (mk, (t0, u0)) in &b.users {
                    if mk == user {
                        continue;
                    }
                    let (t1, u1) = owned(&self.engine, mk, *player);
                    if t1 == *t0 && u1 == *u0 {
                        continue;
                    }
                    let mk = *mk;
                    if t1 > *t0 {
                        let (q, paid) = (t1 - t0, u0.saturating_sub(u1));
                        self.bought(&mk, *player, q, paid as u128);
                        self.act(&mk, a("order-fill", Some(*player), -(paid as i64), q as i64, format!("Limit buy filled · {} tokens", tok(q))));
                        self.emit(json!({"type": "fill", "seq": seq, "user": bs(&mk), "player": player, "side": "buy", "tokens": q, "usdc": paid}));
                    } else {
                        let (q, got) = (t0 - t1, u1.saturating_sub(*u0));
                        self.sold(&mk, *player, q, got as u128);
                        self.act(&mk, a("order-fill", Some(*player), got as i64, -(q as i64), format!("Limit sell filled · {} tokens", tok(q))));
                        self.emit(json!({"type": "fill", "seq": seq, "user": bs(&mk), "player": player, "side": "sell", "tokens": q, "usdc": got}));
                    }
                    touched.insert(mk);
                }
                // Orders that are gone (filled or cancelled) leave the user's index.
                for u in touched.clone() {
                    let ids: Vec<u64> = self.user(&u).orders.iter().copied().collect();
                    let live: Vec<u64> = ids.into_iter().filter(|id| self.engine.order(*id).is_some()).collect();
                    self.user(&u).orders = live.into_iter().collect();
                }
                if market_changed {
                    self.point(*player, ts, *usdc);
                }
            }
            (Cmd::CancelOrder { user, order, .. }, _) => {
                self.user(user).orders.remove(order);
                self.act(user, a("order-cancel", b.player, 0, 0, "Limit order cancelled".into()));
                touched.insert(*user);
            }
            (Cmd::AddLiquidity { user, player, .. }, Outcome::Liquidity { position, tokens, usdc, .. }) => {
                // The tokens' cost basis moves into the position.
                let part = self.sold(user, *player, *tokens, 0);
                if let Some(x) = self.user(user).realized.get_mut(player) {
                    *x += part as i128; // moving tokens into a position realises nothing
                }
                *self.user(user).lp_in.entry(*position).or_default() += part + *usdc as u128;
                let px = spot(&self.engine, *player);
                self.user(user).lp_px.entry(*position).or_insert(px);
                self.act(user, a("lp-add", Some(*player), -(*usdc as i64), -(*tokens as i64), "Added liquidity".into()));
                touched.insert(*user);
                market_changed = true;
                self.point(*player, ts, 0);
            }
            (Cmd::RemoveLiquidity { user, position, liquidity, .. }, Outcome::Liquidity { tokens, usdc, .. }) => {
                if let (Some(p), Some((_, before_l))) = (b.player, b.lp) {
                    let px = spot(&self.engine, p);
                    let gone = self.engine.lp(*position).is_none();
                    let ui = self.users.entry(*user).or_default();
                    let put = ui.lp_in.get(position).copied().unwrap_or(0);
                    let part = if before_l == 0 { put } else { put * *liquidity / before_l };
                    let left = put - part;
                    if left == 0 || gone {
                        ui.lp_in.remove(position);
                    } else {
                        ui.lp_in.insert(*position, left);
                    }
                    let back = *usdc as u128 + val(*tokens, px);
                    *ui.realized.entry(p).or_default() += back as i128 - part as i128;
                    self.bought(user, p, *tokens, val(*tokens, px));
                    self.act(user, a("lp-remove", Some(p), *usdc as i64, *tokens as i64, "Removed liquidity (fees collected)".into()));
                    market_changed = true;
                    self.point(p, ts, 0);
                }
                touched.insert(*user);
            }
            (Cmd::Claim { user, player, round, .. }, Outcome::Claimed { usdc, tokens }) => {
                if *tokens > 0 {
                    self.bought(user, *player, *tokens, 0);
                    self.act(user, a("claim-tokens", Some(*player), 0, *tokens as i64, format!("Round {round} dividend taken as tokens (+10%)")));
                    market_changed = true;
                } else {
                    self.act(user, a("claim-usdc", Some(*player), *usdc as i64, 0, format!("Round {round} dividend taken as USDC")));
                }
                touched.insert(*user);
            }
            (Cmd::ClaimAll { user, .. }, Outcome::ClaimedAll { rows }) => {
                for &(round, player, usdc, tokens) in rows {
                    if tokens > 0 {
                        self.bought(user, player, tokens, 0);
                        self.act(user, a("claim-tokens", Some(player), 0, tokens as i64, format!("Round {round} dividend taken as tokens (+10%)")));
                        market_changed = true;
                    } else {
                        self.act(user, a("claim-usdc", Some(player), usdc as i64, 0, format!("Round {round} dividend taken as USDC")));
                    }
                }
                touched.insert(*user);
            }
            (Cmd::Snapshot { round }, _) => {
                let mut m = BTreeMap::new();
                for (p, _) in self.engine.markets().filter(|(_, m)| m.state == MarketState::Bonded) {
                    if let Some(s) = self.engine.kickoff_snapshot(*round, *p) {
                        m.insert(*p, SnapView { px: s.px, circulating: s.circulating, holders: s.holders.clone() });
                    }
                }
                self.snaps.insert(*round, (ts, m));
                while self.snaps.len() > 6 {
                    self.snaps.pop_first();
                }
                self.emit(json!({"type": "snapshot", "seq": seq, "round": round}));
            }
            (Cmd::RoundResult { round, payouts }, _) => {
                let credits: BTreeMap<(UserId, PlayerId), u64> = self.engine.pending_rounds().filter(|(k, _)| *k == round).flat_map(|(_, r)| r.credits.clone()).collect();
                self.results.insert(*round, RoundRes { ts, payouts: payouts.clone(), credits, credited: false });
                while self.results.len() > 60 {
                    self.results.pop_first();
                }
                self.emit(json!({"type": "result", "seq": seq, "round": round}));
            }
            (Cmd::BatchFinalized { .. }, _) => {
                for (round, credits) in &b.credits {
                    let mut users: Vec<String> = vec![];
                    for ((u, p), amt) in credits {
                        self.user(u).dividends += amt;
                        self.paid_out += amt;
                        self.act(u, a("dividend", Some(*p), *amt as i64, 0, format!("Round {round} dividend credited")));
                        users.push(bs(u));
                        touched.insert(*u);
                    }
                    if let Some(r) = self.results.get_mut(round) {
                        r.credited = true;
                    }
                    self.emit(json!({"type": "credited", "seq": seq, "round": round, "users": users}));
                }
            }
            _ => {}
        }
        if market_changed {
            if let Some(p) = b.player.or(player_of(&r.cmd)) {
                let px = spot(&self.engine, p);
                if px != b.px || b.state != self.engine.market(p).map(|m| m.state) {
                    self.emit(json!({"type": "market", "seq": seq, "player": p, "px": px}));
                }
            }
        }
        for u in touched {
            self.user(&u).last_seq = seq;
            if self.ready {
                self.sample(&u, ts);
            }
            self.emit(json!({"type": "user", "seq": seq, "user": bs(&u)}));
        }
    }

    /// (value, positions value, LP value) of a user now, in USDC base units.
    pub fn value_of(&self, u: &UserId) -> (u128, u128, u128, u128) {
        let e = &self.engine;
        let a = e.account(u);
        let cash = (a.free + a.locked + a.in_orders) as u128;
        let mut pos = 0u128;
        for (p, h) in e.holdings_of(u) {
            pos += val(h.amount + h.locked, spot(e, p));
        }
        let mut lp = 0u128;
        if let Some(ui) = self.users.get(u) {
            for id in ui.lp_in.keys() {
                if let Some(l) = e.lp(*id) {
                    lp += lp_value(e, l).0;
                }
            }
        }
        let claims: u128 = e.claims().filter(|((o, _, _), _)| o == u).map(|(_, v)| *v as u128).sum();
        (cash + pos + lp + claims, pos, lp, claims)
    }

    fn sample(&mut self, u: &UserId, ts: i64) {
        let (v, ..) = self.value_of(u);
        let ui = self.users.entry(*u).or_default();
        let net_in = ui.deposits as i128 - ui.withdrawals as i128;
        let pnl = v as i128 - net_in;
        let bucket = ts - ts.rem_euclid(30);
        match ui.value.back_mut() {
            Some(last) if last.0 == bucket => *last = (bucket, v as i64, pnl as i64),
            _ => {
                ui.value.push_back((bucket, v as i64, pnl as i64));
                if ui.value.len() > VALUE_POINTS {
                    ui.value.pop_front();
                }
            }
        }
    }

    fn sample_all(&mut self, ts: i64) {
        let users: Vec<UserId> = self.users.iter().filter(|(_, ui)| ui.deposits > 0).map(|(u, _)| *u).collect();
        for u in users {
            self.sample(&u, ts);
        }
    }
}

/// (value incl. uncollected fees, tokens, usdc, fee tokens, fee usdc) of a liquidity position now.
pub fn lp_value(e: &Engine, l: &score_engine::LpPosition) -> (u128, u128, u128, u128, u128) {
    let Some(pool) = e.pool(l.player) else { return (0, 0, 0, 0, 0) };
    let (t, u) = pool.amounts_for(l.lower, l.upper, l.liquidity, false).unwrap_or((0, 0));
    let (g0, g1) = pool.fee_inside(l.lower, l.upper);
    let f0 = l.owed0 + fee_owed(l.liquidity, g0.wrapping_sub(l.inside0)).unwrap_or(0);
    let f1 = l.owed1 + fee_owed(l.liquidity, g1.wrapping_sub(l.inside1)).unwrap_or(0);
    let px = px_from_sqrt(pool.sqrt, false).unwrap_or(0);
    let v = u + f1 + usdc_at_px(t + f0, px, false).unwrap_or(0);
    (v, t, u, f0, f1)
}

pub fn usd(micro: u64) -> String {
    format!("${:.2}", micro as f64 / 1e6)
}
fn tok(base: u64) -> String {
    let v = base as f64 / 1e6;
    if v >= 100.0 {
        format!("{v:.0}")
    } else {
        format!("{v:.2}")
    }
}

/// Start the read model: replay the whole log, then follow the stream. Returns the shared views
/// and the channel of app events.
pub fn spawn(wal: PathBuf, mut rx: broadcast::Receiver<Arc<Record>>) -> (Shared, broadcast::Sender<Value>) {
    let (events, _) = broadcast::channel(8_192);
    let views: Shared = Arc::new(RwLock::new(Views::new(events.clone())));
    let v = views.clone();
    std::thread::Builder::new()
        .name("views".into())
        .spawn(move || {
            let t0 = Instant::now();
            let recs = FileWal::read_all(&wal).unwrap_or_default();
            {
                let mut w = v.write().unwrap();
                for r in &recs {
                    w.apply(r);
                }
                let ts = w.last_ts;
                w.sample_all(ts);
                w.ready = true;
                eprintln!("views: {} records indexed in {} ms", recs.len(), t0.elapsed().as_millis());
            }
            drop(recs);
            // Forward the broadcast into a channel with a timeout, so value samples run on a timer.
            let (tx, frx) = std::sync::mpsc::sync_channel::<Option<Arc<Record>>>(16_384);
            std::thread::Builder::new()
                .name("views-rx".into())
                .spawn(move || loop {
                    match rx.blocking_recv() {
                        Ok(r) => {
                            if tx.send(Some(r)).is_err() {
                                return;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            let _ = tx.send(None);
                        }
                        Err(broadcast::error::RecvError::Closed) => return,
                    }
                })
                .expect("views rx thread");
            let mut last_sample = Instant::now();
            loop {
                match frx.recv_timeout(Duration::from_millis(500)) {
                    Ok(Some(r)) => {
                        let mut w = v.write().unwrap();
                        if r.seq <= w.seq {
                            continue;
                        }
                        if r.seq != w.seq + 1 {
                            // Missed records: catch up from the log file.
                            let from = w.seq;
                            for x in FileWal::read_all(&wal).unwrap_or_default().iter().filter(|x| x.seq > from) {
                                w.apply(x);
                            }
                            continue;
                        }
                        w.apply(&r);
                        // Drain whatever else is waiting under the same lock.
                        while let Ok(Some(r)) = frx.try_recv() {
                            if r.seq == w.seq + 1 {
                                w.apply(&r);
                            }
                        }
                    }
                    Ok(None) => {
                        let mut w = v.write().unwrap();
                        let from = w.seq;
                        for x in FileWal::read_all(&wal).unwrap_or_default().iter().filter(|x| x.seq > from) {
                            w.apply(x);
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => return,
                }
                if last_sample.elapsed() >= SAMPLE_EVERY {
                    let mut w = v.write().unwrap();
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
                    w.sample_all(now);
                    last_sample = Instant::now();
                }
            }
        })
        .expect("views thread");
    (views, events)
}

// ------------------------------------------------------------------ JSON for the API

pub fn market_json(v: &Views, p: PlayerId, now: i64) -> Option<Value> {
    let e = &v.engine;
    let m = e.market(p)?;
    let idx = v.markets.get(&p);
    let px = spot(e, p);
    let pool = e.pool(p);
    let pts = idx.map(|i| &i.pts);
    let day_ago = now - DAY;
    // 24h change compares with the market's price a day ago, or, for a player that bonded within the
    // day, with the pool's opening price (the launch curve's run-up isn't a market move).
    let since = match idx.and_then(|i| i.bonded_ts) {
        Some(b) if m.state == MarketState::Bonded && b > day_ago => b,
        _ => day_ago,
    };
    let px24 = pts
        .and_then(|pts| pts.iter().rev().find(|x| x.t <= since).filter(|x| since == day_ago || x.t >= since - 60).or_else(|| pts.iter().find(|x| x.t >= since)).or(pts.front()).map(|x| x.px))
        .unwrap_or(px);
    let vol24: u64 = pts.map(|pts| pts.iter().rev().take_while(|x| x.t > day_ago).map(|x| x.vol).sum()).unwrap_or(0);
    let spark: Vec<u64> = sparkline(pts, now);
    let book = e.book(p);
    let protocol_tokens: u128 = e.lps().filter(|(_, l)| l.player == p && l.protocol).map(|(_, l)| lp_value(e, l).1).sum();
    Some(json!({
        "player": p,
        "protocolTokens": protocol_tokens as u64,
        "state": if m.state == MarketState::Bonded { "bonded" } else { "launching" },
        "listedTs": idx.map(|i| i.listed_ts), "bondedTs": idx.and_then(|i| i.bonded_ts),
        "sold": m.sold, "raised": m.raised, "threshold": THRESHOLD as u64, "minted": m.minted, "reserveLeft": m.reserve_left,
        "px": px, "px24": px24, "volume24h": vol24, "volume": idx.map(|i| i.volume).unwrap_or(0),
        "poolUsdc": pool.map(|x| x.reserve1), "poolTokens": pool.map(|x| x.reserve0),
        "bestBid": book.and_then(|b| b.bids.keys().next_back().copied()), "bestAsk": book.and_then(|b| b.asks.keys().next().copied()),
        "sparkline": spark,
        "lastTradeTs": idx.and_then(|i| i.trades.front().map(|t| t.ts)),
    }))
}

fn sparkline(pts: Option<&VecDeque<Pt>>, now: i64) -> Vec<u64> {
    let Some(pts) = pts else { return vec![] };
    if pts.is_empty() {
        return vec![];
    }
    let n = 24;
    let start = now - DAY;
    let mut out = Vec::with_capacity(n);
    let mut i = 0;
    let mut last = pts.front().map(|x| x.px).unwrap_or(0);
    for k in 0..=n {
        let t = start + (DAY * k as i64) / n as i64;
        while i < pts.len() && pts[i].t <= t {
            last = pts[i].px;
            i += 1;
        }
        out.push(last);
    }
    out
}

pub fn trade_json(t: &Trade, me: Option<&UserId>) -> Value {
    json!({"id": t.seq, "player": t.player, "user": bs(&t.user), "side": if t.buy {"buy"} else {"sell"}, "venue": if t.curve {"curve"} else {"pool"}, "usdc": t.usdc, "tokens": t.tokens, "fee": t.fee, "ts": t.ts, "mine": me == Some(&t.user)})
}

pub fn detail_json(v: &Views, p: PlayerId, me: Option<&UserId>, now: i64) -> Option<Value> {
    let mut out = market_json(v, p, now)?;
    let e = &v.engine;
    let pool = e.pool(p);
    // Book: aggregate levels, best first.
    let mut bids: Vec<Value> = vec![];
    let mut asks: Vec<Value> = vec![];
    if let Some(b) = e.book(p) {
        for (px, ids) in b.bids.iter().rev().take(16) {
            let usdc: u64 = ids.iter().filter_map(|id| e.order(*id)).map(|o| o.remaining).sum();
            bids.push(json!({"px": px, "usdc": usdc, "orders": ids.len()}));
        }
        for (px, ids) in b.asks.iter().take(16) {
            let tokens: u64 = ids.iter().filter_map(|id| e.order(*id)).map(|o| o.remaining).sum();
            asks.push(json!({"px": px, "tokens": tokens, "orders": ids.len()}));
        }
    }
    // Holders (free + in asks), plus liquidity providers' token side.
    let mut holders: BTreeMap<UserId, (u128, bool)> = BTreeMap::new();
    for ((u, hp), h) in e.holdings() {
        if *hp == p && h.amount + h.locked > 0 {
            holders.entry(*u).or_default().0 += (h.amount + h.locked) as u128;
        }
    }
    let mut protocol_l = 0u128;
    let mut total_l = 0u128;
    let mut lp_tokens_protocol = 0u128;
    for (_, l) in e.lps().filter(|(_, l)| l.player == p) {
        total_l += l.liquidity;
        let (_, t, ..) = lp_value(e, l);
        if l.protocol {
            protocol_l += l.liquidity;
            lp_tokens_protocol += t;
        } else {
            let x = holders.entry(l.owner).or_default();
            x.0 += t;
            x.1 = true;
        }
    }
    let holder_count = holders.len();
    let mut top: Vec<(UserId, (u128, bool))> = holders.into_iter().collect();
    top.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
    let holders_json: Vec<Value> = top.iter().take(12).map(|(u, (t, lp))| json!({"user": bs(u), "tokens": *t as u64, "lp": lp, "mine": me == Some(u)})).collect();
    let trades: Vec<Value> = v.markets.get(&p).map(|m| m.trades.iter().take(40).map(|t| trade_json(t, me)).collect()).unwrap_or_default();
    let dividends: Vec<Value> = v
        .results
        .iter()
        .rev()
        .filter_map(|(r, res)| res.payouts.iter().find(|(x, _)| *x == p).map(|(_, amt)| (r, res, amt)))
        .take(12)
        .map(|(r, res, amt)| {
            let circ = v.snaps.get(r).and_then(|(_, m)| m.get(&p)).map(|s| s.circulating).unwrap_or(0);
            json!({"round": r, "payout": amt, "circulating": circ, "ts": res.ts})
        })
        .collect();
    let paid: u64 = v.results.values().flat_map(|r| r.payouts.iter().filter(|(x, _)| *x == p).map(|(_, a)| *a)).sum();
    let o = out.as_object_mut().unwrap();
    o.insert("bids".into(), json!(bids));
    o.insert("asks".into(), json!(asks));
    o.insert("holders".into(), json!(holders_json));
    o.insert("holderCount".into(), json!(holder_count));
    o.insert("protocolShare".into(), json!(if total_l == 0 { 0.0 } else { protocol_l as f64 / total_l as f64 }));
    o.insert("protocolTokens".into(), json!(lp_tokens_protocol as u64));
    o.insert("activeLiquidity".into(), json!(pool.map(|x| x.liquidity.to_string())));
    o.insert("trades".into(), json!(trades));
    o.insert("dividends".into(), json!(dividends));
    o.insert("dividendsPaid".into(), json!(paid));
    Some(out)
}

/// Price history: (t, px, vol) points, downsampled to at most `max` buckets over the window.
pub fn history_json(v: &Views, p: PlayerId, window: i64, now: i64, max: usize) -> Value {
    let Some(m) = v.markets.get(&p) else { return json!([]) };
    let from = if window <= 0 { m.pts.front().map(|x| x.t).unwrap_or(now) } else { now - window };
    let span = (now - from).max(60);
    let step = (span / max as i64).max(60);
    let mut out: Vec<Value> = vec![];
    let mut last_px = m.pts.iter().rev().find(|x| x.t <= from).map(|x| x.px);
    let mut bucket_t = from - from.rem_euclid(step);
    let mut vol = 0u64;
    let mut have = false;
    for x in m.pts.iter().filter(|x| x.t > from) {
        let b = x.t - x.t.rem_euclid(step);
        if b != bucket_t {
            if have || last_px.is_some() {
                out.push(json!([bucket_t, last_px.unwrap_or(x.px), vol]));
            }
            bucket_t = b;
            vol = 0;
        }
        last_px = Some(x.px);
        vol += x.vol;
        have = true;
    }
    if let Some(px) = last_px {
        out.push(json!([bucket_t, px, vol]));
        out.push(json!([now, px, 0]));
    }
    json!(out)
}

pub fn user_json(v: &Views, u: &UserId) -> Value {
    let e = &v.engine;
    let a = e.account(u);
    let ui = v.users.get(u);
    let positions: Vec<Value> = e
        .holdings_of(u)
        .filter(|(_, h)| h.amount + h.locked > 0 || h.cap_bought > 0)
        .map(|(p, h)| {
            let c = ui.and_then(|x| x.cost.get(&p)).copied().unwrap_or_default();
            let realized = ui.and_then(|x| x.realized.get(&p)).copied().unwrap_or(0);
            json!({"player": p, "amount": h.amount, "locked": h.locked, "entryTs": h.entry_ts, "capBought": h.cap_bought, "cost": c.usdc as u64, "costTokens": c.tokens, "realized": realized as i64, "px": spot(e, p)})
        })
        .collect();
    let lps: Vec<Value> = ui
        .map(|x| {
            x.lp_in
                .iter()
                .filter_map(|(id, put)| {
                    let l = e.lp(*id)?;
                    let (value, t, usdc, f0, f1) = lp_value(e, l);
                    let total = e.lps().filter(|(_, o)| o.player == l.player).map(|(_, o)| o.liquidity).sum::<u128>();
                    Some(json!({"id": id, "player": l.player, "liquidity": l.liquidity.to_string(), "share": if total == 0 {0.0} else {l.liquidity as f64 / total as f64}, "tokens": t as u64, "usdc": usdc as u64, "feeTokens": f0 as u64, "feeUsdc": f1 as u64, "value": value as u64, "deposited": *put as u64, "entryPx": x.lp_px.get(id).copied().unwrap_or(0), "entryTs": l.entry_ts, "fullRange": l.lower <= score_engine::fixed::MIN_SQRT_X64 + 1}))
                })
                .collect()
        })
        .unwrap_or_default();
    let orders: Vec<Value> = e
        .orders()
        .filter(|(_, o)| o.user == *u)
        .map(|(id, o)| json!({"id": id, "player": o.player, "side": if o.side == Side::Bid {"buy"} else {"sell"}, "px": o.px, "remaining": o.remaining}))
        .collect();
    let claims: Vec<Value> = e.claims().filter(|((o, _, _), _)| o == u).map(|((_, r, p), amt)| json!({"round": r, "player": p, "amount": amt, "electionPx": e.election_px(*r, *p)})).collect();
    let locks: Vec<Value> = e
        .locks()
        .filter(|(_, l)| l.user == *u)
        .map(|(id, l)| json!({"id": id, "amount": l.amount, "kind": match l.kind { LockKind::Permit { .. } => "permit", LockKind::Requested => "requested", LockKind::Forced => "forced" }}))
        .collect();
    let activity: Vec<Value> = ui
        .map(|x| x.activity.iter().take(150).map(|a| json!({"id": format!("{}-{}-{}", a.seq, a.kind, a.player.unwrap_or(0)), "seq": a.seq, "ts": a.ts, "kind": a.kind, "player": a.player, "usdc": a.usdc, "tokens": a.tokens, "detail": a.detail})).collect())
        .unwrap_or_default();
    let (value, pos, lpv, claimable) = v.value_of(u);
    json!({
        "user": bs(u), "seq": v.seq, "lastSeq": ui.map(|x| x.last_seq).unwrap_or(0),
        "free": a.free, "locked": a.locked, "inOrders": a.in_orders, "nonce": a.nonce,
        "value": value as u64, "positionsValue": pos as u64, "lpValue": lpv as u64, "claimable": claimable as u64,
        "fees": ui.map(|x| x.fees).unwrap_or(0), "dividends": ui.map(|x| x.dividends).unwrap_or(0),
        "deposits": ui.map(|x| x.deposits).unwrap_or(0), "withdrawals": ui.map(|x| x.withdrawals).unwrap_or(0),
        "realized": ui.map(|x| x.realized.values().sum::<i128>() as i64).unwrap_or(0),
        "positions": positions, "lps": lps, "orders": orders, "claims": claims, "locks": locks, "activity": activity,
    })
}

pub fn value_json(v: &Views, u: &UserId, window: i64, now: i64) -> Value {
    let Some(ui) = v.users.get(u) else { return json!([]) };
    let from = if window <= 0 { i64::MIN } else { now - window };
    let pts: Vec<&(i64, i64, i64)> = ui.value.iter().filter(|x| x.0 >= from).collect();
    let step = (pts.len() / 240).max(1);
    let mut out: Vec<Value> = pts.iter().step_by(step).map(|x| json!([x.0, x.1, x.2])).collect();
    // Always end at now with the live value.
    let (val, ..) = v.value_of(u);
    let pnl = val as i128 - (ui.deposits as i128 - ui.withdrawals as i128);
    if ui.deposits > 0 {
        if out.is_empty() {
            if let Some(first) = ui.value.iter().rev().find(|x| x.0 < from) {
                out.push(json!([from, first.1, first.2]));
            }
        }
        out.push(json!([now, val as u64, pnl as i64]));
    }
    json!(out)
}

pub fn stats_json(v: &Views, now: i64) -> Value {
    let e = &v.engine;
    let mut bonded = 0;
    let mut launching = 0;
    let mut pool_usdc = 0u64;
    let mut curve_usdc = 0u64;
    let mut external = 0u128;
    let mut reserve = 0u64;
    let day_ago = now - DAY;
    let mut vol24 = 0u64;
    for (p, m) in e.markets() {
        match m.state {
            MarketState::Bonded => {
                bonded += 1;
                pool_usdc += e.pool(*p).map(|x| x.reserve1).unwrap_or(0);
            }
            MarketState::IcoLive => {
                launching += 1;
                curve_usdc += m.raised;
            }
        }
        reserve += m.reserve_left;
        if let Some(idx) = v.markets.get(p) {
            vol24 += idx.pts.iter().rev().take_while(|x| x.t > day_ago).map(|x| x.vol).sum::<u64>();
        }
    }
    for (_, l) in e.lps().filter(|(_, l)| !l.protocol) {
        external += lp_value(e, l).0;
    }
    json!({
        "seq": v.seq, "vault": e.vault(), "treasury": e.treasury(), "custody": e.custody(), "reserved": e.reserved(), "claimable": e.claimable(),
        "bonded": bonded, "launching": launching, "poolUsdc": pool_usdc, "curveUsdc": curve_usdc, "externalLp": external as u64,
        "reserveLeft": reserve, "volume24h": vol24, "paidOut": v.paid_out, "fees": v.fees,
        "rounds": {"lastSnapshot": e.rounds().0, "lastResult": e.rounds().1},
    })
}

pub fn snapshot_json(v: &Views, round: u32, me: Option<&UserId>) -> Value {
    match v.snaps.get(&round) {
        None => json!(null),
        Some((ts, m)) => {
            let players: Vec<Value> = m.iter().map(|(p, s)| json!({"player": p, "px": s.px, "circulating": s.circulating, "mine": me.and_then(|u| s.holders.get(u)).copied().unwrap_or(0), "holders": s.holders.len()})).collect();
            json!({"round": round, "ts": ts, "players": players})
        }
    }
}

pub fn results_json(v: &Views, limit: usize, me: Option<&UserId>) -> Value {
    let out: Vec<Value> = v
        .results
        .iter()
        .rev()
        .take(limit)
        .map(|(r, res)| {
            let mine: Vec<Value> = me.map(|u| res.credits.iter().filter(|((o, _), _)| o == u).map(|((_, p), a)| json!({"player": p, "amount": a})).collect()).unwrap_or_default();
            json!({"round": r, "ts": res.ts, "credited": res.credited, "payouts": res.payouts.iter().map(|(p, a)| json!([p, a])).collect::<Vec<_>>(), "mine": mine})
        })
        .collect();
    json!(out)
}

// ------------------------------------------------------------------ quotes

pub struct QuoteIn {
    pub kind: String,
    pub user: UserId,
    pub player: PlayerId,
    pub usdc: u64,
    pub tokens: u64,
    pub position: u64,
    pub fraction: f64,
}

fn err_code(e: &score_engine::Error) -> String {
    format!("{e:?}")
}

fn run(e: &Engine, q: &QuoteIn, now: i64, cmd: &Cmd, top_usdc: u64, top_tokens: u64) -> Result<(Outcome, Engine), String> {
    let mut s = e.sandbox(q.player, &q.user, top_usdc, top_tokens);
    let out = s.apply(now, cmd).map_err(|x| err_code(&x))?;
    Ok((out, s))
}

/// Exact quote for a buy, sell, or liquidity change, on a throwaway copy of the market.
pub fn quote(v: &Views, q: &QuoteIn, now: i64) -> Value {
    let e = &v.engine;
    let Some(m) = e.market(q.player) else { return json!({"ok": false, "error": "UnknownPlayer"}) };
    let curve = m.state == MarketState::IcoLive;
    let user = q.user;
    let nonce = e.account(&user).nonce + 1;
    let px0 = spot(e, q.player);
    let h = e.holding(&user, q.player);
    let base = |out: Result<(Outcome, Engine), String>| -> Value {
        match out {
            Err(code) => json!({"ok": false, "error": code, "pxBefore": px0, "curve": curve, "capBought": h.cap_bought, "held": h.amount, "entryTs": h.entry_ts}),
            Ok((o, s)) => {
                let px1 = spot(&s, q.player);
                let graduated = curve && s.market(q.player).map(|x| x.state) == Some(MarketState::Bonded);
                json!({"ok": true, "outcome": o, "pxBefore": px0, "pxAfter": px1, "curve": curve, "graduated": graduated, "capBought": h.cap_bought, "held": h.amount, "entryTs": h.entry_ts, "raisedAfter": s.market(q.player).map(|x| x.raised)})
            }
        }
    };
    match q.kind.as_str() {
        "buy" => {
            let cmd = if curve {
                Cmd::BuyCurve { user, nonce, player: q.player, usdc_in: q.usdc, min_tokens: 0 }
            } else {
                Cmd::Buy { user, nonce, player: q.player, usdc_in: q.usdc, min_tokens: 0, limit_px: 0 }
            };
            base(run(e, q, now, &cmd, q.usdc, 0))
        }
        "sell" => {
            let mk = |tokens: u64| if curve { Cmd::SellCurve { user, nonce, player: q.player, tokens, min_usdc: 0 } } else { Cmd::Sell { user, nonce, player: q.player, tokens_in: tokens, min_usdc: 0, limit_px: 0 } };
            let net = |o: &Outcome| match o {
                Outcome::Sold { usdc_out, .. } => *usdc_out,
                Outcome::Traded { usdc, .. } => *usdc,
                _ => 0,
            };
            let mut tokens = q.tokens;
            if tokens == 0 && q.usdc > 0 {
                // Smallest token amount that nets at least `usdc` (binary search on real quotes).
                let cap = if h.amount > 0 { h.amount } else { m.minted };
                let (mut lo, mut hi) = (0u64, cap);
                match run(e, q, now, &mk(round_milli(hi, curve)), 0, hi) {
                    Ok((o, _)) if net(&o) >= q.usdc => {}
                    _ => return base(Err(if h.amount > 0 { "InsufficientTokens".into() } else { "NoFill".into() })),
                }
                for _ in 0..48 {
                    if hi - lo <= if curve { 1_000 } else { 1 } {
                        break;
                    }
                    let mid = lo + (hi - lo) / 2;
                    match run(e, q, now, &mk(round_milli(mid, curve).max(1)), 0, mid) {
                        Ok((o, _)) if net(&o) >= q.usdc => hi = mid,
                        _ => lo = mid,
                    }
                }
                tokens = round_milli(hi, curve);
                if curve && tokens < hi {
                    tokens += 1_000;
                }
            }
            let tokens = if curve { round_milli(tokens, true) } else { tokens };
            let mut r = base(run(e, q, now, &mk(tokens), 0, tokens));
            r["tokensIn"] = json!(tokens);
            r
        }
        "add" | "zap" => {
            if curve {
                return json!({"ok": false, "error": "WrongState"});
            }
            let mut s = e.sandbox(q.player, &user, q.usdc, 0);
            let mut swap = None;
            let mut nonce = nonce;
            let mut need_tokens = 0u64;
            let (usdc_side, max_tokens) = if q.kind == "zap" {
                let half = q.usdc / 2;
                match s.apply(now, &Cmd::Buy { user, nonce, player: q.player, usdc_in: half, min_tokens: 0, limit_px: 0 }) {
                    Ok(o) => {
                        nonce += 1;
                        let got = match &o {
                            Outcome::Traded { tokens, .. } => *tokens,
                            _ => 0,
                        };
                        swap = Some(o);
                        (q.usdc - half, got)
                    }
                    Err(x) => return json!({"ok": false, "error": err_code(&x)}),
                }
            } else {
                // Pair: `usdc` is the USDC side; the tokens side comes from the holding, at the
                // pool price (2% headroom: the engine takes only what the ratio needs).
                let need = (score_engine::fixed::tokens_at_px(q.usdc as u128, px0.max(1) as u128).unwrap_or(0) * 102 / 100) as u64;
                need_tokens = need;
                (q.usdc, need.min(h.amount))
            };
            let cmd = Cmd::AddLiquidity { user, nonce, player: q.player, lower_px: 0, upper_px: 0, max_usdc: usdc_side, max_tokens, min_liquidity: 0 };
            let total_before: u128 = s.lps().filter(|(_, l)| l.player == q.player).map(|(_, l)| l.liquidity).sum();
            match s.apply(now, &cmd) {
                Ok(o) => {
                    let share = match &o {
                        Outcome::Liquidity { liquidity, .. } => *liquidity as f64 / (total_before + *liquidity) as f64,
                        _ => 0.0,
                    };
                    json!({"ok": true, "outcome": o, "swap": swap, "share": share, "pxBefore": px0, "pxAfter": spot(&s, q.player), "maxTokens": max_tokens, "maxUsdc": usdc_side, "needTokens": need_tokens, "held": h.amount})
                }
                Err(x) => json!({"ok": false, "error": err_code(&x), "maxTokens": max_tokens, "needTokens": need_tokens, "held": h.amount}),
            }
        }
        "remove" => {
            let Some(l) = e.lp(q.position) else { return json!({"ok": false, "error": "UnknownPosition"}) };
            let liq = ((l.liquidity as f64) * q.fraction.clamp(0.0, 1.0)) as u128;
            let liq = if q.fraction >= 0.999_999 { l.liquidity } else { liq };
            let cmd = Cmd::RemoveLiquidity { user, nonce, position: q.position, liquidity: liq, min_usdc: 0, min_tokens: 0 };
            let mut r = base(run(e, q, now, &cmd, 0, 0));
            r["liquidity"] = json!(liq.to_string());
            r
        }
        _ => json!({"ok": false, "error": "unknown quote kind"}),
    }
}

fn round_milli(x: u64, curve: bool) -> u64 {
    if curve {
        x - x % 1_000
    } else {
        x
    }
}

