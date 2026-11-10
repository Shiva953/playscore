//! HTTP API and live updates. User commands arrive as the exact signed bytes (`borsh(cmd)`) plus
//! the ed25519 signature. Withdrawal: prepare → user signs `LockWithdraw` → hold → permit → user
//! signs the transaction → relayer co-signs and sends.

#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use ed25519_dalek::Signer as _;
use score_engine::fixed::px_from_sqrt;
use score_engine::{Cmd, Side, UserId};
use serde::Deserialize;
use serde_json::{json, Value};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use tokio::sync::{Mutex, Notify};

use crate::chain::{Rpc, FINALIZED};
use crate::committer::{hex, BatchStatus};
use crate::core::Core;
use crate::program::Addrs;
use crate::projector::DbStatus;
use crate::watcher::WatchStatus;
use crate::{program, relayer};

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct ChainCache {
    pub custody_balance: u64,
    pub unproven_payouts: u64,
    pub cap_min: u64,
    pub cap_bps: u64,
    pub voucher_max_ttl: i64,
    pub payout_count: u64,
    /// Instant permits issued that the view may not show yet, and their total.
    pub held_instant: u64,
    #[serde(skip)]
    pub instant: BTreeMap<u64, Held>,
}

#[derive(Debug, Clone, Copy)]
pub struct Held {
    pub amount: u64,
    pub expiry: i64,
}

impl ChainCache {
    /// Whether an instant withdrawal of `amount` stays within the program's exposure cap, counting
    /// our own permits not yet in the view (their payouts raise the unproven total and lower custody).
    pub fn fits_instant(&self, amount: u64) -> bool {
        let custody = self.custody_balance.saturating_sub(self.held_instant);
        let cap = self.cap_min.max((custody as u128 * self.cap_bps as u128 / 10_000) as u64);
        self.unproven_payouts.saturating_add(self.held_instant).saturating_add(amount) <= cap
    }
    pub fn hold(&mut self, id: u64, amount: u64, expiry: i64) {
        if self.instant.insert(id, Held { amount, expiry }).is_none() {
            self.held_instant += amount;
        }
    }
    pub fn release(&mut self, id: u64) {
        if let Some(h) = self.instant.remove(&id) {
            self.held_instant -= h.amount;
        }
    }
}

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct RelayStatus {
    pub accepted: u64,
    pub rejected: u64,
    pub landed: u64,
    pub failed: u64,
    pub last_error: Option<String>,
}

pub struct App {
    pub core: Core,
    pub rpc: Rpc,
    pub addrs: Addrs,
    pub relayer: Arc<Keypair>,
    pub operator: Arc<Keypair>,
    pub voucher: ed25519_dalek::SigningKey,
    pub admin_token: String,
    pub next_voucher: Arc<AtomicU64>,
    /// Mirrored on-chain exit mode and pause flags.
    pub exit: Arc<AtomicBool>,
    pub paused: Arc<AtomicU8>,
    pub trigger: Arc<Notify>,
    pub chain: Arc<Mutex<ChainCache>>,
    pub watch: Arc<Mutex<WatchStatus>>,
    pub batches: Arc<Mutex<BatchStatus>>,
    pub db: Arc<Mutex<DbStatus>>,
    pub relay: Arc<Mutex<RelayStatus>>,
    pub views: crate::views::Shared,
    /// When each user last had the relayer fund a recipient's token account (wallet sends).
    pub ata_creates: Arc<Mutex<std::collections::HashMap<Pubkey, Vec<i64>>>>,
    pub view_events: tokio::sync::broadcast::Sender<Value>,
}

type S = State<Arc<App>>;

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/v1/info", get(info))
        .route("/v1/engine", get(engine))
        .route("/v1/status", get(status))
        .route("/v1/users/{pk}", get(user))
        .route("/v1/markets/{player}", get(market))
        .route("/v1/cmd", post(cmd))
        .route("/v1/withdraw/prepare", post(prepare))
        .route("/v1/withdraw", post(withdraw))
        .route("/v1/relay", post(relay))
        .route("/v1/admin/cmd", post(admin))
        .route("/v1/stream", get(stream))
        .route("/v1/view/head", get(view_head))
        .route("/v1/view/markets", get(view_markets))
        .route("/v1/view/markets/{player}", get(view_market))
        .route("/v1/view/markets/{player}/history", get(view_history))
        .route("/v1/view/trades", get(view_trades))
        .route("/v1/view/users/{pk}", get(view_user))
        .route("/v1/view/users/{pk}/value", get(view_value))
        .route("/v1/view/stats", get(view_stats))
        .route("/v1/view/rounds/{round}/snapshot", get(view_snapshot))
        .route("/v1/view/results", get(view_results))
        .route("/v1/view/stream", get(view_stream))
        .route("/v1/quote", post(view_quote))
        .route("/v1/blockhash", get(blockhash))
        .route("/v1/wallet/{pk}", get(wallet))
        .route("/v1/tx/{sig}", get(tx_status))
        .layer(tower_http::cors::CorsLayer::new().allow_origin(tower_http::cors::Any).allow_methods(tower_http::cors::Any).allow_headers(tower_http::cors::Any).max_age(std::time::Duration::from_secs(7200)))
        .with_state(app)
}

fn err(code: StatusCode, msg: impl ToString) -> Response {
    (code, Json(json!({"error": msg.to_string()}))).into_response()
}

const MAX_ATA_CREATES_PER_DAY: usize = 5;

const EXIT_MSG: &str = "exit mode is on: the protocol is closed; withdraw on-chain with exit_withdraw";

fn b64(s: &str) -> Result<Vec<u8>, Response> {
    base64::engine::general_purpose::STANDARD.decode(s).map_err(|_| err(StatusCode::BAD_REQUEST, "bad base64"))
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn bs(u: &UserId) -> String {
    bs58::encode(u).into_string()
}

async fn info(State(a): S) -> Json<Value> {
    let ttl = a.chain.lock().await.voucher_max_ttl;
    Json(json!({
        "program": program::program_id().to_string(),
        "relayer": a.relayer.pubkey().to_string(),
        "operator": a.operator.pubkey().to_string(),
        "voucherSigner": bs58::encode(a.voucher.verifying_key().to_bytes()).into_string(),
        "usdcMint": a.addrs.usdc_mint.to_string(),
        "custody": a.addrs.custody.to_string(),
        "vault": a.addrs.vault.to_string(),
        "treasury": a.addrs.treasury.to_string(),
        "pending": a.addrs.pending.to_string(),
        "config": a.addrs.config.to_string(),
        "state": a.addrs.state.to_string(),
        "voucherMaxTtl": ttl,
    }))
}

async fn engine(State(a): S) -> Json<Value> {
    Json(
        a.core
            .read(|s| {
                let e = &s.engine;
                json!({
                    "applied": e.applied(), "head": hex(&s.head), "deposits": e.deposits(), "payouts": e.payouts(),
                    "custody": e.custody(), "vault": e.vault(), "treasury": e.treasury(), "reserved": e.reserved(),
                    "claimable": e.claimable(), "finalizedCut": e.finalized_cut(), "paused": e.paused(),
                    "stateRoot": hex(&score_engine::state_root::state_root(e)),
                    "locks": e.locks().count(),
                    "lastSnapshot": e.rounds().0, "lastResult": e.rounds().1,
                    "players": e.markets().map(|(p, _)| *p).collect::<Vec<_>>(),
                })
            })
            .await,
    )
}

async fn status(State(a): S) -> Json<Value> {
    Json(json!({
        "exitMode": a.exit.load(Ordering::Relaxed),
        "programPaused": a.paused.load(Ordering::Relaxed),
        "watcher": *a.watch.lock().await,
        "batches": *a.batches.lock().await,
        "db": *a.db.lock().await,
        "relay": *a.relay.lock().await,
        "chain": *a.chain.lock().await,
    }))
}

async fn user(State(a): S, Path(pk): Path<String>) -> Response {
    let Ok(pk) = pk.parse::<Pubkey>() else { return err(StatusCode::BAD_REQUEST, "bad pubkey") };
    let u = pk.to_bytes();
    Json(
        a.core
            .read(move |s| {
                let e = &s.engine;
                let acc = e.account(&u);
                json!({
                    "free": acc.free, "locked": acc.locked, "inOrders": acc.in_orders, "nonce": acc.nonce,
                    "openOrders": acc.open_orders, "lpPositions": acc.lp_positions,
                    "holdings": e.holdings().filter(|((o, _), _)| *o == u).map(|((_, p), h)| json!({"player": p, "amount": h.amount, "locked": h.locked, "entryTs": h.entry_ts})).collect::<Vec<_>>(),
                    "claims": e.claims().filter(|((o, _, _), _)| *o == u).map(|((_, r, p), v)| json!({"round": r, "player": p, "amount": v})).collect::<Vec<_>>(),
                    "orders": e.orders().filter(|(_, o)| o.user == u).map(|(id, o)| json!({"id": id, "player": o.player, "side": if o.side == Side::Bid {"bid"} else {"ask"}, "px": o.px, "remaining": o.remaining})).collect::<Vec<_>>(),
                    "lps": e.lps().filter(|(_, l)| l.owner == u).map(|(id, l)| json!({"id": id, "player": l.player, "liquidity": l.liquidity.to_string()})).collect::<Vec<_>>(),
                })
            })
            .await,
    )
    .into_response()
}

async fn market(State(a): S, Path(p): Path<u32>) -> Response {
    let v = a
        .core
        .read(move |s| {
            let e = &s.engine;
            let mk = e.market(p)?;
            let pool = e.pool(p);
            let book = e.book(p);
            Some(json!({
                "state": format!("{:?}", mk.state), "sold": mk.sold, "raised": mk.raised, "minted": mk.minted, "reserveLeft": mk.reserve_left,
                "px": pool.and_then(|x| px_from_sqrt(x.sqrt, false).ok()).map(|x| x as u64),
                "reserveTokens": pool.map(|x| x.reserve0), "reserveUsdc": pool.map(|x| x.reserve1),
                "bestBid": book.and_then(|b| b.bids.keys().next_back().copied()), "bestAsk": book.and_then(|b| b.asks.keys().next().copied()),
            }))
        })
        .await;
    match v {
        Some(v) => Json(v).into_response(),
        None => err(StatusCode::NOT_FOUND, "unknown player"),
    }
}

#[derive(Deserialize)]
struct Signed {
    cmd: String,
    sig: String,
}

fn decode_signed(body: &Signed) -> Result<(Cmd, [u8; 64]), Response> {
    let cmd: Cmd = borsh::from_slice(&b64(&body.cmd)?).map_err(|_| err(StatusCode::BAD_REQUEST, "undecodable command"))?;
    let sig: [u8; 64] = b64(&body.sig)?.try_into().map_err(|_| err(StatusCode::BAD_REQUEST, "signature must be 64 bytes"))?;
    if cmd.signer().is_none() {
        return Err(err(StatusCode::FORBIDDEN, "system commands are not accepted here"));
    }
    Ok((cmd, sig))
}

async fn cmd(State(a): S, Json(body): Json<Signed>) -> Response {
    if a.exit.load(Ordering::Relaxed) {
        return err(StatusCode::CONFLICT, EXIT_MSG);
    }
    let (cmd, sig) = match decode_signed(&body) {
        Ok(x) => x,
        Err(r) => return r,
    };
    if matches!(cmd, Cmd::LockWithdraw { .. }) {
        return err(StatusCode::BAD_REQUEST, "use /v1/withdraw");
    }
    match a.core.submit(cmd, Some(sig)).await {
        Ok((seq, outcome)) => Json(json!({"seq": seq, "outcome": outcome})).into_response(),
        Err(e) => err(StatusCode::UNPROCESSABLE_ENTITY, format!("{e:?}")),
    }
}

#[derive(Deserialize)]
struct Prepare {
    amount: u64,
}

/// Refuse withdrawals up front when the program would refuse them (no hold, nothing stuck).
fn withdrawals_closed(a: &App) -> Option<Response> {
    if a.exit.load(Ordering::Relaxed) {
        return Some(err(StatusCode::CONFLICT, EXIT_MSG));
    }
    if a.paused.load(Ordering::Relaxed) & program::PAUSE_WITHDRAWALS_ != 0 {
        return Some(err(StatusCode::SERVICE_UNAVAILABLE, "withdrawals are paused on-chain; try again later"));
    }
    None
}

async fn prepare(State(a): S, Json(p): Json<Prepare>) -> Response {
    if let Some(r) = withdrawals_closed(&a) {
        return r;
    }
    let (instant, ttl) = {
        let c = a.chain.lock().await;
        (c.fits_instant(p.amount), c.voucher_max_ttl)
    };
    let id = a.next_voucher.fetch_add(1, Ordering::SeqCst);
    let ttl = ttl.clamp(60, 600);
    // `mode` here is a hint; the one returned by /v1/withdraw is what counts.
    Json(json!({"id": id, "expiry": now() + (ttl - 30).max(30), "mode": if instant {"instant"} else {"request"}, "page": program::page_address(id).to_string()})).into_response()
}

async fn withdraw(State(a): S, Json(body): Json<Signed>) -> Response {
    let (cmd, sig) = match decode_signed(&body) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let Cmd::LockWithdraw { user, amount, id, expiry, .. } = cmd else { return err(StatusCode::BAD_REQUEST, "expected LockWithdraw") };
    if let Some(r) = withdrawals_closed(&a) {
        return r;
    }
    // Decide and reserve in one step, so concurrent withdrawals can't both take the last room.
    let instant = {
        let mut c = a.chain.lock().await;
        let t = now();
        if expiry <= t + 20 || expiry > t + c.voucher_max_ttl {
            return err(StatusCode::BAD_REQUEST, "expiry outside the allowed window");
        }
        let instant = c.fits_instant(amount);
        if instant {
            c.hold(id, amount, expiry);
        }
        instant
    };
    match a.core.submit(cmd, Some(sig)).await {
        Ok((seq, _)) => {
            let msg = program::voucher_message(&Pubkey::new_from_array(user), amount, id, expiry);
            let vsig = a.voucher.sign(&msg).to_bytes();
            let mode = if instant { "instant" } else { "request" };
            Json(json!({"seq": seq, "id": id, "amount": amount, "expiry": expiry, "mode": mode, "voucherSig": base64::engine::general_purpose::STANDARD.encode(vsig)})).into_response()
        }
        Err(e) => {
            if instant {
                a.chain.lock().await.release(id);
            }
            err(StatusCode::UNPROCESSABLE_ENTITY, format!("{e:?}"))
        }
    }
}

#[derive(Deserialize)]
struct Relay {
    tx: String,
}

async fn relay(State(a): S, Json(r): Json<Relay>) -> Response {
    let bytes = match b64(&r.tx) {
        Ok(b) => b,
        Err(e) => return e,
    };
    if a.exit.load(Ordering::Relaxed) {
        return err(StatusCode::CONFLICT, EXIT_MSG);
    }
    let (tx, kind) = match relayer::cosign(&bytes, &a.relayer, &a.addrs.usdc_mint) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("relayer: REFUSED a transaction: {e}");
            let mut s = a.relay.lock().await;
            s.rejected += 1;
            s.last_error = Some(e.to_string());
            return err(StatusCode::FORBIDDEN, e);
        }
    };
    // Don't pay fees for a transaction the program will refuse while paused.
    let paused = a.paused.load(Ordering::Relaxed);
    let blocked = match kind {
        relayer::Kind::Deposit => paused & program::PAUSE_DEPOSITS_ != 0,
        relayer::Kind::Withdraw | relayer::Kind::Request => paused & program::PAUSE_WITHDRAWALS_ != 0,
        relayer::Kind::Send { .. } | relayer::Kind::WithdrawTo { .. } => false, // a pause doesn't apply to the address it pays
    };
    if blocked {
        return err(StatusCode::SERVICE_UNAVAILABLE, "paused on-chain; try again later");
    }
    // Each new recipient account costs the relayer ~0.002 SOL of rent: a few per user per day.
    if let Some((user, true)) = match kind {
        relayer::Kind::Send { user, creates } => Some((user, creates)),
        // The user's own signature is key #1 in both shapes.
        relayer::Kind::WithdrawTo { creates } => Some((tx.message.static_account_keys()[1], creates)),
        _ => None,
    } {
        let t = now();
        let mut m = a.ata_creates.lock().await;
        let mine = m.entry(user).or_default();
        mine.retain(|x| t - *x < 86_400);
        if mine.len() >= MAX_ATA_CREATES_PER_DAY {
            return err(StatusCode::TOO_MANY_REQUESTS, format!("you can send to {MAX_ATA_CREATES_PER_DAY} new addresses a day; try again tomorrow"));
        }
        mine.push(t);
    }
    let sig = tx.signatures[0];
    if let Err(e) = a.rpc.send_raw(&tx).await {
        return err(StatusCode::BAD_GATEWAY, e);
    }
    a.relay.lock().await.accepted += 1;
    eprintln!("relayer: co-signed and sent {sig}");
    let (rpc, stats) = (a.rpc.clone(), a.relay.clone());
    tokio::spawn(async move {
        let limit = rpc.block_height().await.unwrap_or(0) + 160;
        match rpc.send_until_finalized(&tx, limit).await {
            Ok(_) => stats.lock().await.landed += 1,
            Err(e) => {
                let mut s = stats.lock().await;
                s.failed += 1;
                s.last_error = Some(e.to_string());
            }
        }
    });
    Json(json!({"signature": sig.to_string()})).into_response()
}

#[derive(Deserialize)]
struct Admin {
    cmd: String,
}

async fn admin(State(a): S, headers: HeaderMap, Json(body): Json<Admin>) -> Response {
    if headers.get("x-admin-token").and_then(|v| v.to_str().ok()) != Some(a.admin_token.as_str()) {
        return err(StatusCode::UNAUTHORIZED, "bad admin token");
    }
    let cmd: Cmd = match b64(&body.cmd).and_then(|b| borsh::from_slice(&b).map_err(|_| err(StatusCode::BAD_REQUEST, "undecodable command"))) {
        Ok(c) => c,
        Err(r) => return r,
    };
    // Oracle and admin commands only. Chain facts come only from the watcher and committer.
    let allowed = matches!(
        cmd,
        Cmd::ListPlayer { .. } | Cmd::PublishCalendar { .. } | Cmd::Snapshot { .. } | Cmd::RoundResult { .. } | Cmd::SetPaused { .. } | Cmd::SetParams { .. } | Cmd::CollectSeedFees { .. }
    );
    if !allowed {
        return err(StatusCode::FORBIDDEN, "command not allowed on the admin channel");
    }
    let is_result = matches!(cmd, Cmd::RoundResult { .. });
    match a.core.submit(cmd, None).await {
        Ok((seq, outcome)) => {
            if is_result {
                a.trigger.notify_one(); // post a batch now, so dividends are credited in ~1 s
            }
            Json(json!({"seq": seq, "outcome": outcome})).into_response()
        }
        Err(e) => err(StatusCode::UNPROCESSABLE_ENTITY, format!("{e:?}")),
    }
}

async fn stream(State(a): S, ws: WebSocketUpgrade) -> Response {
    let rx = a.core.records.subscribe();
    ws.on_upgrade(move |socket| pump(socket, rx))
}

async fn pump(mut socket: WebSocket, mut rx: tokio::sync::broadcast::Receiver<Arc<score_engine::wal::Record>>) {
    while let Ok(r) = rx.recv().await {
        let user = match &r.cmd {
            Cmd::Deposit { user, .. } => Some(bs(user)),
            c => c.signer().map(bs),
        };
        let kind = serde_json::to_value(&r.cmd).ok().and_then(|v| v.as_object().and_then(|o| o.keys().next().cloned())).unwrap_or_default();
        let msg = json!({"seq": r.seq, "ts": r.ts, "kind": kind, "user": user, "cmd": r.cmd});
        if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
            return;
        }
    }
}

// ------------------------------------------------------------------ app read model (views.rs)

#[derive(Deserialize, Default)]
struct ViewQ {
    user: Option<String>,
    after: Option<u64>,
    range: Option<String>,
    player: Option<u32>,
    limit: Option<usize>,
}

fn pk_of(s: &Option<String>) -> Option<UserId> {
    s.as_deref().and_then(|x| x.parse::<Pubkey>().ok()).map(|p| p.to_bytes())
}

fn window(range: Option<&str>) -> i64 {
    match range.unwrap_or("24H") {
        "1H" => 3_600,
        "24H" => 86_400,
        "3D" => 3 * 86_400,
        "6D" => 6 * 86_400,
        "7D" => 7 * 86_400,
        _ => 0,
    }
}

/// Wait until the read model has applied `after` (read-your-writes after a command), up to 2 s.
async fn caught_up(a: &App, after: Option<u64>) {
    let Some(after) = after else { return };
    for _ in 0..400 {
        if a.views.read().unwrap().seq >= after {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
}

async fn view_head(State(a): S) -> Json<Value> {
    let v = a.views.read().unwrap();
    Json(json!({"seq": v.seq, "ready": v.ready, "ts": now()}))
}

async fn view_markets(State(a): S, Query(q): Query<ViewQ>) -> Json<Value> {
    caught_up(&a, q.after).await;
    let v = a.views.read().unwrap();
    let t = now();
    let list: Vec<Value> = v.engine.markets().filter_map(|(p, _)| crate::views::market_json(&v, *p, t)).collect();
    Json(json!({"seq": v.seq, "markets": list}))
}

async fn view_market(State(a): S, Path(p): Path<u32>, Query(q): Query<ViewQ>) -> Response {
    caught_up(&a, q.after).await;
    let me = pk_of(&q.user);
    let v = a.views.read().unwrap();
    match crate::views::detail_json(&v, p, me.as_ref(), now()) {
        Some(x) => Json(x).into_response(),
        None => err(StatusCode::NOT_FOUND, "unknown player"),
    }
}

async fn view_history(State(a): S, Path(p): Path<u32>, Query(q): Query<ViewQ>) -> Json<Value> {
    let v = a.views.read().unwrap();
    Json(crate::views::history_json(&v, p, window(q.range.as_deref()), now(), q.limit.unwrap_or(240).clamp(10, 1_000)))
}

async fn view_trades(State(a): S, Query(q): Query<ViewQ>) -> Json<Value> {
    let me = pk_of(&q.user);
    let v = a.views.read().unwrap();
    let n = q.limit.unwrap_or(30).min(300);
    let list: Vec<Value> = match q.player {
        Some(p) => v.markets.get(&p).map(|m| m.trades.iter().take(n).map(|t| crate::views::trade_json(t, me.as_ref())).collect()).unwrap_or_default(),
        None => v.tape.iter().take(n).map(|t| crate::views::trade_json(t, me.as_ref())).collect(),
    };
    Json(json!(list))
}

async fn view_user(State(a): S, Path(pk): Path<String>, Query(q): Query<ViewQ>) -> Response {
    let Ok(pk) = pk.parse::<Pubkey>() else { return err(StatusCode::BAD_REQUEST, "bad pubkey") };
    caught_up(&a, q.after).await;
    let v = a.views.read().unwrap();
    Json(crate::views::user_json(&v, &pk.to_bytes())).into_response()
}

async fn view_value(State(a): S, Path(pk): Path<String>, Query(q): Query<ViewQ>) -> Response {
    let Ok(pk) = pk.parse::<Pubkey>() else { return err(StatusCode::BAD_REQUEST, "bad pubkey") };
    let v = a.views.read().unwrap();
    Json(crate::views::value_json(&v, &pk.to_bytes(), window(q.range.as_deref()), now())).into_response()
}

async fn view_stats(State(a): S) -> Json<Value> {
    let v = a.views.read().unwrap();
    Json(crate::views::stats_json(&v, now()))
}

async fn view_snapshot(State(a): S, Path(round): Path<u32>, Query(q): Query<ViewQ>) -> Json<Value> {
    let me = pk_of(&q.user);
    let v = a.views.read().unwrap();
    Json(crate::views::snapshot_json(&v, round, me.as_ref()))
}

async fn view_results(State(a): S, Query(q): Query<ViewQ>) -> Json<Value> {
    let me = pk_of(&q.user);
    let v = a.views.read().unwrap();
    Json(crate::views::results_json(&v, q.limit.unwrap_or(10).min(60), me.as_ref()))
}

#[derive(Deserialize)]
struct QuoteBody {
    kind: String,
    user: Option<String>,
    player: u32,
    #[serde(default)]
    usdc: u64,
    #[serde(default)]
    tokens: u64,
    #[serde(default)]
    position: u64,
    #[serde(default)]
    fraction: f64,
}

async fn view_quote(State(a): S, Json(b): Json<QuoteBody>) -> Json<Value> {
    // Signed out: a stand-in key (never the protocol's all-zero one).
    let user = pk_of(&b.user).unwrap_or([1u8; 32]);
    let q = crate::views::QuoteIn { kind: b.kind, user, player: b.player, usdc: b.usdc, tokens: b.tokens, position: b.position, fraction: if b.fraction == 0.0 { 1.0 } else { b.fraction } };
    let v = a.views.read().unwrap();
    let mut out = crate::views::quote(&v, &q, now().max(v.last_ts));
    out["seq"] = json!(v.seq);
    Json(out)
}

/// A recent blockhash for user transactions (the browser needs no RPC key).
async fn blockhash(State(a): S) -> Response {
    match a.rpc.call("getLatestBlockhash", json!([{"commitment": "confirmed"}])).await {
        Ok(v) => Json(json!({"blockhash": v["value"]["blockhash"], "lastValidBlockHeight": v["value"]["lastValidBlockHeight"]})).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

/// A wallet's test USDC (its associated token account) at finalized and confirmed, plus whether
/// the account exists. Base units.
async fn wallet(State(a): S, Path(pk): Path<String>) -> Response {
    let Ok(owner) = pk.parse::<Pubkey>() else { return err(StatusCode::BAD_REQUEST, "bad pubkey") };
    let token_program: Pubkey = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA".parse().unwrap();
    let ata_program: Pubkey = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL".parse().unwrap();
    let (ata, _) = Pubkey::find_program_address(&[owner.as_ref(), token_program.as_ref(), a.addrs.usdc_mint.as_ref()], &ata_program);
    let read = |c: &'static str| {
        let rpc = a.rpc.clone();
        async move { rpc.account(&ata, c).await.map(|(d, _)| d.map(|d| u64::from_le_bytes(d[64..72].try_into().unwrap_or_default()))) }
    };
    let (fin, conf) = tokio::join!(read(FINALIZED), read("confirmed"));
    match (fin, conf) {
        (Ok(f), Ok(c)) => Json(json!({"ata": ata.to_string(), "exists": c.is_some() || f.is_some(), "finalized": f.unwrap_or(0), "confirmed": c.unwrap_or(0)})).into_response(),
        (Err(e), _) | (_, Err(e)) => err(StatusCode::BAD_GATEWAY, e),
    }
}

/// Status of a relayed transaction: "processed" | "confirmed" | "finalized" | "failed" | "unknown".
async fn tx_status(State(a): S, Path(sig): Path<String>) -> Response {
    let Ok(sig) = sig.parse::<solana_sdk::signature::Signature>() else { return err(StatusCode::BAD_REQUEST, "bad signature") };
    match a.rpc.status(&sig).await {
        Ok(None) => Json(json!({"status": "unknown"})).into_response(),
        Ok(Some((level, e))) => Json(json!({"status": if e.is_some() { "failed".to_string() } else { level }, "error": e})).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

async fn view_stream(State(a): S, ws: WebSocketUpgrade) -> Response {
    let rx = a.view_events.subscribe();
    let seq = a.views.read().unwrap().seq;
    ws.on_upgrade(move |socket| view_pump(socket, rx, seq))
}

async fn view_pump(mut socket: WebSocket, mut rx: tokio::sync::broadcast::Receiver<Value>, seq: u64) {
    if socket.send(Message::Text(json!({"type": "hello", "seq": seq}).to_string().into())).await.is_err() {
        return;
    }
    let mut ping = tokio::time::interval(std::time::Duration::from_secs(20));
    loop {
        tokio::select! {
            r = rx.recv() => match r {
                Ok(v) => {
                    if socket.send(Message::Text(v.to_string().into())).await.is_err() {
                        return;
                    }
                }
                // Too slow: tell the client to refetch everything.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if socket.send(Message::Text(json!({"type": "resync"}).to_string().into())).await.is_err() {
                        return;
                    }
                }
                Err(_) => return,
            },
            _ = ping.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ChainCache;

    /// The instant/request decision counts our own permits the (finalized, slightly old) view
    /// doesn't show yet, so two quick withdrawals can't both take the last room under the cap.
    #[test]
    fn instant_room_counts_permits_not_yet_in_the_view() {
        // custody 100,000 → cap = max(1,000, 2%) = 2,000; 500 already unproven.
        let mut c = ChainCache { custody_balance: 100_000, cap_min: 1_000, cap_bps: 200, unproven_payouts: 500, ..Default::default() };
        assert!(c.fits_instant(1_500));
        assert!(!c.fits_instant(1_501));
        c.hold(1, 1_000, 0);
        // Same old view: 500 + 1,000 held; custody will drop by the 1,000, so the cap is 1,980.
        assert!(c.fits_instant(480));
        assert!(!c.fits_instant(481));
        c.hold(1, 1_000, 0); // the same permit twice counts once
        assert_eq!(c.held_instant, 1_000);
        c.release(1);
        c.release(1);
        assert_eq!(c.held_instant, 0);
        assert!(c.fits_instant(1_500));
    }
}
