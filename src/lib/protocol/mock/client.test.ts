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
    expect(client.quoteBuy("bellingham", 10).ok).toBe(true);
    await expect(client.buy("bellingham", 10)).rejects.toThrow(/Sign in/);

    // Sign in → 1,000 test USDC, plus the faucet
    await client.signIn({ method: "google", country: "Germany", acceptedTerms: true });
    await client.faucet(1_000);
    expect((await client.getPortfolio())!.usdc).toBe(2_000);

    // Buy on a launching curve, hit the cap message
    const capQuote = client.quoteBuy("olise", 5_000);
    expect(capQuote.ok).toBe(false);
    expect(capQuote.error!.code).toBe("CAP_PER_PURCHASE");
    await client.buy("olise", 500);
    const h = (await client.getPortfolio())!.positions.find((p) => p.playerId === "olise")!;
    expect(h.tokens).toBeGreaterThan(0);
    expect(h.curvePurchased).toBe(h.tokens);

    // Push the curve near the threshold with synthetic demand, then bond it ourselves
    client.simulateLaunchDemand("olise", 0.97);
    const before = await client.getPlayer("olise");
    expect(before.status).toBe("launching");
    const vaultBefore = (await client.getProtocolStats()).vault;
    const r = await client.buy("olise", 1_000);
    expect(r.bonded).toBe("olise");
    expect(r.refund).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "bonded" && e.playerId === "olise" && e.mine)).toBe(true);
    const after = await client.getPlayer("olise");
    expect(after.status).toBe("trading");
    expect(after.pool!.usdc).toBeCloseTo(17_500, 6);
    expect(after.price).toBeCloseTo(0.0109375, 9);
    expect((await client.getProtocolStats()).vault).toBeCloseTo(vaultBefore + 5_000, 6);

    // Sell on the pool shows the 5% day-0 tax; fast-forward 30 days lowers it
    const q0 = client.quoteSell("olise", { usdc: 100 });
    expect(q0.fees[0]!.rate).toBeCloseTo(0.05, 6);
    client.fastForwardDays(30);
    const q30 = client.quoteSell("olise", { usdc: 100 });
    expect(q30.fees[0]!.rate).toBeCloseTo(0.035, 4);
    const vaultPreSell = (await client.getProtocolStats()).vault;
    await client.sell("olise", { usdc: 100 });
    expect((await client.getProtocolStats()).vault).toBeCloseTo(vaultPreSell + 100 * 0.035 * 0.9, 4);

    // Also hold a seeded bonded player before kickoff
    await client.buy("bellingham", 300);

    // Kickoff → snapshot
    advance(PROTOCOL_CONFIG.curve.bondThresholdUsdc > 0 ? 40 : 0);
    let round = await client.getRound();
    expect(round.phase).toBe("live");
    expect(round.my.snapshotTaken).toBe(true);
    const snapJude = round.my.players.find((p) => p.playerId === "bellingham")!;
    expect(snapJude.tokens).toBeGreaterThan(0);

    // Buying after kickoff doesn't change this round's eligibility; selling doesn't remove it
    await client.buy("bellingham", 100);
    const sellAll = (await client.getPortfolio())!.positions.find((p) => p.playerId === "olise")!;
    await client.sell("olise", { tokens: sellAll.tokens });
    round = await client.getRound();
    expect(round.my.players.find((p) => p.playerId === "bellingham")!.tokens).toBeCloseTo(snapJude.tokens, 6);
    expect(round.my.players.find((p) => p.playerId === "olise")).toBeDefined();

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
    const judeBefore = (await client.getPlayer("bellingham")).supply;
    const vaultPreClaim = (await client.getProtocolStats()).vault;
    await client.claim("tokens");
    const judeAfter = (await client.getPlayer("bellingham")).supply;
    const tokenLine = pf.claimable.tokens.lines.find((l) => l.playerId === "bellingham");
    if (tokenLine && tokenLine.tokens > 0) {
      expect(judeAfter.minted - judeBefore.minted).toBeCloseTo(tokenLine.tokens, 6);
      expect(judeAfter.reserveLeft).toBeCloseTo(judeBefore.reserveLeft - tokenLine.tokens, 6);
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
    await client.buy("bellingham", 400);
    client.fastForwardDays(60);
    const age0 = (await client.getPortfolio())!.positions[0]!.holdAgeDays;
    const pair = client.quoteLiquidity("bellingham", 100, "pair");
    expect(pair.ok).toBe(true);
    await client.addLiquidity("bellingham", 100, "pair");
    const pf = (await client.getPortfolio())!;
    expect(pf.lp).toHaveLength(1);
    expect(pf.lp[0]!.tokens).toBeGreaterThan(0);
    // LP tokens count at kickoff
    advance(40);
    const round = await client.getRound();
    const kane = round.my.players.find((p) => p.playerId === "bellingham")!;
    expect(kane.tokens).toBeGreaterThan(pf.positions[0]!.tokens);
    await client.removeLiquidity("bellingham");
    const pf2 = (await client.getPortfolio())!;
    expect(pf2.lp).toHaveLength(0);
    expect(pf2.positions[0]!.holdAgeDays).toBeCloseTo(age0, 3);
    // Zap works with USDC only
    await client.addLiquidity("mbappe", 200, "zap");
    expect((await client.getPortfolio())!.lp[0]!.playerId).toBe("mbappe");
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
    await client.buy("bellingham", 100);
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

describe("lab pin and seek", () => {
  it("holds a mid-live moment, then resumes from it", async () => {
    const { client, advance, now } = makeClient();
    client.skipPhase(); // open → live
    expect((await client.getRound()).phase).toBe("live");
    client.seekPhase(0.5);
    const at = await client.getRound();
    expect(at.liveProgress).toBeCloseTo(0.5, 1);
    const events = at.events.length;
    expect(events).toBeGreaterThan(0);

    client.setPinned(true);
    const left = at.phaseEndsAt - now();
    advance(120); // longer than the whole live phase
    const held = await client.getRound();
    expect(held.phase).toBe("live");
    expect(held.events.length).toBe(events);
    expect(held.phaseEndsAt - now()).toBe(left);

    client.setPinned(false);
    advance(Math.ceil(left / 1000));
    expect((await client.getRound()).phase).toBe("ended");
  });
});

describe("limit orders", () => {
  it("escrows a buy, fills it once the price crosses, and refunds on cancel", async () => {
    const { client, advance } = makeClient();
    await client.signIn({ method: "google", country: "Germany", acceptedTerms: true });
    const spot = (await client.getPlayer("bellingham")).price;
    const before = (await client.getPortfolio())!.usdc;

    // Below the price: rests, USDC escrowed
    await client.placeLimit("bellingham", "buy", 50, spot * 0.5);
    let pf = (await client.getPortfolio())!;
    expect(pf.orders).toHaveLength(1);
    expect(pf.usdc).toBeCloseTo(before - 50, 6);
    advance(3);
    expect((await client.getPortfolio())!.orders).toHaveLength(1);

    // Cancel: refunded
    await client.cancelOrder(pf.orders[0]!.id);
    pf = (await client.getPortfolio())!;
    expect(pf.orders).toHaveLength(0);
    expect(pf.usdc).toBeCloseTo(before, 6);

    // At or above the price: fills on the next tick
    await client.placeLimit("bellingham", "buy", 40, spot * 1.5);
    advance(1);
    pf = (await client.getPortfolio())!;
    expect(pf.orders).toHaveLength(0);
    expect(pf.positions.find((p) => p.playerId === "bellingham")!.tokens).toBeGreaterThan(0);
  });

  it("rejects limits on players still on the launch curve, and sells beyond holdings", async () => {
    const { client } = makeClient();
    await client.signIn({ method: "google", country: "Germany", acceptedTerms: true });
    await expect(client.placeLimit("olise", "buy", 10, 0.01)).rejects.toThrow(/bonds/);
    await expect(client.placeLimit("bellingham", "sell", 1_000, 0.02)).rejects.toThrow(/You hold/);
  });
});

describe("sign-in identities", () => {
  it("demo account seeds holdings from the faucet balance", async () => {
    const { client } = makeClient();
    await client.signIn({ method: "demo", country: "Germany", acceptedTerms: true });
    const pf = (await client.getPortfolio())!;
    expect(pf.user.method).toBe("demo");
    expect(pf.positions.length).toBeGreaterThanOrEqual(3);
    expect(pf.usdc).toBeLessThan(1_000);
    expect(pf.usdc + pf.positionsValue).toBeGreaterThan(900);
  });

  it("uses the Privy wallet address and keeps the account on a repeat sign-in", async () => {
    const { client } = makeClient();
    const identity = { id: "did:privy:abc", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", handle: "fan@example.com" };
    const s = await client.signIn({ method: "email", country: "Germany", acceptedTerms: true, identity });
    expect(s.address).toBe(identity.address);
    expect(s.label).toBe("Email · fan@example.com");
    await client.buy("bellingham", 25);
    await client.signIn({ method: "email", country: "Germany", acceptedTerms: true, identity });
    const pf = (await client.getPortfolio())!;
    expect(pf.positions.find((p) => p.playerId === "bellingham")).toBeDefined();
  });
});
