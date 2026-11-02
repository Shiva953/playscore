import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  createPool,
  dispose,
  holdAgeDays,
  impermanentLoss,
  lpTokensFor,
  mergeAcquisition,
  nonProtocolPoolTokens,
  poolBuyFee,
  quoteAddLiquidity,
  quotePoolBuy,
  quotePoolSell,
  quoteRemoveLiquidity,
  quoteZap,
  routeFee,
  sellTaxRate,
  spotPrice,
} from "../src";

describe("sell tax (ARCHITECTURE §9)", () => {
  it("tax(0)=5%, tax(45)=2.75%, tax(90)=0.5%, tax(120)=0.5%", () => {
    expect(sellTaxRate(0)).toBeCloseTo(0.05, 12);
    expect(sellTaxRate(45)).toBeCloseTo(0.0275, 12);
    expect(sellTaxRate(90)).toBeCloseTo(0.005, 12);
    expect(sellTaxRate(120)).toBeCloseTo(0.005, 12);
    expect(sellTaxRate(7)).toBeCloseTo(0.0465, 12);
  });
});

describe("fee routing (ARCHITECTURE §9)", () => {
  it("buy $1,000 post-bond → $0.50 to treasury", () => {
    const fee = poolBuyFee(1_000);
    expect(fee).toBeCloseTo(0.5, 12);
    expect(routeFee("buy", fee)).toEqual({ vault: 0, treasury: fee });
    const q = quotePoolBuy(createPool(17_500, 1_600_000), 1_000);
    expect(q.buyFee).toBeCloseTo(0.5, 12);
  });

  it("sell $1,000 at 7 days → tax 4.65% = $46.50 → $41.85 vault / $4.65 treasury", () => {
    const pool = createPool(17_500, 1_600_000);
    const q = quotePoolSell(pool, { usdc: 1_000 }, sellTaxRate(7));
    expect(q.ok).toBe(true);
    expect(q.gross).toBeCloseTo(1_000, 6);
    expect(q.tax).toBeCloseTo(46.5, 6);
    const split = routeFee("sell", q.tax);
    expect(split.vault).toBeCloseTo(41.85, 6);
    expect(split.treasury).toBeCloseTo(4.65, 6);
  });
});

describe("hold age (ARCHITECTURE §9)", () => {
  it("10k @ day −60 + 10k @ today → 30 days", () => {
    const now = Date.UTC(2026, 10, 2);
    const merged = mergeAcquisition({ qty: 10_000, ts: now - 60 * DAY_MS }, { qty: 10_000, ts: now });
    expect(holdAgeDays(merged.ts, now)).toBeCloseTo(30, 9);
  });

  it("sells don't change the acquisition time", () => {
    const b = { qty: 1_000, ts: 123 };
    expect(dispose(b, 400)).toEqual({ qty: 600, ts: 123 });
  });

  it("first acquisition after a full exit starts fresh", () => {
    expect(mergeAcquisition({ qty: 0, ts: 1 }, { qty: 5, ts: 99 })).toEqual({ qty: 5, ts: 99 });
  });
});

describe("CPMM pool", () => {
  const pool = createPool(17_500, 1_600_000);

  it("opens at 0.0109375 with all shares owned by the protocol", () => {
    expect(spotPrice(pool)).toBe(0.0109375);
    expect(pool.protocolShares).toBe(pool.totalShares);
    expect(nonProtocolPoolTokens(pool)).toBe(0);
  });

  it("buys raise the price and fees grow k", () => {
    const q = quotePoolBuy(pool, 1_000);
    expect(q.spotAfter).toBeGreaterThan(q.spotBefore);
    expect(q.next.usdc * q.next.tokens).toBeGreaterThan(pool.usdc * pool.tokens);
    expect(q.priceImpact).toBeGreaterThan(0);
    expect(q.lpFee).toBeCloseTo(999.5 * 0.0025, 10);
  });

  it("a round trip loses roughly fees + tax, never gains", () => {
    const b = quotePoolBuy(pool, 1_000);
    const s = quotePoolSell(b.next, { tokens: b.tokensOut }, 0);
    expect(s.net).toBeLessThan(1_000);
    expect(s.net).toBeGreaterThan(1_000 * (1 - 0.0005 - 0.0025 * 2 - 0.001));
  });

  it("sells by token amount match sells by USDC amount", () => {
    const byUsdc = quotePoolSell(pool, { usdc: 500 }, 0.02);
    const byTokens = quotePoolSell(pool, { tokens: byUsdc.tokensIn }, 0.02);
    expect(byTokens.gross).toBeCloseTo(500, 6);
  });

  it("pair deposit and withdrawal are proportional", () => {
    const add = quoteAddLiquidity(pool, 1_750);
    expect(add.tokens).toBeCloseTo(160_000, 6);
    expect(add.sharesMinted / add.next.totalShares).toBeCloseTo(1_750 / 19_250, 12);
    expect(lpTokensFor(add.next, add.sharesMinted)).toBeCloseTo(160_000, 6);
    const rem = quoteRemoveLiquidity(add.next, add.sharesMinted);
    expect(rem.usdcOut).toBeCloseTo(1_750, 6);
    expect(rem.tokensOut).toBeCloseTo(160_000, 6);
  });

  it("the protocol seed can't be withdrawn", () => {
    expect(quoteRemoveLiquidity(pool, 1).ok).toBe(false);
  });

  it("zap swaps half and deposits at the new ratio", () => {
    const z = quoteZap(pool, 2_000);
    expect(z.ok).toBe(true);
    expect(z.depositUsdc + z.leftoverUsdc).toBeCloseTo(1_000, 6);
    expect(z.leftoverUsdc).toBeGreaterThanOrEqual(0);
    expect(z.leftoverTokens).toBeGreaterThanOrEqual(-1e-6);
    expect(z.sharesMinted).toBeGreaterThan(0);
  });

  it("impermanent loss matches the prototype formula", () => {
    expect(impermanentLoss(1)).toBe(0);
    expect(impermanentLoss(1.5)).toBeCloseTo(0.0202, 4);
    expect(impermanentLoss(2)).toBeCloseTo(0.0572, 4);
    expect(impermanentLoss(0.5)).toBeCloseTo(0.0572, 4);
  });
});
