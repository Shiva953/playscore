import { PROTOCOL_CONFIG } from "./config";
import { bisectIncreasing, EPS } from "./math";

const C = PROTOCOL_CONFIG.curve;

/** USDC raised after S tokens sold: R(S) = 0.00039·S + S³ / 1.1649e16 */
export function raisedAt(sold: number): number {
  const s = Math.max(0, sold);
  return C.linear * s + (s * s * s) / C.cubicDivisor;
}

/** Spot price: P(S) = dR/dS = 0.00039 + S² / 3.883e15 */
export function priceAt(sold: number): number {
  const s = Math.max(0, sold);
  return C.linear + (s * s) / C.priceDivisor;
}

/** Inverse of R via deterministic bisection (prototype `inv`). */
export function soldForRaised(raised: number): number {
  if (raised <= 0) return 0;
  return bisectIncreasing(raisedAt, raised, C.bisection.lo, C.bisection.hi, C.bisection.iterations);
}

/** Tokens sold when the curve bonds (≈ 6,400,040). */
export const S_MAX = soldForRaised(C.bondThresholdUsdc);
export const BOND_PRICE = priceAt(S_MAX);
export const LAUNCH_PRICE = priceAt(0);

/** Tokens bought for `usdcNet` (after fee) starting at `sold`. */
export function tokensForUsdc(sold: number, usdcNet: number): number {
  if (usdcNet <= 0) return 0;
  return Math.max(0, soldForRaised(raisedAt(sold) + usdcNet) - sold);
}

/** Net USDC needed to buy `qty` tokens starting at `sold`. */
export function costForTokens(sold: number, qty: number): number {
  return raisedAt(sold + qty) - raisedAt(sold);
}

/** Gross USDC returned by selling `qty` tokens back down the curve from `sold`. */
export function usdcForTokens(sold: number, qty: number): number {
  const q = Math.min(Math.max(0, qty), sold);
  return raisedAt(sold) - raisedAt(sold - q);
}

export interface CurveState {
  /** Tokens sold on the curve. */
  sold: number;
  /** USDC held by the curve (net of fees). */
  raised: number;
}

export type CurveError =
  | "INVALID_AMOUNT"
  | "ALREADY_BONDED"
  | "CAP_PER_PURCHASE"
  | "CAP_PER_ACCOUNT"
  | "INSUFFICIENT_TOKENS"
  | "INSUFFICIENT_LIQUIDITY";

export interface CapUsage {
  limit: number;
  usedBefore: number;
  usedAfter: number;
  /** Most tokens this account can still buy in one purchase right now. */
  maxTokensNow: number;
  /** Most USDC (incl. fee) this account can usefully spend right now. */
  maxUsdcNow: number;
}

export interface CurveBuyQuote {
  ok: boolean;
  error?: CurveError;
  usdcIn: number;
  /** Gross USDC actually spent (≤ usdcIn when the bonding buy is partially filled). */
  usdcUsed: number;
  refund: number;
  fee: number;
  usdcNet: number;
  tokensOut: number;
  avgPrice: number;
  spotBefore: number;
  spotAfter: number;
  /** Execution price before fees vs spot before (≥ 0). */
  priceImpact: number;
  bonds: boolean;
  cap: CapUsage;
  next: CurveState;
}

export function capUsage(state: CurveState, accountPurchased: number, tokensOut = 0): CapUsage {
  const remainingAccount = Math.max(0, C.capTokensPerAccount - accountPurchased);
  const remainingCurve = Math.max(0, S_MAX - state.sold);
  const maxTokensNow = Math.min(C.capTokensPerPurchase, remainingAccount, remainingCurve);
  const maxUsdcNow = costForTokens(state.sold, maxTokensNow) / (1 - C.feeRate);
  return {
    limit: C.capTokensPerAccount,
    usedBefore: accountPurchased,
    usedAfter: accountPurchased + tokensOut,
    maxTokensNow,
    maxUsdcNow,
  };
}

/**
 * Quote a curve buy. Fee comes off the USDC going in. If the buy would cross the bond threshold
 * it is filled only up to exactly $25,000 raised and the rest is refunded (SPEC-QUESTION: SQ-12).
 * The per-account cap counts gross cumulative purchases (SPEC-QUESTION: SQ-19).
 */
export function quoteCurveBuy(state: CurveState, usdcIn: number, accountPurchased = 0): CurveBuyQuote {
  const spotBefore = priceAt(state.sold);
  const base: CurveBuyQuote = {
    ok: false,
    usdcIn,
    usdcUsed: 0,
    refund: usdcIn,
    fee: 0,
    usdcNet: 0,
    tokensOut: 0,
    avgPrice: spotBefore,
    spotBefore,
    spotAfter: spotBefore,
    priceImpact: 0,
    bonds: false,
    cap: capUsage(state, accountPurchased),
    next: { ...state },
  };
  if (!(usdcIn > 0) || !Number.isFinite(usdcIn)) return { ...base, error: "INVALID_AMOUNT" };
  if (state.raised >= C.bondThresholdUsdc - EPS) return { ...base, error: "ALREADY_BONDED" };

  let usdcUsed = usdcIn;
  let fee = usdcIn * C.feeRate;
  let usdcNet = usdcIn - fee;
  let bonds = false;
  const remainingToBond = C.bondThresholdUsdc - state.raised;
  if (usdcNet >= remainingToBond - EPS) {
    bonds = true;
    usdcNet = remainingToBond;
    usdcUsed = usdcNet / (1 - C.feeRate);
    fee = usdcUsed - usdcNet;
  }
  const tokensOut = bonds ? Math.max(0, S_MAX - state.sold) : tokensForUsdc(state.sold, usdcNet);
  const cap = capUsage(state, accountPurchased, tokensOut);
  if (tokensOut > C.capTokensPerPurchase + EPS) {
    return { ...base, error: "CAP_PER_PURCHASE", tokensOut, cap };
  }
  if (accountPurchased + tokensOut > C.capTokensPerAccount + EPS) {
    return { ...base, error: "CAP_PER_ACCOUNT", tokensOut, cap };
  }
  const nextSold = state.sold + tokensOut;
  const spotAfter = priceAt(nextSold);
  return {
    ok: true,
    usdcIn,
    usdcUsed,
    refund: Math.max(0, usdcIn - usdcUsed),
    fee,
    usdcNet,
    tokensOut,
    avgPrice: tokensOut > 0 ? usdcUsed / tokensOut : spotBefore,
    spotBefore,
    spotAfter,
    priceImpact: tokensOut > 0 ? usdcNet / tokensOut / spotBefore - 1 : 0,
    bonds,
    cap,
    next: { sold: nextSold, raised: bonds ? C.bondThresholdUsdc : state.raised + usdcNet },
  };
}

export type SellInput = { tokens: number } | { usdc: number };

export interface CurveSellQuote {
  ok: boolean;
  error?: CurveError;
  tokensIn: number;
  /** USDC taken out of the curve before the fee. */
  gross: number;
  fee: number;
  /** USDC the seller receives. */
  net: number;
  avgPrice: number;
  spotBefore: number;
  spotAfter: number;
  priceImpact: number;
  next: CurveState;
}

/** Quote a curve sell by token amount or by gross USDC amount (prototype input). */
export function quoteCurveSell(state: CurveState, input: SellInput, holderTokens = Infinity): CurveSellQuote {
  const spotBefore = priceAt(state.sold);
  const empty: CurveSellQuote = {
    ok: false,
    tokensIn: 0,
    gross: 0,
    fee: 0,
    net: 0,
    avgPrice: spotBefore,
    spotBefore,
    spotAfter: spotBefore,
    priceImpact: 0,
    next: { ...state },
  };
  let tokensIn: number;
  if ("tokens" in input) {
    tokensIn = input.tokens;
  } else {
    if (!(input.usdc > 0)) return { ...empty, error: "INVALID_AMOUNT" };
    if (input.usdc > state.raised + EPS) return { ...empty, error: "INSUFFICIENT_LIQUIDITY" };
    tokensIn = state.sold - soldForRaised(Math.max(0, raisedAt(state.sold) - input.usdc));
  }
  if (!(tokensIn > 0) || !Number.isFinite(tokensIn)) return { ...empty, error: "INVALID_AMOUNT" };
  if (tokensIn > holderTokens + 1e-6) return { ...empty, tokensIn, error: "INSUFFICIENT_TOKENS" };
  if (tokensIn > state.sold + EPS) return { ...empty, tokensIn, error: "INSUFFICIENT_LIQUIDITY" };
  const gross = Math.min(state.raised, usdcForTokens(state.sold, tokensIn));
  const fee = gross * C.feeRate;
  const nextSold = Math.max(0, state.sold - tokensIn);
  const spotAfter = priceAt(nextSold);
  return {
    ok: true,
    tokensIn,
    gross,
    fee,
    net: gross - fee,
    avgPrice: gross / tokensIn,
    spotBefore,
    spotAfter,
    priceImpact: Math.max(0, 1 - gross / tokensIn / spotBefore),
    next: { sold: nextSold, raised: Math.max(0, state.raised - gross) },
  };
}

/** Bonding progress 0..1. */
export function bondProgress(state: CurveState): number {
  return Math.min(1, Math.max(0, state.raised / C.bondThresholdUsdc));
}
