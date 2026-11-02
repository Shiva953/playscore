import { lpTokensFor, nonProtocolPoolTokens, type PoolState } from "./pool";

/**
 * Dividend eligibility (ARCHITECTURE §4.6, §5.1). One snapshot per round at first kickoff:
 * wallet-held position tokens + tokens attributable to the holder's LP shares.
 * Buying after kickoff earns nothing this round; selling after kickoff still earns in full.
 */

export interface HolderSnapshot {
  /** Position tokens at kickoff. */
  tokens: number;
  /** Pool tokens attributable to the holder's LP shares at kickoff. */
  lpTokens: number;
}

export function snapshotHolder(positionTokens: number, lpShares: number, pool: PoolState | null): HolderSnapshot {
  return { tokens: positionTokens, lpTokens: pool && lpShares > 0 ? lpTokensFor(pool, lpShares) : 0 };
}

export function eligibleTokens(s: HolderSnapshot | undefined): number {
  return s ? s.tokens + s.lpTokens : 0;
}

/**
 * Total tokens that share a player's payout: every holder balance plus every non-protocol LP share
 * of the pool's tokens. The protocol seed's share is excluded (it earns nothing).
 *
 * This replaces the prototype's denominator `p.sold`, which overpays when the price is above the pool
 * open (holders then hold more than 6.4M tokens). SPEC-QUESTION: SQ-1.
 *
 * @param holderTokens all tokens held in positions (= curve sold + pool seed + reserve minted − pool tokens)
 */
export function eligibleSupplyAtSnapshot(holderTokens: number, pool: PoolState | null): number {
  return Math.max(0, holderTokens) + (pool ? nonProtocolPoolTokens(pool) : 0);
}

/** Holder share of a player's payout = payout × holderEligible / eligibleSupply. Σ over holders ≤ payout. */
export function holderPayout(playerPayout: number, holderEligible: number, eligibleSupply: number): number {
  if (!(eligibleSupply > 0) || !(holderEligible > 0)) return 0;
  return (playerPayout * Math.min(holderEligible, eligibleSupply)) / eligibleSupply;
}

/**
 * The prototype's formula, kept only to document the bug (see tests): payout × held / curveSold.
 * Do not use for payouts.
 * @deprecated SPEC-QUESTION: SQ-1
 */
export function prototypeHolderPayout(playerPayout: number, heldTokens: number, curveSold: number): number {
  return curveSold > 0 ? (playerPayout * heldTokens) / curveSold : 0;
}

/**
 * Lazy snapshot helper for the future program (ARCHITECTURE §6.2): no iteration over holders.
 * Before any balance change, call `touchPosition` with the latest round whose kickoff has passed.
 * Assumes each round settles before the next kickoff (true for the calendar and the demo clock),
 * so a position touched after round N+1's kickoff has already accrued round N.
 */
export interface LazyPosition {
  balance: number;
  lastRound: number;
  balanceAtRoundStart: number;
}

export function touchPosition(pos: LazyPosition, liveRound: number): LazyPosition {
  if (liveRound > pos.lastRound) {
    return { ...pos, lastRound: liveRound, balanceAtRoundStart: pos.balance };
  }
  return pos;
}

export function eligibleForRound(pos: LazyPosition, round: number): number {
  if (pos.lastRound === round) return pos.balanceAtRoundStart;
  if (pos.lastRound < round) return pos.balance;
  throw new Error(`round ${round} must be accrued before the position is touched in round ${pos.lastRound}`);
}
