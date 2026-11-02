import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  PROTOCOL_CONFIG,
  S_MAX,
  allocateRoundPool,
  bondSplit,
  buildBoards,
  createPool,
  eligibleForRound,
  eligibleSupplyAtSnapshot,
  holderPayout,
  pushPayHistory,
  quoteClaim,
  quoteCurveBuy,
  quoteCurveSell,
  quotePoolBuy,
  quotePoolSell,
  reserveAfterBond,
  sizeRoundPool,
  touchPosition,
  type CurveState,
  type LazyPosition,
  type PoolState,
  type RankEntry,
} from "../src";

const MAX = PROTOCOL_CONFIG.supply.maxSupply;

describe("supply never exceeds 10M", () => {
  it("random curve trades → bond → pool trades → token claims", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.boolean(), fc.double({ min: 1, max: 3_000, noNaN: true })), { maxLength: 400 }),
        fc.array(fc.double({ min: 0, max: 50_000, noNaN: true }), { maxLength: 10 }),
        (curveOps, claims) => {
          let curve: CurveState = { sold: 0, raised: 0 };
          // Many synthetic accounts, each within the cap
          let bonded = false;
          for (const [buy, usdc] of curveOps) {
            if (bonded) break;
            if (buy) {
              const q = quoteCurveBuy(curve, usdc, 0);
              if (q.ok) {
                curve = q.next;
                bonded = q.bonds;
              }
            } else {
              const q = quoteCurveSell(curve, { usdc: Math.min(usdc, curve.raised * 0.5) });
              if (q.ok) curve = q.next;
            }
            expect(curve.sold).toBeLessThanOrEqual(S_MAX + 1e-6);
          }
          let minted = 0;
          let reserve = reserveAfterBond(curve.sold);
          if (bonded) {
            const split = bondSplit(curve.raised);
            expect(split.poolSeedUsdc + split.vaultUsdc + split.treasuryUsdc).toBeCloseTo(curve.raised, 6);
            for (const usd of claims) {
              const q = quoteClaim([{ roundId: 1, playerId: "p", usd }], "tokens", () => ({ price: 0.0109, reserveLeft: reserve }));
              const t = q.lines[0]!.tokens;
              expect(t).toBeLessThanOrEqual(reserve + 1e-9);
              reserve -= t;
              minted += t;
            }
          }
          const supply = curve.sold + (bonded ? PROTOCOL_CONFIG.supply.poolSeedTokens : 0) + minted;
          expect(supply).toBeLessThanOrEqual(MAX + 1e-6);
        }
      ),
      { numRuns: 150 }
    );
  });
});

describe("vault never negative", () => {
  it("controller pays at most 2.5% of the vault per round", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5e6, noNaN: true }),
        fc.integer({ min: 0, max: 300 }),
        fc.array(fc.double({ min: 0, max: 50_000, noNaN: true }), { maxLength: 60 }),
        (vault0, bonded, inflows) => {
          let vault = vault0;
          let hist: number[] = [];
          let prev: number | null = null;
          for (const inflow of inflows) {
            const r = sizeRoundPool({ vault, bondedPlayers: bonded, payHistory: hist, prevBps: prev });
            expect(r.roundPool).toBeLessThanOrEqual(vault * 0.025 + 1e-9);
            expect(r.bps).toBeGreaterThanOrEqual(20);
            expect(r.bps).toBeLessThanOrEqual(250);
            vault -= r.roundPool;
            expect(vault).toBeGreaterThanOrEqual(0);
            vault += inflow;
            hist = pushPayHistory(hist, r.roundPool);
            prev = r.bps;
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

const entryArb = fc.record({
  playerId: fc.string({ minLength: 1, maxLength: 4 }),
  position: fc.constantFrom("FWD", "MID", "DEF", "GK" as const),
  league: fc.constantFrom("PL", "LAL", "BUN", "SA", "L1", "MLS", "SPL" as const),
  points: fc.double({ min: -10, max: 40, noNaN: true }),
  goals: fc.integer({ min: 0, max: 3 }),
  assists: fc.integer({ min: 0, max: 3 }),
  minutes: fc.integer({ min: 0, max: 90 }),
  ucl: fc.boolean(),
}) as fc.Arbitrary<RankEntry>;

describe("payouts ≤ round pool", () => {
  it("board allocation never exceeds the pool and sums to it when anyone ranked", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(entryArb, { selector: (e) => e.playerId, maxLength: 60 }),
        fc.boolean(),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (entries, ucl, pool) => {
          const a = allocateRoundPool(buildBoards(entries, ucl), pool);
          const total = Object.values(a.playerPayouts).reduce((s, v) => s + v, 0);
          expect(total).toBeLessThanOrEqual(pool * (1 + 1e-9) + 1e-9);
          if (entries.some((e) => e.minutes > 0)) expect(total).toBeCloseTo(pool, 4);
          else expect(total).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("Σ holder payouts ≤ player payout with the eligible-supply denominator", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 500_000, noNaN: true }), { minLength: 1, maxLength: 30 }),
        fc.array(fc.tuple(fc.boolean(), fc.double({ min: 1, max: 5_000, noNaN: true })), { maxLength: 30 }),
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        (holders, trades, payout) => {
          let pool: PoolState = createPool(17_500, 1_600_000);
          for (const [buy, usdc] of trades) {
            const q = buy ? quotePoolBuy(pool, usdc) : quotePoolSell(pool, { usdc: Math.min(usdc, pool.usdc * 0.5) }, 0.02);
            if (q.ok) pool = q.next;
          }
          const holderTokens = holders.reduce((s, v) => s + v, 0);
          const supply = eligibleSupplyAtSnapshot(holderTokens, pool);
          const paid = holders.reduce((s, h) => s + holderPayout(payout, h, supply), 0);
          expect(paid).toBeLessThanOrEqual(payout * (1 + 1e-9) + 1e-9);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("lazy snapshot agrees with an eager kickoff snapshot", () => {
  it("random balance changes across rounds", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: -500, max: 500 })), { maxLength: 40 }),
        (ops) => {
          // ops: [kickoffs to advance before this change, delta]
          let round = 0;
          let balance = 1_000;
          const eager: Record<number, number> = {};
          let lazy: LazyPosition = { balance, lastRound: 0, balanceAtRoundStart: 0 };
          for (const [advance, delta] of ops) {
            for (let i = 0; i < advance; i++) {
              round++;
              eager[round] = balance;
              // the round before is settled before this kickoff: accrue it from the lazy state
              if (round > 1) expect(eligibleForRound(lazy, round - 1)).toBe(eager[round - 1]);
            }
            if (round > 0) lazy = touchPosition(lazy, round);
            balance = Math.max(0, balance + delta);
            lazy = { ...lazy, balance };
          }
          if (round > 0) expect(eligibleForRound(lazy, round)).toBe(eager[round]);
        }
      ),
      { numRuns: 200 }
    );
  });
});
