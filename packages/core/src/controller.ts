import { PROTOCOL_CONFIG } from "./config";
import { clamp, mean } from "./math";

const K = PROTOCOL_CONFIG.controller;

/** Number of edges ≤ v (prototype `bk`). */
export function bucket(v: number, edges: readonly number[]): number {
  return edges.filter((e) => v >= e).length;
}

export interface ControllerInput {
  vault: number;
  bondedPlayers: number;
  /** Most recent round payouts, oldest first. Only the last 8 are used. */
  payHistory: readonly number[];
  /** Previous round's bps, or null for the first round. */
  prevBps: number | null;
}

export interface ControllerResult {
  /** Prototype TVL approximation: bonded × 17,500 + vault (SPEC-QUESTION: SQ-2). */
  tvl: number;
  avgPay: number;
  /** vault / avgPay in rounds; Infinity with no history. */
  runwayRounds: number;
  /** vault / TVL in bps. */
  ratioBps: number;
  matrixRow: number;
  matrixCol: number;
  /** Raw matrix value (or 100 with no history). */
  matrixBps: number;
  /** After the ±10% step clamp and the 20–250 clamp. Becomes next round's prevBps. */
  bps: number;
  uncappedPool: number;
  /** TVL × 12% / 38 */
  capPerRound: number;
  roundPool: number;
  capped: boolean;
  /** roundPool / vault, which is what the UI must show (SPEC-QUESTION: SQ-15). */
  effectiveRate: number;
}

/** Round pool sizing, ported 1:1 from the prototype's `releasePool` (ARCHITECTURE §4.9). */
export function sizeRoundPool(input: ControllerInput): ControllerResult {
  const vault = Math.max(0, input.vault);
  const tvl = input.bondedPlayers * K.tvlPerBondedPlayer + vault;
  const history = input.payHistory.slice(-K.payHistoryLength);
  const avgPay = mean(history);
  const runwayRounds = avgPay > 0 ? vault / avgPay : Infinity;
  const ratioBps = tvl > 0 ? (vault / tvl) * 10_000 : 0;
  const matrixRow = bucket(runwayRounds, K.runwayEdges);
  const matrixCol = bucket(ratioBps, K.ratioEdgesBps);
  const matrixBps = avgPay > 0 ? (K.matrixBps[matrixRow]?.[matrixCol] ?? K.defaultBps) : K.defaultBps;
  let bps = matrixBps;
  if (input.prevBps && input.prevBps > 0) {
    bps = clamp(bps, input.prevBps * (1 - K.stepClamp), input.prevBps * (1 + K.stepClamp));
  }
  bps = clamp(bps, K.minBps, K.maxBps);
  const uncappedPool = (vault * bps) / 10_000;
  const capPerRound = (tvl * K.annualTvlCap) / K.roundsPerYear;
  const roundPool = Math.min(uncappedPool, capPerRound);
  return {
    tvl,
    avgPay,
    runwayRounds,
    ratioBps,
    matrixRow,
    matrixCol,
    matrixBps,
    bps,
    uncappedPool,
    capPerRound,
    roundPool,
    capped: capPerRound < uncappedPool,
    effectiveRate: vault > 0 ? roundPool / vault : 0,
  };
}

/** Append a payout to the rolling history (keeps the last 8). */
export function pushPayHistory(history: readonly number[], payout: number): number[] {
  return [...history, payout].slice(-K.payHistoryLength);
}
