import { POSITIONS, PROTOCOL_CONFIG, type LeagueCode, type PositionCode } from "./config";
import { sum } from "./math";

const B = PROTOCOL_CONFIG.boards;

/**
 * Boards (client decision, Nov 2026): one per position across all leagues, plus the Champions
 * League board in UCL windows. Per-league boards were removed. Defenders, midfielders and forwards
 * pay a top 5 (35/25/20/12/8%); goalkeepers a top 3 (44/31/25%).
 */
export type BoardKind = "position" | "ucl";

export interface BoardDef {
  key: string;
  kind: BoardKind;
  label: string;
  multiplier: number;
  /** Payout shares by rank; its length is the number of paid places. */
  shares: readonly number[];
}

/** One ranked player's frozen (or provisional) result for the window. */
export interface RankEntry {
  playerId: string;
  position: PositionCode;
  league: LeagueCode;
  /** Ranking points P (coefficient applied). */
  points: number;
  goals: number;
  assists: number;
  minutes: number;
  /** Played in the Champions League this window. */
  ucl?: boolean;
}

export function boardDefinitions(uclWindow: boolean): BoardDef[] {
  const defs: BoardDef[] = POSITIONS.map((p) => ({
    key: `pos:${p}`,
    kind: "position" as const,
    label: p,
    multiplier: B.positionMultiplier,
    shares: p === "GK" ? B.gkShares : B.payoutShares,
  }));
  if (uclWindow) defs.push({ key: "ucl", kind: "ucl", label: "Champions League", multiplier: B.uclMultiplier, shares: B.payoutShares });
  return defs;
}

/**
 * Ranking order: points desc → goals + assists desc → fewer minutes → player ID ascending.
 * SPEC-QUESTION: SQ-21 (ID direction).
 */
export function compareEntries(a: RankEntry, b: RankEntry): number {
  if (b.points !== a.points) return b.points - a.points;
  const ga = a.goals + a.assists;
  const gb = b.goals + b.assists;
  if (gb !== ga) return gb - ga;
  if (a.minutes !== b.minutes) return a.minutes - b.minutes;
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
}

function belongs(def: BoardDef, e: RankEntry): boolean {
  if (def.kind === "position") return `pos:${e.position}` === def.key;
  return !!e.ucl;
}

export interface RankedBoard {
  def: BoardDef;
  /** Every ranked player on this board, best first. */
  entries: RankEntry[];
}

/** Only players who played (minutes > 0) are ranked. */
export function buildBoards(entries: readonly RankEntry[], uclWindow: boolean): RankedBoard[] {
  const played = entries.filter((e) => e.minutes > 0);
  return boardDefinitions(uclWindow).map((def) => ({
    def,
    entries: played.filter((e) => belongs(def, e)).sort(compareEntries),
  }));
}

/** A board's payout shares, renormalised to sum to 1 when fewer players than paid places rank. */
export function payoutShares(rankedCount: number, shares: readonly number[] = B.payoutShares): number[] {
  const k = Math.min(rankedCount, shares.length);
  if (k <= 0) return [];
  const raw = shares.slice(0, k);
  const total = sum(raw);
  return raw.map((s) => s / total);
}

/** weight = min(ranked, paid places) × multiplier */
export function boardWeight(rankedCount: number, multiplier: number, places: number = B.maxRanked): number {
  return Math.min(rankedCount, places) * multiplier;
}

export interface BoardWinner {
  playerId: string;
  rank: number;
  points: number;
  share: number;
  usd: number;
}

export interface BoardPayout extends RankedBoard {
  weight: number;
  /** USD allocated to this board. */
  poolUsd: number;
  winners: BoardWinner[];
}

export interface RoundAllocation {
  roundPool: number;
  totalWeight: number;
  boards: BoardPayout[];
  /** Sum of each player's board winnings. */
  playerPayouts: Record<string, number>;
  /** Total actually allocated (0 if nobody ranked). */
  allocated: number;
}

/** Board share = roundPool × weight / Σ weights; within a board its own shares (renormalised). */
export function allocateRoundPool(boards: readonly RankedBoard[], roundPool: number): RoundAllocation {
  const weighted = boards.map((b) => ({ ...b, weight: boardWeight(b.entries.length, b.def.multiplier, b.def.shares.length) }));
  const totalWeight = sum(weighted.map((b) => b.weight));
  const playerPayouts: Record<string, number> = {};
  let allocated = 0;
  const out: BoardPayout[] = weighted.map((b) => {
    const poolUsd = totalWeight > 0 ? (roundPool * b.weight) / totalWeight : 0;
    const shares = payoutShares(b.entries.length, b.def.shares);
    const winners: BoardWinner[] = shares.map((share, i) => {
      const e = b.entries[i]!;
      const usd = poolUsd * share;
      playerPayouts[e.playerId] = (playerPayouts[e.playerId] ?? 0) + usd;
      allocated += usd;
      return { playerId: e.playerId, rank: i + 1, points: e.points, share, usd };
    });
    return { ...b, poolUsd, winners };
  });
  return { roundPool, totalWeight, boards: out, playerPayouts, allocated };
}

/** Which boards a player currently places on (a paid rank), for "#1 FWD · #2 GK" style labels. */
export function placementsFor(allocation: RoundAllocation, playerId: string): { board: BoardDef; rank: number; usd: number }[] {
  const out: { board: BoardDef; rank: number; usd: number }[] = [];
  for (const b of allocation.boards) {
    const w = b.winners.find((x) => x.playerId === playerId);
    if (w) out.push({ board: b.def, rank: w.rank, usd: w.usd });
  }
  return out;
}
