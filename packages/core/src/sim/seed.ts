import { DEMO_DEFAULTS, PROTOCOL_CONFIG } from "../config";
import { S_MAX, priceAt, soldForRaised, type CurveState } from "../curve";
import { POOL_OPEN_PRICE, reserveAfterBond } from "../bonding";
import { createPool, quoteAddLiquidity, type PoolState } from "../pool";
import { launchSlots } from "../calendar";
import { createRng } from "./rng";
import { PLAYERS, type PlayerProfile } from "./players";

export type PlayerStatus = "scheduled" | "launching" | "trading";

export interface PricePoint {
  /** ms timestamp */
  t: number;
  p: number;
}

export interface FormEntry {
  /** Label for the matchday, e.g. "MD −3" or "R2". */
  label: string;
  round: number | null;
  /** Display score 0–10. */
  score: number;
  /** Best board rank (lower is better). */
  rank: number;
}

export interface SeedPlayerState {
  id: string;
  status: PlayerStatus;
  launchAt: number | null;
  bondedAt: number | null;
  curve: CurveState;
  pool: PoolState | null;
  reserveLeft: number;
  minted: number;
  priceHistory: PricePoint[];
  /** Background 24h volume before any simulated trades (prototype `v24`). */
  baseVolume24h: number;
  /** Lifetime dividends paid to this player's holders (prototype `div`). */
  dividendsPaid: number;
  form: FormEntry[];
}

export interface WorldSeed {
  createdAt: number;
  players: readonly PlayerProfile[];
  state: Record<string, SeedPlayerState>;
  vault: number;
  treasury: number;
}

const HIST_POINTS = 48;
const HIST_STEP_MS = 3 * 3_600_000;

/** Reserves for a seeded bonded pool that traded from the open price to `price` with no fees (SPEC-QUESTION: SQ-27). */
export function seededPoolAtPrice(price: number): PoolState {
  const k = PROTOCOL_CONFIG.bond.poolSeedShare * PROTOCOL_CONFIG.curve.bondThresholdUsdc * PROTOCOL_CONFIG.supply.poolSeedTokens;
  const pool = createPool(Math.sqrt(k * price), Math.sqrt(k / price));
  return pool;
}

/**
 * Builds the demo world exactly from the prototype's seeded randomness:
 * 6 bonded, 4 launching, 20 scheduled; vault $60,000.
 */
export function buildSeed(now: number): WorldSeed {
  const state: Record<string, SeedPlayerState> = {};
  const scheduled = PLAYERS.filter((p) => p.index >= DEMO_DEFAULTS.bondedAtStart + DEMO_DEFAULTS.launchingAtStart);
  const slots = launchSlots(now + 60_000, scheduled.length);

  for (const p of PLAYERS) {
    const r = createRng(p.index * 977 + 13);
    const base = 0.0062 + p.avgScore * 0.00035 + r.next() * 0.001;
    let v = base;
    const walk: number[] = [];
    for (let k = 0; k < HIST_POINTS; k++) {
      v *= 1 + (r.next() - 0.46) * 0.07;
      walk.push(v);
    }
    const dividendsPaid = Math.round((p.avgScore - 5) * r.next() * 9000 + 2000);
    const baseVolume24h = Math.round(15000 + r.next() * 90000);
    const bonded = p.index < DEMO_DEFAULTS.bondedAtStart;
    // The prototype's ternary skips the draw for bonded players, which shifts later draws. Kept for parity.
    const raised = bonded ? PROTOCOL_CONFIG.curve.bondThresholdUsdc : Math.round(4000 + r.next() * 17000);
    const xlp = Math.round(r.next() * 15000);
    const md = Array.from({ length: 8 }, () => Math.max(1, Math.min(10, p.avgScore + (r.next() - 0.5) * 3)));
    const rk = Array.from({ length: 8 }, () => Math.ceil(r.next() * (p.avgScore > 8 ? 5 : 9)));
    const form: FormEntry[] = md.map((score, i) => ({ label: `MD −${8 - i}`, round: null, score, rank: rk[i]! }));

    const start = now - (HIST_POINTS - 1) * HIST_STEP_MS;
    if (bonded) {
      const last = walk[walk.length - 1]!;
      let pool = seededPoolAtPrice(last);
      if (xlp > 0) {
        const add = quoteAddLiquidity(pool, xlp / 2);
        if (add.ok) pool = add.next;
      }
      state[p.id] = {
        id: p.id,
        status: "trading",
        launchAt: start - 4 * 86_400_000,
        bondedAt: start - 86_400_000,
        curve: { sold: S_MAX, raised: PROTOCOL_CONFIG.curve.bondThresholdUsdc },
        pool,
        reserveLeft: reserveAfterBond(S_MAX),
        minted: 0,
        priceHistory: walk.map((p_, i) => ({ t: start + i * HIST_STEP_MS, p: p_ })),
        baseVolume24h,
        dividendsPaid,
        form,
      };
    } else if (p.index < DEMO_DEFAULTS.bondedAtStart + DEMO_DEFAULTS.launchingAtStart) {
      const sold = soldForRaised(raised);
      const hist: PricePoint[] = [];
      for (let i = 0; i < HIST_POINTS; i++) {
        const frac = Math.pow((i + 1) / HIST_POINTS, 1.15);
        hist.push({ t: start + i * HIST_STEP_MS, p: priceAt(sold * frac) });
      }
      state[p.id] = {
        id: p.id,
        status: "launching",
        launchAt: start,
        bondedAt: null,
        curve: { sold, raised },
        pool: null,
        reserveLeft: PROTOCOL_CONFIG.supply.reserve,
        minted: 0,
        priceHistory: hist,
        baseVolume24h: Math.round(baseVolume24h * 0.15),
        dividendsPaid: 0,
        form,
      };
    } else {
      const slot = slots[scheduled.indexOf(p)] ?? now;
      state[p.id] = {
        id: p.id,
        status: "scheduled",
        launchAt: slot,
        bondedAt: null,
        curve: { sold: 0, raised: 0 },
        pool: null,
        reserveLeft: PROTOCOL_CONFIG.supply.reserve,
        minted: 0,
        priceHistory: [],
        baseVolume24h: 0,
        dividendsPaid: 0,
        form,
      };
    }
  }
  return { createdAt: now, players: PLAYERS, state, vault: DEMO_DEFAULTS.initialVault, treasury: 0 };
}

export { POOL_OPEN_PRICE };
