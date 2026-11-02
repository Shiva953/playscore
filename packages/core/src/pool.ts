import { PROTOCOL_CONFIG } from "./config";
import { EPS } from "./math";
import type { SellInput } from "./curve";

const POOL = PROTOCOL_CONFIG.pool;

/**
 * Post-bond constant-product pool (x·y = k), USDC ↔ player token, with LP shares.
 * The protocol's locked seed owns `protocolShares`. Those shares earn swap fees (which deepen
 * the locked liquidity) but never dividends.
 */
export interface PoolState {
  usdc: number;
  tokens: number;
  totalShares: number;
  protocolShares: number;
  /** Cumulative LP-fee value in USD per share. Display only ("fees earned"). */
  feeGrowthPerShare: number;
}

export type PoolError = "INVALID_AMOUNT" | "INSUFFICIENT_TOKENS" | "INSUFFICIENT_LIQUIDITY" | "INSUFFICIENT_SHARES";

export function createPool(seedUsdc: number, seedTokens: number): PoolState {
  const shares = Math.sqrt(seedUsdc * seedTokens);
  return { usdc: seedUsdc, tokens: seedTokens, totalShares: shares, protocolShares: shares, feeGrowthPerShare: 0 };
}

export function spotPrice(pool: PoolState): number {
  return pool.tokens > 0 ? pool.usdc / pool.tokens : 0;
}

export interface PoolBuyQuote {
  ok: boolean;
  error?: PoolError;
  usdcIn: number;
  /** 5 bps → treasury. */
  buyFee: number;
  /** 0.25% of the swapped amount, stays in the pool. */
  lpFee: number;
  tokensOut: number;
  /** All-in USDC per token. */
  avgPrice: number;
  spotBefore: number;
  spotAfter: number;
  /** Execution price before fees vs spot before. */
  priceImpact: number;
  next: PoolState;
}

/** Buy tokens with `usdcIn`. Buy fee first (treasury), then LP fee on the swapped amount. */
export function quotePoolBuy(pool: PoolState, usdcIn: number): PoolBuyQuote {
  const spotBefore = spotPrice(pool);
  if (!(usdcIn > 0) || !Number.isFinite(usdcIn)) {
    return {
      ok: false,
      error: "INVALID_AMOUNT",
      usdcIn,
      buyFee: 0,
      lpFee: 0,
      tokensOut: 0,
      avgPrice: spotBefore,
      spotBefore,
      spotAfter: spotBefore,
      priceImpact: 0,
      next: pool,
    };
  }
  const buyFee = usdcIn * POOL.buyFeeRate;
  const swapIn = usdcIn - buyFee;
  const lpFee = swapIn * POOL.lpFeeRate;
  const effectiveIn = swapIn - lpFee;
  const k = pool.usdc * pool.tokens;
  const tokensOut = pool.tokens - k / (pool.usdc + effectiveIn);
  const next: PoolState = {
    ...pool,
    usdc: pool.usdc + swapIn,
    tokens: pool.tokens - tokensOut,
    feeGrowthPerShare: pool.feeGrowthPerShare + (pool.totalShares > 0 ? lpFee / pool.totalShares : 0),
  };
  const spotAfter = spotPrice(next);
  return {
    ok: true,
    usdcIn,
    buyFee,
    lpFee,
    tokensOut,
    avgPrice: usdcIn / tokensOut,
    spotBefore,
    spotAfter,
    priceImpact: effectiveIn / tokensOut / spotBefore - 1,
    next,
  };
}

export interface PoolSellQuote {
  ok: boolean;
  error?: PoolError;
  tokensIn: number;
  /** LP fee taken in tokens (stays in the pool). */
  lpFeeTokens: number;
  lpFeeUsd: number;
  /** USDC out of the pool before the sell tax. */
  gross: number;
  taxRate: number;
  tax: number;
  /** USDC the seller receives. */
  net: number;
  avgPrice: number;
  spotBefore: number;
  spotAfter: number;
  priceImpact: number;
  next: PoolState;
}

function emptySell(pool: PoolState, taxRate: number, error: PoolError, tokensIn = 0): PoolSellQuote {
  const spot = spotPrice(pool);
  return {
    ok: false,
    error,
    tokensIn,
    lpFeeTokens: 0,
    lpFeeUsd: 0,
    gross: 0,
    taxRate,
    tax: 0,
    net: 0,
    avgPrice: spot,
    spotBefore: spot,
    spotAfter: spot,
    priceImpact: 0,
    next: pool,
  };
}

/**
 * Sell into the pool by token amount, or by gross USDC wanted (before tax, prototype input).
 * Sell tax `taxRate` comes off the gross USDC (ARCHITECTURE §4.4 test vector).
 */
export function quotePoolSell(
  pool: PoolState,
  input: SellInput,
  taxRate: number,
  holderTokens = Infinity
): PoolSellQuote {
  const k = pool.usdc * pool.tokens;
  let tokensIn: number;
  if ("tokens" in input) {
    tokensIn = input.tokens;
  } else {
    const gross = input.usdc;
    if (!(gross > 0) || !Number.isFinite(gross)) return emptySell(pool, taxRate, "INVALID_AMOUNT");
    if (gross >= pool.usdc - EPS) return emptySell(pool, taxRate, "INSUFFICIENT_LIQUIDITY");
    const effectiveIn = k / (pool.usdc - gross) - pool.tokens;
    tokensIn = effectiveIn / (1 - POOL.lpFeeRate);
  }
  if (!(tokensIn > 0) || !Number.isFinite(tokensIn)) return emptySell(pool, taxRate, "INVALID_AMOUNT");
  if (tokensIn > holderTokens + 1e-6) return emptySell(pool, taxRate, "INSUFFICIENT_TOKENS", tokensIn);
  const spotBefore = spotPrice(pool);
  const lpFeeTokens = tokensIn * POOL.lpFeeRate;
  const effectiveIn = tokensIn - lpFeeTokens;
  const gross = pool.usdc - k / (pool.tokens + effectiveIn);
  const tax = gross * taxRate;
  const nextBase: PoolState = { ...pool, usdc: pool.usdc - gross, tokens: pool.tokens + tokensIn };
  const spotAfter = spotPrice(nextBase);
  const lpFeeUsd = lpFeeTokens * spotAfter;
  const next: PoolState = {
    ...nextBase,
    feeGrowthPerShare: pool.feeGrowthPerShare + (pool.totalShares > 0 ? lpFeeUsd / pool.totalShares : 0),
  };
  return {
    ok: true,
    tokensIn,
    lpFeeTokens,
    lpFeeUsd,
    gross,
    taxRate,
    tax,
    net: gross - tax,
    avgPrice: (gross - tax) / tokensIn,
    spotBefore,
    spotAfter,
    priceImpact: Math.max(0, 1 - gross / effectiveIn / spotBefore),
    next,
  };
}

export interface AddLiquidityQuote {
  ok: boolean;
  error?: PoolError;
  usdc: number;
  tokens: number;
  sharesMinted: number;
  next: PoolState;
}

/** Pair deposit at the current ratio: `usdc` plus the matching tokens. */
export function quoteAddLiquidity(pool: PoolState, usdc: number, holderTokens = Infinity): AddLiquidityQuote {
  if (!(usdc > 0) || pool.usdc <= 0) {
    return { ok: false, error: "INVALID_AMOUNT", usdc, tokens: 0, sharesMinted: 0, next: pool };
  }
  const tokens = (usdc * pool.tokens) / pool.usdc;
  if (tokens > holderTokens + 1e-6) {
    return { ok: false, error: "INSUFFICIENT_TOKENS", usdc, tokens, sharesMinted: 0, next: pool };
  }
  const sharesMinted = (pool.totalShares * usdc) / pool.usdc;
  return {
    ok: true,
    usdc,
    tokens,
    sharesMinted,
    next: { ...pool, usdc: pool.usdc + usdc, tokens: pool.tokens + tokens, totalShares: pool.totalShares + sharesMinted },
  };
}

export interface ZapQuote {
  ok: boolean;
  error?: PoolError;
  usdcIn: number;
  /** The swap of half the USDC into tokens (pays buy fee + LP fee). */
  swap: PoolBuyQuote;
  depositUsdc: number;
  depositTokens: number;
  /** Rounding leftovers returned to the user. */
  leftoverUsdc: number;
  leftoverTokens: number;
  sharesMinted: number;
  next: PoolState;
}

/** USDC-only deposit: swap half into tokens, then pair-deposit at the post-swap ratio. */
export function quoteZap(pool: PoolState, usdcIn: number): ZapQuote {
  const half = usdcIn / 2;
  const swap = quotePoolBuy(pool, half);
  if (!swap.ok) {
    return {
      ok: false,
      error: swap.error ?? "INVALID_AMOUNT",
      usdcIn,
      swap,
      depositUsdc: 0,
      depositTokens: 0,
      leftoverUsdc: usdcIn,
      leftoverTokens: 0,
      sharesMinted: 0,
      next: pool,
    };
  }
  const p1 = swap.next;
  const usdcForTokens = (swap.tokensOut * p1.usdc) / p1.tokens;
  let depositUsdc: number;
  let depositTokens: number;
  if (usdcForTokens <= usdcIn - half) {
    depositTokens = swap.tokensOut;
    depositUsdc = usdcForTokens;
  } else {
    depositUsdc = usdcIn - half;
    depositTokens = (depositUsdc * p1.tokens) / p1.usdc;
  }
  const add = quoteAddLiquidity(p1, depositUsdc, depositTokens);
  return {
    ok: add.ok,
    error: add.error,
    usdcIn,
    swap,
    depositUsdc,
    depositTokens: add.tokens,
    leftoverUsdc: usdcIn - half - depositUsdc,
    leftoverTokens: swap.tokensOut - add.tokens,
    sharesMinted: add.sharesMinted,
    next: add.next,
  };
}

export interface RemoveLiquidityQuote {
  ok: boolean;
  error?: PoolError;
  shares: number;
  usdcOut: number;
  tokensOut: number;
  next: PoolState;
}

export function quoteRemoveLiquidity(pool: PoolState, shares: number, holderShares = Infinity): RemoveLiquidityQuote {
  if (!(shares > 0) || shares > holderShares + EPS || shares > pool.totalShares - pool.protocolShares + EPS) {
    return { ok: false, error: "INSUFFICIENT_SHARES", shares, usdcOut: 0, tokensOut: 0, next: pool };
  }
  const f = shares / pool.totalShares;
  const usdcOut = pool.usdc * f;
  const tokensOut = pool.tokens * f;
  return {
    ok: true,
    shares,
    usdcOut,
    tokensOut,
    next: { ...pool, usdc: pool.usdc - usdcOut, tokens: pool.tokens - tokensOut, totalShares: pool.totalShares - shares },
  };
}

/** Tokens in the pool attributable to `shares` (what the kickoff snapshot counts). */
export function lpTokensFor(pool: PoolState, shares: number): number {
  return pool.totalShares > 0 ? (pool.tokens * shares) / pool.totalShares : 0;
}

export function lpUsdcFor(pool: PoolState, shares: number): number {
  return pool.totalShares > 0 ? (pool.usdc * shares) / pool.totalShares : 0;
}

/** Mark-to-market value of `shares` (both sides at spot). */
export function lpValueUsd(pool: PoolState, shares: number): number {
  return lpUsdcFor(pool, shares) * 2;
}

/** Tokens in the pool owned by anyone other than the protocol seed. */
export function nonProtocolPoolTokens(pool: PoolState): number {
  return lpTokensFor(pool, pool.totalShares - pool.protocolShares);
}

/** Total value locked in the pool (both sides at spot). */
export function poolDepthUsd(pool: PoolState): number {
  return pool.usdc * 2;
}

/** Loss vs simply holding, for a price ratio r = P_new / P_entry: 1 − 2√r / (1 + r). */
export function impermanentLoss(priceRatio: number): number {
  if (!(priceRatio > 0)) return 0;
  return 1 - (2 * Math.sqrt(priceRatio)) / (1 + priceRatio);
}

export interface ImpactRow {
  usdc: number;
  buyImpact: number;
  sellImpact: number;
}

/** AMM-native depth view: price impact for a few trade sizes (replaces the prototype's synthetic order book). */
export function impactLadder(pool: PoolState, sizes: readonly number[] = [100, 500, 1_000, 5_000]): ImpactRow[] {
  return sizes.map((usdc) => {
    const b = quotePoolBuy(pool, usdc);
    const s = quotePoolSell(pool, { usdc }, 0);
    return { usdc, buyImpact: b.ok ? b.priceImpact : NaN, sellImpact: s.ok ? s.priceImpact : NaN };
  });
}
