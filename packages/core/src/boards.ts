import {
  COEFFICIENTS,
  LEAGUE_NAMES,
  LEAGUES,
  POSITIONS,
  PROTOCOL_CONFIG,
  type LeagueCode,
  type PositionCode,
} from "./config";
import { sum } from "./math";

const B = PROTOCOL_CONFIG.boards;

export type BoardKind = "position" | "league" | "ucl";

export interface BoardDef {
  key: string;
  kind: BoardKind;
  label: string;
  multiplier: number;
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
  }));
  for (const lg of LEAGUES) {
    defs.push({ key: `lg:${lg}`, kind: "league", label: LEAGUE_NAMES[lg], multiplier: COEFFICIENTS[lg] });
  }
  if (uclWindow) defs.push({ key: "ucl", kind: "ucl", label: "Champions League", multiplier: B.uclMultiplier });
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
  if (def.kind === "league") return `lg:${e.league}` === def.key;
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

/** Top-k payout shares, renormalised to sum to 1 when fewer than 5 are ranked. */
export function payoutShares(rankedCount: number): number[] {
  const k = Math.min(rankedCount, B.maxRanked);
  if (k <= 0) return [];
  const raw = B.payoutShares.slice(0, k);
  const total = sum(raw);
  return raw.map((s) => s / total);
}

/** weight = min(ranked, 5) × multiplier */
export function boardWeight(rankedCount: number, multiplier: number): number {
  return Math.min(rankedCount, B.maxRanked) * multiplier;
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

/** Board share = roundPool × weight / Σ weights; within a board 35/25/20/12/8 (renormalised). */
export function allocateRoundPool(boards: readonly RankedBoard[], roundPool: number): RoundAllocation {
  const weighted = boards.map((b) => ({ ...b, weight: boardWeight(b.entries.length, b.def.multiplier) }));
  const totalWeight = sum(weighted.map((b) => b.weight));
  const playerPayouts: Record<string, number> = {};
  let allocated = 0;
  const out: BoardPayout[] = weighted.map((b) => {
    const poolUsd = totalWeight > 0 ? (roundPool * b.weight) / totalWeight : 0;
    const shares = payoutShares(b.entries.length);
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

/** Which boards a player currently places on (rank ≤ 5), for "#1 FWD · #2 PL" style labels. */
export function placementsFor(allocation: RoundAllocation, playerId: string): { board: BoardDef; rank: number; usd: number }[] {
  const out: { board: BoardDef; rank: number; usd: number }[] = [];
  for (const b of allocation.boards) {
    const w = b.winners.find((x) => x.playerId === playerId);
    if (w) out.push({ board: b.def, rank: w.rank, usd: w.usd });
  }
  return out;
}
