//! Batch committer: every 10 s, or at once for a round result, large withdrawal or forced request.
//! Posts the engine's snapshot with `commit_batch`, waits for FINALIZED, then sends `BatchFinalized`
//! and settles payable requests. Forced requests are answered with `serve_forced` inside the batch
//! transaction when they fit, otherwise right after it.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use score::state::{Batch, State};
use score_engine::{exit::exit_root, state_root::state_root, Cmd, LockKind};
use solana_sdk::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use tokio::sync::{Mutex, Notify};

use crate::chain::{Rpc, FINALIZED};
use crate::core::Core;
use crate::program::{self, Addrs};

const TX_LIMIT: usize = 1232;
const SERVE_PER_PASS: u64 = 16;
const SERVE_CU: u32 = 15_000;

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct BatchStatus {
    pub batches: u64,
    pub last_seq: u64,
    pub last_cut: u64,
    pub last_state_root: String,
    pub last_signature: String,
    pub last_ms: u64,
    pub settled_requests: u64,
    pub forced_served: u64,
    pub last_error: Option<String>,
}

struct Snap {
    cut: u64,
    head: [u8; 32],
    state_root: [u8; 32],
    exit_root: [u8; 32],
    deposits: u64,
    payouts: u64,
    custody: u64,
    vault: u64,
    treasury: u64,
    /// Large-withdrawal requests the engine holds (voucher ids).
    requested: Vec<u64>,
    /// Forced requests the engine has applied, and what it holds for each (index → amount).
    forced: u64,
    forced_holds: BTreeMap<u64, u64>,
}

struct Serve {
    index: u64,
    user: Pubkey,
    pay_to: Option<Pubkey>,
    amount: u64,
}

pub fn spawn(core: Core, rpc: Rpc, addrs: Addrs, operator: Arc<Keypair>, trigger: Arc<Notify>, exit: Arc<AtomicBool>, status: Arc<Mutex<BatchStatus>>) {
    tokio::spawn(async move {
        let mut last_cut = 0u64;
        let mut last_commit = Instant::now() - Duration::from_secs(3600);
        let mut served = 0u64;
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(10)) => {}
                _ = trigger.notified() => {}
            }
            if exit.load(Ordering::Relaxed) {
                continue; // exit mode: the program accepts no more batches
            }
            let snap = core
                .read(|s| {
                    let e = &s.engine;
                    Snap {
                        cut: e.applied(),
                        head: s.head,
                        state_root: state_root(e),
                        exit_root: exit_root(e).expect("exit table"),
                        deposits: e.deposits(),
                        payouts: e.payouts(),
                        custody: e.custody(),
                        vault: e.vault(),
                        treasury: e.treasury(),
                        requested: e.locks().filter(|(_, l)| l.kind == LockKind::Requested).map(|(id, _)| *id).collect(),
                        forced: e.forced(),
                        forced_holds: e.locks().filter(|(_, l)| l.kind == LockKind::Forced).map(|(id, l)| (id & !program::FORCED_ID_BIT_, l.amount)).collect(),
                    }
                })
                .await;
            let idle = snap.cut == last_cut;
            if idle && snap.requested.is_empty() && snap.forced <= served && last_commit.elapsed() < Duration::from_secs(3600) {
                continue;
            }
            let t0 = Instant::now();
            // Settle and answer in the batch transaction; if that fails, the batch goes alone.
            let first = settle_candidate(&rpc, &addrs, &snap.requested).await;
            let mut extras = false;
            let mut res = commit(&rpc, &addrs, &operator, &snap, idle, first, true, &mut extras).await;
            let mut res_settled = res.is_ok();
            if res.is_err() && extras {
                res = commit(&rpc, &addrs, &operator, &snap, idle, None, false, &mut extras).await;
                res_settled = false;
            }
            match res {
                Ok(c) => {
                    served = c.served;
                    if c.answered > 0 {
                        status.lock().await.forced_served += c.answered as u64;
                    }
                    if let Some((seq, sig)) = c.batch {
                        last_cut = snap.cut;
                        last_commit = Instant::now();
                        // The note itself is a log entry; it alone doesn't make the engine "not idle".
                        // Only skip past it if it directly follows the cut: anything logged in between
                        // (e.g. a payout reported meanwhile) still needs the next batch.
                        match core.submit(Cmd::BatchFinalized { cut: snap.cut }, None).await {
                            Ok((seq, _)) if seq == snap.cut + 1 => last_cut = seq,
                            Ok(_) => {}
                            Err(e) => status.lock().await.last_error = Some(format!("BatchFinalized: {e:?}")),
                        }
                        let mut also = String::new();
                        if first.is_some() && res_settled {
                            also += " · paid a large withdrawal in the same transaction";
                        }
                        if c.answered > 0 {
                            also += &format!(" · answered {} forced request(s) in the same transaction", c.answered);
                        }
                        eprintln!(
                            "batch {seq}: covers log #{} · fingerprint {}… · finalized in {} ms{also} · https://explorer.solana.com/tx/{sig}?cluster=devnet",
                            snap.cut,
                            &hex(&snap.state_root)[..12],
                            t0.elapsed().as_millis(),
                        );
                        let mut st = status.lock().await;
                        st.batches += 1;
                        st.last_seq = seq;
                        st.last_cut = snap.cut;
                        st.last_state_root = hex(&snap.state_root);
                        st.last_signature = sig;
                        st.last_ms = t0.elapsed().as_millis() as u64;
                    }
                }
                Err(e) => {
                    eprintln!("batch: failed: {e:#} (retrying)");
                    status.lock().await.last_error = Some(format!("commit: {e:#}"));
                    continue;
                }
            }
            if !snap.requested.is_empty() {
                let n = settle(&rpc, &addrs, &operator, &snap.requested).await;
                status.lock().await.settled_requests += n;
            }
            if snap.forced > served {
                match serve_rest(&rpc, &addrs, &operator, &snap).await {
                    Ok((now_served, n)) => {
                        served = now_served;
                        status.lock().await.forced_served += n;
                        if snap.forced > served {
                            trigger.notify_one(); // more waiting: go again now
                        }
                    }
                    Err(e) => status.lock().await.last_error = Some(format!("serve_forced: {e:#}")),
                }
            }
        }
    });
}

/// A request already recorded on-chain (so the batch we're about to post makes it payable).
async fn settle_candidate(rpc: &Rpc, a: &Addrs, ids: &[u64]) -> Option<(u64, Pubkey, Pubkey)> {
    if ids.is_empty() {
        return None;
    }
    let (Some(sd), _) = rpc.account(&a.state, FINALIZED).await.ok()? else { return None };
    let st = program::decode_state(&sd).ok()?;
    for id in ids {
        let Ok((Some(d), _)) = rpc.account(&program::request_address(*id), FINALIZED).await else { continue };
        let Ok(r) = program::decode_request(&d) else { continue };
        if !r.settled_in_exit() && r.batch_seq <= st.batch_seq {
            return Some((*id, r.user, r.payer));
        }
    }
    None
}

struct Committed {
    batch: Option<(u64, String)>,
    /// The chain's forced-served count once this transaction is final.
    served: u64,
    /// Forced requests answered in it.
    answered: usize,
}

#[allow(clippy::too_many_arguments)]
async fn commit(rpc: &Rpc, a: &Addrs, operator: &Keypair, s: &Snap, idle: bool, settle: Option<(u64, Pubkey, Pubkey)>, answer: bool, extras: &mut bool) -> anyhow::Result<Committed> {
    let st = program::decode_state(&rpc.account(&a.state, FINALIZED).await?.0.ok_or_else(|| anyhow::anyhow!("no state"))?)?;
    anyhow::ensure!(!st.in_exit_mode(), "exit mode is on: no more batches");
    if idle && st.state_root == s.state_root && settle.is_none() {
        // Nothing new to commit; forced requests are answered separately.
        return Ok(Committed { batch: None, served: st.forced_served, answered: 0 });
    }
    let serves = if answer { forced_serves(rpc, a, &st, s).await? } else { vec![] };
    let deposit_hash = program::deposit_cut(&st, s.deposits).ok_or_else(|| anyhow::anyhow!("deposit cut {} not on the chain's ring (chain at {})", s.deposits, st.deposit_count))?;
    let payout_hash = program::payout_cut(&st, s.payouts).ok_or_else(|| anyhow::anyhow!("payout cut {} not on the chain's ring (chain at {})", s.payouts, st.payout_count))?;
    let b = Batch {
        seq: st.batch_seq + 1,
        prev_state_root: st.state_root,
        state_root: s.state_root,
        exit_root: s.exit_root,
        log_head: s.head,
        deposits: s.deposits,
        deposit_hash,
        payouts: s.payouts,
        payout_hash,
        forced_served: st.forced_served,
        liabilities: s.custody,
        vault: s.vault,
        treasury: s.treasury,
    };
    let mut body = vec![program::commit_batch(a, operator.pubkey(), b)];
    let mut cu = 30_000;
    if let Some((id, user, payer)) = settle {
        body.push(program::settle_request(a, id, user, payer, operator.pubkey()));
        cu += 40_000;
    }
    let mut answered = 0;
    for sv in &serves {
        let mut trial = with_budget(cu + SERVE_CU, &body);
        trial.push(serve_ix(a, sv, operator));
        if Rpc::tx_size(&operator.pubkey(), &trial) > TX_LIMIT {
            break;
        }
        body.push(serve_ix(a, sv, operator));
        cu += SERVE_CU;
        answered += 1;
    }
    *extras = settle.is_some() || answered > 0;
    let sig = rpc.run(operator, &[], with_budget(cu, &body)).await?;
    Ok(Committed { batch: Some((st.batch_seq + 1, sig.to_string())), served: st.forced_served + answered as u64, answered })
}

fn with_budget(cu: u32, body: &[Instruction]) -> Vec<Instruction> {
    let mut ixs = program::compute_budget(cu, 20_000).to_vec();
    ixs.extend_from_slice(body);
    ixs
}

fn serve_ix(a: &Addrs, sv: &Serve, operator: &Keypair) -> Instruction {
    program::serve_forced(a, sv.index, sv.user, sv.pay_to, sv.amount, operator.pubkey())
}

/// The next forced requests to answer, in order: each pays what the engine holds for it, into the
/// user's USDC account. With no such account, or withdrawals paused on-chain, it's answered with
/// nothing, and the engine then returns the hold (`ForcedUnpaid`).
async fn forced_serves(rpc: &Rpc, a: &Addrs, st: &State, s: &Snap) -> anyhow::Result<Vec<Serve>> {
    let from = st.forced_served + 1;
    let to = s.forced.min(st.forced_served + SERVE_PER_PASS);
    if from > to {
        return Ok(vec![]);
    }
    let idx: Vec<u64> = (from..=to).collect();
    let (accs, _) = rpc.accounts(&idx.iter().map(|i| program::forced_address(*i)).collect::<Vec<_>>(), FINALIZED).await?;
    let mut out = Vec::new();
    for (i, acc) in idx.iter().zip(accs) {
        let Some(d) = acc else { break }; // answered strictly in order
        let r = program::decode_forced(&d)?;
        out.push(Serve { index: *i, user: r.user, pay_to: None, amount: s.forced_holds.get(i).copied().unwrap_or(0) });
    }
    let paying: Vec<usize> = (0..out.len()).filter(|k| out[*k].amount > 0).collect();
    if !paying.is_empty() {
        let atas: Vec<Pubkey> = paying.iter().map(|k| program::ata(&out[*k].user, &a.usdc_mint)).collect();
        let (accs, _) = rpc.accounts(&atas, FINALIZED).await?;
        let paused = st.withdrawals_paused();
        for ((k, ata), acc) in paying.iter().zip(atas).zip(accs) {
            let ok = !paused && acc.as_deref().and_then(program::token_account_owner) == Some((a.usdc_mint, out[*k].user));
            if ok {
                out[*k].pay_to = Some(ata);
            } else {
                out[*k].amount = 0;
            }
        }
    }
    Ok(out)
}

/// Answer forced requests in their own transactions (those the batch transaction had no room for).
async fn serve_rest(rpc: &Rpc, a: &Addrs, operator: &Keypair, s: &Snap) -> anyhow::Result<(u64, u64)> {
    let st = program::decode_state(&rpc.account(&a.state, FINALIZED).await?.0.ok_or_else(|| anyhow::anyhow!("no state"))?)?;
    let serves = forced_serves(rpc, a, &st, s).await?;
    let mut served = st.forced_served;
    let mut done = 0;
    let mut rest = &serves[..];
    while !rest.is_empty() {
        let mut body: Vec<Instruction> = Vec::new();
        let mut n = 0;
        for sv in rest {
            let mut trial = with_budget(SERVE_CU * (n + 1), &body);
            trial.push(serve_ix(a, sv, operator));
            if Rpc::tx_size(&operator.pubkey(), &trial) > TX_LIMIT {
                break;
            }
            body.push(serve_ix(a, sv, operator));
            n += 1;
        }
        anyhow::ensure!(n > 0, "a forced answer doesn't fit in a transaction");
        let sig = rpc.run(operator, &[], with_budget(SERVE_CU * n, &body)).await?;
        eprintln!("forced: answered {n} request(s) (#{}..#{}) · https://explorer.solana.com/tx/{sig}?cluster=devnet", rest[0].index, rest[n as usize - 1].index);
        served += n as u64;
        done += n as u64;
        rest = &rest[n as usize..];
    }
    Ok((served, done))
}

/// Pay recorded large withdrawals whose batch has passed, with the operator's approval. Only
/// requests whose lock the engine holds are passed in.
async fn settle(rpc: &Rpc, a: &Addrs, operator: &Keypair, ids: &[u64]) -> u64 {
    let mut done = 0;
    let Ok((Some(sd), _)) = rpc.account(&a.state, FINALIZED).await else { return 0 };
    let Ok(st) = program::decode_state(&sd) else { return 0 };
    for id in ids {
        let Ok((Some(d), _)) = rpc.account(&program::request_address(*id), FINALIZED).await else { continue };
        let Ok(r) = program::decode_request(&d) else { continue };
        if st.batch_seq <= r.batch_seq || r.settled_in_exit() {
            continue;
        }
        let mut ixs = program::compute_budget(40_000, 20_000).to_vec();
        ixs.push(program::settle_request(a, *id, r.user, r.payer, operator.pubkey()));
        if rpc.run(operator, &[], ixs).await.is_ok() {
            done += 1;
        }
    }
    done
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
