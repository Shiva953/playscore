//! Sequencer and write-ahead log.
//!
//! Every accepted command gets a sequence number and a timestamp, is hashed into a chain
//! `h = sha256(LOG_DOMAIN || h_prev || seq || ts || borsh(cmd) || borsh(sig))`, and is appended to
//! the log. Rejected commands are never logged and never change state. Replaying the log from
//! genesis checks every signature and hash and reproduces the state exactly.
//!
//! Durability: `FileWal::append_batch` writes a group of records and fsyncs once. A fill is acked
//! only after that returns. Each frame carries its length and a CRC, so after a crash a torn final
//! frame is detected and truncated by `FileWal::recover`; corruption anywhere else is an error.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;

use borsh::{BorshDeserialize, BorshSerialize};
use sha2::{Digest, Sha256};

use crate::auth::{self, Sig};
use crate::engine::Engine;
use crate::error::Error;
use crate::types::{Cmd, Outcome};

pub type Hash = [u8; 32];

pub const LOG_DOMAIN: &[u8] = b"score:log:v1:";

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Record {
    pub seq: u64,
    pub ts: i64,
    pub cmd: Cmd,
    pub sig: Option<Sig>,
    pub hash: Hash,
}

pub fn chain_hash(prev: &Hash, seq: u64, ts: i64, cmd: &Cmd, sig: &Option<Sig>) -> Hash {
    let mut body = Vec::with_capacity(160);
    borsh::to_writer(&mut body, cmd).expect("writing to a Vec cannot fail");
    borsh::to_writer(&mut body, sig).expect("writing to a Vec cannot fail");
    let mut h = Sha256::new();
    h.update(LOG_DOMAIN);
    h.update(prev);
    h.update(seq.to_le_bytes());
    h.update(ts.to_le_bytes());
    h.update(&body);
    h.finalize().into()
}

/// Serialisable: a restart snapshot is `borsh(Sequencer)`, checked against the log's hash chain.
#[derive(Debug, Default, BorshSerialize, BorshDeserialize)]
pub struct Sequencer {
    pub engine: Engine,
    pub seq: u64,
    pub head: Hash,
    pub last_ts: i64,
}

impl Sequencer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check time and signature, apply, and return the record to persist. State advances only on success.
    pub fn submit(&mut self, ts: i64, cmd: Cmd, sig: Option<Sig>) -> Result<(Outcome, Record), Error> {
        if ts < 0 || ts < self.last_ts {
            return Err(Error::BadTime);
        }
        auth::verify(&cmd, sig.as_ref())?;
        let out = self.engine.apply(ts, &cmd)?;
        self.seq += 1;
        self.last_ts = ts;
        self.head = chain_hash(&self.head, self.seq, ts, &cmd, &sig);
        Ok((out, Record { seq: self.seq, ts, cmd, sig, hash: self.head }))
    }

    /// Rebuild state from a log, checking sequence numbers, timestamps, signatures and the hash chain.
    pub fn replay<'a>(records: impl IntoIterator<Item = &'a Record>) -> Result<Sequencer, String> {
        let mut s = Sequencer::new();
        for r in records {
            if r.seq != s.seq + 1 {
                return Err(format!("gap at seq {}", r.seq));
            }
            let (_, rec) = s
                .submit(r.ts, r.cmd.clone(), r.sig)
                .map_err(|e| format!("seq {} rejected on replay: {e:?}", r.seq))?;
            if rec.hash != r.hash {
                return Err(format!("hash mismatch at seq {}", r.seq));
            }
        }
        Ok(s)
    }
}

/// Append-only file WAL. Frame = `len: u32 LE | crc32(payload): u32 LE | payload (borsh Record)`.
pub struct FileWal {
    file: File,
}

const FRAME_HEADER: usize = 8;

impl FileWal {
    /// Open for appending after crash recovery: read every intact record, truncate a torn final
    /// frame, fsync, and return the records so the caller can replay them.
    pub fn recover(path: &Path) -> std::io::Result<(FileWal, Vec<Record>)> {
        let created = !path.exists();
        let mut file = OpenOptions::new().create(true).read(true).append(true).open(path)?;
        if created {
            // Make the new file's directory entry durable too.
            if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
                File::open(dir)?.sync_all()?;
            }
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        let (records, good_len) = decode_frames(&bytes)?;
        if good_len < bytes.len() {
            file.set_len(good_len as u64)?;
            file.sync_all()?;
        }
        Ok((FileWal { file }, records))
    }

    /// Write all records, then fsync once (group commit). Ack fills only after this returns.
    pub fn append_batch(&mut self, recs: &[Record]) -> std::io::Result<()> {
        let mut buf = Vec::with_capacity(recs.len() * 256);
        for r in recs {
            let payload = borsh::to_vec(r)?;
            let len = u32::try_from(payload.len()).map_err(|_| invalid("record too large"))?;
            buf.extend_from_slice(&len.to_le_bytes());
            buf.extend_from_slice(&crc32fast::hash(&payload).to_le_bytes());
            buf.extend_from_slice(&payload);
        }
        self.file.write_all(&buf)?;
        self.file.sync_data()
    }

    /// Read a log without modifying it (for verifiers and tooling).
    pub fn read_all(path: &Path) -> std::io::Result<Vec<Record>> {
        Ok(decode_frames(&fs::read(path)?)?.0)
    }
}

fn invalid(msg: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, msg.to_string())
}

/// Decode frames. Returns the records and the byte length of the intact prefix. Only the final
/// frame may be torn (short, or bad CRC with nothing after it); anything else is corruption.
fn decode_frames(bytes: &[u8]) -> std::io::Result<(Vec<Record>, usize)> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < bytes.len() {
        let rest = &bytes[at..];
        if rest.len() < FRAME_HEADER {
            break; // torn header at the tail
        }
        let len = u32::from_le_bytes(rest[0..4].try_into().unwrap()) as usize;
        let crc = u32::from_le_bytes(rest[4..8].try_into().unwrap());
        let end = FRAME_HEADER + len;
        if rest.len() < end {
            break; // torn payload at the tail
        }
        let payload = &rest[FRAME_HEADER..end];
        if crc32fast::hash(payload) != crc {
            if rest.len() == end {
                break; // torn final frame
            }
            return Err(invalid(&format!("corrupt WAL frame at byte {at}")));
        }
        out.push(Record::try_from_slice(payload).map_err(|_| invalid(&format!("undecodable WAL frame at byte {at}")))?);
        at += end;
    }
    Ok((out, at))
}
