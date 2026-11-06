//! Rough per-command latency of the engine (no I/O), and of a WAL group commit.
//! cargo run --release --example latency
use std::time::Instant;

use ed25519_dalek::{Signer, SigningKey};
use score_engine::auth::order_message;
use score_engine::math as m;
use score_engine::wal::{FileWal, Sequencer};
use score_engine::*;

fn main() {
    let mut s = Sequencer::new();
    let keys: Vec<SigningKey> = (0..200u16).map(|i| { let mut b = [9u8; 32]; b[..2].copy_from_slice(&i.to_le_bytes()); SigningKey::from_bytes(&b) }).collect();
    let id = |k: &SigningKey| k.verifying_key().to_bytes();
    let mut nonce = vec![0u64; keys.len()];
    let ts = 0i64;
    let mut seq = 0u64;
    let run = |s: &mut Sequencer, ts: i64, c: Cmd, k: Option<&SigningKey>| {
        let sig = k.map(|k| k.sign(&order_message(&c)).to_bytes());
        s.submit(ts, c, sig)
    };
    run(&mut s, ts, Cmd::ListPlayer { player: 1 }, None).unwrap();
    // graduate with users 0..40
    for (i, k) in keys.iter().enumerate().take(40) {
        seq += 1;
        run(&mut s, ts, Cmd::Deposit { user: id(k), amount: 50_000_000_000, seq }, None).unwrap();
        if s.engine.market(1).unwrap().state == MarketState::IcoLive {
            let sold = s.engine.market(1).unwrap().sold as u128;
            let cost = m::curve_cost(sold, m::MAX_BUY_BASE - 5_000).unwrap();
            nonce[i] += 1;
            let _ = run(&mut s, ts, Cmd::BuyCurve { user: id(k), nonce: nonce[i], player: 1, usdc_in: (cost + m::fee(cost, m::ICO_FEE_BPS).unwrap()) as u64, min_tokens: 1 }, Some(k));
        }
    }
    for (i, k) in keys.iter().enumerate().skip(40) {
        seq += 1;
        run(&mut s, ts, Cmd::Deposit { user: id(k), amount: 50_000_000_000, seq }, None).unwrap();
        let _ = i;
    }
    // resting book: 100 bids and 100 asks around the price
    let px = score_engine::fixed::px_from_sqrt(s.engine.pool(1).unwrap().sqrt, false).unwrap() as u64;
    for (i, k) in keys.iter().enumerate().take(100) {
        nonce[i] += 1;
        let (side, p, amt) = if i % 2 == 0 { (Side::Bid, px * (90 + (i as u64 % 9)) / 100, 20_000_000) } else { (Side::Ask, px * (102 + (i as u64 % 9)) / 100, 2_000_000_000) };
        let _ = run(&mut s, ts, Cmd::PlaceOrder { user: id(k), nonce: nonce[i], player: 1, side, px: p, amount: amt, post_only: true }, Some(k));
    }
    // Sign up front so the timing covers verify + apply + hashing, not signing.
    let mut cmds = Vec::new();
    for j in 0..20_000usize {
        // each user buys, then sells part of it on their next turn
        let i = 100 + (j / 2) % 100;
        nonce[i] += 1;
        let c = if j % 2 == 0 {
            Cmd::Buy { user: id(&keys[i]), nonce: nonce[i], player: 1, usdc_in: 50_000_000, min_tokens: 0, limit_px: 0 }
        } else {
            Cmd::Sell { user: id(&keys[i]), nonce: nonce[i], player: 1, tokens_in: 1_000_000_000, min_usdc: 0, limit_px: 0 }
        };
        let sig = keys[i].sign(&order_message(&c)).to_bytes();
        cmds.push((c, sig));
    }
    let ts = ts + 1;
    let mut lat = Vec::with_capacity(cmds.len());
    let mut recs = Vec::new();
    let t0 = Instant::now();
    for (c, sig) in cmds {
        let t = Instant::now();
        if let Ok((_, r)) = s.submit(ts, c, Some(sig)) {
            recs.push(r);
        }
        lat.push(t.elapsed().as_nanos() as u64);
    }
    let total = t0.elapsed();
    lat.sort();
    let pct = |p: f64| lat[((lat.len() as f64 - 1.0) * p) as usize] as f64 / 1000.0;
    println!("{} routed orders in {:?}: p50 {:.1} µs, p99 {:.1} µs, max {:.1} µs ({} accepted)", lat.len(), total, pct(0.5), pct(0.99), pct(1.0), recs.len());

    let dir = std::env::temp_dir().join(format!("score-latency-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (mut w, _) = FileWal::recover(&dir.join("log.wal")).unwrap();
    let mut gc = Vec::new();
    for chunk in recs.chunks(64).take(200) {
        let t = Instant::now();
        w.append_batch(chunk).unwrap();
        gc.push(t.elapsed().as_micros() as u64);
    }
    gc.sort();
    println!("WAL group commit of 64 records + fsync: p50 {} µs, p99 {} µs", gc[gc.len() / 2], gc[gc.len() * 99 / 100]);
    let _ = std::fs::remove_dir_all(&dir);
}
