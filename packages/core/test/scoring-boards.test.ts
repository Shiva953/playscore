import { describe, expect, it } from "vitest";
import {
  EVENT_MATRIX,
  LEAGUES,
  POSITIONS,
  allocateRoundPool,
  buildBoards,
  compareEntries,
  displayScore,
  holderPayout,
  payoutShares,
  scorePoints,
  type LeagueCode,
  type PositionCode,
  type RankEntry,
} from "../src";

describe("scoring", () => {
  it("display score: P = 6 → 5.0", () => {
    expect(displayScore(6)).toBe(5);
  });

  it("display score clamps to 0 for P ≤ 0 (SQ-20)", () => {
    expect(displayScore(0)).toBe(0);
    expect(displayScore(-3)).toBe(0);
    expect(displayScore(-12)).toBe(0);
  });

  it("matrix matches the spec rows", () => {
    expect(EVENT_MATRIX.goal.points).toEqual([6, 7, 9, 12]);
    expect(EVENT_MATRIX.assist.points).toEqual([4, 4.5, 5.5, 6]);
    expect(EVENT_MATRIX.cleanSheet.points).toEqual([0, 1, 3, 4]);
    expect(EVENT_MATRIX.goalConceded.points).toEqual([0, -0.1, -0.6, -0.9]);
    expect(EVENT_MATRIX.foul.points).toEqual([-0.2, -0.15, -0.1, -0.2]);
    expect(Object.keys(EVENT_MATRIX)).toHaveLength(29); // + minutes = 30 rows
  });

  it("applies the coefficient to events and minutes", () => {
    // FWD: 1 goal + 1 assist + 2 SOT + 90 minutes = 6 + 4 + 1 + 1.08 = 12.08
    const stat = { minutes: 90, goal: 1, assist: 1, shotOnTarget: 2 };
    expect(scorePoints(stat, "FWD", 1)).toBeCloseTo(12.08, 10);
    expect(scorePoints(stat, "FWD", 0.93)).toBeCloseTo(12.08 * 0.93, 10);
  });

  it("clean sheet scales with minutes/90", () => {
    expect(scorePoints({ minutes: 45, cleanSheet: 1 }, "DEF", 1)).toBeCloseTo(1.5 + 45 * 0.012, 10);
  });
});

/** Every position board and every league board gets ≥5 ranked players; Haaland tops FWD and PL. */
function fullField(): RankEntry[] {
  const entries: RankEntry[] = [];
  let n = 0;
  for (const lg of LEAGUES) {
    for (let i = 0; i < 5; i++) {
      const position = POSITIONS[(n + i) % 4] as PositionCode;
      entries.push({ playerId: `${lg}-${i}`, position, league: lg as LeagueCode, points: 10 - i, goals: 0, assists: 0, minutes: 90 });
    }
    n++;
  }
  entries.push({ playerId: "haaland", position: "FWD", league: "PL", points: 30, goals: 2, assists: 0, minutes: 90 });
  return entries;
}

describe("boards & payout split (position boards across leagues; GK top 3)", () => {
  const alloc = allocateRoundPool(buildBoards(fullField(), false), 10_000);

  it("only the four position boards: no per-league boards", () => {
    expect(alloc.boards.map((b) => b.def.key).sort()).toEqual(["pos:DEF", "pos:FWD", "pos:GK", "pos:MID"]);
  });

  it("Σ weights = 5 + 5 + 5 + 3 = 18 (goalkeepers pay three places)", () => {
    expect(alloc.totalWeight).toBeCloseTo(18, 10);
  });

  it("forward board = $2,777.78; Haaland #1 = 35% = $972.22; a 1% holder → $9.72", () => {
    const fwd = alloc.boards.find((b) => b.def.key === "pos:FWD")!;
    expect(fwd.poolUsd).toBeCloseTo(2777.78, 2);
    expect(fwd.winners).toHaveLength(5);
    expect(fwd.winners[0]!.playerId).toBe("haaland");
    expect(fwd.winners[0]!.usd).toBeCloseTo(972.22, 2);
    expect(alloc.playerPayouts.haaland).toBeCloseTo(972.22, 2);
    expect(holderPayout(alloc.playerPayouts.haaland!, 1, 100)).toBeCloseTo(9.72, 2);
  });

  it("goalkeeper board = $1,666.67, paid 44 / 31 / 25% to its top three", () => {
    const gk = alloc.boards.find((b) => b.def.key === "pos:GK")!;
    expect(gk.poolUsd).toBeCloseTo(1666.67, 2);
    expect(gk.winners.map((w) => w.share)).toEqual([0.44, 0.31, 0.25]);
    expect(gk.winners[0]!.usd).toBeCloseTo(733.33, 2);
  });

  it("allocates the whole pool when boards exist", () => {
    expect(alloc.allocated).toBeCloseTo(10_000, 6);
  });

  it("no Champions League board in a league weekend", () => {
    expect(alloc.boards.some((b) => b.def.kind === "ucl")).toBe(false);
  });

  it("allocates nothing when nobody played", () => {
    const none = allocateRoundPool(buildBoards([], false), 10_000);
    expect(none.allocated).toBe(0);
    expect(none.totalWeight).toBe(0);
  });

  it("players with 0 minutes are not ranked", () => {
    const boards = buildBoards(
      [{ playerId: "a", position: "FWD", league: "PL", points: 5, goals: 0, assists: 0, minutes: 0 }],
      false
    );
    expect(boards.every((b) => b.entries.length === 0)).toBe(true);
  });
});

describe("renormalisation and tie-breaks", () => {
  it("2 goalkeepers ranked → 44/31 scaled to 100%", () => {
    const s = payoutShares(2, [0.44, 0.31, 0.25]);
    expect(s[0]).toBeCloseTo(0.44 / 0.75, 12);
    expect(s[1]).toBeCloseTo(0.31 / 0.75, 12);
  });

  it("3 ranked → 35/25/20 scaled to 100%", () => {
    const s = payoutShares(3);
    expect(s[0]).toBeCloseTo(0.4375, 12);
    expect(s[1]).toBeCloseTo(0.3125, 12);
    expect(s[2]).toBeCloseTo(0.25, 12);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("ties break on goals + assists, then fewer minutes, then player ID", () => {
    const base = { position: "FWD" as const, league: "PL" as const, points: 8 };
    const a = { ...base, playerId: "a", goals: 1, assists: 0, minutes: 90 };
    const b = { ...base, playerId: "b", goals: 1, assists: 1, minutes: 90 };
    const c = { ...base, playerId: "c", goals: 1, assists: 0, minutes: 70 };
    const d = { ...base, playerId: "d", goals: 1, assists: 0, minutes: 90 };
    expect([a, b, c, d].sort(compareEntries).map((e) => e.playerId)).toEqual(["b", "c", "a", "d"]);
  });

  it("a Champions League board appears in midweek windows (×1.05)", () => {
    const e: RankEntry = { playerId: "x", position: "MID", league: "PL", points: 7, goals: 0, assists: 0, minutes: 90, ucl: true };
    const alloc = allocateRoundPool(buildBoards([e], true), 1_000);
    const ucl = alloc.boards.find((b) => b.def.kind === "ucl")!;
    expect(ucl.weight).toBeCloseTo(1.05, 12);
    // MID (1) + UCL (1.05): the sole player wins both
    expect(alloc.playerPayouts.x).toBeCloseTo(1_000, 8);
  });
});
