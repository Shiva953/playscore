import {
  DEMO_DEFAULTS,
  buildSeed,
  emptyPoints,
  type ActivityPoints,
  type ClaimRow,
  type HolderSnapshot,
  type MatchPlan,
  type RoundPhase,
  type SeedPlayerState,
  type SimState,
} from "@score/core";
import type { ActivityItem, DemoSettings, MatchEventView, RoundResult, TradeRecord, UserSession } from "../types";

export const STATE_VERSION = 1;

export interface PlayerRuntime extends SeedPlayerState {
  /** Synthetic demand bias from live events (−1..1). Demo only. */
  momentum: number;
  trades: TradeRecord[];
  volumeLog: { t: number; usd: number }[];
}

export interface UserPosition {
  tokens: number;
  /** Weighted acquisition time (hold-age clock, includes the demo time offset). */
  ts: number;
  costBasis: number;
  /** Gross cumulative curve purchases (cap accounting, SQ-19). */
  curvePurchased: number;
  realizedPnl: number;
}

export interface UserLp {
  shares: number;
  /** Hold-age time of the tokens inside the LP position. */
  ts: number;
  depositedUsd: number;
  feeGrowthEntry: number;
  feesAccrued: number;
  entryPrice: number;
}

export interface UserRuntime {
  session: UserSession;
  usdc: number;
  positions: Record<string, UserPosition>;
  lp: Record<string, UserLp>;
  claims: ClaimRow[];
  history: ActivityItem[];
  points: ActivityPoints;
  dividendsEarned: number;
  feesPaid: number;
  faucetTotal: number;
}

export interface RoundSnapshot {
  at: number;
  /** Players bonded at kickoff: the only ones that rank this round (SQ-30). */
  bonded: string[];
  /** Eligible supply per player (SQ-1 denominator). */
  eligibleSupply: Record<string, number>;
  /** The user's snapshot per player. */
  user: Record<string, HolderSnapshot>;
}

export interface RoundRuntime {
  round: number;
  phase: RoundPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  plan: MatchPlan | null;
  sim: SimState | null;
  liveProgress: number;
  events: MatchEventView[];
  snapshot: RoundSnapshot | null;
}

export interface StoredResult extends RoundResult {
  perPlayer: Record<string, { payout: number; eligibleSupply: number; points: number; display: number; bestRank: number | null }>;
}

export interface MockState {
  version: number;
  createdAt: number;
  seq: number;
  rngState: number;
  vault: number;
  treasury: number;
  totalPaidOut: number;
  feesCollected: number;
  payHistory: number[];
  prevBps: number | null;
  players: Record<string, PlayerRuntime>;
  round: RoundRuntime;
  results: StoredResult[];
  /** Recent trades across all players (newest first). */
  tape: TradeRecord[];
  user: UserRuntime | null;
  settings: DemoSettings;
  /** Lab pin: phase time already elapsed and still remaining when the moment was pinned. */
  pin?: { elapsed: number; remaining: number } | null;
}

export const DEFAULT_SETTINGS: DemoSettings = {
  clockMode: "demo",
  openSeconds: DEMO_DEFAULTS.openSeconds,
  liveSeconds: DEMO_DEFAULTS.liveSeconds,
  freezeSeconds: DEMO_DEFAULTS.freezeSeconds,
  ambientMarket: true,
  failureRate: 0,
  latencyMs: 120,
  timeOffsetDays: 0,
  pinned: false,
};

export function createInitialState(now: number, settings: DemoSettings = DEFAULT_SETTINGS): MockState {
  const seed = buildSeed(now);
  const players: Record<string, PlayerRuntime> = {};
  for (const [id, st] of Object.entries(seed.state)) {
    players[id] = { ...st, momentum: 0, trades: [], volumeLog: [] };
  }
  return {
    version: STATE_VERSION,
    createdAt: now,
    seq: 1,
    rngState: (now % 4294967296) >>> 0,
    vault: seed.vault,
    treasury: seed.treasury,
    totalPaidOut: 0,
    feesCollected: 0,
    payHistory: [],
    prevBps: null,
    players,
    round: {
      round: 1,
      phase: "open",
      phaseStartedAt: now,
      phaseEndsAt: now + settings.openSeconds * 1000,
      plan: null,
      sim: null,
      liveProgress: 0,
      events: [],
      snapshot: null,
    },
    results: [],
    tape: [],
    user: null,
    settings: { ...settings },
  };
}

export function newUser(session: UserSession): UserRuntime {
  return {
    session,
    usdc: 0,
    positions: {},
    lp: {},
    claims: [],
    history: [],
    points: emptyPoints(),
    dividendsEarned: 0,
    feesPaid: 0,
    faucetTotal: 0,
  };
}

export function isMockState(v: unknown): v is MockState {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { version?: unknown }).version === STATE_VERSION &&
    typeof (v as { players?: unknown }).players === "object"
  );
}
