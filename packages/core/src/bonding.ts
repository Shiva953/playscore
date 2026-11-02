import { PROTOCOL_CONFIG } from "./config";

const B = PROTOCOL_CONFIG.bond;

export interface BondSplit {
  raised: number;
  /** Permanent pool liquidity (70%). */
  poolSeedUsdc: number;
  /** Paired with the seed: the 1.6M float tokens held back from the curve. */
  poolSeedTokens: number;
  /** Dividend vault (20%). */
  vaultUsdc: number;
  /** Treasury (10%). */
  treasuryUsdc: number;
  /** Pool opening price = seed USDC / seed tokens. */
  openPrice: number;
}

/** 70 / 20 / 10 split of the actual amount raised (net of curve buy fees). */
export function bondSplit(raised: number): BondSplit {
  const poolSeedUsdc = raised * B.poolSeedShare;
  const poolSeedTokens = PROTOCOL_CONFIG.supply.poolSeedTokens;
  return {
    raised,
    poolSeedUsdc,
    poolSeedTokens,
    vaultUsdc: raised * B.vaultShare,
    treasuryUsdc: raised * B.treasuryShare,
    openPrice: poolSeedUsdc / poolSeedTokens,
  };
}

/** $17,500 / 1,600,000 = $0.0109375 */
export const POOL_OPEN_PRICE = bondSplit(PROTOCOL_CONFIG.curve.bondThresholdUsdc).openPrice;

/**
 * Dividend reserve available after bonding, capped so curve sold + pool seed + reserve ≤ 10M.
 * The spec's curve constants give S_max = 6,400,040 (not 6.4M), so a full 2M reserve would allow
 * 10,000,040 tokens. Trimming the reserve by the overshoot keeps every price unchanged.
 * SPEC-QUESTION: SQ-35
 */
export function reserveAfterBond(curveSold: number): number {
  const { maxSupply, poolSeedTokens, reserve } = PROTOCOL_CONFIG.supply;
  return Math.max(0, Math.min(reserve, maxSupply - curveSold - poolSeedTokens));
}
