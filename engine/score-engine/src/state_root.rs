//! Merkle commitment to the whole engine state, posted on-chain by `commit_batch`.
//!
//! Leaf = sha256(0x00 || tag || borsh(key) || borsh(value)), one per state entry, in a fixed order
//! (tag order, then key order within each map). Node = sha256(0x01 || left || right); an unpaired
//! node is carried up unchanged (no duplication, so no second-preimage ambiguity). Users prove
//! their balances against the committed root in exit mode.
//!
//! O(state). Computed by the batch committer off the hot path (e.g. a follower replaying the log).

use borsh::BorshSerialize;
use sha2::{Digest, Sha256};

use crate::engine::Engine;
use crate::wal::Hash;

pub const TAG_GLOBALS: &[u8] = b"glob";
pub const TAG_ACCOUNT: &[u8] = b"acct";
pub const TAG_HOLDING: &[u8] = b"hold";
pub const TAG_MARKET: &[u8] = b"mrkt";
pub const TAG_POOL: &[u8] = b"pool";
pub const TAG_BOUNDARY: &[u8] = b"bnd_";
pub const TAG_ORDER: &[u8] = b"ordr";
pub const TAG_LP: &[u8] = b"lpos";
pub const TAG_LOCK: &[u8] = b"lock";
pub const TAG_CALENDAR: &[u8] = b"cal_";
pub const TAG_SNAPSHOT: &[u8] = b"snap";
pub const TAG_ELECTION: &[u8] = b"elpx";
pub const TAG_CLAIM: &[u8] = b"clm_";
pub const TAG_PENDING_ROUND: &[u8] = b"prnd";

pub fn leaf<K: BorshSerialize, V: BorshSerialize>(tag: &[u8], key: &K, value: &V) -> Hash {
    let mut h = Sha256::new();
    h.update([0u8]);
    h.update(tag);
    h.update(borsh::to_vec(key).expect("vec write"));
    h.update(borsh::to_vec(value).expect("vec write"));
    h.finalize().into()
}

fn node(l: &Hash, r: &Hash) -> Hash {
    let mut h = Sha256::new();
    h.update([1u8]);
    h.update(l);
    h.update(r);
    h.finalize().into()
}

#[derive(BorshSerialize)]
struct Globals<'a> {
    params: &'a crate::engine::Params,
    paused: bool,
    custody: u64,
    vault: u64,
    treasury: u64,
    claimable: u64,
    reserved: u64,
    deposits: u64,
    payouts: u64,
    forced: u64,
    applied: u64,
    finalized_cut: u64,
    next_order: u64,
    next_lp: u64,
    last_snapshot: u32,
    last_result: u32,
}

#[derive(BorshSerialize)]
struct PoolHeader {
    sqrt: u128,
    liquidity: u128,
    just_below: bool,
    fg0: u128,
    fg1: u128,
    reserve0: u64,
    reserve1: u64,
}

/// All leaves in canonical order. (Books are not committed separately: each level is exactly its
/// orders sorted by id, which the order leaves already fix.)
pub fn leaves(e: &Engine) -> Vec<Hash> {
    let mut out = Vec::new();
    let g = Globals {
        params: &e.params,
        paused: e.paused,
        custody: e.custody,
        vault: e.vault,
        treasury: e.treasury,
        claimable: e.claimable,
        reserved: e.reserved,
        deposits: e.deposits,
        payouts: e.payouts,
        forced: e.forced,
        applied: e.applied,
        finalized_cut: e.finalized_cut,
        next_order: e.next_order,
        next_lp: e.next_lp,
        last_snapshot: e.last_snapshot,
        last_result: e.last_result,
    };
    out.push(leaf(TAG_GLOBALS, &(), &g));
    out.extend(e.accounts.iter().map(|(k, v)| leaf(TAG_ACCOUNT, k, v)));
    out.extend(e.holdings.iter().map(|(k, v)| leaf(TAG_HOLDING, k, v)));
    out.extend(e.markets.iter().map(|(k, v)| leaf(TAG_MARKET, k, v)));
    for (p, pool) in &e.pools {
        let hdr = PoolHeader {
            sqrt: pool.sqrt,
            liquidity: pool.liquidity,
            just_below: pool.just_below,
            fg0: pool.fg0,
            fg1: pool.fg1,
            reserve0: pool.reserve0,
            reserve1: pool.reserve1,
        };
        out.push(leaf(TAG_POOL, p, &hdr));
        out.extend(pool.boundaries.iter().map(|(b, x)| leaf(TAG_BOUNDARY, &(p, b), x)));
    }
    out.extend(e.orders.iter().map(|(k, v)| leaf(TAG_ORDER, k, v)));
    out.extend(e.lps.iter().map(|(k, v)| leaf(TAG_LP, k, v)));
    out.extend(e.locks.iter().map(|(k, v)| leaf(TAG_LOCK, k, v)));
    out.extend(e.calendar.iter().map(|(k, v)| leaf(TAG_CALENDAR, k, v)));
    out.extend(e.snapshots.iter().map(|(k, v)| leaf(TAG_SNAPSHOT, k, v)));
    out.extend(e.election_px.iter().map(|(k, v)| leaf(TAG_ELECTION, k, v)));
    out.extend(e.claims.iter().map(|(k, v)| leaf(TAG_CLAIM, k, v)));
    out.extend(e.pending_rounds.iter().map(|(k, v)| leaf(TAG_PENDING_ROUND, k, v)));
    out
}

pub fn root_of(leaves: &[Hash]) -> Hash {
    if leaves.is_empty() {
        return [0u8; 32];
    }
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = level.chunks(2).map(|c| if c.len() == 2 { node(&c[0], &c[1]) } else { c[0] }).collect();
    }
    level[0]
}

pub fn state_root(e: &Engine) -> Hash {
    root_of(&leaves(e))
}

/// Sibling path for leaf `index`: (sibling, sibling_is_right). Levels where the node is unpaired
/// contribute nothing.
pub fn proof(leaves: &[Hash], mut index: usize) -> Vec<(Hash, bool)> {
    let mut path = Vec::new();
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        let sib = index ^ 1;
        if sib < level.len() {
            path.push((level[sib], sib > index));
        }
        level = level.chunks(2).map(|c| if c.len() == 2 { node(&c[0], &c[1]) } else { c[0] }).collect();
        index /= 2;
    }
    path
}

pub fn verify(root: &Hash, leaf: &Hash, path: &[(Hash, bool)]) -> bool {
    let mut h = *leaf;
    for (sib, right) in path {
        h = if *right { node(&h, sib) } else { node(sib, &h) };
    }
    h == *root
}
