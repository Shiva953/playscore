import {
  PROTOCOL_CONFIG,
  addPoints,
  advanceRound,
  allocateRoundPool,
  bondSplit,
  buildBoards,
  costForTokens,
  createPool,
  createRng,
  decayMomentum,
  displayScore,
  eligibleSupplyAtSnapshot,
  eligibleTokens,
  eventValue,
  hashString,
  holdAgeDays,
  holderPayout,
  initialSimState,
  lpTokensFor,
  mergeAcquisition,
  momentumImpulse,
  nextAmbientIntent,
  planRound,
  poisson,
  priceAt,
  pushPayHistory,
  quoteAddLiquidity,
  quoteClaim,
  quoteCurveBuy,
  quoteCurveSell,
  quotePoolBuy,
  quotePoolSell,
  quoteRemoveLiquidity,
  quoteZap,
  reserveAfterBond,
  routeFee,
  scorePoints,
  sellTaxRate,
  snapshotHolder,
  spotPrice,
  windowForRound,
  type ClaimMode,
  type SimEvent,
} from "@score/core";
import { ProtocolError } from "../errors";
import type { ActivityItem, MatchEventView, ProtocolEvent, TradeRecord, TxResult } from "../types";
import {
  coefficientFor,
  eventLabel,
  getPlayer,
  holdNow,
  holderTokens,
  nextId,
  profile,
  simInputs,
  spot,
  userTokens,
} from "./helpers";
import type { MockState, PlayerRuntime, StoredResult, UserPosition, UserRuntime } from "./state";
import { buildBoardViews, controllerNow, curveErrorMessage } from "./views";

export interface EngineCtx {
  s: MockState;
  now: number;
  emit: (e: ProtocolEvent) => void;
}

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const fmtTok = (n: number) => Math.floor(n).toLocaleString("en-US");
const PRICE_POINT_MIN_GAP = 2_000;
const MAX_PRICE_POINTS = 1_500;

// ---------------------------------------------------------------- bookkeeping

function recordPrice(p: PlayerRuntime, t: number): void {
  const pt = { t, p: spot(p) };
  const h = p.priceHistory;
  const last = h[h.length - 1];
  if (last && t - last.t < PRICE_POINT_MIN_GAP) h[h.length - 1] = { t: last.t, p: pt.p };
  else h.push(pt);
  if (h.length > MAX_PRICE_POINTS) h.splice(0, h.length - MAX_PRICE_POINTS);
}

function recordTrade(ctx: EngineCtx, p: PlayerRuntime, t: Omit<TradeRecord, "id" | "playerId" | "ticker" | "at">): TradeRecord {
  const trade: TradeRecord = { id: nextId(ctx.s, "tx"), playerId: p.id, ticker: profile(p.id).ticker, at: ctx.now, ...t };
  p.trades.unshift(trade);
  if (p.trades.length > 40) p.trades.length = 40;
  p.volumeLog.push({ t: ctx.now, usd: t.usdc });
  const cutoff = ctx.now - 86_400_000;
  while (p.volumeLog.length && p.volumeLog[0]!.t < cutoff) p.volumeLog.shift();
  ctx.s.tape.unshift(trade);
  if (ctx.s.tape.length > 200) ctx.s.tape.length = 200;
  recordPrice(p, ctx.now);
  ctx.emit({ type: "trade", trade });
  return trade;
}

function takeFee(s: MockState, side: "buy" | "sell", fee: number): void {
  const split = routeFee(side, fee);
  s.vault += split.vault;
  s.treasury += split.treasury;
  s.feesCollected += fee;
}

function requireUser(s: MockState): UserRuntime {
  if (!s.user) throw new ProtocolError("NOT_SIGNED_IN", "Sign in to trade.");
  return s.user;
}

function positionOf(u: UserRuntime, id: string): UserPosition {
  return (u.positions[id] ??= { tokens: 0, ts: 0, costBasis: 0, curvePurchased: 0, realizedPnl: 0 });
}

function acquire(pos: UserPosition, qty: number, ts: number): void {
  const m = mergeAcquisition({ qty: pos.tokens, ts: pos.ts }, { qty, ts });
  pos.tokens = m.qty;
  pos.ts = m.ts;
}

/** Remove tokens; returns the cost basis that left with them. */
function release(pos: UserPosition, qty: number): number {
  const before = pos.tokens;
  const cb = before > 0 ? (pos.costBasis * Math.min(qty, before)) / before : 0;
  pos.tokens = Math.max(0, before - qty);
  if (pos.tokens < 1e-6) pos.tokens = 0;
  pos.costBasis = Math.max(0, pos.costBasis - cb);
  return cb;
}

function addHistory(ctx: EngineCtx, u: UserRuntime, item: Omit<ActivityItem, "id" | "at">): void {
  u.history.unshift({ id: nextId(ctx.s, "act"), at: ctx.now, ...item });
  if (u.history.length > 100) u.history.length = 100;
}

function checkUsdc(u: UserRuntime, usdc: number): void {
  if (!(usdc > 0) || !Number.isFinite(usdc)) throw new ProtocolError("INVALID_AMOUNT", "Enter an amount.");
  if (usdc > u.usdc + 1e-9) throw new ProtocolError("INSUFFICIENT_USDC", `Not enough USDC. Balance ${fmtUsd(u.usdc)}.`);
}

// ---------------------------------------------------------------- launches & bonding

export function bond(ctx: EngineCtx, p: PlayerRuntime): void {
  const split = bondSplit(p.curve.raised);
  p.pool = createPool(split.poolSeedUsdc, split.poolSeedTokens);
  ctx.s.vault += split.vaultUsdc;
  ctx.s.treasury += split.treasuryUsdc;
  p.status = "trading";
  p.bondedAt = ctx.now;
  p.reserveLeft = reserveAfterBond(p.curve.sold);
  recordPrice(p, ctx.now);
  ctx.emit({
    type: "bonded",
    playerId: p.id,
    mine: userTokens(ctx.s.user, p.id) > 0,
    split: { pool: split.poolSeedUsdc, vault: split.vaultUsdc, treasury: split.treasuryUsdc },
  });
}

function launch(ctx: EngineCtx, p: PlayerRuntime): void {
  p.status = "launching";
  p.launchAt = ctx.now;
  p.curve = { sold: 0, raised: 0 };
  p.priceHistory = [{ t: ctx.now, p: priceAt(0) }];
  p.baseVolume24h = 0;
}

function scheduledInOrder(s: MockState): PlayerRuntime[] {
  return Object.values(s.players)
    .filter((p) => p.status === "scheduled")
    .sort((a, b) => (a.launchAt ?? 0) - (b.launchAt ?? 0) || profile(a.id).index - profile(b.id).index);
}

/** Demo clock: the next two scheduled players go live when a round opens. */
export function launchNextScheduled(ctx: EngineCtx, count = 2): string[] {
  const next = scheduledInOrder(ctx.s).slice(0, count);
  for (const p of next) launch(ctx, p);
  if (next.length) ctx.emit({ type: "launched", playerIds: next.map((p) => p.id) });
  return next.map((p) => p.id);
}

/** Calendar mode: launch every scheduled player whose slot has passed. */
export function launchDue(ctx: EngineCtx): void {
  const due = scheduledInOrder(ctx.s).filter((p) => (p.launchAt ?? Infinity) <= ctx.now);
  for (const p of due) launch(ctx, p);
  if (due.length) ctx.emit({ type: "launched", playerIds: due.map((p) => p.id) });
}

/** Demo tool: synthetic fans buy a curve up to `target` (0..1) of the bond threshold. */
export function simulateLaunchDemand(ctx: EngineCtx, id: string, target = 0.96): void {
  const p = getPlayer(ctx.s, id);
  if (p.status !== "launching") throw new ProtocolError("NOT_LAUNCHED", "Only launching players can be boosted.");
  const goal = PROTOCOL_CONFIG.curve.bondThresholdUsdc * Math.min(0.999, target);
  let guard = 0;
  while (p.curve.raised < goal - 1 && guard++ < 200) {
    const remainingTokens = Math.min(PROTOCOL_CONFIG.curve.capTokensPerPurchase * 0.95, 1e9);
    const usdcForGoal = (goal - p.curve.raised) / (1 - PROTOCOL_CONFIG.curve.feeRate);
    const usdcForCap = costForTokens(p.curve.sold, remainingTokens) / (1 - PROTOCOL_CONFIG.curve.feeRate);
    const q = quoteCurveBuy(p.curve, Math.min(usdcForGoal, usdcForCap), 0);
    if (!q.ok) break;
    p.curve = q.next;
    takeFee(ctx.s, "buy", q.fee);
    recordTrade(ctx, p, { side: "buy", venue: "curve", usdc: q.usdcUsed, tokens: q.tokensOut, price: q.avgPrice, fee: q.fee, mine: false });
    if (q.bonds) {
      bond(ctx, p);
      break;
    }
  }
  ctx.emit({ type: "market", playerIds: [id] });
}

// ---------------------------------------------------------------- user actions

export function userBuy(ctx: EngineCtx, id: string, usdc: number): TxResult {
  const s = ctx.s;
  const u = requireUser(s);
  const p = getPlayer(s, id);
  const pr = profile(id);
  if (!(usdc > 0) || !Number.isFinite(usdc)) throw new ProtocolError("INVALID_AMOUNT", "Enter an amount.");
  if (p.status === "scheduled") throw new ProtocolError("NOT_LAUNCHED", `${pr.name} hasn't launched yet.`);
  const pos = positionOf(u, id);
  const t = holdNow(s, ctx.now);

  if (p.status === "launching") {
    const q = quoteCurveBuy(p.curve, usdc, pos.curvePurchased);
    if (!q.ok) {
      const e = curveErrorMessage(q.error!, { maxUsdc: q.cap.maxUsdcNow, maxTokens: q.cap.maxTokensNow, ticker: pr.ticker });
      throw new ProtocolError(e.code as ProtocolError["code"], e.message);
    }
    // The bonding buy only spends what reaches $25k; the rest is never taken, so check what's used.
    checkUsdc(u, q.usdcUsed);
    u.usdc -= q.usdcUsed;
    acquire(pos, q.tokensOut, t);
    pos.costBasis += q.usdcUsed;
    pos.curvePurchased += q.tokensOut;
    p.curve = q.next;
    takeFee(s, "buy", q.fee);
    u.feesPaid += q.fee;
    u.points = addPoints(u.points, { launch: q.usdcUsed, fees: q.fee, volume: q.usdcUsed });
    recordTrade(ctx, p, { side: "buy", venue: "curve", usdc: q.usdcUsed, tokens: q.tokensOut, price: q.avgPrice, fee: q.fee, mine: true });
    addHistory(ctx, u, {
      kind: "buy",
      playerId: id,
      ticker: pr.ticker,
      usdc: q.usdcUsed,
      tokens: q.tokensOut,
      detail: `Launch buy · fee ${fmtUsd(q.fee)}${q.refund > 0.005 ? ` · refunded ${fmtUsd(q.refund)}` : ""}`,
    });
    if (q.bonds) bond(ctx, p);
    ctx.emit({ type: "user" });
    return {
      ok: true,
      id: nextId(s, "tx"),
      summary: `Bought ${fmtTok(q.tokensOut)} ${pr.ticker}`,
      tokens: q.tokensOut,
      usdc: q.usdcUsed,
      refund: q.refund,
      bonded: q.bonds ? id : undefined,
    };
  }

  checkUsdc(u, usdc);
  const q = quotePoolBuy(p.pool!, usdc);
  if (!q.ok) throw new ProtocolError("INVALID_AMOUNT", "Enter an amount.");
  u.usdc -= usdc;
  acquire(pos, q.tokensOut, t);
  pos.costBasis += usdc;
  p.pool = q.next;
  takeFee(s, "buy", q.buyFee);
  u.feesPaid += q.buyFee + q.lpFee;
  u.points = addPoints(u.points, { fees: q.buyFee + q.lpFee, volume: usdc });
  recordTrade(ctx, p, { side: "buy", venue: "pool", usdc, tokens: q.tokensOut, price: q.avgPrice, fee: q.buyFee + q.lpFee, mine: true });
  addHistory(ctx, u, { kind: "buy", playerId: id, ticker: pr.ticker, usdc, tokens: q.tokensOut, detail: `Pool buy · fees ${fmtUsd(q.buyFee + q.lpFee)}` });
  ctx.emit({ type: "user" });
  return { ok: true, id: nextId(s, "tx"), summary: `Bought ${fmtTok(q.tokensOut)} ${pr.ticker}`, tokens: q.tokensOut, usdc };
}

export function userSell(ctx: EngineCtx, id: string, input: { usdc: number } | { tokens: number }): TxResult {
  const s = ctx.s;
  const u = requireUser(s);
  const p = getPlayer(s, id);
  const pr = profile(id);
  const pos = u.positions[id];
  if (!pos || pos.tokens <= 0) throw new ProtocolError("INSUFFICIENT_TOKENS", `You don't hold any ${pr.ticker}.`);
  if (p.status === "scheduled") throw new ProtocolError("NOT_LAUNCHED", `${pr.name} hasn't launched yet.`);

  if (p.status === "launching") {
    const q = quoteCurveSell(p.curve, input, pos.tokens);
    if (!q.ok) {
      const e = curveErrorMessage(q.error!, { ticker: pr.ticker });
      throw new ProtocolError(e.code as ProtocolError["code"], e.message);
    }
    const cb = release(pos, q.tokensIn);
    pos.realizedPnl += q.net - cb;
    u.usdc += q.net;
    p.curve = q.next;
    takeFee(s, "sell", q.fee);
    u.feesPaid += q.fee;
    u.points = addPoints(u.points, { fees: q.fee, volume: q.gross });
    recordTrade(ctx, p, { side: "sell", venue: "curve", usdc: q.gross, tokens: q.tokensIn, price: q.avgPrice, fee: q.fee, mine: true });
    addHistory(ctx, u, { kind: "sell", playerId: id, ticker: pr.ticker, usdc: q.net, tokens: q.tokensIn, detail: `Launch sell · fee ${fmtUsd(q.fee)}` });
    ctx.emit({ type: "user" });
    return { ok: true, id: nextId(s, "tx"), summary: `Sold ${fmtTok(q.tokensIn)} ${pr.ticker} for ${fmtUsd(q.net)}`, tokens: q.tokensIn, usdc: q.net };
  }

  const age = holdAgeDays(pos.ts, holdNow(s, ctx.now));
  const rate = sellTaxRate(age);
  const q = quotePoolSell(p.pool!, input, rate, pos.tokens);
  if (!q.ok) {
    const e = curveErrorMessage(q.error!, { ticker: pr.ticker });
    throw new ProtocolError(e.code as ProtocolError["code"], e.message);
  }
  const cb = release(pos, q.tokensIn);
  pos.realizedPnl += q.net - cb;
  u.usdc += q.net;
  p.pool = q.next;
  takeFee(s, "sell", q.tax);
  u.feesPaid += q.tax + q.lpFeeUsd;
  u.points = addPoints(u.points, { fees: q.tax + q.lpFeeUsd, volume: q.gross });
  recordTrade(ctx, p, { side: "sell", venue: "pool", usdc: q.gross, tokens: q.tokensIn, price: q.avgPrice, fee: q.tax + q.lpFeeUsd, mine: true });
  addHistory(ctx, u, {
    kind: "sell",
    playerId: id,
    ticker: pr.ticker,
    usdc: q.net,
    tokens: q.tokensIn,
    detail: `Pool sell · tax ${(rate * 100).toFixed(2)}% (${fmtUsd(q.tax)})`,
  });
  ctx.emit({ type: "user" });
  return { ok: true, id: nextId(s, "tx"), summary: `Sold ${fmtTok(q.tokensIn)} ${pr.ticker} for ${fmtUsd(q.net)}`, tokens: q.tokensIn, usdc: q.net };
}

function accrueLpFees(u: UserRuntime, id: string, feeGrowth: number): void {
  const lp = u.lp[id];
  if (!lp) return;
  lp.feesAccrued += (feeGrowth - lp.feeGrowthEntry) * lp.shares;
  lp.feeGrowthEntry = feeGrowth;
}

export function userAddLiquidity(ctx: EngineCtx, id: string, usdc: number, mode: "pair" | "zap"): TxResult {
  const s = ctx.s;
  const u = requireUser(s);
  const p = getPlayer(s, id);
  const pr = profile(id);
  checkUsdc(u, usdc);
  if (p.status !== "trading" || !p.pool) throw new ProtocolError("NOT_TRADING", "Liquidity opens once the player bonds.");
  const pos = positionOf(u, id);
  const price = spotPrice(p.pool);
  accrueLpFees(u, id, p.pool.feeGrowthPerShare);
  const lp = (u.lp[id] ??= { shares: 0, ts: 0, depositedUsd: 0, feeGrowthEntry: p.pool.feeGrowthPerShare, feesAccrued: 0, entryPrice: price });
  const lpTokensBefore = lpTokensFor(p.pool, lp.shares);
  const t = holdNow(s, ctx.now);

  if (mode === "pair") {
    const q = quoteAddLiquidity(p.pool, usdc, pos.tokens);
    if (!q.ok) {
      throw new ProtocolError(
        "INSUFFICIENT_TOKENS",
        `Pairing needs ${fmtTok(q.tokens)} ${pr.ticker}. You hold ${fmtTok(pos.tokens)}. Use USDC only, or buy more.`
      );
    }
    const posTs = pos.ts;
    const cb = release(pos, q.tokens);
    u.usdc -= usdc;
    p.pool = q.next;
    const merged = mergeAcquisition({ qty: lpTokensBefore, ts: lp.ts }, { qty: q.tokens, ts: posTs });
    lp.ts = merged.ts;
    lp.entryPrice = lp.depositedUsd > 0 ? (lp.entryPrice * lp.depositedUsd + price * 2 * usdc) / (lp.depositedUsd + 2 * usdc) : price;
    lp.depositedUsd += usdc + cb;
    lp.shares += q.sharesMinted;
    lp.feeGrowthEntry = p.pool.feeGrowthPerShare;
    u.points = addPoints(u.points, { liquidity: usdc * 2 });
    addHistory(ctx, u, { kind: "lp-add", playerId: id, ticker: pr.ticker, usdc, tokens: q.tokens, detail: `Added ${fmtUsd(usdc)} + ${fmtTok(q.tokens)} ${pr.ticker}` });
    ctx.emit({ type: "market", playerIds: [id] });
    ctx.emit({ type: "user" });
    return { ok: true, id: nextId(s, "tx"), summary: `Added liquidity to ${pr.ticker}`, usdc, tokens: q.tokens };
  }

  const z = quoteZap(p.pool, usdc);
  if (!z.ok) throw new ProtocolError("INVALID_AMOUNT", "Enter a USDC amount.");
  u.usdc -= usdc - z.leftoverUsdc;
  takeFee(s, "buy", z.swap.buyFee);
  u.feesPaid += z.swap.buyFee + z.swap.lpFee;
  if (z.leftoverTokens > 1e-9) {
    acquire(pos, z.leftoverTokens, t);
    pos.costBasis += z.leftoverTokens * spotPrice(z.next);
  }
  p.pool = z.next;
  const merged = mergeAcquisition({ qty: lpTokensBefore, ts: lp.ts }, { qty: z.depositTokens, ts: t });
  lp.ts = merged.ts;
  const deposited = usdc - z.leftoverUsdc - z.leftoverTokens * spotPrice(z.next);
  lp.entryPrice = lp.depositedUsd > 0 ? (lp.entryPrice * lp.depositedUsd + spotPrice(z.next) * deposited) / (lp.depositedUsd + deposited) : spotPrice(z.next);
  lp.depositedUsd += deposited;
  lp.shares += z.sharesMinted;
  lp.feeGrowthEntry = p.pool.feeGrowthPerShare;
  u.points = addPoints(u.points, { liquidity: usdc, fees: z.swap.buyFee + z.swap.lpFee, volume: usdc / 2 });
  recordTrade(ctx, p, { side: "buy", venue: "pool", usdc: usdc / 2, tokens: z.swap.tokensOut, price: z.swap.avgPrice, fee: z.swap.buyFee + z.swap.lpFee, mine: true });
  addHistory(ctx, u, { kind: "lp-add", playerId: id, ticker: pr.ticker, usdc, tokens: z.depositTokens, detail: `Zapped ${fmtUsd(usdc)} (half swapped)` });
  ctx.emit({ type: "user" });
  return { ok: true, id: nextId(s, "tx"), summary: `Added liquidity to ${pr.ticker}`, usdc };
}

export function userRemoveLiquidity(ctx: EngineCtx, id: string, fraction = 1): TxResult {
  const s = ctx.s;
  const u = requireUser(s);
  const p = getPlayer(s, id);
  const pr = profile(id);
  const lp = u.lp[id];
  if (!lp || lp.shares <= 0 || !p.pool) throw new ProtocolError("INSUFFICIENT_SHARES", "No liquidity to remove.");
  const f = Math.min(1, Math.max(0, fraction));
  accrueLpFees(u, id, p.pool.feeGrowthPerShare);
  const q = quoteRemoveLiquidity(p.pool, lp.shares * f, lp.shares);
  if (!q.ok) throw new ProtocolError("INSUFFICIENT_SHARES", "No liquidity to remove.");
  const price = spotPrice(p.pool);
  p.pool = q.next;
  u.usdc += q.usdcOut;
  const pos = positionOf(u, id);
  acquire(pos, q.tokensOut, lp.ts);
  pos.costBasis += q.tokensOut * price;
  const depositedOut = lp.depositedUsd * f;
  pos.realizedPnl += q.usdcOut + q.tokensOut * price - depositedOut;
  lp.shares -= q.shares;
  lp.depositedUsd -= depositedOut;
  lp.feesAccrued *= 1 - f;
  if (lp.shares <= 1e-9) delete u.lp[id];
  addHistory(ctx, u, {
    kind: "lp-remove",
    playerId: id,
    ticker: pr.ticker,
    usdc: q.usdcOut,
    tokens: q.tokensOut,
    detail: `Withdrew ${fmtUsd(q.usdcOut)} + ${fmtTok(q.tokensOut)} ${pr.ticker} (hold age kept)`,
  });
  ctx.emit({ type: "market", playerIds: [id] });
  ctx.emit({ type: "user" });
  return { ok: true, id: nextId(s, "tx"), summary: `Withdrew ${fmtUsd(q.usdcOut)} and ${fmtTok(q.tokensOut)} ${pr.ticker}`, usdc: q.usdcOut, tokens: q.tokensOut };
}

export function userClaim(ctx: EngineCtx, mode: ClaimMode): TxResult {
  const s = ctx.s;
  const u = requireUser(s);
  if (!u.claims.length) throw new ProtocolError("NOTHING_TO_CLAIM", "Nothing to claim yet.");
  const q = quoteClaim(u.claims, mode, (id) => {
    const p = s.players[id]!;
    return { price: spot(p), reserveLeft: p.reserveLeft };
  });
  const t = holdNow(s, ctx.now);
  u.usdc += q.usdcOut;
  let tokens = 0;
  for (const line of q.lines) {
    if (line.tokens <= 0) continue;
    const p = s.players[line.playerId]!;
    p.reserveLeft -= line.tokens;
    p.minted += line.tokens;
    const pos = positionOf(u, line.playerId);
    acquire(pos, line.tokens, t);
    pos.costBasis += line.usdInTokens;
    s.vault += line.usdInTokens;
    tokens += line.tokens;
  }
  u.dividendsEarned += q.totalUsd;
  u.claims = [];
  addHistory(ctx, u, {
    kind: mode === "usdc" ? "claim-usdc" : "claim-tokens",
    usdc: q.totalUsd,
    tokens: tokens || undefined,
    detail:
      mode === "usdc"
        ? `Claimed ${fmtUsd(q.totalUsd)} in USDC`
        : `Claimed ${fmtTok(tokens)} tokens (+10%)${q.usdcOut > 0.005 ? ` and ${fmtUsd(q.usdcOut)} USDC (reserve limit)` : ""}`,
  });
  ctx.emit({ type: "market", playerIds: q.lines.map((l) => l.playerId) });
  ctx.emit({ type: "user" });
  return {
    ok: true,
    id: nextId(s, "tx"),
    summary: mode === "usdc" ? `Claimed ${fmtUsd(q.totalUsd)} USDC` : `Claimed ${fmtTok(tokens)} tokens (+10% bonus)`,
    usdc: q.usdcOut,
    tokens,
  };
}

export function userFaucet(ctx: EngineCtx, amount: number): TxResult {
  const u = requireUser(ctx.s);
  if (!(amount > 0)) throw new ProtocolError("INVALID_AMOUNT", "Enter an amount.");
  u.usdc += amount;
  u.faucetTotal += amount;
  addHistory(ctx, u, { kind: "faucet", usdc: amount, detail: `Devnet faucet +${fmtUsd(amount)} test USDC` });
  ctx.emit({ type: "user" });
  return { ok: true, id: nextId(ctx.s, "tx"), summary: `+${fmtUsd(amount)} test USDC`, usdc: amount };
}

// ---------------------------------------------------------------- ambient market (demo only)

export function ambientTick(ctx: EngineCtx): void {
  const s = ctx.s;
  const rng = createRng(s.rngState);
  for (const p of Object.values(s.players)) if (p.momentum) p.momentum = decayMomentum(p.momentum);
  if (!s.settings.ambientMarket) {
    s.rngState = rng.state;
    return;
  }
  const n = poisson(rng, 0.9);
  const touched = new Set<string>();
  for (let i = 0; i < n; i++) {
    const bonded = Object.values(s.players)
      .filter((p) => p.status === "trading")
      .map((p) => ({ id: p.id, momentum: p.momentum }));
    const launching = Object.values(s.players)
      .filter((p) => p.status === "launching")
      .map((p) => ({ id: p.id }));
    const intent = nextAmbientIntent(rng, { bonded, launching });
    if (!intent) continue;
    const p = s.players[intent.playerId]!;
    const mine = userTokens(s.user, p.id);
    if (intent.kind === "pool-buy" && p.pool) {
      const q = quotePoolBuy(p.pool, intent.usdc);
      if (!q.ok) continue;
      p.pool = q.next;
      takeFee(s, "buy", q.buyFee);
      recordTrade(ctx, p, { side: "buy", venue: "pool", usdc: intent.usdc, tokens: q.tokensOut, price: q.avgPrice, fee: q.buyFee + q.lpFee, mine: false });
    } else if (intent.kind === "pool-sell" && p.pool) {
      const q = quotePoolSell(p.pool, { usdc: intent.usdc }, sellTaxRate(intent.holdAgeDays), Math.max(0, holderTokens(p) - mine) * 0.05);
      if (!q.ok) continue;
      p.pool = q.next;
      takeFee(s, "sell", q.tax);
      recordTrade(ctx, p, { side: "sell", venue: "pool", usdc: q.gross, tokens: q.tokensIn, price: q.avgPrice, fee: q.tax + q.lpFeeUsd, mine: false });
    } else if (intent.kind === "curve-buy" && p.status === "launching") {
      const q = quoteCurveBuy(p.curve, intent.usdc, 0);
      if (!q.ok) continue;
      p.curve = q.next;
      takeFee(s, "buy", q.fee);
      recordTrade(ctx, p, { side: "buy", venue: "curve", usdc: q.usdcUsed, tokens: q.tokensOut, price: q.avgPrice, fee: q.fee, mine: false });
      if (q.bonds) bond(ctx, p);
    } else if (intent.kind === "curve-sell" && p.status === "launching") {
      const q = quoteCurveSell(p.curve, { usdc: Math.min(intent.usdc, p.curve.raised * 0.02) }, Math.max(0, p.curve.sold - mine));
      if (!q.ok) continue;
      p.curve = q.next;
      takeFee(s, "sell", q.fee);
      recordTrade(ctx, p, { side: "sell", venue: "curve", usdc: q.gross, tokens: q.tokensIn, price: q.avgPrice, fee: q.fee, mine: false });
    }
    touched.add(p.id);
  }
  s.rngState = rng.state;
  if (touched.size) ctx.emit({ type: "market", playerIds: [...touched] });
}

// ---------------------------------------------------------------- round lifecycle

/** First kickoff: snapshot every holder, plan the matches. */
export function kickoff(ctx: EngineCtx): void {
  const s = ctx.s;
  const r = s.round;
  const w = windowForRound(r.round);
  const bonded = Object.values(s.players).filter((p) => p.status === "trading");
  const eligibleSupply: Record<string, number> = {};
  for (const p of bonded) eligibleSupply[p.id] = eligibleSupplyAtSnapshot(holderTokens(p), p.pool);
  const user: Record<string, ReturnType<typeof snapshotHolder>> = {};
  let myTokens = 0;
  if (s.user) {
    for (const p of bonded) {
      const snap = snapshotHolder(userTokens(s.user, p.id), s.user.lp[p.id]?.shares ?? 0, p.pool);
      if (eligibleTokens(snap) > 0) {
        user[p.id] = snap;
        myTokens += eligibleTokens(snap);
      }
    }
  }
  r.snapshot = { at: ctx.now, bonded: bonded.map((p) => p.id), eligibleSupply, user };
  const seed = hashString(`${s.createdAt}:${r.round}`);
  r.plan = planRound({ round: r.round, kind: w.kind, mode: s.settings.clockMode, players: simInputs(s), seed });
  r.sim = initialSimState(r.plan, seed ^ 0x5f3759df);
  r.liveProgress = 0;
  r.events = [];
  ctx.emit({ type: "snapshot", round: r.round, myTokens });
}

function eventPoints(s: MockState, e: SimEvent): number {
  if (!e.playerId || e.code === "kickoff" || e.code === "fulltime") return 0;
  const pr = profile(e.playerId);
  const w = windowForRound(s.round.round);
  const coef = coefficientFor(w.kind, pr.league);
  const minutes = s.round.sim?.stats[e.playerId]?.minutes ?? 90;
  const factor = e.code === "cleanSheet" ? Math.min(1, minutes / 90) : 1;
  return eventValue(e.code, pr.position) * coef * factor;
}

/** Advance the live matches to `progress` (0..1). */
export function liveTick(ctx: EngineCtx, progress: number): void {
  const s = ctx.s;
  const r = s.round;
  if (!r.plan || !r.sim) return;
  const inputs = Object.fromEntries(simInputs(s).map((p) => [p.id, p]));
  const res = advanceRound(r.plan, r.sim, progress, inputs);
  r.sim = res.state;
  r.liveProgress = Math.max(r.liveProgress, Math.min(1, progress));
  if (!res.events.length) return;
  const views: MatchEventView[] = res.events.map((e) => {
    const pr = e.playerId ? profile(e.playerId) : null;
    if (e.playerId) {
      const p = s.players[e.playerId];
      if (p) p.momentum = Math.max(-1, Math.min(1, p.momentum + momentumImpulse(e.code)));
    }
    return {
      id: nextId(s, "ev"),
      round: r.round,
      at: ctx.now,
      slot: e.slot,
      minute: e.minute,
      playerId: e.playerId,
      ticker: pr?.ticker ?? null,
      name: pr?.name ?? null,
      club: e.club,
      code: e.code,
      label: eventLabel(e.code),
      points: eventPoints(s, e),
      ranked: !!e.playerId && !!r.snapshot?.bonded.includes(e.playerId),
    };
  });
  r.events = [...views.reverse(), ...r.events].slice(0, 80);
  ctx.emit({ type: "match", events: views });
}

/** After freeze: rank boards on final data, size the pool, credit holders. */
export function settle(ctx: EngineCtx): void {
  const s = ctx.s;
  const r = s.round;
  const w = windowForRound(r.round);
  if (r.plan && r.sim) liveTick(ctx, 1);
  const snap = r.snapshot;
  const stats = r.sim?.stats ?? {};
  const entries = (snap?.bonded ?? [])
    .filter((id) => stats[id])
    .map((id) => {
      const pr = profile(id);
      const st = stats[id]!;
      return {
        playerId: id,
        position: pr.position,
        league: pr.league,
        points: scorePoints(st, pr.position, coefficientFor(w.kind, pr.league)),
        goals: st.goal ?? 0,
        assists: st.assist ?? 0,
        minutes: st.minutes,
        ucl: w.kind === "ucl",
      };
    });
  const ctrl = controllerNow(s);
  const alloc = allocateRoundPool(buildBoards(entries, w.kind === "ucl"), ctrl.roundPool);
  s.vault -= alloc.allocated;
  if (alloc.allocated > 0) {
    s.payHistory = pushPayHistory(s.payHistory, alloc.allocated);
    s.prevBps = ctrl.bps;
  }
  s.totalPaidOut += alloc.allocated;

  const bestRank: Record<string, number> = {};
  for (const b of alloc.boards) for (const wnr of b.winners) bestRank[wnr.playerId] = Math.min(bestRank[wnr.playerId] ?? 99, wnr.rank);
  const perPlayer: StoredResult["perPlayer"] = {};
  for (const e of entries) {
    if (e.minutes <= 0) continue;
    const payout = alloc.playerPayouts[e.playerId] ?? 0;
    const p = s.players[e.playerId]!;
    p.dividendsPaid += payout;
    const display = displayScore(e.points);
    p.form.push({ label: `R${r.round}`, round: r.round, score: display, rank: bestRank[e.playerId] ?? 99 });
    if (p.form.length > 16) p.form.splice(0, p.form.length - 16);
    perPlayer[e.playerId] = {
      payout,
      eligibleSupply: snap?.eligibleSupply[e.playerId] ?? 0,
      points: e.points,
      display,
      bestRank: bestRank[e.playerId] ?? null,
    };
  }

  let myTotal = 0;
  const myRows: StoredResult["myRows"] = [];
  const u = s.user;
  if (u && snap) {
    for (const id of snap.bonded) {
      const elig = eligibleTokens(snap.user[id]);
      if (elig <= 0) continue;
      u.points = addPoints(u.points, { holding: elig * spot(s.players[id]!) });
      const payout = alloc.playerPayouts[id] ?? 0;
      if (payout <= 0) continue;
      const usd = holderPayout(payout, elig, snap.eligibleSupply[id] ?? 0);
      if (usd <= 0) continue;
      u.claims.push({ roundId: r.round, playerId: id, usd });
      myRows.push({ playerId: id, ticker: profile(id).ticker, usd });
      myTotal += usd;
    }
    if (myTotal > 0) {
      u.points = addPoints(u.points, { dividends: myTotal });
      addHistory(ctx, u, { kind: "dividend", usdc: myTotal, detail: `Round ${r.round} dividends: ${fmtUsd(myTotal)} claimable` });
    }
  }

  const mineShare = (id: string) => eligibleTokens(snap?.user[id]);
  const result: StoredResult = {
    round: r.round,
    windowLabel: `${w.fromLabel} → ${w.toLabel}`,
    kind: w.kind,
    settledAt: ctx.now,
    pool: alloc.allocated,
    bps: ctrl.bps,
    effectiveRate: s.vault + alloc.allocated > 0 ? alloc.allocated / (s.vault + alloc.allocated) : 0,
    boards: buildBoardViews(alloc, mineShare),
    myDividends: myTotal,
    myRows,
    perPlayer,
  };
  s.results.unshift(result);
  if (s.results.length > 20) s.results.length = 20;
  ctx.emit({ type: "settled", round: r.round, pool: alloc.allocated, myDividends: myTotal });
}

export function startRound(ctx: EngineCtx, round: number, phase: "open" | "live" | "ended", startedAt: number, endsAt: number): void {
  const s = ctx.s;
  s.round = {
    round,
    phase,
    phaseStartedAt: startedAt,
    phaseEndsAt: endsAt,
    plan: null,
    sim: null,
    liveProgress: 0,
    events: [],
    snapshot: null,
  };
}
