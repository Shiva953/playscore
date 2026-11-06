//! score-node: the score backend in one process (Phase 1, devnet).
//!
//! Engine + log (one thread, group-committed to disk) · HTTP API and live updates · permit signer ·
//! relayer · chain watcher (finalized only) · batch committer · Postgres writer (optional).
//!
//! Run from the repo root: `cargo run --release --manifest-path backend/Cargo.toml`.
//! Config (env, or `.env.local` / `.env`): `NEXT_PUBLIC_SOLANA_RPC_DEVNET` or `DEVNET_RPC` (Helius
//! devnet URL), optional `DATABASE_URL`, `SCORE_PORT` (8787), `SCORE_WAL` (.devnet/node/wal.log).
//! Keys from `.devnet/` (created by `bun run devnet:setup`).

mod api;
mod chain;
mod committer;
mod core;
mod engine_log;
mod pg_tls;
mod program;
mod projector;
mod relayer;
mod snapshot;
mod watcher;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use solana_sdk::signature::Signer;
use tokio::sync::{Mutex, Notify};

use crate::api::{App, ChainCache};
use crate::chain::{load_keypair, Rpc, FINALIZED};

fn load_env() {
    for f in [".env.local", ".env"] {
        let Ok(text) = std::fs::read_to_string(f) else { continue };
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('#') || !line.contains('=') {
                continue;
            }
            let (k, v) = line.split_once('=').unwrap();
            let v = v.trim().trim_matches('"').trim_matches('\'');
            if std::env::var(k.trim()).is_err() && !v.is_empty() {
                std::env::set_var(k.trim(), v);
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    load_env();
    let url = std::env::var("DEVNET_RPC").or_else(|_| std::env::var("NEXT_PUBLIC_SOLANA_RPC_DEVNET")).context("set NEXT_PUBLIC_SOLANA_RPC_DEVNET (Helius devnet URL) in .env.local")?;
    let rpc = Rpc::new(&url);
    let operator = Arc::new(load_keypair(".devnet/operator.json")?);
    let relayer = Arc::new(load_keypair(".devnet/relayer.json")?);
    let voucher_kp = load_keypair(".devnet/voucher.json")?;
    let voucher = ed25519_dalek::SigningKey::from_bytes(&voucher_kp.secret_bytes()[..32].try_into()?);
    let admin_token = std::fs::read_to_string(".devnet/admin-token").context("missing .devnet/admin-token: run bun run devnet:setup")?.trim().to_string();

    // The deployment, and a check that our keys are the ones the program trusts.
    let (cfg, _) = rpc.account(&score::constants::CONFIG_ADDRESS, FINALIZED).await?;
    let cfg = program::decode_config(&cfg.context("program not initialized: run bun run devnet:setup")?)?;
    if cfg.keys.operator != operator.pubkey() || cfg.keys.voucher_signer.to_bytes() != voucher.verifying_key().to_bytes() {
        bail!("the program's operator / voucher keys don't match .devnet/");
    }
    let addrs = program::Addrs::from_config(&cfg);

    let wal = PathBuf::from(std::env::var("SCORE_WAL").unwrap_or_else(|_| ".devnet/node/wal.log".into()));
    let t0 = std::time::Instant::now();
    let (core, rec) = core::Core::start(&wal)?;
    let how = match rec.snapshot {
        Some(s) => format!(" (from the snapshot at #{s}, then re-applied {} with signatures checked)", rec.replayed),
        None => " (whole log, signatures checked)".into(),
    };
    eprintln!("log: {} records replayed in {:?}, head {}{how}", rec.records, t0.elapsed(), committer::hex(&rec.head));

    let trigger = Arc::new(Notify::new());
    let chain_cache = Arc::new(Mutex::new(ChainCache { voucher_max_ttl: cfg.limits.voucher_max_ttl, cap_min: cfg.limits.exposure_cap_min, cap_bps: cfg.limits.exposure_cap_bps, ..Default::default() }));
    let watch = Arc::new(Mutex::new(watcher::WatchStatus::default()));
    let batches = Arc::new(Mutex::new(committer::BatchStatus::default()));
    let db = Arc::new(Mutex::new(projector::DbStatus::default()));
    let exit = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicU8::new(0));

    watcher::spawn(core.clone(), rpc.clone(), addrs, trigger.clone(), exit.clone(), watch.clone());
    committer::spawn(core.clone(), rpc.clone(), addrs, operator.clone(), trigger.clone(), exit.clone(), batches.clone());
    // The background follower: snapshots for fast restarts, and the engine log if asked.
    engine_log::spawn(wal.clone(), core.records.subscribe(), std::env::var("SCORE_ENGINE_LOG").is_ok_and(|v| v == "1"));
    projector::spawn(std::env::var("DATABASE_URL").ok().filter(|s| !s.is_empty()), wal.clone(), core.records.subscribe(), db.clone());

    // The chain view for the withdrawal flow (exposure-cap inputs, pause flags, exit mode),
    // refreshed from finalized state. Instant permits stay counted until the view shows their
    // payout (the program's payout counter has reached it), or they can no longer be used.
    {
        let (rpc, cache, a, exit, paused) = (rpc.clone(), chain_cache.clone(), addrs, exit.clone(), paused.clone());
        let mut rx = core.records.subscribe();
        tokio::spawn(async move {
            let mut paid: Vec<(u64, u64)> = Vec::new();
            loop {
                let mut gone = Vec::new();
                loop {
                    match rx.try_recv() {
                        Ok(r) => match r.cmd {
                            score_engine::Cmd::WithdrawPaid { id, seq } => paid.push((id, seq)),
                            score_engine::Cmd::ReleaseLock { id, .. } | score_engine::Cmd::WithdrawRequested { id } => gone.push(id),
                            _ => {}
                        },
                        Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => continue, // missed ones expire below
                        Err(_) => break,
                    }
                }
                let view = rpc.accounts(&[a.state, a.custody], FINALIZED).await;
                let mut c = cache.lock().await;
                for id in gone {
                    c.release(id); // expired unused, or used as a request: never an instant payout
                }
                if let Ok((accs, _)) = view {
                    if let (Some(Some(sd)), Some(Some(cd))) = (accs.first(), accs.get(1)) {
                        if let Ok(st) = program::decode_state(sd) {
                            c.unproven_payouts = st.payout_total.saturating_sub(st.committed_payout_total);
                            c.custody_balance = u64::from_le_bytes(cd[64..72].try_into().unwrap_or_default());
                            c.payout_count = st.payout_count;
                            paused.store(st.paused, Ordering::Relaxed);
                            if st.in_exit_mode() {
                                exit.store(true, Ordering::Relaxed);
                            }
                            paid.retain(|(id, seq)| {
                                let shown = *seq <= st.payout_count;
                                if shown {
                                    c.release(*id);
                                }
                                !shown
                            });
                        }
                    }
                }
                // A permit can't be paid after its expiry; two minutes later the view has it.
                let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
                let stale: Vec<u64> = c.instant.iter().filter(|(_, h)| t > h.expiry + 120).map(|(id, _)| *id).collect();
                for id in stale {
                    c.release(id);
                }
                drop(c);
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
        });
    }

    // Keep the voucher page of the next permit id, and the one after it, created ahead of use.
    let next_voucher = Arc::new(AtomicU64::new(rec.max_voucher_id + 1));
    {
        let (rpc, relayer, next) = (rpc.clone(), relayer.clone(), next_voucher.clone());
        tokio::spawn(async move {
            loop {
                let page = next.load(Ordering::Relaxed) / program::PAGE_BITS_;
                for p in [page, page + 1] {
                    let addr = program::pda(&[score::constants::PAGE_SEED, &p.to_le_bytes()]);
                    if let Ok((None, _)) = rpc.account(&addr, FINALIZED).await {
                        let mut ixs = program::compute_budget(30_000, 20_000).to_vec();
                        ixs.push(program::init_voucher_page(relayer.pubkey(), p));
                        match rpc.run(&relayer, &[], ixs).await {
                            Ok(_) => eprintln!("voucher page {p} created"),
                            Err(e) => eprintln!("voucher page {p}: {e:#}"),
                        }
                    }
                }
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        });
    }

    let app = Arc::new(App {
        core,
        rpc,
        addrs,
        relayer,
        operator,
        voucher,
        admin_token,
        next_voucher,
        exit,
        paused,
        trigger,
        chain: chain_cache,
        watch,
        batches,
        db,
        relay: Arc::new(Mutex::new(Default::default())),
    });
    let port: u16 = std::env::var("SCORE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    eprintln!("score-node listening on http://127.0.0.1:{port}");
    axum::serve(listener, api::router(app)).await?;
    Ok(())
}
