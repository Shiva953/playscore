import {
  COEFFICIENTS,
  hashString,
  planRound,
  windowForRound,
  type MatchPlan,
  EVENT_MATRIX,
  PLAYERS,
  PLAYERS_BY_ID,
  PROTOCOL_CONFIG,
  priceAt,
  spotPrice,
  type EventCode,
  type LeagueCode,
  type PlayerProfile,
  type SimPlayerInput,
  type WindowKind,
} from "@score/core";
import { ProtocolError } from "../errors";
import type { MockState, PlayerRuntime, UserRuntime } from "./state";

export const DAY_MS = 86_400_000;

export function profile(id: string): PlayerProfile {
  const p = PLAYERS_BY_ID[id];
  if (!p) throw new ProtocolError("NOT_FOUND", `No player "${id}".`);
  return p;
}

export function getPlayer(s: MockState, id: string): PlayerRuntime {
  const p = s.players[id];
  if (!p) throw new ProtocolError("NOT_FOUND", `No player "${id}".`);
  return p;
}

/** Spot price: curve while launching, pool once trading. */
export function spot(p: PlayerRuntime): number {
  if (p.status === "trading" && p.pool) return spotPrice(p.pool);
  return priceAt(p.curve.sold);
}

/** Tokens in circulation (not counting the unminted reserve). */
export function circulating(p: PlayerRuntime): number {
  if (p.status === "trading") return p.curve.sold + PROTOCOL_CONFIG.supply.poolSeedTokens + p.minted;
  return p.curve.sold;
}

/** Tokens held in positions (everything circulating that isn't sitting in the pool). */
export function holderTokens(p: PlayerRuntime): number {
  if (p.status === "trading" && p.pool) return Math.max(0, circulating(p) - p.pool.tokens);
  return p.curve.sold;
}

/** Hold-age clock: wall time plus the demo fast-forward offset. */
export function holdNow(s: MockState, now: number): number {
  return now + s.settings.timeOffsetDays * DAY_MS;
}

export function nextId(s: MockState, prefix: string): string {
  s.seq += 1;
  return `${prefix}_${s.seq.toString(36)}`;
}

export function userTokens(u: UserRuntime | null, id: string): number {
  return u?.positions[id]?.tokens ?? 0;
}

export function coefficientFor(kind: WindowKind, league: LeagueCode): number {
  return kind === "ucl" ? COEFFICIENTS.UCL : COEFFICIENTS[league];
}

export function simInputs(s: MockState): SimPlayerInput[] {
  return PLAYERS.filter((p) => s.players[p.id]?.status !== "scheduled").map((p) => ({
    id: p.id,
    club: p.club,
    position: p.position,
    league: p.league,
    avgScore: p.avgScore,
    inUcl: p.inUcl,
  }));
}

const EVENT_LABELS: Partial<Record<EventCode | "kickoff" | "fulltime", string>> = {
  kickoff: "Kick-off",
  fulltime: "Full time",
  shotOnTarget: "Shot on target",
  cleanSheet: "Clean sheet",
  penaltyWon: "Penalty won",
  penaltySaved: "Penalty saved",
  penaltyMissed: "Penalty missed",
};

export function eventLabel(code: EventCode | "kickoff" | "fulltime"): string {
  return EVENT_LABELS[code] ?? (code in EVENT_MATRIX ? EVENT_MATRIX[code as EventCode].label : code);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The round's fixtures, deterministic per world + round, so they can be shown before kickoff. */
export function planFor(s: MockState): MatchPlan {
  const r = s.round;
  const w = windowForRound(r.round);
  const seed = hashString(`${s.createdAt}:${r.round}`);
  return planRound({ round: r.round, kind: w.kind, mode: s.settings.clockMode, players: simInputs(s), seed });
}

export function planSeed(s: MockState): number {
  return hashString(`${s.createdAt}:${s.round.round}`);
}
