//! HTTP API and live updates.
//!
//! User commands arrive as the exact bytes the user signed (`borsh(cmd)`, base64) plus the ed25519
//! signature; the sequencer checks the signature against the command's own `user` field. The
//! withdrawal flow is: prepare (voucher id + expiry) → the user signs `LockWithdraw` → the engine
//! puts the amount on hold → the node signs the permit → the user signs the Solana transaction →
//! the relayer co-signs as fee payer and sends it.
//!
//! Instant or request: decided when the hold is placed (`/v1/withdraw`, returned as `mode`), against
//! the finalized chain view PLUS every instant permit we've issued that the view doesn't show yet,
//! so a slightly old view can never make us promise an instant withdrawal the program will refuse.
//! On-chain pauses and exit mode are mirrored in memory (atomics), so these checks cost nothing.

// Handlers return early with ready HTTP responses; their size doesn't matter here.
#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
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

use crate::chain::Rpc;
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
    /// The program's payout counter in the view.
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
    /// On-chain state mirrored for free checks: exit mode, and the program's pause flags.
    pub exit: Arc<AtomicBool>,
    pub paused: Arc<AtomicU8>,
    pub trigger: Arc<Notify>,
    pub chain: Arc<Mutex<ChainCache>>,
    pub watch: Arc<Mutex<WatchStatus>>,
    pub batches: Arc<Mutex<BatchStatus>>,
    pub db: Arc<Mutex<DbStatus>>,
    pub relay: Arc<Mutex<RelayStatus>>,
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
        .with_state(app)
}

fn err(code: StatusCode, msg: impl ToString) -> Response {
    (code, Json(json!({"error": msg.to_string()}))).into_response()
}

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
    let (tx, kind) = match relayer::cosign(&bytes, &a.relayer) {
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
    };
    if blocked {
        return err(StatusCode::SERVICE_UNAVAILABLE, "paused on-chain; try again later");
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
