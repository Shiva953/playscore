//! Restart snapshots: magic · sha256(body) · borsh(Sequencer), written via temp file + fsync +
//! rename. Used only if the checksum matches and its head equals the log's hash at that sequence
//! number; then only the later log is re-applied. Otherwise the whole log is replayed.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use score_engine::wal::{Record, Sequencer};
use sha2::{Digest, Sha256};

/// Bump when the engine's state layout changes.
const MAGIC: &[u8; 8] = b"SCSNAP03";

pub fn path_for(wal: &Path) -> PathBuf {
    wal.with_file_name("snapshot.bin")
}

pub fn save(path: &Path, s: &Sequencer) -> std::io::Result<()> {
    let body = borsh::to_vec(s)?;
    let tmp = path.with_extension("tmp");
    let mut f = File::create(&tmp)?;
    f.write_all(MAGIC)?;
    f.write_all(&Sha256::digest(&body))?;
    f.write_all(&body)?;
    f.sync_all()?;
    fs::rename(&tmp, path)?;
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        File::open(dir)?.sync_all()?;
    }
    Ok(())
}

fn load(path: &Path) -> Option<Sequencer> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 40 || &bytes[..8] != MAGIC {
        return None;
    }
    let (sum, body) = bytes[8..].split_at(32);
    if Sha256::digest(body).as_slice() != sum {
        return None;
    }
    borsh::from_slice(body).ok()
}

/// How the state was rebuilt.
pub struct Restored {
    pub seq: Sequencer,
    /// The snapshot's sequence number, if one was used.
    pub from: Option<u64>,
    /// Records re-applied (with signatures and hashes checked).
    pub replayed: usize,
}

/// Rebuild the state from the latest valid snapshot plus the log after it, or from the whole log.
pub fn restore(snap: &Path, recs: &[Record]) -> anyhow::Result<Restored> {
    if let Some(mut s) = load(snap) {
        let n = s.seq as usize;
        let linked = n <= recs.len() && (n == 0 || (recs[n - 1].seq == s.seq && recs[n - 1].hash == s.head));
        if linked {
            for r in &recs[n..] {
                anyhow::ensure!(r.seq == s.seq + 1, "gap in the log at #{}", r.seq);
                let (_, mine) = s.submit(r.ts, r.cmd.clone(), r.sig).map_err(|e| anyhow::anyhow!("#{} rejected on replay: {e:?}", r.seq))?;
                anyhow::ensure!(mine.hash == r.hash, "hash mismatch at #{}", r.seq);
            }
            return Ok(Restored { from: Some(n as u64), replayed: recs.len() - n, seq: s });
        }
        eprintln!("snapshot: doesn't match the log (ignored); replaying the whole log");
    }
    let seq = Sequencer::replay(recs).map_err(|e| anyhow::anyhow!("log replay failed: {e}"))?;
    Ok(Restored { seq, from: None, replayed: recs.len() })
}
