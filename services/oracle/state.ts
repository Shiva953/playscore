// Oracle state: everything the engine doesn't hold (player id map, launch schedule, the live round's
// match simulation, round results with their boards, form). Saved as JSON (temp file + rename) so a
// restart resumes the same round and never re-rolls a match that's already under way.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FormEntry, MatchPlan, SimState } from "@score/core";
import type { BoardView, MatchEventView, RoundPhase } from "@/lib/protocol/types";

export interface RoundRuntime {
  round: number;
  phase: RoundPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  kickoffAt: number;
  liveEndsAt: number;
  settleAt: number;
  seed: number;
  /** PublishCalendar accepted for this round. */
  published: boolean;
  /** Snapshot accepted: the players bonded at kickoff (registry ids). */
  bondedAtKickoff: string[] | null;
  plan: MatchPlan | null;
  sim: SimState | null;
  liveProgress: number;
  events: MatchEventView[];
  resultSent: boolean;
}

export interface OracleResult {
  round: number;
  windowLabel: string;
  kind: "league" | "ucl";
  settledAt: number;
  pool: number;
  bps: number;
  effectiveRate: number;
  boards: BoardView[];
  /** Registry id → USDC paid to that player's holders. */
  payouts: Record<string, number>;
  perPlayer: Record<string, { points: number; display: number; bestRank: number | null }>;
}

export interface OracleState {
  version: 1;
  /** Registry id → engine player id. Assigned once, never reused. */
  ids: Record<string, number>;
  nextId: number;
  /** Registry id → launch time (ms) for players not listed yet. */
  schedule: Record<string, number>;
  listedAt: Record<string, number>;
  round: RoundRuntime | null;
  results: OracleResult[];
  form: Record<string, FormEntry[]>;
  payHistory: number[];
  prevBps: number | null;
  /** Faucet use per Privy user (or address in open mode). */
  faucet: Record<string, { total: number; times: number[] }>;
  /** Sign-in gate answers per Privy user. */
  profiles: Record<string, { country: string; acceptedTerms: boolean; address: string; at: number }>;
}

export function emptyState(): OracleState {
  return { version: 1, ids: {}, nextId: 1001, schedule: {}, listedAt: {}, round: null, results: [], form: {}, payHistory: [], prevBps: null, faucet: {}, profiles: {} };
}

export class Store {
  state: OracleState;
  private dirty = false;
  constructor(readonly path: string) {
    this.state = existsSync(path) ? { ...emptyState(), ...JSON.parse(readFileSync(path, "utf8")) } : emptyState();
    mkdirSync(dirname(path), { recursive: true });
    setInterval(() => this.flush(), 1_000).unref?.();
  }
  touch(): void {
    this.dirty = true;
  }
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.path);
  }
}
