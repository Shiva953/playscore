import { describe, expect, it } from "vitest";
import {
  BOND_PRICE,
  LAUNCH_PRICE,
  POOL_OPEN_PRICE,
  PROTOCOL_CONFIG,
  S_MAX,
  bondSplit,
  costForTokens,
  priceAt,
  quoteCurveBuy,
  quoteCurveSell,
  raisedAt,
  reserveAfterBond,
  soldForRaised,
  tokensForUsdc,
} from "../src";

const CAP = PROTOCOL_CONFIG.curve.capTokensPerAccount;

describe("bonding curve (ARCHITECTURE §9)", () => {
  it("R(0) = 0 and P(0) = 0.00039", () => {
    expect(raisedAt(0)).toBe(0);
    expect(priceAt(0)).toBe(0.00039);
    expect(LAUNCH_PRICE).toBe(0.00039);
  });

  it("S_max ≈ 6.4M (±5k) and R(S_max) ≈ 25,000 (±1)", () => {
    expect(Math.abs(S_MAX - 6_400_000)).toBeLessThan(5_000);
    expect(Math.abs(raisedAt(S_MAX) - 25_000)).toBeLessThan(1);
  });

  it("P(S_max) ≈ 0.01094", () => {
    expect(BOND_PRICE).toBeCloseTo(0.01094, 5);
  });

  it("P is the derivative of R", () => {
    for (const s of [1e5, 1e6, 3e6, 6e6]) {
      const h = 1;
      expect((raisedAt(s + h) - raisedAt(s - h)) / (2 * h)).toBeCloseTo(priceAt(s), 9);
    }
  });

  it("inverse is deterministic and round-trips", () => {
    for (const r of [1, 100, 5_000, 17_397, 24_999]) {
      const s = soldForRaised(r);
      expect(soldForRaised(r)).toBe(s);
      expect(raisedAt(s)).toBeCloseTo(r, 6);
    }
  });

  it("average curve price ≈ $0.0039 and pool open is continuous with the curve end", () => {
    expect(25_000 / S_MAX).toBeCloseTo(0.0039062, 6);
    expect(POOL_OPEN_PRICE).toBe(0.0109375);
    expect(Math.abs(POOL_OPEN_PRICE / BOND_PRICE - 1)).toBeLessThan(0.001);
  });
});

describe("curve buys", () => {
  it("charges a flat 1.25% fee on the USDC going in", () => {
    const q = quoteCurveBuy({ sold: 0, raised: 0 }, 50, 0);
    expect(q.ok).toBe(true);
    expect(q.fee).toBeCloseTo(0.625, 10);
    expect(q.usdcNet).toBeCloseTo(49.375, 10);
    expect(q.tokensOut).toBeCloseTo(tokensForUsdc(0, 49.375), 6);
    expect(q.next.raised).toBeCloseTo(49.375, 10);
  });

  it("rejects a single buy above 240,000 tokens", () => {
    // $1,000 at S=0 buys ~1.6M tokens
    const q = quoteCurveBuy({ sold: 0, raised: 0 }, 1_000, 0);
    expect(q.ok).toBe(false);
    expect(q.error).toBe("CAP_PER_PURCHASE");
    expect(q.cap.maxTokensNow).toBe(CAP);
    // The max spend within the cap is affordable and accepted
    const max = quoteCurveBuy({ sold: 0, raised: 0 }, q.cap.maxUsdcNow * 0.9999, 0);
    expect(max.ok).toBe(true);
    expect(max.tokensOut).toBeLessThanOrEqual(CAP);
  });

  it("rejects when cumulative purchases would exceed 240,000 tokens", () => {
    const state = { sold: 3e6, raised: raisedAt(3e6) };
    const first = quoteCurveBuy(state, costForTokens(3e6, 200_000) / 0.9875, 0);
    expect(first.ok).toBe(true);
    const second = quoteCurveBuy(first.next, costForTokens(first.next.sold, 60_000) / 0.9875, first.tokensOut);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("CAP_PER_ACCOUNT");
  });

  it("fills the bonding buy exactly to $25,000 and refunds the excess (SQ-12)", () => {
    const state = { sold: soldForRaised(24_900), raised: 24_900 };
    const q = quoteCurveBuy(state, 500, 0);
    expect(q.ok).toBe(true);
    expect(q.bonds).toBe(true);
    expect(q.next.raised).toBe(25_000);
    expect(q.usdcNet).toBeCloseTo(100, 8);
    expect(q.usdcUsed).toBeCloseTo(100 / 0.9875, 8);
    expect(q.refund).toBeCloseTo(500 - 100 / 0.9875, 8);
    expect(q.next.sold).toBeCloseTo(S_MAX, 3);
    // S_max is 6,400,040 with the spec constants, so float ends 40 tokens above 8M (SQ-35)…
    expect(q.next.sold + PROTOCOL_CONFIG.supply.poolSeedTokens).toBeLessThanOrEqual(PROTOCOL_CONFIG.supply.float + 41);
    // …and the reserve is trimmed so max supply stays ≤ 10M
    const total = q.next.sold + PROTOCOL_CONFIG.supply.poolSeedTokens + reserveAfterBond(q.next.sold);
    expect(total).toBeLessThanOrEqual(PROTOCOL_CONFIG.supply.maxSupply + 1e-6);
  });

  it("rejects buys after bonding", () => {
    expect(quoteCurveBuy({ sold: S_MAX, raised: 25_000 }, 10).error).toBe("ALREADY_BONDED");
  });
});

describe("curve sells", () => {
  it("returns gross minus 1.25% and moves down the curve", () => {
    const state = { sold: 4e6, raised: raisedAt(4e6) };
    const q = quoteCurveSell(state, { tokens: 100_000 });
    expect(q.ok).toBe(true);
    expect(q.gross).toBeCloseTo(raisedAt(4e6) - raisedAt(3.9e6), 8);
    expect(q.fee).toBeCloseTo(q.gross * 0.0125, 10);
    expect(q.net).toBeCloseTo(q.gross * 0.9875, 10);
    expect(q.next.sold).toBe(3.9e6);
  });

  it("can sell by USDC amount (prototype input)", () => {
    const state = { sold: 4e6, raised: raisedAt(4e6) };
    const q = quoteCurveSell(state, { usdc: 250 });
    expect(q.ok).toBe(true);
    expect(q.gross).toBeCloseTo(250, 4);
  });

  it("rejects selling more than held", () => {
    const state = { sold: 4e6, raised: raisedAt(4e6) };
    expect(quoteCurveSell(state, { tokens: 1_000 }, 500).error).toBe("INSUFFICIENT_TOKENS");
  });
});

describe("bond split", () => {
  it("25,000 → 17,500 / 5,000 / 2,500", () => {
    const s = bondSplit(25_000);
    expect(s.poolSeedUsdc).toBe(17_500);
    expect(s.vaultUsdc).toBe(5_000);
    expect(s.treasuryUsdc).toBe(2_500);
    expect(s.poolSeedTokens).toBe(1_600_000);
    expect(s.openPrice).toBe(0.0109375);
  });
});
