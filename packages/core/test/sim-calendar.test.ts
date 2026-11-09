import { describe, expect, it } from "vitest";
import {
  PLAYERS,
  advanceRound,
  buildSeed,
  calendarPositionAt,
  initialSimState,
  launchSlots,
  planRound,
  scorePoints,
  spotPrice,
  windowForRound,
  type SimPlayerInput,
} from "../src";

const NOW = Date.UTC(2026, 10, 2, 12, 0);

describe("seed parity with the prototype", () => {
  const seed = buildSeed(NOW);

  it("the client's list: 6 bonded, 4 launching, the rest scheduled; vault $60,000", () => {
    const states = Object.values(seed.state);
    expect(PLAYERS.length).toBeGreaterThan(200);
    expect(new Set(PLAYERS.map((p) => p.ticker)).size).toBe(PLAYERS.length);
    expect(states.filter((s) => s.status === "trading")).toHaveLength(6);
    expect(states.filter((s) => s.status === "launching")).toHaveLength(4);
    expect(states.filter((s) => s.status === "scheduled")).toHaveLength(PLAYERS.length - 10);
    expect(seed.vault).toBe(60_000);
  });

  it("launching curves match the prototype's seeded raises", () => {
    // Launch order is the client's ICO#; the seeded raises keep the prototype's sequence.
    expect(seed.state.pacho!.curve.raised).toBe(14_842);
    expect(seed.state.olise!.curve.raised).toBe(15_693);
    expect(seed.state.vuskovic!.curve.raised).toBe(16_545);
    expect(seed.state.pedri!.curve.raised).toBe(17_397);
  });

  it("bonded pools sit at the prototype's last price", () => {
    const jude = seed.state.bellingham!;
    const last = jude.priceHistory[jude.priceHistory.length - 1]!.p;
    expect(last).toBeCloseTo(0.0102, 4);
    expect(spotPrice(jude.pool!)).toBeCloseTo(last, 9);
    expect(jude.pool!.totalShares).toBeGreaterThan(jude.pool!.protocolShares); // third-party LP
  });

  it("scheduled players launch on weekday 14:00/20:00 UTC slots", () => {
    for (const s of Object.values(seed.state).filter((x) => x.status === "scheduled")) {
      const d = new Date(s.launchAt!);
      expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay());
      expect([14, 20]).toContain(d.getUTCHours());
    }
  });
});

describe("calendar", () => {
  it("round 1 = league weekend Fri 30 Oct → Mon 2 Nov; round 2 = UCL Tue 3 → Thu 5 Nov", () => {
    const r1 = windowForRound(1);
    expect(r1.kind).toBe("league");
    expect(r1.fromLabel).toBe("Fri 30 Oct");
    expect(r1.toLabel).toBe("Mon 2 Nov");
    const r2 = windowForRound(2);
    expect(r2.kind).toBe("ucl");
    expect(r2.fromLabel).toBe("Tue 3 Nov");
    expect(r2.toLabel).toBe("Thu 5 Nov");
  });

  it("freeze is 12h after the last whistle and always before the next kickoff", () => {
    for (let r = 1; r < 30; r++) {
      const w = windowForRound(r);
      expect(w.freezeAt - w.lastWhistle).toBe(12 * 3_600_000);
      expect(w.freezeAt).toBeLessThan(windowForRound(r + 1).firstKickoff);
    }
  });

  it("phase at a given time", () => {
    // Mon 2 Nov 12:00 UTC: round 1 is live
    expect(calendarPositionAt(NOW)).toMatchObject({ round: 1, phase: "live" });
    // Tue 3 Nov 05:00 UTC: round 1 ended, freezing
    expect(calendarPositionAt(Date.UTC(2026, 10, 3, 5))).toMatchObject({ round: 1, phase: "ended" });
    // Tue 3 Nov 12:00 UTC: round 2 open
    expect(calendarPositionAt(Date.UTC(2026, 10, 3, 12))).toMatchObject({ round: 2, phase: "open" });
  });

  it("launch slots skip weekends", () => {
    const slots = launchSlots(Date.UTC(2026, 9, 30, 21), 4); // Fri after 20:00
    expect(slots.map((t) => new Date(t).toISOString())).toEqual([
      "2026-11-02T14:00:00.000Z",
      "2026-11-02T20:00:00.000Z",
      "2026-11-03T14:00:00.000Z",
      "2026-11-03T20:00:00.000Z",
    ]);
  });
});

describe("match simulator", () => {
  const inputs: SimPlayerInput[] = PLAYERS.map((p) => ({
    id: p.id,
    club: p.club,
    position: p.position,
    league: p.league,
    avgScore: p.avgScore,
    inUcl: p.inUcl,
  }));
  const byId = Object.fromEntries(inputs.map((p) => [p.id, p]));

  function runRound(kind: "league" | "ucl", seed: number, steps = 50) {
    const plan = planRound({ round: 1, kind, mode: "demo", players: inputs, seed });
    let state = initialSimState(plan, seed);
    const events = [];
    for (let i = 1; i <= steps; i++) {
      const r = advanceRound(plan, state, i / steps, byId);
      state = r.state;
      events.push(...r.events);
    }
    return { plan, state, events };
  }

  it("is deterministic for a seed", () => {
    const a = runRound("league", 42);
    const b = runRound("league", 42);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it("a club kicks off at the first moment (the snapshot) and every match reaches full time", () => {
    const { plan, events } = runRound("league", 7);
    expect(Object.values(plan.clubs).some((c) => c.kickoff === 0)).toBe(true);
    const fulltimes = events.filter((e) => e.code === "fulltime").length;
    expect(fulltimes).toBe(Object.keys(plan.clubs).length);
  });

  it("minutes never exceed 90 and match the plan", () => {
    const { plan, state } = runRound("league", 99);
    for (const [id, pp] of Object.entries(plan.players)) {
      expect(state.stats[id]?.minutes ?? 0).toBe(pp.off - pp.on);
    }
  });

  it("midweek only UCL clubs play", () => {
    const { plan, state } = runRound("ucl", 5);
    for (const id of Object.keys(state.stats)) expect(byId[id]!.inUcl).toBe(true);
    expect(plan.players.messi).toBeUndefined();
  });

  it("produces plausible scores (elite average 4–20 points)", () => {
    let total = 0;
    let n = 0;
    for (let s = 1; s <= 20; s++) {
      const { state } = runRound("league", s * 31);
      for (const [id, stat] of Object.entries(state.stats)) {
        if (stat.minutes < 90) continue;
        total += scorePoints(stat, byId[id]!.position, 1);
        n++;
      }
    }
    const avg = total / n;
    expect(avg).toBeGreaterThan(4);
    expect(avg).toBeLessThan(20);
  });

  it("advancing twice to the same progress is a no-op", () => {
    const plan = planRound({ round: 3, kind: "league", mode: "demo", players: inputs, seed: 3 });
    const s0 = initialSimState(plan, 3);
    const a = advanceRound(plan, s0, 0.5, byId);
    const b = advanceRound(plan, a.state, 0.5, byId);
    expect(b.events).toHaveLength(0);
    expect(b.state.stats).toEqual(a.state.stats);
  });
});
