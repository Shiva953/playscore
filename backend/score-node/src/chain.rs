//! Minimal Solana JSON-RPC client. We rebroadcast transactions ourselves (`maxRetries: 0`) until
//! finalized or expired.

use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine as _;
use serde_json::{json, Value};
use solana_sdk::hash::Hash;
use solana_sdk::instruction::Instruction;
use solana_sdk::message::{v0, VersionedMessage};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signature, Signer};
use solana_sdk::transaction::VersionedTransaction;

#[derive(Clone)]
pub struct Rpc {
    http: reqwest::Client,
    pub url: String,
}

pub const FINALIZED: &str = "finalized";

impl Rpc {
    pub fn new(url: &str) -> Self {
        Rpc { http: reqwest::Client::builder().timeout(Duration::from_secs(20)).build().expect("http client"), url: url.to_string() }
    }

    pub fn ws_url(&self) -> String {
        self.url.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1)
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let body = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params});
        let mut delay = 200u64;
        for attempt in 0..5 {
            let r = self.http.post(&self.url).json(&body).send().await;
            match r {
                Ok(resp) if resp.status().as_u16() == 429 || resp.status().is_server_error() => {
                    if attempt == 4 {
                        bail!("{method}: HTTP {}", resp.status());
                    }
                }
                Ok(resp) => {
                    let v: Value = resp.json().await.with_context(|| format!("{method}: bad JSON"))?;
                    if let Some(e) = v.get("error") {
                        bail!("{method}: {e}");
                    }
                    return Ok(v["result"].clone());
                }
                Err(e) if attempt == 4 => return Err(anyhow!("{method}: {e}")),
                Err(_) => {}
            }
            tokio::time::sleep(Duration::from_millis(delay)).await;
            delay *= 2;
        }
        unreachable!()
    }

    /// Account data and the slot it was read at.
    pub async fn account(&self, addr: &Pubkey, commitment: &str) -> Result<(Option<Vec<u8>>, u64)> {
        let r = self.call("getAccountInfo", json!([addr.to_string(), {"encoding": "base64", "commitment": commitment}])).await?;
        Ok((decode_account(&r["value"])?, r["context"]["slot"].as_u64().unwrap_or(0)))
    }

    /// Several accounts read at one slot.
    pub async fn accounts(&self, addrs: &[Pubkey], commitment: &str) -> Result<(Vec<Option<Vec<u8>>>, u64)> {
        let keys: Vec<String> = addrs.iter().map(|a| a.to_string()).collect();
        let r = self.call("getMultipleAccounts", json!([keys, {"encoding": "base64", "commitment": commitment}])).await?;
        let vals = r["value"].as_array().ok_or_else(|| anyhow!("getMultipleAccounts: no value"))?;
        Ok((vals.iter().map(decode_account).collect::<Result<_>>()?, r["context"]["slot"].as_u64().unwrap_or(0)))
    }

    pub async fn block_time(&self, slot: u64) -> Result<i64> {
        self.call("getBlockTime", json!([slot])).await?.as_i64().ok_or_else(|| anyhow!("no block time for {slot}"))
    }

    pub async fn latest_blockhash(&self) -> Result<(Hash, u64)> {
        let r = self.call("getLatestBlockhash", json!([{"commitment": "confirmed"}])).await?;
        let h: Hash = r["value"]["blockhash"].as_str().ok_or_else(|| anyhow!("no blockhash"))?.parse()?;
        Ok((h, r["value"]["lastValidBlockHeight"].as_u64().unwrap_or(0)))
    }

    pub async fn block_height(&self) -> Result<u64> {
        self.call("getBlockHeight", json!([{"commitment": "confirmed"}])).await?.as_u64().ok_or_else(|| anyhow!("no block height"))
    }

    pub async fn send_raw(&self, tx: &VersionedTransaction) -> Result<()> {
        let b = base64::engine::general_purpose::STANDARD.encode(bincode::serialize(tx)?);
        self.call("sendTransaction", json!([b, {"encoding": "base64", "skipPreflight": true, "maxRetries": 0}])).await?;
        Ok(())
    }

    /// (status, error) of a signature, if known.
    pub async fn status(&self, sig: &Signature) -> Result<Option<(String, Option<Value>)>> {
        let r = self.call("getSignatureStatuses", json!([[sig.to_string()]])).await?;
        let v = &r["value"][0];
        if v.is_null() {
            return Ok(None);
        }
        let err = if v["err"].is_null() { None } else { Some(v["err"].clone()) };
        Ok(Some((v["confirmationStatus"].as_str().unwrap_or("").to_string(), err)))
    }

    /// Send, rebroadcast every 2 s, and return once finalized (Err if it failed or expired).
    pub async fn send_until_finalized(&self, tx: &VersionedTransaction, last_valid: u64) -> Result<Signature> {
        let sig = tx.signatures[0];
        self.send_raw(tx).await?;
        let started = tokio::time::Instant::now();
        let mut last_send = started;
        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;
            // Hard deadline, so a stuck send can't hold up the next batch.
            if started.elapsed() > Duration::from_secs(75) {
                bail!("transaction {sig} not finalized after 75 s");
            }
            let st = self.status(&sig).await.ok().flatten();
            if let Some((status, err)) = &st {
                if let Some(e) = err {
                    bail!("transaction {sig} failed: {e}");
                }
                if status == FINALIZED {
                    return Ok(sig);
                }
            }
            if last_send.elapsed() > Duration::from_secs(2) {
                if self.block_height().await.unwrap_or(0) > last_valid {
                    bail!("transaction {sig} expired without finalizing");
                }
                if st.is_none() {
                    let _ = self.send_raw(tx).await;
                }
                last_send = tokio::time::Instant::now();
            }
        }
    }

    /// Bytes the signed transaction would take (the limit is 1,232).
    pub fn tx_size(payer: &Pubkey, ixs: &[Instruction]) -> usize {
        match v0::Message::try_compile(payer, ixs, &[], Hash::default()) {
            Ok(m) => {
                let n = m.header.num_required_signatures as usize;
                1 + 64 * n + VersionedMessage::V0(m).serialize().len()
            }
            Err(_) => usize::MAX,
        }
    }

    /// Build, sign (payer + extra signers), send, and wait for finalized.
    pub async fn run(&self, payer: &Keypair, signers: &[&Keypair], ixs: Vec<Instruction>) -> Result<Signature> {
        let (bh, last_valid) = self.latest_blockhash().await?;
        let msg = v0::Message::try_compile(&payer.pubkey(), &ixs, &[], bh)?;
        let mut all: Vec<&Keypair> = vec![payer];
        all.extend_from_slice(signers);
        let tx = VersionedTransaction::try_new(VersionedMessage::V0(msg), &all)?;
        self.send_until_finalized(&tx, last_valid).await
    }

    /// Program transactions newest first: (signature, slot, failed).
    pub async fn signatures_for(&self, addr: &Pubkey, before: Option<&str>, limit: usize) -> Result<Vec<(String, u64, bool)>> {
        let mut cfg = json!({"limit": limit, "commitment": FINALIZED});
        if let Some(b) = before {
            cfg["before"] = json!(b);
        }
        let r = self.call("getSignaturesForAddress", json!([addr.to_string(), cfg])).await?;
        Ok(r.as_array()
            .unwrap_or(&vec![])
            .iter()
            .map(|x| (x["signature"].as_str().unwrap_or("").to_string(), x["slot"].as_u64().unwrap_or(0), !x["err"].is_null()))
            .collect())
    }

    pub async fn transaction_logs(&self, sig: &str) -> Result<Option<Vec<String>>> {
        let r = self.call("getTransaction", json!([sig, {"commitment": FINALIZED, "maxSupportedTransactionVersion": 0, "encoding": "json"}])).await?;
        if r.is_null() || !r["meta"]["err"].is_null() {
            return Ok(None);
        }
        Ok(Some(r["meta"]["logMessages"].as_array().unwrap_or(&vec![]).iter().filter_map(|l| l.as_str().map(String::from)).collect()))
    }
}

fn decode_account(v: &Value) -> Result<Option<Vec<u8>>> {
    if v.is_null() {
        return Ok(None);
    }
    let b64 = v["data"][0].as_str().ok_or_else(|| anyhow!("account without data"))?;
    Ok(Some(base64::engine::general_purpose::STANDARD.decode(b64)?))
}

pub fn load_keypair(path: &str) -> Result<Keypair> {
    let bytes: Vec<u8> = serde_json::from_str(&std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?)?;
    Keypair::try_from(bytes.as_slice()).map_err(|e| anyhow!("{path}: {e}"))
}
