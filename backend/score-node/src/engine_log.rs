//! Background follower: a copy of the engine, on its own low-priority thread, replaying the saved
//! log stream. Writes restart snapshots, checks every record's hash against the engine's, and with
//! `SCORE_ENGINE_LOG=1` prints one plain-language line per command. Never touches the trading path.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use score_engine::fixed::px_from_sqrt;
use score_engine::math::price_micro;
use score_engine::wal::{FileWal, Record, Sequencer};
use score_engine::{Cmd, Engine, Outcome, PlayerId, Side, UserId};
use tokio::sync::broadcast;

const SNAPSHOT_EVERY: u64 = 5_000;

pub fn spawn(wal_path: PathBuf, mut rx: broadcast::Receiver<Arc<Record>>, log: bool) {
    std::thread::Builder::new()
        .name("follower".into())
        .spawn(move || {
            lowest_priority();
            let snap = crate::snapshot::path_for(&wal_path);
            let (mut rep, from) = rebuild_from(&wal_path);
            // Don't rewrite the snapshot we just started from.
            let (mut snapped, mut snapped_at) = (from.unwrap_or(0), Instant::now());
            let mut healthy = true;
            if log {
                eprintln!("engine │ log view on: replaying from #{} (a separate copy of the engine; the trading path is untouched)", rep.seq + 1);
            }
            loop {
                // Snapshot from this copy (only while it matches the engine exactly).
                if healthy && rep.seq > snapped && (rep.seq - snapped >= SNAPSHOT_EVERY || snapped_at.elapsed().as_secs() >= 60) {
                    let t = Instant::now();
                    match crate::snapshot::save(&snap, &rep) {
                        Ok(()) => eprintln!("snapshot: engine state at #{} saved in {} ms (restarts re-apply only what comes after)", rep.seq, t.elapsed().as_millis()),
                        Err(e) => eprintln!("snapshot: failed: {e}"),
                    }
                    (snapped, snapped_at) = (rep.seq, Instant::now());
                }
                match rx.blocking_recv() {
                    Ok(r) => {
                        if r.seq <= rep.seq {
                            continue;
                        }
                        if r.seq != rep.seq + 1 {
                            rep = rebuild(&wal_path);
                            continue;
                        }
                        let before = if log { Some(Before::of(&rep.engine, &r.cmd)) } else { None };
                        let t = Instant::now();
                        match rep.submit(r.ts, r.cmd.clone(), r.sig) {
                            Ok((out, mine)) => {
                                let us = t.elapsed().as_micros();
                                if mine.hash != r.hash {
                                    healthy = false;
                                    eprintln!("follower: #{} !! REPLAY DIFFERS FROM THE ENGINE (snapshots stopped)", r.seq);
                                }
                                if let Some(b) = &before {
                                    eprintln!("engine │ #{} {} · {us} µs", r.seq, describe(b, &rep.engine, &r.cmd, &out, r.ts));
                                }
                            }
                            Err(e) => {
                                healthy = false;
                                eprintln!("follower: #{} !! replay refused a logged command: {e:?} (snapshots stopped)", r.seq);
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        eprintln!("follower: skipped {n} records to keep up; resyncing from the log file");
                        rep = rebuild(&wal_path);
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
        })
        .expect("engine log thread");
}

fn rebuild(path: &std::path::Path) -> Sequencer {
    rebuild_from(path).0
}

fn rebuild_from(path: &std::path::Path) -> (Sequencer, Option<u64>) {
    let recs = FileWal::read_all(path).unwrap_or_default();
    match crate::snapshot::restore(&crate::snapshot::path_for(path), &recs) {
        Ok(r) => (r.seq, r.from.filter(|f| *f == recs.len() as u64)),
        Err(_) => (Sequencer::default(), None),
    }
}


fn usd(micro: u64) -> String {
    let v = micro as f64 / 1e6;
    if v != 0.0 && v.abs() < 0.01 {
        format!("${v:.6}")
    } else {
        format!("${}", thousands(v, 2))
    }
}
fn tok(base: u64) -> String {
    format!("{} tokens", thousands(base as f64 / 1e6, if base < 10_000_000 { 2 } else { 0 }))
}
fn px(p: u64) -> String {
    format!("${:.6}", p as f64 / 1e9)
}
fn thousands(v: f64, dp: usize) -> String {
    let s = format!("{v:.dp$}");
    let (int, frac) = s.split_once('.').map_or((s.as_str(), ""), |(a, b)| (a, b));
    let neg = int.starts_with('-');
    let digits: Vec<char> = int.trim_start_matches('-').chars().collect();
    let mut out = String::new();
    for (i, c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(*c);
    }
    format!("{}{out}{}{frac}", if neg { "-" } else { "" }, if frac.is_empty() { "" } else { "." })
}
fn who(u: &UserId) -> String {
    let s = bs58::encode(u).into_string();
    format!("{}…{}", &s[..4], &s[s.len() - 3..])
}


#[derive(Default)]
struct Mkt {
    raised: u64,
    pool_usdc: u64,
    pool_tokens: u64,
    px: u64,
}

fn mkt(e: &Engine, p: PlayerId) -> Mkt {
    let Some(m) = e.market(p) else { return Mkt::default() };
    let mut out = Mkt { raised: m.raised, ..Default::default() };
    if let Some(pool) = e.pool(p) {
        out.pool_usdc = pool.reserve1;
        out.pool_tokens = pool.reserve0;
        out.px = px_from_sqrt(pool.sqrt, false).map(|x| x as u64).unwrap_or(0);
    } else {
        out.px = price_micro(m.sold as u128).map(|x| (x * 1000) as u64).unwrap_or(0); // µUSDC → px (1e9)
    }
    out
}

struct Before {
    m: Mkt,
    free: u64,
    entry_ts: i64,
    vault: u64,
    treasury: u64,
    reserved: u64,
    lock: Option<(UserId, u64)>,
    lp_player: Option<PlayerId>,
}

fn player_of(e: &Engine, c: &Cmd) -> Option<PlayerId> {
    match c {
        Cmd::BuyCurve { player, .. } | Cmd::SellCurve { player, .. } | Cmd::Buy { player, .. } | Cmd::Sell { player, .. } | Cmd::PlaceOrder { player, .. } | Cmd::AddLiquidity { player, .. } | Cmd::Claim { player, .. } | Cmd::CollectSeedFees { player } | Cmd::ListPlayer { player } => Some(*player),
        Cmd::RemoveLiquidity { position, .. } => e.lp(*position).map(|l| l.player),
        Cmd::CancelOrder { order, .. } => e.order(*order).map(|o| o.player),
        _ => None,
    }
}

fn user_of(c: &Cmd) -> Option<UserId> {
    match c {
        Cmd::Deposit { user, .. } | Cmd::Forced { user, .. } => Some(*user),
        c => c.signer().copied(),
    }
}

impl Before {
    fn of(e: &Engine, c: &Cmd) -> Before {
        let p = player_of(e, c);
        let u = user_of(c);
        let h = match (u, p) {
            (Some(u), Some(p)) => e.holding(&u, p),
            _ => Default::default(),
        };
        let lock = match c {
            Cmd::WithdrawPaid { id, .. } | Cmd::ReleaseLock { id, .. } | Cmd::WithdrawRequested { id } => e.locks().find(|(k, _)| *k == id).map(|(_, l)| (l.user, l.amount)),
            Cmd::ForcedUnpaid { index } => e.locks().find(|(k, _)| **k == score_engine::FORCED_ID_BIT | index).map(|(_, l)| (l.user, l.amount)),
            _ => None,
        };
        Before {
            m: p.map(|p| mkt(e, p)).unwrap_or_default(),
            free: u.map(|u| e.account(&u).free).unwrap_or(0),
            entry_ts: h.entry_ts,
            vault: e.vault(),
            treasury: e.treasury(),
            reserved: e.reserved(),
            lock,
            lp_player: p,
        }
    }
}

fn describe(b: &Before, e: &Engine, c: &Cmd, out: &Outcome, ts: i64) -> String {
    let p = b.lp_player.unwrap_or(0);
    let a = mkt(e, p);
    let moved = |x: u64, y: u64| if x == y { px(x) } else { format!("{}→{}", px(x), px(y)) };
    match (c, out) {
        (Cmd::Deposit { user, amount, seq }, _) => {
            format!("DEPOSIT {seq} (finalized on Solana): {} +{} → free {} · engine total {}", who(user), usd(*amount), usd(e.account(user).free), usd(e.custody()))
        }
        (Cmd::WithdrawPaid { id, seq }, _) => {
            let (u, amt) = b.lock.unwrap_or(([0; 32], 0));
            format!("PAYOUT {seq} (finalized): withdrawal #{id} left custody: {} −{} from on hold", who(&u), usd(amt))
        }
        (Cmd::LockWithdraw { user, amount, id, .. }, _) => {
            format!("WITHDRAW {}: {} moved free → on hold for permit #{id} (free {}→{})", who(user), usd(*amount), usd(b.free), usd(e.account(user).free))
        }
        (Cmd::BuyCurve { user, player, .. }, Outcome::Bought { tokens, cost, fee, graduated }) => {
            let mut s = format!(
                "ICO BUY {} P{player}: {} → {} (fee {} → treasury) · curve price {} · raised {} of $25,000",
                who(user),
                usd(cost + fee),
                tok(*tokens),
                usd(*fee),
                moved(b.m.px, if *graduated { a.px } else { mkt(e, *player).px }),
                usd(if *graduated { 25_000_000_000 } else { a.raised })
            );
            if *graduated {
                s += &format!(
                    "\nengine │      ★ P{player} GRADUATED: pool opens at {} with {} + {} (70% of the raise, locked forever) · dividend vault +{} · treasury +{} · the rest of this order bought from the new pool",
                    px(a.px),
                    usd(a.pool_usdc),
                    tok(a.pool_tokens),
                    usd(e.vault().saturating_sub(b.vault)),
                    usd(e.treasury().saturating_sub(b.treasury)),
                );
            }
            s
        }
        (Cmd::SellCurve { user, player, tokens, .. }, Outcome::Sold { usdc_out, fee }) => {
            format!("ICO SELL {} P{player}: {} → {} (fee {}: 90% vault, 10% treasury) · curve price {}", who(user), tok(*tokens), usd(*usdc_out), usd(*fee), moved(b.m.px, a.px))
        }
        (Cmd::Buy { user, player, .. }, Outcome::Traded { tokens, usdc, fee, .. }) => {
            let pool = a.pool_usdc.saturating_sub(b.m.pool_usdc);
            let book = (usdc - fee).saturating_sub(pool);
            format!(
                "BUY {} P{player}: {} → {} · routed: pool {} / order book {} · fee {} → treasury · price {}",
                who(user),
                usd(*usdc),
                tok(*tokens),
                usd(pool),
                usd(book),
                usd(*fee),
                moved(b.m.px, a.px)
            )
        }
        (Cmd::Sell { user, player, .. }, Outcome::Traded { tokens, usdc, tax, .. }) => {
            let pool = a.pool_tokens.saturating_sub(b.m.pool_tokens);
            let book = tokens.saturating_sub(pool);
            let rate = if usdc + tax > 0 { *tax as f64 * 100.0 / (usdc + tax) as f64 } else { 0.0 };
            let days = (ts - b.entry_ts).max(0) as f64 / 86_400.0;
            format!(
                "SELL {} P{player}: {} → {} · sell tax {} ({rate:.2}% after {days:.1} days held: 90% vault, 10% treasury) · routed: pool {} / order book {} · price {}",
                who(user),
                tok(*tokens),
                usd(*usdc),
                usd(*tax),
                tok(pool),
                tok(book),
                moved(b.m.px, a.px)
            )
        }
        (Cmd::PlaceOrder { user, player, side, px: limit, amount, .. }, Outcome::Traded { tokens, order, .. }) => {
            let what = if *side == Side::Bid { format!("buy with {}", usd(*amount)) } else { format!("sell {}", tok(*amount)) };
            let rest = match order {
                Some(id) => format!("rests on the book as order #{id}"),
                None => "filled completely, nothing rests".into(),
            };
            let now_filled = if *tokens > 0 { format!("{} filled at once, ", tok(*tokens)) } else { String::new() };
            format!("LIMIT ORDER {} P{player}: {what} at {} → {now_filled}{rest} · best bid/ask now {}/{}", who(user), px(*limit), e.book(*player).and_then(|bk| bk.bids.keys().next_back().copied()).map_or("—".into(), px), e.book(*player).and_then(|bk| bk.asks.keys().next().copied()).map_or("—".into(), px))
        }
        (Cmd::CancelOrder { user, order, .. }, _) => format!("CANCEL {} order #{order}: what it still held went back to the user", who(user)),
        (Cmd::AddLiquidity { user, player, lower_px, upper_px, .. }, Outcome::Liquidity { position, tokens, usdc, .. }) => {
            let range = if *lower_px == 0 && *upper_px == 0 { "full range".into() } else { format!("range {}–{}", px(*lower_px), px(*upper_px)) };
            format!("ADD LIQUIDITY {} P{player}: {} + {} into the pool ({range}) → position #{position} · earns 0.25% of trades through its range", who(user), usd(*usdc), tok(*tokens))
        }
        (Cmd::RemoveLiquidity { user, position, .. }, Outcome::Liquidity { tokens, usdc, .. }) => {
            format!("REMOVE LIQUIDITY {} position #{position} (P{p}): got back {} + {} (incl. its share of fees)", who(user), usd(*usdc), tok(*tokens))
        }
        (Cmd::Claim { user, round, player, .. }, Outcome::Claimed { usdc, tokens }) => {
            if *tokens > 0 {
                format!("CLAIM {} round {round} P{player}: took the dividend as {} (+10%, from the reserve); the USDC stays in the vault", who(user), tok(*tokens))
            } else {
                format!("CLAIM {} round {round} P{player}: {} dividend → free balance", who(user), usd(*usdc))
            }
        }
        (Cmd::ReleaseLock { id, .. }, _) => {
            let (u, amt) = b.lock.unwrap_or(([0; 32], 0));
            format!("RELEASE permit #{id} expired unused (checked on finalized state): {} back to {}'s free balance", usd(amt), who(&u))
        }
        (Cmd::WithdrawRequested { id }, _) => {
            let (u, amt) = b.lock.unwrap_or(([0; 32], 0));
            format!("LARGE WITHDRAWAL #{id} recorded on-chain for {} ({}): stays on hold until the next batch pays it", who(&u), usd(amt))
        }
        (Cmd::ListPlayer { player }, _) => format!("LIST P{player}: ICO opens; the curve starts at {}", px(mkt(e, *player).px)),
        (Cmd::PublishCalendar { round, lock_ts }, _) => format!("CALENDAR round {round}: kickoff snapshot at unix {lock_ts}"),
        (Cmd::Snapshot { round }, _) => {
            let parts: Vec<String> = e
                .markets()
                .filter_map(|(p, _)| e.kickoff_snapshot(*round, *p).map(|s| format!("P{p}: {} holders, {} at {}", s.holders.len(), tok(s.circulating), px(s.px))))
                .collect();
            format!("SNAPSHOT round {round} (exact kickoff balances; protocol seed excluded): {}", if parts.is_empty() { "no bonded players".into() } else { parts.join(" · ") })
        }
        (Cmd::RoundResult { round, payouts }, _) => {
            let set_aside = e.reserved().saturating_sub(b.reserved);
            let holders: usize = e.pending_rounds().filter(|(r, _)| *r == round).map(|(_, r)| r.credits.len()).sum();
            format!(
                "ROUND {round} RESULT: {} for {} → {} set aside from the vault for {holders} holders (rounded down) · vault {}→{} · credited only once the batch moving it into custody is final",
                usd(payouts.iter().map(|(_, a)| a).sum()),
                payouts.iter().map(|(p, _)| format!("P{p}")).collect::<Vec<_>>().join(", "),
                usd(set_aside),
                usd(b.vault),
                usd(e.vault())
            )
        }
        (Cmd::BatchFinalized { cut }, _) => {
            let credited = b.reserved.saturating_sub(e.reserved());
            if credited > 0 {
                format!("BATCH FINAL on Solana (covers up to #{cut}) → dividends credited: {} now claimable", usd(credited))
            } else {
                format!("BATCH FINAL on Solana (covers up to #{cut})")
            }
        }
        (Cmd::WithdrawTreasury { amount, seq }, _) => format!("TREASURY payout {seq} (finalized): {} out of the treasury", usd(*amount)),
        (Cmd::CollectSeedFees { player }, Outcome::SeedFees { usdc, tokens_burned }) => format!("SEED FEES P{player}: {} → treasury/vault, {} burned", usd(*usdc), tok(*tokens_burned)),
        (Cmd::SetPaused { paused }, _) => format!("TRADING {}", if *paused { "PAUSED" } else { "RESUMED" }),
        (Cmd::SetParams { .. }, _) => "PARAMS changed by admin".into(),
        (Cmd::Forced { index, user, kind, data }, out) => {
            let arg = u64::from_le_bytes(data[..8].try_into().unwrap_or_default());
            let asked = match *kind {
                score_engine::FORCED_WITHDRAW if arg == 0 => "withdraw everything free".to_string(),
                score_engine::FORCED_WITHDRAW => format!("withdraw {}", usd(arg)),
                score_engine::FORCED_CANCEL => format!("cancel order #{arg}"),
                k => format!("unknown kind {k}"),
            };
            let did = match out {
                Outcome::Locked { amount, .. } => format!("{} on hold; the committer pays it on-chain now", usd(*amount)),
                _ if *kind == score_engine::FORCED_CANCEL && b.free != e.account(user).free => "order cancelled".into(),
                _ => "nothing to do; answered on-chain with no effect".into(),
            };
            format!("FORCED REQUEST #{index} (posted on-chain by {}, finalized): {asked} → {did}", who(user))
        }
        (Cmd::ForcedUnpaid { index }, _) => {
            let (u, amt) = b.lock.unwrap_or(([0; 32], 0));
            format!("FORCED REQUEST #{index} answered without payment (no USDC account, or paused): {} back to {}'s free balance", usd(amt), who(&u))
        }
        (c, o) => format!("{c:?} → {o:?}"),
    }
}

/// Background priority, so it only uses CPU the engine thread doesn't need.
fn lowest_priority() {
    #[cfg(target_os = "macos")]
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_BACKGROUND, 0);
    }
    #[cfg(target_os = "linux")]
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, libc::gettid() as libc::id_t, 19);
    }
}
