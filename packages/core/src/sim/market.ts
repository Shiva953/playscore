import type { EventCode } from "../config";
import { between, logUniform, type Rng } from "./rng";

/**
 * Ambient demo market: synthetic traders whose orders go through the real curve/pool maths
 * (fees routed normally), so prices, the vault and launches move during a demo.
 * Demo-only (SPEC-QUESTION: SQ-28).
 */

export type AmbientIntent =
  | { kind: "pool-buy"; playerId: string; usdc: number }
  | { kind: "pool-sell"; playerId: string; usdc: number; holdAgeDays: number }
  | { kind: "curve-buy"; playerId: string; usdc: number }
  | { kind: "curve-sell"; playerId: string; usdc: number };

export interface AmbientCandidates {
  bonded: readonly { id: string; momentum: number }[];
  launching: readonly { id: string }[];
}

function weightedPick<T>(rng: Rng, items: readonly T[], weight: (t: T) => number): T | null {
  const total = items.reduce((s, t) => s + weight(t), 0);
  if (!(total > 0)) return null;
  let r = rng.next() * total;
  for (const t of items) {
    r -= weight(t);
    if (r <= 0) return t;
  }
  return items[items.length - 1] ?? null;
}

export function nextAmbientIntent(rng: Rng, c: AmbientCandidates): AmbientIntent | null {
  const useLaunch = c.launching.length > 0 && (c.bonded.length === 0 || rng.next() < 0.3);
  if (useLaunch) {
    const l = c.launching[Math.floor(rng.next() * c.launching.length)]!;
    if (rng.next() < 0.85) return { kind: "curve-buy", playerId: l.id, usdc: logUniform(rng, 20, 350) };
    return { kind: "curve-sell", playerId: l.id, usdc: logUniform(rng, 10, 120) };
  }
  const b = weightedPick(rng, c.bonded, (x) => 1 + Math.abs(x.momentum) * 3);
  if (!b) return null;
  const sellProb = Math.min(0.9, Math.max(0.1, 0.5 - b.momentum * 0.35));
  const usdc = logUniform(rng, 15, 450) * (1 + Math.abs(b.momentum));
  if (rng.next() < sellProb) return { kind: "pool-sell", playerId: b.id, usdc, holdAgeDays: between(rng, 0, 150) };
  return { kind: "pool-buy", playerId: b.id, usdc };
}

/** How a live event nudges synthetic demand for the player (−1..1 scale). */
export function momentumImpulse(code: EventCode | "kickoff" | "fulltime"): number {
  switch (code) {
    case "goal":
      return 0.6;
    case "assist":
      return 0.35;
    case "penaltySaved":
      return 0.4;
    case "cleanSheet":
      return 0.2;
    case "shotOnTarget":
    case "save":
      return 0.05;
    case "penaltyWon":
      return 0.1;
    case "yellow":
      return -0.1;
    case "red":
      return -0.5;
    case "penaltyMissed":
    case "ownGoal":
    case "errorToGoal":
      return -0.4;
    default:
      return 0;
  }
}

export function decayMomentum(m: number, factor = 0.9): number {
  const v = m * factor;
  return Math.abs(v) < 0.01 ? 0 : Math.max(-1, Math.min(1, v));
}
