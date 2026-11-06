//! Chain watcher: applies on-chain facts to the engine only once FINALIZED, in the program's order.
//! `logsSubscribe` for speed, plus catch-up from history whenever the program's counters are ahead
//! (startup, reconnects, missed notifications), so nothing is ever lost.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use score_engine::{Cmd, Error, LockKind, Outcome};
use serde_json::{json, Value};
use solana_sdk::pubkey::Pubkey;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio_tungstenite::tungstenite::Message;

use crate::chain::{Rpc, FINALIZED};
use crate::core::Core;
use crate::program::{self, Addrs, Event};

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct WatchStatus {
    pub connected: bool,
    pub notifications: u64,
    pub backfills: u64,
    pub backfilled_txs: u64,
    pub deposits_applied: u64,
    pub payouts_applied: u64,
    pub forced_applied: u64,
    pub locks_released: u64,
    pub last_error: Option<String>,
}

enum Item {
    Events(Vec<Event>),
    Backfill,
}

pub fn spawn(core: Core, rpc: Rpc, addrs: Addrs, trigger: Arc<Notify>, exit: Arc<AtomicBool>, status: Arc<Mutex<WatchStatus>>) {
    let (tx, rx) = mpsc::unbounded_channel::<Item>();
    tokio::spawn(subscribe(rpc.ws_url(), tx.clone(), status.clone()));
    tokio::spawn(release_locks(core.clone(), rpc.clone(), addrs, status.clone()));
    let _ = tx.send(Item::Backfill); // catch up on anything that happened while we were down
    tokio::spawn(ingest(core, rpc, addrs, rx, trigger, exit, status));
}

async fn subscribe(url: String, tx: mpsc::UnboundedSender<Item>, status: Arc<Mutex<WatchStatus>>) {
    let program = program::program_id().to_string();
    loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                let sub = json!({"jsonrpc": "2.0", "id": 1, "method": "logsSubscribe", "params": [{"mentions": [program]}, {"commitment": FINALIZED}]});
                if ws.send(Message::Text(sub.to_string().into())).await.is_err() {
                    continue;
                }
                status.lock().await.connected = true;
                let _ = tx.send(Item::Backfill);
                let mut ping = tokio::time::interval(Duration::from_secs(20));
                loop {
                    tokio::select! {
                        _ = ping.tick() => { if ws.send(Message::Ping(vec![].into())).await.is_err() { break; } }
                        m = ws.next() => {
                            let Some(Ok(m)) = m else { break };
                            let Message::Text(t) = m else { continue };
                            let Ok(v) = serde_json::from_str::<Value>(&t) else { continue };
                            if v["method"] != "logsNotification" { continue; }
                            let val = &v["params"]["result"]["value"];
                            if !val["err"].is_null() { continue; } // failed transactions changed nothing
                            let logs: Vec<String> = val["logs"].as_array().map(|a| a.iter().filter_map(|l| l.as_str().map(String::from)).collect()).unwrap_or_default();
                            status.lock().await.notifications += 1;
                            let evs = program::parse_events(&logs);
                            if !evs.is_empty() { let _ = tx.send(Item::Events(evs)); }
                        }
                    }
                }
                status.lock().await.connected = false;
            }
            Err(e) => status.lock().await.last_error = Some(format!("websocket: {e}")),
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[derive(Default)]
struct Pending {
    deposits: BTreeMap<u64, (Pubkey, u64)>,
    payouts: BTreeMap<u64, (u8, u64, u64)>,
    requested: Vec<u64>,
    forced: BTreeMap<u64, (Pubkey, u8, [u8; 32])>,
    unpaid: Vec<u64>,
    exit: bool,
}

impl Pending {
    fn add(&mut self, evs: Vec<Event>) {
        for e in evs {
            match e {
                Event::Deposited { seq, user, amount } => {
                    self.deposits.insert(seq, (user, amount));
                }
                Event::Paid { seq, kind, id, amount } => {
                    self.payouts.insert(seq, (kind, id, amount));
                }
                Event::Requested { id } => self.requested.push(id),
                Event::Forced { index, user, kind, data } => {
                    self.forced.insert(index, (user, kind, data));
                }
                Event::ForcedServed { index, amount } => {
                    if amount == 0 {
                        self.unpaid.push(index);
                    }
                }
                Event::BatchCommitted => {}
                Event::ExitMode => self.exit = true,
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn ingest(core: Core, rpc: Rpc, addrs: Addrs, mut rx: mpsc::UnboundedReceiver<Item>, trigger: Arc<Notify>, exit: Arc<AtomicBool>, status: Arc<Mutex<WatchStatus>>) {
    let mut p = Pending::default();
    let mut tick = tokio::time::interval(Duration::from_millis(1500));
    let mut behind_since: Option<Instant> = None;
    loop {
        let mut backfill = false;
        tokio::select! {
            item = rx.recv() => match item {
                Some(Item::Events(evs)) => { p.add(evs); }
                Some(Item::Backfill) => backfill = true,
                None => return,
            },
            _ = tick.tick() => {
                if let Ok((Some(d), _)) = rpc.account(&addrs.state, FINALIZED).await {
                    if let Ok(st) = program::decode_state(&d) {
                        if st.in_exit_mode() { p.exit = true; }
                        let (dep, pay, frc) = core.read(|s| (s.engine.deposits(), s.engine.payouts(), s.engine.forced())).await;
                        let missing = (st.deposit_count > dep && !p.deposits.contains_key(&(dep + 1)))
                            || (st.payout_count > pay && !p.payouts.contains_key(&(pay + 1)))
                            || (st.forced_count > frc && !p.forced.contains_key(&(frc + 1)));
                        if missing {
                            let since = *behind_since.get_or_insert_with(Instant::now);
                            if since.elapsed() > Duration::from_secs(2) { backfill = true; }
                        } else {
                            behind_since = None;
                        }
                    }
                }
            }
        }
        if backfill {
            match catch_up(&rpc, &core, &addrs, &mut p).await {
                Ok(n) => {
                    if n > 0 {
                        eprintln!("watcher: caught up from history ({n} transactions read)");
                    }
                    let mut s = status.lock().await;
                    s.backfills += 1;
                    s.backfilled_txs += n;
                }
                Err(e) => status.lock().await.last_error = Some(format!("backfill: {e}")),
            }
            behind_since = None;
        }
        if p.exit && !exit.swap(true, Ordering::Relaxed) {
            eprintln!("watcher: EXIT MODE entered on-chain → the API stops taking orders, permits and relays; batches stop");
        }
        apply(&core, &mut p, &trigger, &status).await;
    }
}

/// Read program transactions newest → oldest until everything the engine is missing is seen.
async fn catch_up(rpc: &Rpc, core: &Core, addrs: &Addrs, p: &mut Pending) -> anyhow::Result<u64> {
    let (dep, pay, frc) = core.read(|s| (s.engine.deposits(), s.engine.payouts(), s.engine.forced())).await;
    let st = program::decode_state(&rpc.account(&addrs.state, FINALIZED).await?.0.ok_or_else(|| anyhow::anyhow!("no state account"))?)?;
    let need_dep = st.deposit_count > dep && !(dep + 1..=st.deposit_count).all(|k| p.deposits.contains_key(&k));
    let need_pay = st.payout_count > pay && !(pay + 1..=st.payout_count).all(|k| p.payouts.contains_key(&k));
    let need_frc = st.forced_count > frc && !(frc + 1..=st.forced_count).all(|k| p.forced.contains_key(&k));
    if !need_dep && !need_pay && !need_frc {
        return Ok(0);
    }
    let mut before: Option<String> = None;
    let mut fetched = 0u64;
    let (mut min_dep, mut min_pay, mut min_frc) = (u64::MAX, u64::MAX, u64::MAX);
    let program = program::program_id();
    loop {
        let page = rpc.signatures_for(&program, before.as_deref(), 200).await?;
        if page.is_empty() {
            break;
        }
        before = page.last().map(|x| x.0.clone());
        for (sig, _, failed) in &page {
            if *failed {
                continue;
            }
            if let Some(logs) = rpc.transaction_logs(sig).await? {
                fetched += 1;
                let evs = program::parse_events(&logs);
                for e in &evs {
                    match e {
                        Event::Deposited { seq, .. } => min_dep = min_dep.min(*seq),
                        Event::Paid { seq, .. } => min_pay = min_pay.min(*seq),
                        Event::Forced { index, .. } => min_frc = min_frc.min(*index),
                        _ => {}
                    }
                }
                // Requests seen in history are re-applied harmlessly (the lock stays non-expiring).
                p.add(evs);
            }
            if (!need_dep || min_dep <= dep + 1) && (!need_pay || min_pay <= pay + 1) && (!need_frc || min_frc <= frc + 1) {
                return Ok(fetched);
            }
        }
    }
    Ok(fetched)
}

async fn apply(core: &Core, p: &mut Pending, trigger: &Notify, status: &Arc<Mutex<WatchStatus>>) {
    let (mut dep, mut pay, mut frc) = core.read(|s| (s.engine.deposits(), s.engine.payouts(), s.engine.forced())).await;
    p.deposits.retain(|k, _| *k > dep);
    p.payouts.retain(|k, _| *k > pay);
    p.forced.retain(|k, _| *k > frc);
    while let Some((user, amount)) = p.deposits.remove(&(dep + 1)) {
        match core.submit(Cmd::Deposit { user: user.to_bytes(), amount, seq: dep + 1 }, None).await {
            Ok((seq, _)) => {
                eprintln!("watcher: deposit {} finalized → credited {} USDC to {} (log #{seq})", dep + 1, amount as f64 / 1e6, short(&user.to_string()));
                dep += 1;
                status.lock().await.deposits_applied += 1;
            }
            Err(e) => {
                status.lock().await.last_error = Some(format!("deposit {}: {e:?}", dep + 1));
                break;
            }
        }
    }
    // Forced requests before payouts: a forced withdrawal's payout needs its hold.
    let mut forced_any = false;
    while let Some((user, kind, data)) = p.forced.remove(&(frc + 1)) {
        match core.submit(Cmd::Forced { index: frc + 1, user: user.to_bytes(), kind, data }, None).await {
            Ok((seq, out)) => {
                let what = match out {
                    Outcome::Locked { amount, .. } => format!("{} USDC on hold", amount as f64 / 1e6),
                    _ => "nothing to hold".into(),
                };
                eprintln!("watcher: forced request {} finalized from {} (kind {kind}) → {what} (log #{seq}); answering it on-chain now", frc + 1, short(&user.to_string()));
                frc += 1;
                forced_any = true;
                status.lock().await.forced_applied += 1;
            }
            Err(e) => {
                status.lock().await.last_error = Some(format!("forced {}: {e:?}", frc + 1));
                break;
            }
        }
    }
    if forced_any {
        trigger.notify_one();
    }
    while let Some((kind, id, amount)) = p.payouts.remove(&(pay + 1)) {
        let cmd = match kind {
            program::PAYOUT_VOUCHER_KIND => Cmd::WithdrawPaid { id, seq: pay + 1 },
            program::PAYOUT_TREASURY_KIND => Cmd::WithdrawTreasury { amount, seq: pay + 1 },
            _ => break, // exit-mode payouts: the engine has stopped
        };
        match core.submit(cmd, None).await {
            Ok((seq, _)) => {
                eprintln!("watcher: payout {} finalized → {} {} USDC (log #{seq})", pay + 1, if kind == program::PAYOUT_VOUCHER_KIND { format!("withdrawal #{id} paid,") } else { "treasury withdrawal,".into() }, amount as f64 / 1e6);
                pay += 1;
                status.lock().await.payouts_applied += 1;
            }
            Err(e) => {
                status.lock().await.last_error = Some(format!("payout {}: {e:?}", pay + 1));
                break;
            }
        }
    }
    for id in std::mem::take(&mut p.requested) {
        match core.submit(Cmd::WithdrawRequested { id }, None).await {
            // Wake the committer only now that the engine holds the request: a batch posted
            // before this point wouldn't make the request payable.
            Ok(_) => {
                eprintln!("watcher: large withdrawal #{id} recorded on-chain → batch now");
                trigger.notify_one()
            }
            Err(Error::UnknownLock) => {}
            Err(e) => status.lock().await.last_error = Some(format!("request {id}: {e:?}")),
        }
    }
    let mut later = Vec::new();
    for index in std::mem::take(&mut p.unpaid) {
        match core.submit(Cmd::ForcedUnpaid { index }, None).await {
            Ok(_) => eprintln!("watcher: forced request {index} answered without payment (finalized) → its hold is back in the user's balance"),
            Err(Error::UnknownLock) => {} // nothing was held
            Err(Error::BadSequence) => later.push(index), // its request isn't applied yet
            Err(e) => status.lock().await.last_error = Some(format!("forced unpaid {index}: {e:?}")),
        }
    }
    p.unpaid = later;
}

/// Release expired, never-used locks: finalized state, at a block time past expiry, must show the
/// voucher unused, and the engine must already have applied every payout up to that state.
async fn release_locks(core: Core, rpc: Rpc, addrs: Addrs, status: Arc<Mutex<WatchStatus>>) {
    let mut tick = tokio::time::interval(Duration::from_secs(10));
    loop {
        tick.tick().await;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let due: Vec<(u64, i64)> = core
            .read(move |s| {
                let grace = s.engine.params.lock_grace_secs;
                s.engine
                    .locks()
                    .filter_map(|(id, l)| match l.kind {
                        LockKind::Permit { expiry } if now >= expiry.saturating_add(grace) => Some((*id, expiry)),
                        _ => None, // requests and forced holds are settled on-chain, never on a timer
                    })
                    .collect()
            })
            .await;
        for (id, expiry) in due {
            let r: anyhow::Result<()> = async {
                let (accs, slot) = rpc.accounts(&[addrs.state, program::page_address(id)], FINALIZED).await?;
                if rpc.block_time(slot).await? <= expiry {
                    return Ok(());
                }
                let st = program::decode_state(accs[0].as_deref().ok_or_else(|| anyhow::anyhow!("no state"))?)?;
                let used = match &accs[1] {
                    Some(d) => program::decode_page(d)?.is_set(id),
                    None => false,
                };
                if used {
                    return Ok(()); // paid or requested: its payout or request event settles it
                }
                if core.read(|s| s.engine.payouts()).await < st.payout_count {
                    return Ok(()); // wait until every payout up to this state is applied
                }
                core.submit(Cmd::ReleaseLock { id, payouts_through: st.payout_count }, None).await.map_err(|e| anyhow::anyhow!("{e:?}"))?;
                eprintln!("watcher: withdrawal #{id} expired unused (finalized) → money back to the user");
                status.lock().await.locks_released += 1;
                Ok(())
            }
            .await;
            if let Err(e) = r {
                status.lock().await.last_error = Some(format!("release {id}: {e}"));
            }
        }
    }
}

fn short(s: &str) -> String {
    format!("{}…{}", &s[..4], &s[s.len() - 4..])
}
