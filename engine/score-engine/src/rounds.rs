//! Rounds: calendar, kickoff snapshots, dividend results and claims (spec sections 9 and 13).
//!
//! Off-chain the snapshot is exact: at the round's lock time the sequencer inserts `Snapshot`, which
//! records every holder's balance for every bonded player (no 8-entry SnapBuf limit). A holder's
//! balance is free tokens + tokens in resting asks + the token side of their LP positions at the
//! snapshot price. Protocol seed liquidity is excluded.
//!
//! Dividends are chain-first, in two steps, so custody always holds the USDC before anyone can
//! spend it:
//! 1. `RoundResult` works out each holder's floor(held × payout / circulating) (the sum never
//!    exceeds the payout; rounding dust stays in the vault) and sets the total aside: the vault
//!    figure drops, nobody is credited. The next batch moves that total from the vault account
//!    into custody.
//! 2. `BatchFinalized` (the chain watcher, once a batch covering step 1 is finalized on Solana)
//!    credits the holders. If that batch fails or is rolled back, nothing was credited: the next
//!    batch carries the same lower vault figure and moves it then.
//!
//! (The reference publishes a 1e12-scaled rate instead; this is at least as precise.) The holder
//! then claims USDC, or tokens at +10% from the player's reserve, priced at the snapshot price.

use std::collections::{BTreeMap, BTreeSet};

use crate::engine::{add64, t, to64, u, Engine, Res};
use crate::error::Error;
use crate::fixed::px_from_sqrt;
use crate::math as m;
use crate::types::*;

impl Engine {
    pub(crate) fn publish_calendar(&mut self, ts: i64, round: u32, lock_ts: i64) -> Res<Outcome> {
        if round <= self.last_snapshot {
            return Err(Error::BadRound);
        }
        if let Some(old) = self.calendar.get(&round) {
            if ts >= *old {
                return Err(Error::Locked);
            }
        }
        if lock_ts <= ts {
            return Err(Error::BadRound);
        }
        self.calendar.insert(round, lock_ts);
        Ok(Outcome::None)
    }

    pub(crate) fn snapshot(&mut self, ts: i64, round: u32) -> Res<Outcome> {
        if round != self.last_snapshot + 1 {
            return Err(Error::BadRound);
        }
        let lock = *self.calendar.get(&round).ok_or(Error::BadRound)?;
        if ts < lock {
            return Err(Error::BadRound);
        }
        let mut held: BTreeMap<PlayerId, BTreeMap<UserId, u128>> = self.pools.keys().map(|p| (*p, BTreeMap::new())).collect();
        for ((user, p), h) in &self.holdings {
            if let Some(m) = held.get_mut(p) {
                *m.entry(*user).or_default() += u(h.amount) + u(h.locked);
            }
        }
        for lp in self.lps.values().filter(|l| !l.protocol) {
            let pool = self.pools.get(&lp.player).ok_or(Error::Math)?;
            let (tokens, _) = pool.amounts_for(lp.lower, lp.upper, lp.liquidity, false)?;
            *held.get_mut(&lp.player).ok_or(Error::Math)?.entry(lp.owner).or_default() += tokens;
        }
        let mut snaps = Vec::with_capacity(held.len());
        for (p, holders) in held {
            let px = to64(px_from_sqrt(self.pools[&p].sqrt, false)?)?;
            let mut circulating = 0u128;
            let mut out = BTreeMap::new();
            for (user, v) in holders {
                if v > 0 {
                    circulating += v;
                    out.insert(user, to64(v)?);
                }
            }
            snaps.push(((round, p), Snapshot { px, circulating: to64(circulating)?, holders: out }));
        }
        self.snapshots.extend(snaps);
        self.last_snapshot = round;
        Ok(Outcome::None)
    }

    pub(crate) fn round_result(&mut self, round: u32, payouts: &[(PlayerId, u64)]) -> Res<Outcome> {
        if round != self.last_result + 1 || round > self.last_snapshot {
            return Err(Error::BadRound);
        }
        let mut seen = BTreeSet::new();
        let mut total_payout = 0u128;
        for (p, pay) in payouts {
            if !seen.insert(*p) || !self.snapshots.contains_key(&(round, *p)) {
                return Err(Error::UnknownPlayer);
            }
            total_payout += u(*pay);
        }
        if total_payout > u(self.vault) {
            return Err(Error::NoVault);
        }
        let mut credits: BTreeMap<(UserId, PlayerId), u64> = BTreeMap::new();
        let mut credited = 0u128;
        for (p, pay) in payouts {
            let snap = &self.snapshots[&(round, *p)];
            if snap.circulating == 0 || *pay == 0 {
                continue;
            }
            for (user, h) in &snap.holders {
                let amt = u(*h) * u(*pay) / u(snap.circulating);
                if amt > 0 {
                    credits.insert((*user, *p), to64(amt)?);
                    credited += amt;
                }
            }
        }
        // credited <= Σ payouts <= vault, so neither of these can fail.
        let credited = to64(credited)?;
        let reserved = add64(self.reserved, credited)?;

        // Step 1: set aside. Credited to holders by `batch_finalized` once this command's batch is
        // final on Solana. This command's log sequence number is `applied + 1`.
        self.vault -= credited;
        self.reserved = reserved;
        if credited > 0 {
            self.pending_rounds.insert(round, PendingRound { at: self.applied + 1, total: credited, credits: credits.into_iter().collect() });
        }
        let keys: Vec<_> = self.snapshots.range((round, 0)..=(round, PlayerId::MAX)).map(|(k, _)| *k).collect();
        for k in keys {
            if let Some(s) = self.snapshots.remove(&k) {
                self.election_px.insert(k, s.px);
            }
        }
        self.last_result = round;
        Ok(Outcome::None)
    }

    /// Step 2: the batch covering the log up to `cut` is final on Solana, so the vault → custody move
    /// for every round set aside at or before `cut` is final: credit those holders.
    pub(crate) fn batch_finalized(&mut self, cut: u64) -> Res<Outcome> {
        if cut < self.finalized_cut || cut > self.applied {
            return Err(Error::BadSequence);
        }
        let ready: Vec<u32> = self.pending_rounds.iter().filter(|(_, r)| r.at <= cut).map(|(k, _)| *k).collect();
        let mut claimable = self.claimable;
        let mut reserved = self.reserved;
        let mut credits: Vec<((UserId, u32, PlayerId), u64)> = Vec::new();
        for round in &ready {
            let r = &self.pending_rounds[round];
            claimable = add64(claimable, r.total)?;
            reserved = reserved.checked_sub(r.total).ok_or(Error::Math)?;
            for ((user, p), amt) in &r.credits {
                let k = (*user, *round, *p);
                self.claims.get(&k).map_or(Some(*amt), |c| c.checked_add(*amt)).ok_or(Error::Math)?;
                credits.push((k, *amt));
            }
        }

        self.finalized_cut = cut;
        self.claimable = claimable;
        self.reserved = reserved;
        for (k, a) in credits {
            *self.claims.entry(k).or_default() += a;
        }
        for round in ready {
            self.pending_rounds.remove(&round);
        }
        Ok(Outcome::None)
    }

    pub(crate) fn claim(&mut self, ts: i64, user: &UserId, nonce: u64, round: u32, player: PlayerId, take_tokens: bool) -> Res<Outcome> {
        self.check_nonce(user, nonce)?;
        let key = (*user, round, player);
        let amt = *self.claims.get(&key).ok_or(Error::NothingToClaim)?;
        let mut tx = self.begin();
        tx.claimable = tx.claimable.checked_sub(amt).ok_or(Error::Math)?;
        let mut emitted = None;
        if take_tokens {
            let mk = self.market_in(player, MarketState::Bonded)?;
            let px = *self.election_px.get(&(round, player)).ok_or(Error::BadRound)?;
            let tokens = to64(m::emit_tokens(u(amt), u(px))?)?;
            if tokens == 0 {
                return Err(Error::BadAmount);
            }
            if tokens > mk.reserve_left {
                // Spec section 13: the election fails and the holder takes USDC instead.
                return Err(Error::ReserveLow);
            }
            // The USDC stays in the vault, extending its runway.
            tx.vault = add64(tx.vault, amt)?;
            let h = self.hold(&mut tx, user, player);
            h.entry_ts = m::new_entry_ts(t(h.entry_ts), u(h.amount) + u(h.locked), u(tokens), t(ts))? as i64;
            h.amount = add64(h.amount, tokens)?;
            let minted = add64(mk.minted, tokens)?;
            emitted = Some((tokens, minted, mk.reserve_left - tokens));
        } else {
            let a = self.acct(&mut tx, user);
            a.free = add64(a.free, amt)?;
        }
        self.acct(&mut tx, user).nonce = nonce;

        self.commit(tx);
        self.claims.remove(&key);
        if let Some((tokens, minted, reserve_left)) = emitted {
            let mk = self.markets.get_mut(&player).expect("checked above");
            mk.minted = minted;
            mk.reserve_left = reserve_left;
            return Ok(Outcome::Claimed { usdc: 0, tokens });
        }
        Ok(Outcome::Claimed { usdc: amt, tokens: 0 })
    }
}
