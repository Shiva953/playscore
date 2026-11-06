//! Exit table: what each user is paid if the program enters exit mode (the operator stops
//! committing, or ignores a forced request). The batch commits `exit_root` next to the state root,
//! and in exit mode a user withdraws by proving their one leaf: `user -> { usdc, pending locks }`.
//!
//! Per user:
//! - USDC: free + resting bids + unclaimed dividend credits;
//! - each bonded player: their user LP positions' USDC side and earned USDC fees go to them
//!   directly. Every token they hold (free, in asks, and the token side and token fees of their
//!   LP positions) redeems pro rata from the rest of that pool's USDC, with no tax (spec section 15
//!   delisting maths). Protocol seed tokens take no share;
//! - each ICO-stage player: tokens redeem pro rata from the curve's raised USDC;
//! - pending withdrawal locks are listed separately with their voucher ids. The program pays a
//!   lock only if that voucher was never paid on-chain, or was recorded as a request that was
//!   never settled.
//!
//! The table is the state at the batch's cut. The program settles each user against it plus the
//! on-chain activity after the cut, from its `Pending` log: their later deposits are added, and
//! voucher payouts after the cut for locks not in this table (so still inside `usdc`) are
//! subtracted. Nothing is lost or paid twice.
//!
//! Every pot is divided with floor rounding, so the table never pays out more than custody holds
//! (minus the vault and treasury, which stay for governance).

use std::collections::BTreeMap;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::engine::{to64, u, Engine, Res};
use crate::error::Error;
use crate::pool::fee_owed;
use crate::state_root::{leaf, proof, root_of};
use crate::types::*;
use crate::wal::Hash;

pub const TAG_EXIT: &[u8] = b"exit";

#[derive(Debug, Clone, Default, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct ExitEntry {
    pub usdc: u64,
    /// (voucher id, amount) of every pending withdrawal lock.
    pub locks: Vec<(u64, u64)>,
}

/// Leaf = sha256(0x00 || "exit" || user || usdc u64 LE || n u32 LE || (id u64 LE, amount u64 LE)*).
pub fn exit_leaf(user: &UserId, e: &ExitEntry) -> Hash {
    leaf(TAG_EXIT, user, e)
}

pub fn exit_table(e: &Engine) -> Res<BTreeMap<UserId, ExitEntry>> {
    let mut usdc: BTreeMap<UserId, u128> = BTreeMap::new();
    for (k, a) in &e.accounts {
        *usdc.entry(*k).or_default() += u(a.free) + u(a.in_orders);
    }
    for ((user, _, _), amt) in &e.claims {
        *usdc.entry(*user).or_default() += u(*amt);
    }
    // Dividends set aside but not yet credited: the batch committing this table moves them into
    // custody, so they're owed to their holders here too.
    for r in e.pending_rounds.values() {
        for ((user, _), amt) in &r.credits {
            *usdc.entry(*user).or_default() += u(*amt);
        }
    }
    // Token units per (player, user), and pots per player.
    let mut units: BTreeMap<PlayerId, BTreeMap<UserId, u128>> = BTreeMap::new();
    let mut pot: BTreeMap<PlayerId, u128> = BTreeMap::new();
    for ((user, p), h) in &e.holdings {
        *units.entry(*p).or_default().entry(*user).or_default() += u(h.amount) + u(h.locked);
    }
    for (p, mk) in &e.markets {
        match mk.state {
            MarketState::IcoLive => {
                pot.insert(*p, u(mk.raised));
            }
            MarketState::Bonded => {
                let pool = e.pools.get(p).ok_or(Error::Math)?;
                pot.insert(*p, u(pool.reserve1));
            }
        }
    }
    for lp in e.lps.values().filter(|l| !l.protocol) {
        let pool = e.pools.get(&lp.player).ok_or(Error::Math)?;
        let (a0, a1) = pool.amounts_for(lp.lower, lp.upper, lp.liquidity, false)?;
        let (in0, in1) = pool.fee_inside(lp.lower, lp.upper);
        let f0 = lp.owed0 + fee_owed(lp.liquidity, in0.wrapping_sub(lp.inside0))?;
        let f1 = lp.owed1 + fee_owed(lp.liquidity, in1.wrapping_sub(lp.inside1))?;
        // The LP's USDC side comes out of the pool's USDC first (pool solvency guarantees it fits).
        let p = pot.get_mut(&lp.player).ok_or(Error::Math)?;
        *p = p.checked_sub(a1 + f1).ok_or(Error::Math)?;
        *usdc.entry(lp.owner).or_default() += a1 + f1;
        *units.entry(lp.player).or_default().entry(lp.owner).or_default() += a0 + f0;
    }
    for (p, holders) in &units {
        let total: u128 = holders.values().sum();
        let pot = pot.get(p).copied().unwrap_or(0);
        if total == 0 {
            continue;
        }
        for (user, n) in holders {
            *usdc.entry(*user).or_default() += pot * n / total;
        }
    }
    let mut locks: BTreeMap<UserId, Vec<(u64, u64)>> = BTreeMap::new();
    for (id, l) in &e.locks {
        locks.entry(l.user).or_default().push((*id, l.amount));
    }
    let mut out = BTreeMap::new();
    for (user, v) in usdc {
        let ls = locks.remove(&user).unwrap_or_default();
        if v > 0 || !ls.is_empty() {
            out.insert(user, ExitEntry { usdc: to64(v)?, locks: ls });
        }
    }
    for (user, ls) in locks {
        out.insert(user, ExitEntry { usdc: 0, locks: ls });
    }
    Ok(out)
}

pub fn exit_leaves(table: &BTreeMap<UserId, ExitEntry>) -> Vec<Hash> {
    table.iter().map(|(k, v)| exit_leaf(k, v)).collect()
}

pub fn exit_root(e: &Engine) -> Res<Hash> {
    Ok(root_of(&exit_leaves(&exit_table(e)?)))
}

/// The proof a user submits to `exit_withdraw`.
pub fn exit_proof(table: &BTreeMap<UserId, ExitEntry>, user: &UserId) -> Option<(ExitEntry, Vec<(Hash, bool)>)> {
    let idx = table.keys().position(|k| k == user)?;
    Some((table[user].clone(), proof(&exit_leaves(table), idx)))
}
