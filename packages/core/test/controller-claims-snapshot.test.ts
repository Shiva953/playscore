import { describe, expect, it } from "vitest";
import {
  PROTOCOL_CONFIG,
  createPool,
  eligibleForRound,
  eligibleSupplyAtSnapshot,
  eligibleTokens,
  holderPayout,
  prototypeHolderPayout,
  pushPayHistory,
  quoteAddLiquidity,
  quoteClaim,
  quotePoolBuy,
  sizeRoundPool,
  snapshotHolder,
  touchPosition,
  type LazyPosition,
} from "../src";

describe("round pool controller (ARCHITECTURE §9)", () => {
  it("no history → 100 bps", () => {
    const r = sizeRoundPool({ vault: 60_000, bondedPlayers: 6, payHistory: [], prevBps: null });
    expect(r.bps).toBe(100);
    expect(r.runwayRounds).toBe(Infinity);
  });

  it("annual cap TVL × 12% / 38 binds in the seed state ($521.05)", () => {
    const r = sizeRoundPool({ vault: 60_000, bondedPlayers: 6, payHistory: [], prevBps: null });
    expect(r.tvl).toBe(165_000);
    expect(r.capPerRound).toBeCloseTo((165_000 * 0.12) / 38, 10);
    expect(r.roundPool).toBeCloseTo(521.05, 2);
    expect(r.capped).toBe(true);
    // The UI must show this, not bps/100 (SQ-15)
    expect(r.effectiveRate).toBeCloseTo(521.05 / 60_000, 6);
  });

  it("step clamp ±10% per round", () => {
    // Long runway + high ratio → matrix says 220, clamped to 110 from 100
    const up = sizeRoundPool({ vault: 1_000_000, bondedPlayers: 1, payHistory: [100], prevBps: 100 });
    expect(up.matrixBps).toBe(220);
    expect(up.bps).toBeCloseTo(110, 10);
    // Short runway + low ratio → matrix says 25, clamped to 180 from 200
    const down = sizeRoundPool({ vault: 1_000, bondedPlayers: 1_000, payHistory: [100], prevBps: 200 });
    expect(down.matrixBps).toBe(25);
    expect(down.bps).toBeCloseTo(180, 10);
  });

  it("global clamp 20–250 bps", () => {
    // Only reachable if the previous bps was outside the band (e.g. a parameter change)
    const low = sizeRoundPool({ vault: 1_000, bondedPlayers: 1_000, payHistory: [100], prevBps: 15 });
    expect(low.bps).toBe(20);
    const high = sizeRoundPool({ vault: 1e7, bondedPlayers: 0, payHistory: [1], prevBps: 300 });
    expect(high.matrixBps).toBe(220);
    expect(high.bps).toBe(250);
  });

  it("smoothing ratchets bps up while the cap binds (documents SQ-15)", () => {
    let vault = 60_000;
    let prev: number | null = null;
    let hist: number[] = [];
    const bps: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = sizeRoundPool({ vault, bondedPlayers: 6, payHistory: hist, prevBps: prev });
      bps.push(r.bps);
      expect(r.capped).toBe(true);
      vault -= r.roundPool;
      hist = pushPayHistory(hist, r.roundPool);
      prev = r.bps;
    }
    expect(bps[5]).toBeGreaterThan(bps[0]! * 1.5);
  });
});

describe("claims (ARCHITECTURE §4.10)", () => {
  const rows = [
    { roundId: 1, playerId: "kane", usd: 10 },
    { roundId: 2, playerId: "kane", usd: 5 },
    { roundId: 1, playerId: "rodri", usd: 4 },
  ];

  it("USDC claims pay the full amount", () => {
    const q = quoteClaim(rows, "usdc", () => ({ price: 0.01, reserveLeft: 2e6 }));
    expect(q.usdcOut).toBeCloseTo(19, 12);
    expect(q.vaultRetained).toBe(0);
  });

  it("token claims mint usd × 1.1 / price and keep the USDC in the vault", () => {
    const q = quoteClaim(rows, "tokens", () => ({ price: 0.01, reserveLeft: 2e6 }));
    const kane = q.lines.find((l) => l.playerId === "kane")!;
    expect(kane.tokens).toBeCloseTo((15 * 1.1) / 0.01, 8);
    expect(q.usdcOut).toBeCloseTo(0, 12);
    expect(q.vaultRetained).toBeCloseTo(19, 10);
  });

  it("token mint never exceeds the reserve; the rest is paid in USDC (SQ-18)", () => {
    const q = quoteClaim([{ roundId: 1, playerId: "kane", usd: 100 }], "tokens", () => ({ price: 0.01, reserveLeft: 5_500 }));
    const l = q.lines[0]!;
    expect(l.tokens).toBe(5_500);
    expect(l.usdInTokens).toBeCloseTo(50, 8);
    expect(l.usdc).toBeCloseTo(50, 8);
  });

  it("empty reserve → USDC only", () => {
    const q = quoteClaim([{ roundId: 1, playerId: "kane", usd: 7 }], "tokens", () => ({ price: 0.01, reserveLeft: 0 }));
    expect(q.usdcOut).toBe(7);
  });
});

describe("snapshot & eligibility (ARCHITECTURE §9)", () => {
  it("buy after kickoff → 0 eligible; sell after kickoff → still eligible", () => {
    let pos: LazyPosition = { balance: 0, lastRound: 0, balanceAtRoundStart: 0 };
    // round 1 kicks off with 0 tokens, then the holder buys
    pos = touchPosition(pos, 1);
    pos = { ...pos, balance: 1_000 };
    expect(eligibleForRound(pos, 1)).toBe(0);

    let seller: LazyPosition = { balance: 1_000, lastRound: 0, balanceAtRoundStart: 0 };
    seller = touchPosition(seller, 1);
    seller = { ...seller, balance: 0 };
    expect(eligibleForRound(seller, 1)).toBe(1_000);
  });

  it("eager snapshot counts LP-attributed tokens", () => {
    const pool = createPool(17_500, 1_600_000);
    const add = quoteAddLiquidity(pool, 1_750);
    const s = snapshotHolder(5_000, add.sharesMinted, add.next);
    expect(eligibleTokens(s)).toBeCloseTo(5_000 + 160_000, 6);
  });

  it("prototype denominator overpays when price is above open; the fix doesn't (SQ-1)", () => {
    const curveSold = 6_400_000;
    const seed = PROTOCOL_CONFIG.supply.poolSeedTokens;
    // Holders buy 300k tokens out of the pool, so they now hold 6.4M + 300k-ish.
    const after = quotePoolBuy(createPool(17_500, seed), 4_000).next;
    const holderTokens = curveSold + seed - after.tokens;
    expect(holderTokens).toBeGreaterThan(curveSold);
    const payout = 1_000;
    const protoTotal = prototypeHolderPayout(payout, holderTokens, curveSold);
    expect(protoTotal).toBeGreaterThan(payout); // overpays
    const supply = eligibleSupplyAtSnapshot(holderTokens, after);
    expect(holderPayout(payout, holderTokens, supply)).toBeCloseTo(payout, 8); // exactly the payout
  });

  it("third-party LPs are in the denominator; the protocol seed isn't", () => {
    const pool = createPool(17_500, 1_600_000);
    const add = quoteAddLiquidity(pool, 1_750);
    expect(eligibleSupplyAtSnapshot(6_400_000, pool)).toBe(6_400_000);
    expect(eligibleSupplyAtSnapshot(6_240_000, add.next)).toBeCloseTo(6_240_000 + 160_000, 4);
  });
});
