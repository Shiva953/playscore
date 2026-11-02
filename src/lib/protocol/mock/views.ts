import {
  BOND_PRICE,
  COEFFICIENTS,
  LAUNCH_PRICE,
  LEAGUE_NAMES,
  POOL_OPEN_PRICE,
  PROTOCOL_CONFIG,
  RESTRICTED_COUNTRIES,
  SIGN_IN_COUNTRIES,
  S_MAX,
  allocateRoundPool,
  bondProgress,
  buildBoards,
  competitionsFor,
  createRng,
  displayScore,
  eligibleSupplyAtSnapshot,
  eligibleTokens,
  hashString,
  holdAgeDays,
  holderPayout,
  impactLadder,
  impermanentLoss,
  lpTokensFor,
  lpUsdcFor,
  lpValueUsd,
  matchMinute,
  nonProtocolPoolTokens,
  quoteAddLiquidity,
  quoteClaim,
  quoteCurveBuy,
  quoteCurveSell,
  quotePoolBuy,
  quotePoolSell,
  quoteZap,
  scorePoints,
  sellTaxRate,
  sizeRoundPool,
  snapshotHolder,
  spotPrice,
  totalPoints,
  windowForRound,
  type ControllerResult,
  type CurveError,
  type PoolError,
  type RankEntry,
  type RoundAllocation,
} from "@score/core";
import type {
  BoardView,
  ClaimableView,
  LiquidityQuote,
  LiveScoreView,
  LpPositionView,
  MyRoundView,
  PlayerDetail,
  PlayerFilter,
  PlayerSummary,
  Portfolio,
  PositionView,
  PricePoint,
  PriceRange,
  ProtocolConfigView,
  ProtocolStats,
  Quote,
  QuoteError,
  RoundState,
} from "../types";
import {
  DAY_MS,
  circulating,
  coefficientFor,
  getPlayer,
  holdNow,
  holderTokens,
  profile,
  spot,
  userTokens,
} from "./helpers";
import type { MockState, PlayerRuntime } from "./state";

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const fmtTokens = (n: number) => Math.floor(n).toLocaleString("en-US");

// ---------------------------------------------------------------- players

function volume24h(p: PlayerRuntime, now: number): number {
  const since = now - DAY_MS;
  return p.baseVolume24h + p.volumeLog.filter((v) => v.t >= since).reduce((s, v) => s + v.usd, 0);
}

function change24h(p: PlayerRuntime, now: number): number {
  const h = p.priceHistory;
  if (h.length < 2) return 0;
  const cutoff = now - DAY_MS;
  let ref = h[0]!;
  for (const pt of h) {
    if (pt.t <= cutoff) ref = pt;
    else break;
  }
  const cur = spot(p);
  return ref.p > 0 ? cur / ref.p - 1 : 0;
}

function playsThisWindow(s: MockState, id: string): boolean {
  const w = windowForRound(s.round.round);
  return w.kind === "league" || profile(id).inUcl;
}

function liveDisplayFor(s: MockState, id: string): number | null {
  const r = s.round;
  if (r.phase === "open" || !r.sim) return null;
  const stat = r.sim.stats[id];
  if (!stat || stat.minutes <= 0) return null;
  const pr = profile(id);
  return displayScore(scorePoints(stat, pr.position, coefficientFor(windowForRound(r.round).kind, pr.league)));
}

export function summaryOf(s: MockState, id: string, now: number): PlayerSummary {
  const p = getPlayer(s, id);
  const pr = profile(id);
  const price = spot(p);
  const last = p.form[p.form.length - 1];
  const hist = p.priceHistory;
  return {
    id,
    name: pr.name,
    ticker: pr.ticker,
    club: pr.club,
    country: pr.country,
    age: pr.age,
    league: pr.league,
    leagueName: LEAGUE_NAMES[pr.league],
    position: pr.position,
    avgScore: pr.avgScore,
    inUcl: pr.inUcl,
    status: p.status,
    launchAt: p.launchAt,
    bondedAt: p.bondedAt,
    price: p.status === "scheduled" ? LAUNCH_PRICE : price,
    change24h: p.status === "scheduled" ? 0 : change24h(p, now),
    volume24h: volume24h(p, now),
    raised: p.curve.raised,
    bondProgress: p.status === "trading" ? 1 : bondProgress(p.curve),
    marketCap: price * circulating(p),
    liquidityUsd: p.pool ? p.pool.usdc * 2 : null,
    sparkline: hist.slice(-30).map((x) => x.p),
    lastScore: last ? last.score : null,
    lastBoardRank: last && last.rank <= 5 ? last.rank : null,
    liveScore: liveDisplayFor(s, id),
    playsThisWindow: playsThisWindow(s, id),
  };
}

export function listOf(s: MockState, filter: PlayerFilter | undefined, now: number): PlayerSummary[] {
  const q = filter?.search?.trim().toLowerCase();
  return Object.keys(s.players)
    .map((id) => summaryOf(s, id, now))
    .filter((x) => !filter?.status || filter.status === "all" || x.status === filter.status)
    .filter((x) => !filter?.league || filter.league === "all" || x.league === filter.league)
    .filter((x) => !filter?.position || filter.position === "all" || x.position === filter.position)
    .filter(
      (x) =>
        !q ||
        x.name.toLowerCase().includes(q) ||
        x.ticker.toLowerCase().includes(q) ||
        x.club.toLowerCase().includes(q)
    );
}

const HOLDER_NAMES = [
  "0x7a…c2",
  "goalhanger",
  "nutmeg.sol",
  "rondo_fan",
  "false9.sol",
  "0x91…e4",
  "tikitaka",
  "panenka",
  "libero.sol",
  "0x3f…aa",
];

function holdersOf(s: MockState, p: PlayerRuntime) {
  const rows: PlayerDetail["holders"] = [];
  const total = circulating(p);
  if (total <= 0) return rows;
  const mine = userTokens(s.user, p.id);
  const rng = createRng(hashString(p.id));
  const others = Math.max(0, holderTokens(p) - mine);
  let pct = 0.055 + rng.next() * 0.02;
  const used = new Set<number>();
  for (let i = 0; i < 6; i++) {
    let n = Math.floor(rng.next() * HOLDER_NAMES.length);
    while (used.has(n)) n = (n + 1) % HOLDER_NAMES.length;
    used.add(n);
    const tokens = Math.min(others, total * pct);
    rows.push({ label: HOLDER_NAMES[n]!, tokens, share: tokens / total, isYou: false, kind: "holder" });
    pct *= 0.72 + rng.next() * 0.1;
  }
  if (mine > 0) rows.push({ label: "You", tokens: mine, share: mine / total, isYou: true, kind: "holder" });
  if (p.pool) {
    const lp = nonProtocolPoolTokens(p.pool);
    const seed = p.pool.tokens - lp;
    rows.push({ label: "Pool · liquidity providers", tokens: lp, share: lp / total, isYou: false, kind: "lp" });
    rows.push({ label: "Pool · locked protocol seed", tokens: seed, share: seed / total, isYou: false, kind: "protocol" });
  }
  return rows.sort((a, b) => b.tokens - a.tokens);
}

export function positionViewOf(s: MockState, id: string, now: number): PositionView | null {
  const u = s.user;
  const pos = u?.positions[id];
  if (!u || !pos || pos.tokens <= 1e-9) return null;
  const p = getPlayer(s, id);
  const pr = profile(id);
  const price = spot(p);
  const age = holdAgeDays(pos.ts, holdNow(s, now));
  const trading = p.status === "trading" && !!p.pool;
  const realisable = trading
    ? quotePoolSell(p.pool!, { tokens: pos.tokens }, sellTaxRate(age)).net
    : quoteCurveSell(p.curve, { tokens: pos.tokens }).net;
  const value = pos.tokens * price;
  const snap = s.round.snapshot;
  return {
    playerId: id,
    ticker: pr.ticker,
    name: pr.name,
    position: pr.position,
    status: p.status,
    tokens: pos.tokens,
    price,
    value,
    costBasis: pos.costBasis,
    pnl: value - pos.costBasis,
    pnlPct: pos.costBasis > 0 ? value / pos.costBasis - 1 : 0,
    holdAgeDays: age,
    sellTaxNow: trading ? sellTaxRate(age) : PROTOCOL_CONFIG.curve.feeRate,
    realisableUsd: realisable,
    curvePurchased: pos.curvePurchased,
    snapshotTokens: snap ? eligibleTokens(snap.user[id]) : null,
    countsNextKickoff: trading,
  };
}

export function lpViewOf(s: MockState, id: string, now: number): LpPositionView | null {
  const lp = s.user?.lp[id];
  const p = s.players[id];
  if (!lp || !p?.pool || lp.shares <= 0) return null;
  const pool = p.pool;
  const valueUsd = lpValueUsd(pool, lp.shares);
  const fees = lp.feesAccrued + (pool.feeGrowthPerShare - lp.feeGrowthEntry) * lp.shares;
  return {
    playerId: id,
    ticker: profile(id).ticker,
    name: profile(id).name,
    shares: lp.shares,
    poolShare: lp.shares / pool.totalShares,
    usdc: lpUsdcFor(pool, lp.shares),
    tokens: lpTokensFor(pool, lp.shares),
    valueUsd,
    depositedUsd: lp.depositedUsd,
    feesEarnedUsd: fees,
    pnl: valueUsd - lp.depositedUsd,
    impermanentLoss: impermanentLoss(spotPrice(pool) / lp.entryPrice),
    entryPrice: lp.entryPrice,
    holdAgeDays: holdAgeDays(lp.ts, holdNow(s, now)),
  };
}

export function detailOf(s: MockState, id: string, now: number): PlayerDetail {
  const p = getPlayer(s, id);
  const pr = profile(id);
  const base = summaryOf(s, id, now);
  const pool = p.pool;
  const depth = pool ? pool.usdc * 2 : 0;
  const dividendHistory = s.results
    .filter((r) => r.perPlayer[id] && r.perPlayer[id]!.payout > 0)
    .map((r) => {
      const x = r.perPlayer[id]!;
      return {
        round: r.round,
        label: r.windowLabel,
        playerPayout: x.payout,
        per10kTokens: x.eligibleSupply > 0 ? (x.payout / x.eligibleSupply) * 10_000 : 0,
      };
    });
  return {
    ...base,
    competitions: competitionsFor(pr),
    curve: {
      sold: p.curve.sold,
      raised: p.curve.raised,
      threshold: PROTOCOL_CONFIG.curve.bondThresholdUsdc,
      sMax: S_MAX,
      spot: p.status === "trading" ? BOND_PRICE : spot(p),
      launchPrice: LAUNCH_PRICE,
      bondPrice: BOND_PRICE,
      poolOpenPrice: POOL_OPEN_PRICE,
    },
    pool: pool
      ? {
          usdc: pool.usdc,
          tokens: pool.tokens,
          depthUsd: depth,
          totalShares: pool.totalShares,
          protocolShare: pool.protocolShares / pool.totalShares,
          lpFeeRate: PROTOCOL_CONFIG.pool.lpFeeRate,
          feeAprDemo: depth > 0 ? (base.volume24h * PROTOCOL_CONFIG.pool.lpFeeRate * 365) / depth : 0,
        }
      : null,
    supply: {
      max: PROTOCOL_CONFIG.supply.maxSupply,
      curveSold: p.curve.sold,
      poolSeed: p.status === "trading" ? PROTOCOL_CONFIG.supply.poolSeedTokens : 0,
      minted: p.minted,
      reserveLeft: p.reserveLeft,
      circulating: circulating(p),
      holderTokens: holderTokens(p),
      inPool: pool?.tokens ?? 0,
    },
    dividendsPaid: p.dividendsPaid,
    form: p.form,
    impactLadder: pool ? impactLadder(pool) : null,
    recentTrades: p.trades.slice(0, 20),
    holders: holdersOf(s, p),
    dividendHistory,
    holding: positionViewOf(s, id, now),
    lpPosition: lpViewOf(s, id, now),
  };
}

const RANGE_MS: Record<PriceRange, number> = { "24H": DAY_MS, "3D": 3 * DAY_MS, "6D": 6 * DAY_MS, ALL: Infinity };

export function priceHistoryOf(s: MockState, id: string, range: PriceRange, now: number): PricePoint[] {
  const p = getPlayer(s, id);
  const since = now - RANGE_MS[range];
  const pts = p.priceHistory.filter((x) => x.t >= since);
  const out = pts.length >= 2 ? pts : p.priceHistory.slice(-2);
  const cur = spot(p);
  if (p.status !== "scheduled" && (!out.length || out[out.length - 1]!.t < now - 1000)) out.push({ t: now, p: cur });
  // Downsample to ≤ 500 points
  if (out.length <= 500) return out;
  const step = out.length / 500;
  return Array.from({ length: 500 }, (_, i) => out[Math.floor(i * step)]!).concat(out[out.length - 1]!);
}

// ---------------------------------------------------------------- round

export function controllerNow(s: MockState): ControllerResult {
  const bonded = Object.values(s.players).filter((p) => p.status === "trading").length;
  return sizeRoundPool({ vault: s.vault, bondedPlayers: bonded, payHistory: s.payHistory, prevBps: s.prevBps });
}

/** Entries for the current round: live/provisional from the sim, or a form projection while open. */
export function currentEntries(s: MockState): { entries: RankEntry[]; projection: boolean } {
  const r = s.round;
  const w = windowForRound(r.round);
  const ucl = w.kind === "ucl";
  if (r.phase === "open" || !r.sim || !r.snapshot) {
    const entries = Object.values(s.players)
      .filter((p) => p.status === "trading")
      .filter((p) => !ucl || profile(p.id).inUcl)
      .map((p) => {
        const pr = profile(p.id);
        return { playerId: p.id, position: pr.position, league: pr.league, points: pr.avgScore, goals: 0, assists: 0, minutes: 90, ucl };
      });
    return { entries, projection: true };
  }
  const entries: RankEntry[] = [];
  for (const id of r.snapshot.bonded) {
    const stat = r.sim.stats[id];
    if (!stat) continue;
    const pr = profile(id);
    entries.push({
      playerId: id,
      position: pr.position,
      league: pr.league,
      points: scorePoints(stat, pr.position, coefficientFor(w.kind, pr.league)),
      goals: stat.goal ?? 0,
      assists: stat.assist ?? 0,
      minutes: stat.minutes,
      ucl,
    });
  }
  return { entries, projection: false };
}

export function buildBoardViews(
  alloc: RoundAllocation,
  myShare: (playerId: string) => number
): BoardView[] {
  return alloc.boards
    .filter((b) => b.entries.length > 0)
    .map((b) => {
      const toRow = (e: RankEntry, i: number) => {
        const pr = profile(e.playerId);
        const w = b.winners[i];
        return {
          playerId: e.playerId,
          ticker: pr.ticker,
          name: pr.name,
          rank: i + 1,
          points: e.points,
          display: displayScore(e.points),
          usd: w ? w.usd : 0,
          mine: myShare(e.playerId) > 0,
        };
      };
      return {
        key: b.def.key,
        kind: b.def.kind,
        label: b.def.label,
        multiplier: b.def.multiplier,
        weight: b.weight,
        poolUsd: b.poolUsd,
        rows: b.entries.slice(0, 5).map(toRow),
        others: b.entries.slice(5).map((e, i) => toRow(e, i + 5)),
      };
    });
}

function myEligible(s: MockState): Record<string, number> {
  const u = s.user;
  const out: Record<string, number> = {};
  if (!u) return out;
  if (s.round.snapshot && s.round.phase !== "open") {
    for (const id of s.round.snapshot.bonded) out[id] = eligibleTokens(s.round.snapshot.user[id]);
    return out;
  }
  for (const p of Object.values(s.players)) {
    if (p.status !== "trading") continue;
    const snap = snapshotHolder(userTokens(u, p.id), u.lp[p.id]?.shares ?? 0, p.pool);
    out[p.id] = eligibleTokens(snap);
  }
  return out;
}

function eligibleSupplyNow(s: MockState, id: string): number {
  const snap = s.round.snapshot;
  if (snap && s.round.phase !== "open" && snap.eligibleSupply[id] !== undefined) return snap.eligibleSupply[id]!;
  const p = s.players[id]!;
  return eligibleSupplyAtSnapshot(holderTokens(p), p.pool);
}

export function roundStateOf(s: MockState): RoundState {
  const r = s.round;
  const w = windowForRound(r.round);
  const ctrl = controllerNow(s);
  const { entries, projection } = currentEntries(s);
  const alloc = allocateRoundPool(buildBoards(entries, w.kind === "ucl"), ctrl.roundPool);
  const mine = myEligible(s);
  const boards = buildBoardViews(alloc, (id) => mine[id] ?? 0);

  const plan = r.plan;
  const playerIds = Object.values(s.players)
    .filter((p) => p.status !== "scheduled")
    .map((p) => p.id);
  const scores: LiveScoreView[] = playerIds
    .filter((id) => playsThisWindow(s, id))
    .map((id) => {
      const pr = profile(id);
      const stat = r.sim?.stats[id];
      const points = stat ? scorePoints(stat, pr.position, coefficientFor(w.kind, pr.league)) : 0;
      const club = plan?.clubs[pr.club];
      return {
        playerId: id,
        ticker: pr.ticker,
        name: pr.name,
        position: pr.position,
        league: pr.league,
        club: pr.club,
        bondedAtKickoff: r.snapshot ? r.snapshot.bonded.includes(id) : s.players[id]!.status === "trading",
        playing: plan ? !!plan.players[id] : true,
        slot: club?.label ?? null,
        matchMinute: plan ? matchMinute(plan, pr.club, r.liveProgress) : -1,
        minutes: stat?.minutes ?? 0,
        points,
        display: displayScore(points),
        goals: stat?.goal ?? 0,
        assists: stat?.assist ?? 0,
      };
    })
    .sort((a, b) => b.points - a.points);

  const totals = { goals: 0, assists: 0, shotsOnTarget: 0, saves: 0, cards: 0 };
  for (const st of Object.values(r.sim?.stats ?? {})) {
    totals.goals += st.goal ?? 0;
    totals.assists += st.assist ?? 0;
    totals.shotsOnTarget += st.shotOnTarget ?? 0;
    totals.saves += st.save ?? 0;
    totals.cards += (st.yellow ?? 0) + (st.red ?? 0);
  }

  const myPlayers: MyRoundView["players"] = Object.entries(mine)
    .filter(([, t]) => t > 0)
    .map(([id, tokens]) => {
      const supply = eligibleSupplyNow(s, id);
      const share = supply > 0 ? tokens / supply : 0;
      return {
        playerId: id,
        ticker: profile(id).ticker,
        name: profile(id).name,
        tokens,
        eligibleShare: share,
        playing: plan ? !!plan.players[id] : playsThisWindow(s, id),
        provisionalUsd: holderPayout(alloc.playerPayouts[id] ?? 0, tokens, supply),
      };
    })
    .sort((a, b) => b.provisionalUsd - a.provisionalUsd);

  return {
    round: r.round,
    window: w,
    phase: r.phase,
    phaseStartedAt: r.phaseStartedAt,
    phaseEndsAt: r.phaseEndsAt,
    clockMode: s.settings.clockMode,
    liveProgress: r.liveProgress,
    pool: { vault: s.vault, usd: ctrl.roundPool, bps: ctrl.bps, effectiveRate: ctrl.effectiveRate, capped: ctrl.capped },
    projection,
    scores,
    boards,
    events: r.events,
    totals,
    my: {
      signedIn: !!s.user,
      snapshotTaken: !!r.snapshot && r.phase !== "open",
      players: myPlayers,
      totalTokens: myPlayers.reduce((a, x) => a + x.tokens, 0),
      provisionalUsd: myPlayers.reduce((a, x) => a + x.provisionalUsd, 0),
    },
  };
}

// ---------------------------------------------------------------- portfolio & stats

export function claimableOf(s: MockState): ClaimableView {
  const u = s.user;
  const rows = (u?.claims ?? []).map((c) => ({ ...c, ticker: profile(c.playerId).ticker }));
  const market = (id: string) => {
    const p = s.players[id]!;
    return { price: spot(p), reserveLeft: p.reserveLeft };
  };
  return {
    totalUsd: rows.reduce((a, r) => a + r.usd, 0),
    rows,
    usdc: quoteClaim(u?.claims ?? [], "usdc", market),
    tokens: quoteClaim(u?.claims ?? [], "tokens", market),
  };
}

export function portfolioOf(s: MockState, now: number): Portfolio | null {
  const u = s.user;
  if (!u) return null;
  const positions = Object.keys(u.positions)
    .map((id) => positionViewOf(s, id, now))
    .filter((x): x is PositionView => !!x)
    .sort((a, b) => b.value - a.value);
  const lp = Object.keys(u.lp)
    .map((id) => lpViewOf(s, id, now))
    .filter((x): x is LpPositionView => !!x);
  const positionsValue = positions.reduce((a, p) => a + p.value, 0);
  const lpValue = lp.reduce((a, p) => a + p.valueUsd, 0);
  const realizedPnl = Object.values(u.positions).reduce((a, p) => a + p.realizedPnl, 0);
  const unrealized = positions.reduce((a, p) => a + p.pnl, 0) + lp.reduce((a, p) => a + p.pnl, 0);
  return {
    user: u.session,
    usdc: u.usdc,
    positionsValue,
    lpValue,
    totalValue: u.usdc + positionsValue + lpValue,
    pnl: unrealized + realizedPnl,
    realizedPnl,
    dividendsEarned: u.dividendsEarned,
    feesPaid: u.feesPaid,
    positions,
    lp,
    claimable: claimableOf(s),
    history: u.history,
    points: { ...u.points, total: totalPoints(u.points) },
  };
}

export function statsOf(s: MockState, now: number): ProtocolStats {
  const ctrl = controllerNow(s);
  const players = Object.values(s.players);
  return {
    tvl: ctrl.tvl,
    vault: s.vault,
    treasury: s.treasury,
    runwayRounds: ctrl.runwayRounds,
    vaultToTvl: ctrl.tvl > 0 ? s.vault / ctrl.tvl : 0,
    roundPool: {
      vault: s.vault,
      usd: ctrl.roundPool,
      bps: ctrl.bps,
      effectiveRate: ctrl.effectiveRate,
      capped: ctrl.capped,
      capPerRound: ctrl.capPerRound,
      matrixBps: ctrl.matrixBps,
    },
    bondedCount: players.filter((p) => p.status === "trading").length,
    launchingCount: players.filter((p) => p.status === "launching").length,
    scheduledCount: players.filter((p) => p.status === "scheduled").length,
    volume24h: players.reduce((a, p) => a + volume24h(p, now), 0),
    totalPaidOut: s.totalPaidOut,
    roundsSettled: s.results.length,
    reserveLeftTotal: players.filter((p) => p.status === "trading").reduce((a, p) => a + p.reserveLeft, 0),
    externalLpDepth: players.reduce((a, p) => a + (p.pool ? lpValueUsd(p.pool, p.pool.totalShares - p.pool.protocolShares) : 0), 0),
    poolUsdcTotal: players.reduce((a, p) => a + (p.pool?.usdc ?? 0), 0),
    curveUsdcTotal: players.filter((p) => p.status === "launching").reduce((a, p) => a + p.curve.raised, 0),
    feesCollected: s.feesCollected,
  };
}

export function configView(): ProtocolConfigView {
  const c = PROTOCOL_CONFIG;
  return {
    bondThresholdUsdc: c.curve.bondThresholdUsdc,
    curveFeeRate: c.curve.feeRate,
    capTokensPerAccount: c.curve.capTokensPerAccount,
    buyFeeRate: c.pool.buyFeeRate,
    lpFeeRate: c.pool.lpFeeRate,
    sellTaxMax: c.sellTax.max,
    sellTaxMin: c.sellTax.min,
    sellTaxDays: c.sellTax.decayDays,
    tokenBonus: c.claims.tokenBonus,
    launchPrice: LAUNCH_PRICE,
    bondPrice: BOND_PRICE,
    poolOpenPrice: POOL_OPEN_PRICE,
    restrictedCountries: RESTRICTED_COUNTRIES,
    signInCountries: SIGN_IN_COUNTRIES,
    coefficients: COEFFICIENTS,
  };
}

// ---------------------------------------------------------------- quotes

export function curveErrorMessage(code: CurveError | PoolError, ctx: { maxUsdc?: number; maxTokens?: number; ticker?: string }): QuoteError {
  const maxUsd = ctx.maxUsdc !== undefined ? fmtUsd(ctx.maxUsdc) : "";
  switch (code) {
    case "CAP_PER_PURCHASE":
      return { code, message: `Launch limit: 240,000 tokens per purchase. You can spend up to ${maxUsd} now.` };
    case "CAP_PER_ACCOUNT":
      return ctx.maxTokens && ctx.maxTokens > 1
        ? { code, message: `Launch limit: 240,000 tokens per account. You can buy ${fmtTokens(ctx.maxTokens)} more (up to ${maxUsd}).` }
        : { code, message: "You've reached the 240,000-token launch limit for this player." };
    case "ALREADY_BONDED":
      return { code, message: "This player has bonded. Trade in the pool instead." };
    case "INSUFFICIENT_TOKENS":
      return { code, message: `You don't hold enough ${ctx.ticker ?? "tokens"}.` };
    case "INSUFFICIENT_LIQUIDITY":
      return { code, message: "Not enough liquidity for that size." };
    case "INSUFFICIENT_SHARES":
      return { code, message: "Not enough liquidity shares." };
    default:
      return { code, message: "Enter an amount." };
  }
}

const EMPTY_QUOTE = {
  usdc: 0,
  tokens: 0,
  avgPrice: 0,
  spotBefore: 0,
  spotAfter: 0,
  priceImpact: 0,
  fees: [],
  totalFees: 0,
  receive: 0,
  refund: 0,
  bonds: false,
  cap: null,
  holdAgeDays: null,
  warnings: [],
};

export function buyQuoteOf(s: MockState, id: string, usdc: number): Quote {
  const p = getPlayer(s, id);
  const pr = profile(id);
  const u = s.user;
  if (p.status === "scheduled") {
    return { ...EMPTY_QUOTE, ok: false, side: "buy", venue: "curve", playerId: id, error: { code: "NOT_LAUNCHED", message: "This player hasn't launched yet." } };
  }
  const warnings: string[] = [];
  let quote: Quote;
  if (p.status === "launching") {
    const purchased = u?.positions[id]?.curvePurchased ?? 0;
    const q = quoteCurveBuy(p.curve, usdc, purchased);
    quote = {
      ok: q.ok,
      error: q.error ? curveErrorMessage(q.error, { maxUsdc: q.cap.maxUsdcNow, maxTokens: q.cap.maxTokensNow, ticker: pr.ticker }) : undefined,
      side: "buy",
      venue: "curve",
      playerId: id,
      usdc: q.usdcUsed || usdc,
      tokens: q.tokensOut,
      avgPrice: q.avgPrice,
      spotBefore: q.spotBefore,
      spotAfter: q.spotAfter,
      priceImpact: q.priceImpact,
      fees: [{ label: "Launch fee", rate: PROTOCOL_CONFIG.curve.feeRate, usd: q.fee, to: "Treasury" }],
      totalFees: q.fee,
      receive: 0,
      refund: q.refund,
      bonds: q.bonds,
      cap: q.cap,
      holdAgeDays: null,
      warnings,
    };
    if (q.bonds) warnings.push(`This buy completes the launch. ${fmtUsd(q.refund)} above the $25,000 target is refunded.`);
  } else {
    const q = quotePoolBuy(p.pool!, usdc);
    quote = {
      ok: q.ok,
      error: q.error ? curveErrorMessage(q.error, {}) : undefined,
      side: "buy",
      venue: "pool",
      playerId: id,
      usdc,
      tokens: q.tokensOut,
      avgPrice: q.avgPrice,
      spotBefore: q.spotBefore,
      spotAfter: q.spotAfter,
      priceImpact: q.priceImpact,
      fees: [
        { label: "Buy fee", rate: PROTOCOL_CONFIG.pool.buyFeeRate, usd: q.buyFee, to: "Treasury" },
        { label: "LP fee", rate: PROTOCOL_CONFIG.pool.lpFeeRate, usd: q.lpFee, to: "Liquidity providers" },
      ],
      totalFees: q.buyFee + q.lpFee,
      receive: 0,
      refund: 0,
      bonds: false,
      cap: null,
      holdAgeDays: 0,
      warnings,
    };
    if (q.ok && q.priceImpact > 0.03) warnings.push(`High price impact: ${(q.priceImpact * 100).toFixed(1)}%.`);
    if (s.round.phase !== "open") warnings.push("Kickoff has passed: tokens bought now count from the next round.");
  }
  if (quote.ok && u && quote.usdc > u.usdc + 1e-9) {
    quote = { ...quote, ok: false, error: { code: "INSUFFICIENT_USDC", message: `Not enough USDC. Balance ${fmtUsd(u.usdc)}.` } };
  }
  return quote;
}

export function sellQuoteOf(s: MockState, id: string, input: { usdc: number } | { tokens: number }, now: number): Quote {
  const p = getPlayer(s, id);
  const pr = profile(id);
  const pos = s.user?.positions[id];
  const held = pos?.tokens ?? 0;
  if (p.status === "scheduled") {
    return { ...EMPTY_QUOTE, ok: false, side: "sell", venue: "curve", playerId: id, error: { code: "NOT_LAUNCHED", message: "This player hasn't launched yet." } };
  }
  if (p.status === "launching") {
    const q = quoteCurveSell(p.curve, input, held);
    return {
      ok: q.ok,
      error: q.error ? curveErrorMessage(q.error, { ticker: pr.ticker }) : undefined,
      side: "sell",
      venue: "curve",
      playerId: id,
      usdc: q.gross,
      tokens: q.tokensIn,
      avgPrice: q.avgPrice,
      spotBefore: q.spotBefore,
      spotAfter: q.spotAfter,
      priceImpact: q.priceImpact,
      fees: [{ label: "Launch fee", rate: PROTOCOL_CONFIG.curve.feeRate, usd: q.fee, to: "90% vault · 10% treasury" }],
      totalFees: q.fee,
      receive: q.net,
      refund: 0,
      bonds: false,
      cap: null,
      holdAgeDays: pos ? holdAgeDays(pos.ts, holdNow(s, now)) : null,
      warnings: [],
    };
  }
  const age = pos ? holdAgeDays(pos.ts, holdNow(s, now)) : 0;
  const rate = sellTaxRate(age);
  const q = quotePoolSell(p.pool!, input, rate, held);
  const warnings: string[] = [];
  if (q.ok && q.priceImpact > 0.03) warnings.push(`High price impact: ${(q.priceImpact * 100).toFixed(1)}%.`);
  if (s.round.phase !== "open" && s.round.snapshot?.user[id]) warnings.push("You're already counted for this round's dividends. Selling now doesn't change that.");
  return {
    ok: q.ok,
    error: q.error ? curveErrorMessage(q.error, { ticker: pr.ticker }) : undefined,
    side: "sell",
    venue: "pool",
    playerId: id,
    usdc: q.gross,
    tokens: q.tokensIn,
    avgPrice: q.avgPrice,
    spotBefore: q.spotBefore,
    spotAfter: q.spotAfter,
    priceImpact: q.priceImpact,
    fees: [
      { label: `Sell tax (${age.toFixed(0)}-day hold)`, rate, usd: q.tax, to: "90% vault · 10% treasury" },
      { label: "LP fee", rate: PROTOCOL_CONFIG.pool.lpFeeRate, usd: q.lpFeeUsd, to: "Liquidity providers" },
    ],
    totalFees: q.tax + q.lpFeeUsd,
    receive: q.net,
    refund: 0,
    bonds: false,
    cap: null,
    holdAgeDays: age,
    warnings,
  };
}

export function liquidityQuoteOf(s: MockState, id: string, usdc: number, mode: "pair" | "zap"): LiquidityQuote {
  const p = getPlayer(s, id);
  const held = userTokens(s.user, id);
  const empty: LiquidityQuote = {
    ok: false,
    mode,
    usdc,
    tokens: 0,
    sharesMinted: 0,
    poolShareAfter: 0,
    swapFees: 0,
    leftoverUsdc: 0,
    leftoverTokens: 0,
    lpTokens: 0,
  };
  if (p.status !== "trading" || !p.pool) return { ...empty, error: { code: "NOT_TRADING", message: "Liquidity opens once the player bonds." } };
  const mine = s.user?.lp[id]?.shares ?? 0;
  if (mode === "pair") {
    const q = quoteAddLiquidity(p.pool, usdc, held);
    const res: LiquidityQuote = {
      ...empty,
      ok: q.ok,
      error: q.error
        ? q.error === "INSUFFICIENT_TOKENS"
          ? { code: q.error, message: `Pairing needs ${fmtTokens(q.tokens)} ${profile(id).ticker}. You hold ${fmtTokens(held)}. Use USDC only, or buy more.` }
          : { code: q.error, message: "Enter a USDC amount." }
        : undefined,
      tokens: q.tokens,
      sharesMinted: q.sharesMinted,
      poolShareAfter: (mine + q.sharesMinted) / q.next.totalShares,
      lpTokens: lpTokensFor(q.next, q.sharesMinted),
    };
    if (res.ok && s.user && usdc > s.user.usdc) return { ...res, ok: false, error: { code: "INSUFFICIENT_USDC", message: "Not enough USDC." } };
    return res;
  }
  const z = quoteZap(p.pool, usdc);
  const res: LiquidityQuote = {
    ...empty,
    ok: z.ok,
    error: z.ok ? undefined : { code: z.error ?? "INVALID_AMOUNT", message: "Enter a USDC amount." },
    tokens: z.depositTokens,
    sharesMinted: z.sharesMinted,
    poolShareAfter: (mine + z.sharesMinted) / z.next.totalShares,
    swapFees: z.swap.buyFee + z.swap.lpFee,
    leftoverUsdc: z.leftoverUsdc,
    leftoverTokens: z.leftoverTokens,
    lpTokens: lpTokensFor(z.next, z.sharesMinted),
  };
  if (res.ok && s.user && usdc > s.user.usdc) return { ...res, ok: false, error: { code: "INSUFFICIENT_USDC", message: "Not enough USDC." } };
  return res;
}
