//! The engine thread: owns the sequencer, the engine and the log file. Commands arrive on a
//! channel and are applied in order. Each group of accepted commands is written to the log with
//! one fsync (group commit) and only then acknowledged, so nothing is ever confirmed to a user
//! before it is on disk. Reads run after that write, so they never see unsaved state.

use std::path::Path;
use std::sync::mpsc;
use std::sync::Arc;

use anyhow::Result;
use score_engine::auth::Sig;
use score_engine::wal::{FileWal, Record, Sequencer};
use score_engine::{Cmd, Error, Outcome};
use tokio::sync::{broadcast, oneshot};

type Reply = oneshot::Sender<Result<(u64, Outcome), Error>>;
type ReadFn = Box<dyn FnOnce(&Sequencer) + Send>;

enum Req {
    Submit { cmd: Cmd, sig: Option<Sig>, reply: Reply },
    Read(ReadFn),
}

#[derive(Clone)]
pub struct Core {
    tx: mpsc::Sender<Req>,
    /// Every logged record, after it is on disk.
    pub records: broadcast::Sender<Arc<Record>>,
}

pub struct Recovered {
    pub records: usize,
    pub head: [u8; 32],
    pub max_voucher_id: u64,
    /// The snapshot used, if any, and how many records were re-applied after it.
    pub snapshot: Option<u64>,
    pub replayed: usize,
}

const MAX_GROUP: usize = 512;

impl Core {
    /// Recover the log (truncating a torn tail), replay it with every signature and hash checked,
    /// and start the engine thread.
    pub fn start(wal_path: &Path) -> Result<(Core, Recovered)> {
        if let Some(dir) = wal_path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let (mut wal, recs) = FileWal::recover(wal_path)?;
        let restored = crate::snapshot::restore(&crate::snapshot::path_for(wal_path), &recs)?;
        let seq = restored.seq;
        let max_voucher_id = recs.iter().filter_map(|r| if let Cmd::LockWithdraw { id, .. } = r.cmd { Some(id) } else { None }).max().unwrap_or(0);
        let rec = Recovered { records: recs.len(), head: seq.head, max_voucher_id, snapshot: restored.from, replayed: restored.replayed };
        let (tx, rx) = mpsc::channel::<Req>();
        let (records, _) = broadcast::channel(16_384);
        let out = records.clone();
        std::thread::Builder::new().name("engine".into()).spawn(move || run(seq, &mut wal, rx, out))?;
        Ok((Core { tx, records }, rec))
    }

    pub async fn submit(&self, cmd: Cmd, sig: Option<Sig>) -> Result<(u64, Outcome), Error> {
        let (reply, rx) = oneshot::channel();
        if self.tx.send(Req::Submit { cmd, sig, reply }).is_err() {
            return Err(Error::Paused);
        }
        rx.await.unwrap_or(Err(Error::Paused))
    }

    pub async fn read<T: Send + 'static>(&self, f: impl FnOnce(&Sequencer) -> T + Send + 'static) -> T {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(Req::Read(Box::new(move |s| {
            let _ = reply.send(f(s));
        })));
        rx.await.expect("engine thread stopped")
    }
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn run(mut seq: Sequencer, wal: &mut FileWal, rx: mpsc::Receiver<Req>, out: broadcast::Sender<Arc<Record>>) {
    while let Ok(first) = rx.recv() {
        let mut group = vec![first];
        while group.len() < MAX_GROUP {
            match rx.try_recv() {
                Ok(r) => group.push(r),
                Err(_) => break,
            }
        }
        let mut recs: Vec<Record> = Vec::new();
        let mut acks: Vec<(Reply, (u64, Outcome))> = Vec::new();
        let mut reads: Vec<ReadFn> = Vec::new();
        for r in group {
            match r {
                Req::Read(f) => reads.push(f),
                Req::Submit { cmd, sig, reply } => {
                    let ts = now().max(seq.last_ts);
                    match seq.submit(ts, cmd, sig) {
                        Ok((outcome, rec)) => {
                            acks.push((reply, (rec.seq, outcome)));
                            recs.push(rec);
                        }
                        Err(e) => {
                            let _ = reply.send(Err(e));
                        }
                    }
                }
            }
        }
        if !recs.is_empty() {
            // Can't continue without the log: panic = abort stops the process, and a restart
            // recovers everything that was acknowledged.
            wal.append_batch(&recs).expect("log write failed");
        }
        for (reply, r) in acks {
            let _ = reply.send(Ok(r));
        }
        for r in recs {
            let _ = out.send(Arc::new(r));
        }
        for f in reads {
            f(&seq);
        }
    }
}
