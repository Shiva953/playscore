import { describe, expect, it } from "vitest";
import { ammBook, quotePoolBuy, spotPrice, type PoolState } from "../src/pool";

const pool: PoolState = { usdc: 20_000, tokens: 2_000_000, totalShares: 1, protocolShares: 1, feeGrowthPerShare: 0 };

describe("ammBook (the pool as an order book)", () => {
  it("steps out from the mid on both sides", () => {
    const b = ammBook(pool, 5, 0.01);
    expect(b.mid).toBeCloseTo(spotPrice(pool), 12);
    expect(b.asks.map((l) => l.price)).toEqual(b.asks.map((_, i) => b.mid * (1 + 0.01 * (i + 1))));
    expect(b.bids.every((l, i) => l.price < (i ? b.bids[i - 1]!.price : b.mid))).toBe(true);
  });

  it("matches the x·y=k reserve: moving the price to an ask level takes exactly that many tokens", () => {
    const b = ammBook(pool, 4, 0.01);
    const p2 = b.asks[1]!.price;
    const k = pool.usdc * pool.tokens;
    const expected = pool.tokens - Math.sqrt(k / p2);
    expect(b.asks[1]!.cumulativeTokens).toBeCloseTo(expected, 6);
  });

  it("agrees with a real fee-free buy of the same size, roughly", () => {
    const b = ammBook(pool, 1, 0.01);
    const usdcIn = pool.usdc * (Math.sqrt(1.01) - 1); // USDC that moves the price up 1% on x·y=k
    const q = quotePoolBuy(pool, usdcIn);
    // quotePoolBuy charges fees, so it gets slightly fewer tokens than the fee-free book level.
    expect(q.ok).toBe(true);
    expect(q.tokensOut).toBeLessThanOrEqual(b.asks[0]!.tokens);
    expect(q.tokensOut / b.asks[0]!.tokens).toBeGreaterThan(0.99);
  });
});
