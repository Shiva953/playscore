import { PROTOCOL_CONFIG } from "./config";
import { clamp } from "./math";

const { curve, pool, sellTax, feeRouting } = PROTOCOL_CONFIG;

export type FeeSide = "buy" | "sell";

/** Flat launch fee on curve buys and sells (1.25%). */
export function curveFee(usdc: number): number {
  return usdc * curve.feeRate;
}

/** Post-bond buy fee (5 bps) on the USDC going in. */
export function poolBuyFee(usdc: number): number {
  return usdc * pool.buyFeeRate;
}

/**
 * Hold-age sell tax: 5% at day 0, linear to 0.5% at day 90, flat after.
 * tax(d) = max(0.005, 0.05 − 0.045·min(1, d/90))
 */
export function sellTaxRate(holdAgeDays: number): number {
  const d = Math.max(0, holdAgeDays);
  const span = sellTax.max - sellTax.min;
  return Math.max(sellTax.min, sellTax.max - span * clamp(d / sellTax.decayDays, 0, 1));
}

export interface FeeSplit {
  vault: number;
  treasury: number;
}

/** Buy-side fees → 100% treasury. Sell-side fees (curve and pool) → 90% vault / 10% treasury. */
export function routeFee(side: FeeSide, fee: number): FeeSplit {
  const r = side === "buy" ? feeRouting.buySide : feeRouting.sellSide;
  return { vault: fee * r.vault, treasury: fee * r.treasury };
}
