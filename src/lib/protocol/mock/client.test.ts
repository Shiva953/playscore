import { describe, expect, it } from "vitest";
import { PROTOCOL_CONFIG } from "@score/core";
import { MockProtocolClient } from "./client";
import type { ProtocolEvent } from "../types";

/** Full Step 0 loop, headless: sign in → faucet → curve buy → bond → sell with tax → kickoff → live → settle → claim. */
function makeClient(start = Date.UTC(2026, 10, 2, 12, 0, 0)) {
  let t = start;
  const client = new MockProtocolClient({
    persist: false,
    now: () => t,
    settings: { latencyMs: 0, ambientMarket: false, clockMode: "demo" },
  });
  const events: ProtocolEvent[] = [];
  client.subscribe((e) => events.push(e));
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      t += 1_000;
      client.tick(t);
    }
  };
  return { client, events, advance, now: () => t };
}

describe("MockProtocolClient end to end", () => {
  it("blocks restricted countries and requires the Terms", async () => {
    const { client } = makeClient();
    await expect(client.signIn({ method: "google", country: "United Kingdom", acceptedTerms: true })).rejects.toThrow(
      /isn't available/
    );
    await expect(client.signIn({ method: "google", country: "Germany", acceptedTerms: false })).rejects.toThrow(/Terms/);
    expect(await client.getSession()).toBeNull();
  });

  it("runs the whole loop", async () => {
    const { client, events, advance } = makeClient();
    expect(client.quoteBuy("kane", 10).ok).toBe(true);
    await expect(client.buy("kane", 10)).rejects.toThrow(/Sign in/);

    // Sign in → 1,000 test USDC, plus the faucet
    await client.signIn({ method: "google", country: "Germany", acceptedTerms: true });
    await client.faucet(1_000);
    expect((await client.getPortfolio())!.usdc).toBe(2_000);

    // Buy on a launching curve, hit the cap message
    const capQuote = client.quoteBuy("haaland", 5_000);
    expect(capQuote.ok).toBe(false);
    expect(capQuote.error!.code).toBe("CAP_PER_PURCHASE");
    await client.buy("haaland", 500);
    const h = (await client.getPortfolio())!.positions.find((p) => p.playerId === "haaland")!;
    expect(h.tokens).toBeGreaterThan(0);
    expect(h.curvePurchased).toBe(h.tokens);

    // Push the curve near the threshold with synthetic demand, then bond it ourselves
    client.simulateLaunchDemand("haaland", 0.97);
    const before = await client.getPlayer("haaland");
    expect(before.status).toBe("launching");
    const vaultBefore = (await client.getProtocolStats()).vault;
    const r = await client.buy("haaland", 1_000);
    expect(r.bonded).toBe("haaland");
    expect(r.refund).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "bonded" && e.playerId === "haaland" && e.mine)).toBe(true);
    const after = await client.getPlayer("haaland");
    expect(after.status).toBe("trading");
    expect(after.pool!.usdc).toBeCloseTo(17_500, 6);
    expect(after.price).toBeCloseTo(0.0109375, 9);
    expect((await client.getProtocolStats()).vault).toBeCloseTo(vaultBefore + 5_000, 6);

    // Sell on the pool shows the 5% day-0 tax; fast-forward 30 days lowers it
    const q0 = client.quoteSell("haaland", { usdc: 100 });
    expect(q0.fees[0]!.rate).toBeCloseTo(0.05, 6);
    client.fastForwardDays(30);
    const q30 = client.quoteSell("haaland", { usdc: 100 });
    expect(q30.fees[0]!.rate).toBeCloseTo(0.035, 4);
    const vaultPreSell = (await client.getProtocolStats()).vault;
    await client.sell("haaland", { usdc: 100 });
    expect((await client.getProtocolStats()).vault).toBeCloseTo(vaultPreSell + 100 * 0.035 * 0.9, 4);

    // Also hold a seeded bonded player before kickoff
    await client.buy("kane", 300);

    // Kickoff → snapshot
    advance(PROTOCOL_CONFIG.curve.bondThresholdUsdc > 0 ? 40 : 0);
    let round = await client.getRound();
    expect(round.phase).toBe("live");
    expect(round.my.snapshotTaken).toBe(true);
    const snapKane = round.my.players.find((p) => p.playerId === "kane")!;
    expect(snapKane.tokens).toBeGreaterThan(0);

    // Buying after kickoff doesn't change this round's eligibility; selling doesn't remove it
    await client.buy("kane", 100);
    const sellAll = (await client.getPortfolio())!.positions.find((p) => p.playerId === "haaland")!;
    await client.sell("haaland", { tokens: sellAll.tokens });
    round = await client.getRound();
    expect(round.my.players.find((p) => p.playerId === "kane")!.tokens).toBeCloseTo(snapKane.tokens, 6);
    expect(round.my.players.find((p) => p.playerId === "haaland")).toBeDefined();

    // Live: events stream
    advance(50);
    round = await client.getRound();
    expect(round.phase).toBe("ended");
    expect(round.events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "match")).toBe(true);

    // Freeze → settle → claimable
    const vaultPreSettle = (await client.getProtocolStats()).vault;
    advance(5);
    round = await client.getRound();
    expect(round.round).toBe(2);
    expect(round.phase).toBe("open");
    const history = await client.getRoundHistory(5);
    expect(history).toHaveLength(1);
    expect(history[0]!.pool).toBeGreaterThan(0);
    expect((await client.getProtocolStats()).vault).toBeCloseTo(vaultPreSettle - history[0]!.pool, 6);
    // Two scheduled players launched with the new round
    expect((await client.listPlayers({ status: "launching" })).length).toBeGreaterThanOrEqual(5);

    const pf = (await client.getPortfolio())!;
    const claimable = pf.claimable.totalUsd;
    expect(claimable).toBeGreaterThan(0);
    expect(claimable).toBeCloseTo(history[0]!.myDividends, 8);
    // Holder payouts never exceed the player payout
    for (const row of history[0]!.myRows) {
      const won = history[0]!.boards.flatMap((b) => b.rows).filter((x) => x.playerId === row.playerId);
      const total = won.reduce((a, x) => a + x.usd, 0);
      expect(row.usd).toBeLessThanOrEqual(total + 1e-9);
    }

    // Claim in tokens: reserve minted, USDC stays in the vault
    const kaneBefore = (await client.getPlayer("kane")).supply;
    const vaultPreClaim = (await client.getProtocolStats()).vault;
    await client.claim("tokens");
    const kaneAfter = (await client.getPlayer("kane")).supply;
    const tokenLine = pf.claimable.tokens.lines.find((l) => l.playerId === "kane");
    if (tokenLine && tokenLine.tokens > 0) {
      expect(kaneAfter.minted - kaneBefore.minted).toBeCloseTo(tokenLine.tokens, 6);
      expect(kaneAfter.reserveLeft).toBeCloseTo(kaneBefore.reserveLeft - tokenLine.tokens, 6);
    }
    expect((await client.getProtocolStats()).vault).toBeCloseTo(vaultPreClaim + pf.claimable.tokens.vaultRetained, 6);
    const pf2 = (await client.getPortfolio())!;
    expect(pf2.claimable.totalUsd).toBe(0);
    expect(pf2.dividendsEarned).toBeCloseTo(claimable, 8);
    expect(pf2.history.some((h) => h.kind === "claim-tokens")).toBe(true);
    await expect(client.claim("usdc")).rejects.toThrow(/Nothing to claim/);

    // Next round: claim USDC instead
    advance(40 + 50 + 5);
    const pf3 = (await client.getPortfolio())!;
    if (pf3.claimable.totalUsd > 0) {
      const usdcBefore = pf3.usdc;
      await client.claim("usdc");
      expect((await client.getPortfolio())!.usdc).toBeCloseTo(usdcBefore + pf3.claimable.totalUsd, 6);
    }
  });

  it("adds and removes liquidity, keeping hold age", async () => {
    const { client, advance } = makeClient();
    await client.signIn({ method: "email", country: "Spain", acceptedTerms: true });
    await client.buy("kane", 400);
    client.fastForwardDays(60);
    const age0 = (await client.getPortfolio())!.positions[0]!.holdAgeDays;
    const pair = client.quoteLiquidity("kane", 100, "pair");
    expect(pair.ok).toBe(true);
    await client.addLiquidity("kane", 100, "pair");
    const pf = (await client.getPortfolio())!;
    expect(pf.lp).toHaveLength(1);
    expect(pf.lp[0]!.tokens).toBeGreaterThan(0);
    // LP tokens count at kickoff
    advance(40);
    const round = await client.getRound();
    const kane = round.my.players.find((p) => p.playerId === "kane")!;
    expect(kane.tokens).toBeGreaterThan(pf.positions[0]!.tokens);
    await client.removeLiquidity("kane");
    const pf2 = (await client.getPortfolio())!;
    expect(pf2.lp).toHaveLength(0);
    expect(pf2.positions[0]!.holdAgeDays).toBeCloseTo(age0, 3);
    // Zap works with USDC only
    await client.addLiquidity("rodri", 200, "zap");
    expect((await client.getPortfolio())!.lp[0]!.playerId).toBe("rodri");
  });

  it("catches up after sleeping, without replaying a backlog", async () => {
    const { client } = makeClient();
    const before = (await client.getRound()).round;
    const s = client.state;
    // 10 minutes later
    client.tick(s.round.phaseEndsAt + 10 * 60_000);
    const after = await client.getRound();
    expect(after.round).toBe(before);
    expect(after.phase).toBe("open");
  });

  it("reset restores the seed world", async () => {
    const { client } = makeClient();
    await client.signIn({ method: "google", country: "Japan", acceptedTerms: true });
    await client.buy("kane", 100);
    client.reset();
    expect(await client.getSession()).toBeNull();
    expect((await client.getProtocolStats()).vault).toBe(60_000);
  });
});

describe("bonding buy balance check", () => {
  it("only needs the USDC actually used up to the threshold", async () => {
    const { client } = makeClient();
    await client.signIn({ method: "google", country: "Germany", acceptedTerms: true });
    client.simulateLaunchDemand("olise", 0.97);
    const before = (await client.getPortfolio())!.usdc; // 1,000
    // Typing more than the balance is fine when the fill needs less than the balance
    const q = client.quoteBuy("olise", 5_000);
    expect(q.bonds).toBe(true);
    expect(q.usdc).toBeLessThan(before);
    expect(q.ok).toBe(true);
    const r = await client.buy("olise", 5_000);
    expect(r.bonded).toBe("olise");
    expect((await client.getPortfolio())!.usdc).toBeCloseTo(before - q.usdc, 6);
  });
});
