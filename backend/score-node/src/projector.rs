//! Postgres writer: copies every saved log record into `log`, off the trading path. Gaps (outages,
//! startup) are refilled from the log file, the source of truth. Off unless DATABASE_URL is set.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use score_engine::wal::{FileWal, Record};
use tokio::sync::{broadcast, Mutex};

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct DbStatus {
    pub enabled: bool,
    pub last_seq: u64,
    pub last_error: Option<String>,
}

const SCHEMA: &str = "
create table if not exists log (
  seq bigint primary key,
  ts bigint not null,
  kind text not null,
  signer text,
  cmd jsonb not null,
  hash bytea not null
);";

pub fn spawn(url: Option<String>, wal_path: PathBuf, mut rx: broadcast::Receiver<Arc<Record>>, status: Arc<Mutex<DbStatus>>) {
    let Some(url) = url else { return };
    tokio::spawn(async move {
        status.lock().await.enabled = true;
        loop {
            let r: anyhow::Result<()> = async {
                let client = connect(&url).await?;
                client.batch_execute(SCHEMA).await?;
                eprintln!("postgres: connected");
                let row = client.query_one("select coalesce(max(seq), 0) from log", &[]).await?;
                let mut last: i64 = row.get(0);
                // Fill the gap from the log file (the source of truth), 500 rows per round trip.
                let from = last;
                let missing: Vec<Record> = FileWal::read_all(&wal_path)?.into_iter().filter(|r| r.seq as i64 > from).collect();
                for chunk in missing.chunks(500) {
                    insert_many(&client, chunk).await?;
                    last = chunk.last().map_or(last, |r| r.seq as i64);
                    status.lock().await.last_seq = last as u64;
                }
                if !missing.is_empty() {
                    eprintln!("postgres: copied {} log records from the log file (now at {last})", missing.len());
                }
                status.lock().await.last_seq = last as u64;
                loop {
                    // Take one record, then everything else already waiting (one round trip).
                    let mut batch: Vec<Record> = Vec::new();
                    match rx.recv().await {
                        Ok(r) => batch.push((*r).clone()),
                        Err(broadcast::error::RecvError::Lagged(_)) => anyhow::bail!("fell behind; refilling from the log file"),
                        Err(broadcast::error::RecvError::Closed) => return Ok(()),
                    }
                    while batch.len() < 500 {
                        match rx.try_recv() {
                            Ok(r) => batch.push((*r).clone()),
                            Err(broadcast::error::TryRecvError::Lagged(_)) => anyhow::bail!("fell behind; refilling from the log file"),
                            Err(_) => break,
                        }
                    }
                    batch.retain(|r| r.seq as i64 > last);
                    if batch.is_empty() {
                        continue;
                    }
                    insert_many(&client, &batch).await?;
                    last = batch.last().map_or(last, |r| r.seq as i64);
                    status.lock().await.last_seq = last as u64;
                }
            }
            .await;
            if let Err(e) = r {
                eprintln!("postgres: {e:#} (retrying in 2 s)");
                status.lock().await.last_error = Some(format!("{e:#}"));
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

async fn connect(url: &str) -> anyhow::Result<tokio_postgres::Client> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()?
        .with_root_certificates(roots)
        .with_no_client_auth();
    let tls = crate::pg_tls::MakeTls(Arc::new(cfg));
    let (client, conn) = tokio_postgres::connect(url, tls).await?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    Ok(client)
}

async fn insert_many(c: &tokio_postgres::Client, rs: &[Record]) -> anyhow::Result<()> {
    use tokio_postgres::types::{Json, ToSql};
    // (seq, ts, kind, signer, cmd, hash)
    type Row = (i64, i64, String, Option<String>, serde_json::Value, Vec<u8>);
    let mut rows: Vec<Row> = Vec::with_capacity(rs.len());
    for r in rs {
        let cmd = serde_json::to_value(&r.cmd)?;
        let kind = cmd.as_object().and_then(|o| o.keys().next().cloned()).unwrap_or_else(|| cmd.as_str().unwrap_or("?").to_string());
        let signer = r.cmd.signer().map(|u| bs58::encode(u).into_string());
        rows.push((r.seq as i64, r.ts, kind, signer, cmd, r.hash.to_vec()));
    }
    let mut sql = String::from("insert into log (seq, ts, kind, signer, cmd, hash) values ");
    let mut params: Vec<&(dyn ToSql + Sync)> = Vec::with_capacity(rows.len() * 6);
    let json: Vec<Json<&serde_json::Value>> = rows.iter().map(|r| Json(&r.4)).collect();
    for (i, r) in rows.iter().enumerate() {
        let b = i * 6;
        sql.push_str(&format!("{}(${}, ${}, ${}, ${}, ${}, ${})", if i > 0 { ", " } else { "" }, b + 1, b + 2, b + 3, b + 4, b + 5, b + 6));
        params.push(&r.0);
        params.push(&r.1);
        params.push(&r.2);
        params.push(&r.3);
        params.push(&json[i]);
        params.push(&r.5);
    }
    sql.push_str(" on conflict (seq) do nothing");
    c.execute(sql.as_str(), &params).await?;
    Ok(())
}
