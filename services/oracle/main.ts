/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from score-node / the oracle, shaped at the point of use */
// score oracle (devnet): lists the client's players on a schedule, runs matchday rounds against the
// engine (calendar → kickoff snapshot → live match data → freeze → RoundResult), and serves the
// matchday read model and the devnet faucet to the app.
//
// Match data: simulated for now (packages/core/sim/match.ts) on a compressed clock. A real stats
// feed replaces `advanceLive` (see README "Oracle"); the engine side stays the same.
//
//   bun services/oracle/main.ts        (needs score-node running; see `bun run stack`)
import { readFileSync } from "node:fs";
import {
  COEFFICIENTS,
  PLAYERS,
  PLAYERS_BY_ID,
  advanceRound,
  allocateRoundPool,
  buildBoards,
  buildSeed,
  dayLabel,
  displayScore,
  eventValue,
  hashString,
  initialSimState,
  launchSlots,
  matchMinute,
  planRound,
  pushPayHistory,
  scorePoints,
  sizeRoundPool,
  windowForRound,
  type LeagueCode,
  type MatchPlan,
  type PlayerProfile,
  type RankEntry,
  type RoundAllocation,
  type SimEvent,
  type SimPlayerInput,
  type WindowKind,
} from "@score/core";
import type { ServerWebSocket } from "bun";
import { eventLabel } from "@/lib/protocol/mock/helpers";
import type { BoardView, LiveScoreView, MatchEventView, RoundState } from "@/lib/protocol/types";
import { NodeApi } from "@/lib/score-api/node";
import { mintTo } from "./faucet";
import { privyConfigured, solanaWallets, verifyAccessToken } from "./privy";
import { Store, type OracleResult, type RoundRuntime } from "./state";

const NODE_URL = process.env.SCORE_NODE_URL || "http://127.0.0.1:8787";
const PORT = Number(process.env.ORACLE_PORT || 8788);
const OPEN_S = Number(process.env.ORACLE_OPEN_S || 480);
const LIVE_S = Number(process.env.ORACLE_LIVE_S || 300);
const FREEZE_S = Number(process.env.ORACLE_FREEZE_S || 40);
const INITIAL_LISTED = Number(process.env.ORACLE_INITIAL_LISTED || 32);
const FAUCET_USDC = 1_000;
const FAUCET_MAX_PER_DAY = Number(process.env.ORACLE_FAUCET_PER_DAY || 5);
const OPEN_FAUCET = process.env.ORACLE_OPEN_FAUCET === "1" || !privyConfigured();
const ADMIN = readFileSync(".devnet/admin-token", "utf8").trim();

const node = new NodeApi(NODE_URL);
const store = new Store(process.env.ORACLE_STATE || ".devnet/oracle/state.json");
const S = store.state;
const log = (...a: unknown[]) => console.error("oracle:", ...a);

// ------------------------------------------------------------------ engine view

interface MarketRow {
  player: number;
  state: "launching" | "bonded";
  px: number;
  raised: number;
  sold: number;
}
let markets = new Map<number, MarketRow>();
let vaultUsd = 0;
let engineRounds = { lastSnapshot: 0, lastResult: 0 };
const byEngine = new Map<number, string>();

function assignIds(): void {
  for (const p of PLAYERS) {
    if (S.ids[p.id] === undefined) S.ids[p.id] = S.nextId++;
  }
  for (const [id, n] of Object.entries(S.ids)) byEngine.set(n, id);
  store.touch();
}

async function refreshEngine(): Promise<void> {
  const [m, st] = await Promise.all([node.get<{ markets: MarketRow[] }>("/v1/view/markets"), node.get<any>("/v1/view/stats")]);
  markets = new Map(m.markets.map((x) => [x.player, x]));
  vaultUsd = st.vault / 1e6;
  engineRounds = st.rounds;
}

const listed = (id: string) => markets.has(S.ids[id]!);
const bonded = (id: string) => markets.get(S.ids[id]!)?.state === "bonded";
const listedPlayers = (): PlayerProfile[] => PLAYERS.filter((p) => listed(p.id));

// ------------------------------------------------------------------ listings

function planListings(): void {
  if (Object.keys(S.schedule).length || Object.keys(S.listedAt).length) return;
  const now = Date.now();
  const rest = PLAYERS.slice(INITIAL_LISTED);
  const slots = launchSlots(now + 60_000, rest.length);
  PLAYERS.slice(0, INITIAL_LISTED).forEach((p) => (S.schedule[p.id] = now));
  rest.forEach((p, i) => (S.schedule[p.id] = slots[i]!));
  store.touch();
  log(`launch schedule: ${INITIAL_LISTED} now, then ${rest.length} on weekday 14:00/20:00 UTC slots`);
}

async function listDue(): Promise<void> {
  const now = Date.now();
  const due = Object.entries(S.schedule)
    .filter(([, at]) => at <= now)
    .sort((a, b) => a[1] - b[1]);
  const launched: string[] = [];
  for (const [id] of due) {
    if (!listed(id)) {
      try {
        await node.admin(ADMIN, { ListPlayer: { player: S.ids[id]! } });
      } catch (e: any) {
        if (e.code !== "PlayerExists") {
          log(`list ${id}: ${e.message}`);
          continue;
        }
      }
      launched.push(id);
    }
    S.listedAt[id] = S.listedAt[id] ?? now;
    delete S.schedule[id];
    store.touch();
  }
  if (launched.length) {
    await refreshEngine();
    if (launched.length <= 6) broadcast({ type: "launched", playerIds: launched });
    log(`listed ${launched.length}: ${launched.slice(0, 8).join(", ")}${launched.length > 8 ? "…" : ""}`);
  }
}

// ------------------------------------------------------------------ rounds

function simInputs(): SimPlayerInput[] {
  return listedPlayers().map((p) => ({ id: p.id, club: p.club, position: p.position, league: p.league, avgScore: p.avgScore, inUcl: p.inUcl }));
}

const coefficientFor = (kind: WindowKind, league: LeagueCode) => (kind === "ucl" ? COEFFICIENTS.UCL : COEFFICIENTS[league]);

/** The round's fixtures. On the compressed clock, slots read as real kickoff times (UTC), not weekend days. */
function planFor(r: RoundRuntime): MatchPlan {
  const w = windowForRound(r.round);
  const plan = planRound({ round: r.round, kind: w.kind, mode: "demo", players: simInputs(), seed: r.seed });
  const liveStart = r.phase === "open" ? r.kickoffAt : r.phaseStartedAt;
  const liveMs = r.phase === "open" ? LIVE_S * 1000 : r.liveEndsAt - r.phaseStartedAt;
  for (const c of Object.values(plan.clubs)) {
    c.label = `${new Date(liveStart + c.kickoff * liveMs).toISOString().slice(11, 16)} UTC`;
  }
  return plan;
}

let openPlan: { key: string; plan: MatchPlan } | null = null;
function currentPlan(r: RoundRuntime): MatchPlan {
  if (r.plan) return r.plan;
  const key = `${r.round}:${markets.size}`;
  if (openPlan?.key !== key) openPlan = { key, plan: planFor(r) };
  return openPlan.plan;
}

function newRound(round: number, now: number): RoundRuntime {
  const kickoffAt = now + OPEN_S * 1000;
  return {
    round,
    phase: "open",
    phaseStartedAt: now,
    phaseEndsAt: kickoffAt,
    kickoffAt,
    liveEndsAt: kickoffAt + LIVE_S * 1000,
    settleAt: kickoffAt + (LIVE_S + FREEZE_S) * 1000,
    seed: hashString(`score-devnet:${round}`),
    published: false,
    bondedAtKickoff: null,
    plan: null,
    sim: null,
    liveProgress: 0,
    events: [],
    resultSent: false,
  };
}

/** Resume or start the round the engine expects next. */
function syncRound(now: number): RoundRuntime {
  const r = S.round;
  const { lastSnapshot, lastResult } = engineRounds;
  // Normal case: our round is the next one the engine will settle.
  if (r && r.round === lastResult + 1) return r;
  // Otherwise (first start, or our result landed but we stopped before opening the next round):
  let next: RoundRuntime;
  if (lastSnapshot > lastResult) {
    // Kickoff happened without our state (fresh oracle): play the round from now.
    next = newRound(lastSnapshot, now - OPEN_S * 1000);
    next.published = true;
  } else {
    next = newRound(lastResult + 1, now);
  }
  S.round = next;
  store.touch();
  log(`round ${next.round}: ${next.phase} until ${new Date(next.phaseEndsAt).toISOString()}`);
  broadcast({ type: "phase", round: next.round, phase: next.phase });
  return next;
}

function eventPoints(e: SimEvent, kind: WindowKind, r: RoundRuntime): number {
  if (!e.playerId || e.code === "kickoff" || e.code === "fulltime") return 0;
  const pr = PLAYERS_BY_ID[e.playerId]!;
  const minutes = r.sim?.stats[e.playerId]?.minutes ?? 90;
  const factor = e.code === "cleanSheet" ? Math.min(1, minutes / 90) : 1;
  return eventValue(e.code, pr.position) * coefficientFor(kind, pr.league) * factor;
}

let evSeq = 0;
function advanceLive(r: RoundRuntime, progress: number): void {
  if (!r.plan || !r.sim) return;
  const inputs = Object.fromEntries(simInputs().map((p) => [p.id, p]));
  const res = advanceRound(r.plan, r.sim, progress, inputs);
  r.sim = res.state;
  r.liveProgress = Math.max(r.liveProgress, Math.min(1, progress));
  if (!res.events.length) return;
  const kind = windowForRound(r.round).kind;
  const views: MatchEventView[] = res.events.map((e) => {
    const pr = e.playerId ? PLAYERS_BY_ID[e.playerId] : null;
    return {
      id: `r${r.round}-${Date.now().toString(36)}-${(evSeq++).toString(36)}`,
      round: r.round,
      at: Date.now(),
      slot: e.slot,
      minute: e.minute,
      playerId: e.playerId,
      ticker: pr?.ticker ?? null,
      name: pr?.name ?? null,
      club: e.club,
      code: e.code,
      label: eventLabel(e.code),
      points: eventPoints(e, kind, r),
      ranked: !!e.playerId && !!r.bondedAtKickoff?.includes(e.playerId),
    };
  });
  r.events = [...views.reverse(), ...r.events].slice(0, 80);
  store.touch();
  broadcast({ type: "match", events: views });
}

function entriesFor(r: RoundRuntime): { entries: RankEntry[]; projection: boolean } {
  const w = windowForRound(r.round);
  const ucl = w.kind === "ucl";
  if (r.phase === "open" || !r.sim || !r.bondedAtKickoff) {
    const entries = PLAYERS.filter((p) => bonded(p.id) && (!ucl || p.inUcl)).map((p) => ({
      playerId: p.id,
      position: p.position,
      league: p.league,
      points: avgForm(p.id),
      goals: 0,
      assists: 0,
      minutes: 90,
      ucl,
    }));
    return { entries, projection: true };
  }
  const entries: RankEntry[] = [];
  for (const id of r.bondedAtKickoff) {
    const st = r.sim.stats[id];
    if (!st) continue;
    const pr = PLAYERS_BY_ID[id]!;
    entries.push({ playerId: id, position: pr.position, league: pr.league, points: scorePoints(st, pr.position, coefficientFor(w.kind, pr.league)), goals: st.goal ?? 0, assists: st.assist ?? 0, minutes: st.minutes, ucl });
  }
  return { entries, projection: false };
}

function controller() {
  const bondedCount = PLAYERS.filter((p) => bonded(p.id)).length;
  return sizeRoundPool({ vault: vaultUsd, bondedPlayers: bondedCount, payHistory: S.payHistory, prevBps: S.prevBps });
}

function boardViews(alloc: RoundAllocation): BoardView[] {
  return alloc.boards
    .filter((b) => b.entries.length > 0)
    .map((b) => {
      const row = (e: RankEntry, i: number) => {
        const pr = PLAYERS_BY_ID[e.playerId]!;
        const w = b.winners[i];
        return { playerId: e.playerId, ticker: pr.ticker, name: pr.name, rank: i + 1, points: e.points, display: displayScore(e.points), usd: w ? w.usd : 0, mine: false };
      };
      return {
        key: b.def.key,
        kind: b.def.kind,
        label: b.def.label,
        multiplier: b.def.multiplier,
        weight: b.weight,
        poolUsd: b.poolUsd,
        paid: b.def.shares.length,
        rows: b.entries.slice(0, b.def.shares.length).map(row),
        others: b.entries.slice(b.def.shares.length).map((e, i) => row(e, i + b.def.shares.length)),
      };
    });
}

async function settle(r: RoundRuntime): Promise<void> {
  advanceLive(r, 1);
  const w = windowForRound(r.round);
  const { entries } = entriesFor({ ...r, phase: "ended" });
  const ctrl = controller();
  const alloc = allocateRoundPool(buildBoards(entries, w.kind === "ucl"), ctrl.roundPool);
  let payouts = Object.entries(alloc.playerPayouts)
    .filter(([, usd]) => usd > 0)
    .map(([id, usd]) => [S.ids[id]!, BigInt(Math.floor(usd * 1e6))] as [number, bigint])
    .filter(([, a]) => a > 0n);
  const total = payouts.reduce((a, [, x]) => a + x, 0n);
  const vaultMicro = BigInt(Math.floor(vaultUsd * 1e6));
  if (total > vaultMicro && total > 0n) payouts = payouts.map(([p, a]) => [p, (a * vaultMicro) / total] as [number, bigint]);
  try {
    await node.admin(ADMIN, { RoundResult: { round: r.round, payouts } });
  } catch (e: any) {
    if (e.code !== "BadRound") throw e; // BadRound: already applied by an earlier attempt
  }
  r.resultSent = true;
  const bestRank: Record<string, number> = {};
  for (const b of alloc.boards) for (const x of b.winners) bestRank[x.playerId] = Math.min(bestRank[x.playerId] ?? 99, x.rank);
  const perPlayer: OracleResult["perPlayer"] = {};
  for (const e of entries) {
    if (e.minutes <= 0) continue;
    const display = displayScore(e.points);
    perPlayer[e.playerId] = { points: e.points, display, bestRank: bestRank[e.playerId] ?? null };
    const f = (S.form[e.playerId] ??= seedForm(e.playerId));
    f.push({ label: `R${r.round}`, round: r.round, score: display, rank: bestRank[e.playerId] ?? 99 });
    if (f.length > 16) f.splice(0, f.length - 16);
  }
  if (alloc.allocated > 0) {
    S.payHistory = pushPayHistory(S.payHistory, alloc.allocated);
    S.prevBps = ctrl.bps;
  }
  S.results.unshift({
    round: r.round,
    windowLabel: `Round ${r.round} · ${dayLabel(r.kickoffAt)} ${new Date(r.kickoffAt).toISOString().slice(11, 16)} UTC`,
    kind: w.kind,
    settledAt: Date.now(),
    pool: alloc.allocated,
    bps: ctrl.bps,
    effectiveRate: vaultUsd > 0 ? alloc.allocated / vaultUsd : 0,
    boards: boardViews(alloc),
    payouts: Object.fromEntries(Object.entries(alloc.playerPayouts).filter(([, v]) => v > 0)),
    perPlayer,
  });
  S.results = S.results.slice(0, 40);
  store.touch();
  log(`round ${r.round} settled: $${alloc.allocated.toFixed(2)} to ${payouts.length} players`);
  broadcast({ type: "settled", round: r.round, pool: alloc.allocated });
}

let busy = false;
let lastErr = { msg: "", at: 0 };
async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await refreshEngine();
    await listDue();
    const now = Date.now();
    const r = syncRound(now);
    if (r.phase === "open") {
      if (!r.published) {
        try {
          await node.admin(ADMIN, { PublishCalendar: { round: r.round, lockTs: BigInt(Math.floor(r.kickoffAt / 1000)) } });
        } catch (e: any) {
          if (e.code !== "Locked") throw e; // an earlier run's lock has passed: snapshot now
          r.kickoffAt = now;
        }
        r.published = true;
        store.touch();
      }
      if (now >= r.kickoffAt + 1_200) {
        try {
          await node.admin(ADMIN, { Snapshot: { round: r.round } });
        } catch (e: any) {
          if (!(e.code === "BadRound" && engineRounds.lastSnapshot >= r.round)) throw e;
        }
        const snap = await node.get<{ players: { player: number }[] } | null>(`/v1/view/rounds/${r.round}/snapshot`);
        r.bondedAtKickoff = (snap?.players ?? []).map((x) => byEngine.get(x.player)).filter((x): x is string => !!x);
        r.plan = planFor(r);
        r.sim = initialSimState(r.plan, r.seed ^ 0x5f3759df);
        r.phase = "live";
        r.phaseStartedAt = now;
        r.liveEndsAt = now + LIVE_S * 1000;
        r.phaseEndsAt = r.liveEndsAt;
        r.settleAt = r.liveEndsAt + FREEZE_S * 1000;
        store.touch();
        log(`round ${r.round}: kickoff, ${r.bondedAtKickoff.length} players bonded at the snapshot`);
        broadcast({ type: "snapshot", round: r.round });
        broadcast({ type: "phase", round: r.round, phase: "live" });
      }
    } else if (r.phase === "live") {
      if (!r.plan || !r.sim) {
        r.plan = planFor(r);
        r.sim = initialSimState(r.plan, r.seed ^ 0x5f3759df);
        r.bondedAtKickoff ??= ((await node.get<any>(`/v1/view/rounds/${r.round}/snapshot`))?.players ?? []).map((x: any) => byEngine.get(x.player)).filter(Boolean);
      }
      advanceLive(r, (now - r.phaseStartedAt) / (r.liveEndsAt - r.phaseStartedAt));
      if (now >= r.liveEndsAt) {
        advanceLive(r, 1);
        r.phase = "ended";
        r.phaseStartedAt = now;
        r.phaseEndsAt = r.settleAt;
        store.touch();
        broadcast({ type: "phase", round: r.round, phase: "ended" });
      }
    } else if (r.phase === "ended" && now >= r.settleAt && !r.resultSent) {
      await settle(r);
      await refreshEngine();
      S.round = newRound(r.round + 1, Date.now());
      store.touch();
      broadcast({ type: "phase", round: r.round + 1, phase: "open" });
    }
  } catch (e: any) {
    const msg = `tick: ${e.message ?? e}`;
    if (msg !== lastErr.msg || Date.now() - lastErr.at > 30_000) log(msg);
    lastErr = { msg, at: Date.now() };
  } finally {
    busy = false;
  }
}

// ------------------------------------------------------------------ read model

const seeded = buildSeed(Date.UTC(2026, 10, 1));
function seedForm(id: string) {
  return [...(seeded.state[id]?.form ?? [])];
}
function formOf(id: string) {
  return S.form[id] ?? seedForm(id);
}
function avgForm(id: string): number {
  const f = formOf(id).slice(-8);
  return f.length ? f.reduce((a, x) => a + x.score, 0) / f.length : PLAYERS_BY_ID[id]!.avgScore;
}

function liveScoreOf(r: RoundRuntime, id: string): number | null {
  if (r.phase === "open" || !r.sim) return null;
  const st = r.sim.stats[id];
  if (!st) return null;
  const pr = PLAYERS_BY_ID[id]!;
  return displayScore(scorePoints(st, pr.position, coefficientFor(windowForRound(r.round).kind, pr.league)));
}

function playsThisWindow(r: RoundRuntime, id: string): boolean {
  return windowForRound(r.round).kind === "league" || !!PLAYERS_BY_ID[id]?.inUcl;
}

/** The round's window on the compressed clock: its real kickoff, whistle and settle times. */
function simWindow(r: RoundRuntime): RoundState["window"] {
  const base = windowForRound(r.round);
  const day = dayLabel(r.kickoffAt);
  return { ...base, title: base.kind === "ucl" ? "Champions League round" : "League round", firstKickoff: r.kickoffAt, lastWhistle: r.liveEndsAt, freezeAt: r.settleAt, days: [day], fromLabel: day, toLabel: day };
}

type RoundView = Omit<RoundState, "my"> & { payouts: Record<string, number> };
let cachedView: { at: number; v: RoundView } | null = null;
function roundView(): RoundView {
  const now = Date.now();
  if (cachedView && now - cachedView.at < 400) return cachedView.v;
  const r = S.round ?? newRound(engineRounds.lastResult + 1, now);
  const w = simWindow(r);
  const ctrl = controller();
  const { entries, projection } = entriesFor(r);
  const alloc = allocateRoundPool(buildBoards(entries, w.kind === "ucl"), ctrl.roundPool);
  const plan = currentPlan(r);
  const fixtures = Object.values(plan.clubs)
    .map((c) => ({ club: c.club, slot: c.label, kickoff: c.kickoff, span: plan.span }))
    .sort((a, b) => a.kickoff - b.kickoff);
  const scores: LiveScoreView[] = listedPlayers()
    .filter((p) => playsThisWindow(r, p.id))
    .map((p) => {
      const st = r.sim?.stats[p.id];
      const points = st ? scorePoints(st, p.position, coefficientFor(w.kind, p.league)) : 0;
      return {
        playerId: p.id,
        ticker: p.ticker,
        name: p.name,
        position: p.position,
        league: p.league,
        club: p.club,
        bondedAtKickoff: r.bondedAtKickoff ? r.bondedAtKickoff.includes(p.id) : bonded(p.id),
        playing: !!plan.players[p.id],
        slot: plan.clubs[p.club]?.label ?? null,
        matchMinute: r.plan ? matchMinute(r.plan, p.club, r.liveProgress) : -1,
        minutes: st?.minutes ?? 0,
        points,
        display: displayScore(points),
        goals: st?.goal ?? 0,
        assists: st?.assist ?? 0,
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
  const v: RoundView = {
    round: r.round,
    window: w,
    phase: r.phase,
    phaseStartedAt: r.phaseStartedAt,
    phaseEndsAt: r.phaseEndsAt,
    clockMode: "demo",
    liveProgress: r.liveProgress,
    fixtures,
    pool: { vault: vaultUsd, usd: ctrl.roundPool, bps: ctrl.bps, effectiveRate: ctrl.effectiveRate, capped: ctrl.capped },
    projection,
    scores,
    boards: boardViews(alloc),
    events: r.events,
    totals,
    payouts: alloc.playerPayouts,
  };
  cachedView = { at: now, v };
  return v;
}

function playersView() {
  const r = S.round;
  const last = S.results[0];
  return PLAYERS.map((p) => {
    const f = formOf(p.id);
    const mine = last?.perPlayer[p.id];
    return {
      id: p.id,
      engineId: S.ids[p.id],
      listed: listed(p.id),
      launchAt: S.schedule[p.id] ?? null,
      listedAt: S.listedAt[p.id] ?? null,
      avgScore: Math.round(avgForm(p.id) * 10) / 10,
      form: f.slice(-8),
      lastScore: mine?.display ?? f[f.length - 1]?.score ?? null,
      lastBoardRank: mine?.bestRank ?? null,
      liveScore: r ? liveScoreOf(r, p.id) : null,
      playsThisWindow: r ? playsThisWindow(r, p.id) : true,
    };
  });
}

// ------------------------------------------------------------------ HTTP + live updates

const sockets = new Set<ServerWebSocket<unknown>>();
function broadcast(msg: unknown): void {
  const s = JSON.stringify(msg);
  for (const ws of sockets) ws.send(s);
}
// The clock between phase changes: lets the app's countdowns stay honest without polling.
setInterval(() => broadcast({ type: "clock" }), 15_000);

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization, x-admin-token", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-max-age": "7200" };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...CORS } });

async function faucet(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { address?: string };
  const address = String(body.address ?? "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return json({ error: "Bad wallet address." }, 400);
  let who = `addr:${address}`;
  if (!OPEN_FAUCET) {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    let user: string;
    try {
      user = await verifyAccessToken(token);
    } catch {
      return json({ error: "Sign in again to use the faucet." }, 401);
    }
    const wallets: string[] = await solanaWallets(user).catch(() => []);
    if (!wallets.includes(address)) return json({ error: "That wallet isn't linked to your account." }, 403);
    who = user;
  }
  const day = Date.now() - 86_400_000;
  const rec = (S.faucet[who] ??= { total: 0, times: [] });
  rec.times = rec.times.filter((t) => t > day);
  if (rec.times.length >= FAUCET_MAX_PER_DAY) return json({ error: `Faucet limit reached: ${FAUCET_MAX_PER_DAY} a day. Try again tomorrow.` }, 429);
  rec.times.push(Date.now());
  store.touch();
  try {
    const info = await node.info();
    const signature = await mintTo(info.usdcMint, address, BigInt(FAUCET_USDC) * 1_000_000n);
    rec.total += FAUCET_USDC;
    store.touch();
    return json({ signature, amount: FAUCET_USDC });
  } catch (e: any) {
    rec.times.pop();
    log(`faucet: ${e.message}`);
    return json({ error: "The faucet couldn't send right now. Try again in a minute." }, 502);
  }
}

async function profile(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { country?: string; acceptedTerms?: boolean; address?: string };
  let who = `addr:${body.address ?? ""}`;
  // Privy users are identified by their login; test wallets (open-faucet mode) by their address.
  if (privyConfigured() && !OPEN_FAUCET) {
    try {
      who = await verifyAccessToken(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    } catch {
      return json({ error: "Sign in again." }, 401);
    }
  }
  S.profiles[who] = { country: String(body.country ?? ""), acceptedTerms: !!body.acceptedTerms, address: String(body.address ?? ""), at: Date.now() };
  store.touch();
  return json({ ok: true });
}

Bun.serve({
  port: PORT,
  hostname: process.env.ORACLE_HOST || "127.0.0.1",
  async fetch(req, server) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/v1/stream") {
      if (server.upgrade(req)) return undefined;
      return json({ error: "expected a websocket" }, 400);
    }
    try {
      switch (url.pathname) {
        case "/v1/health":
          return json({ ok: true, round: S.round?.round ?? null, phase: S.round?.phase ?? null, listed: Object.keys(S.listedAt).length, openFaucet: OPEN_FAUCET });
        case "/v1/players":
          return json({ ids: S.ids, players: playersView() });
        case "/v1/round":
          return json({ ...roundView(), serverNow: Date.now() });
        case "/v1/rounds":
          return json(S.results.slice(0, Math.min(40, Number(url.searchParams.get("limit") ?? 10))));
        case "/v1/faucet":
          return req.method === "POST" ? faucet(req) : json({ error: "POST only" }, 405);
        case "/v1/profile":
          return req.method === "POST" ? profile(req) : json({ error: "POST only" }, 405);
        case "/v1/admin/skip": {
          // Devnet only: end the current phase now (demos and tests).
          if (req.headers.get("x-admin-token") !== ADMIN) return json({ error: "bad admin token" }, 401);
          const r = S.round;
          if (r) {
            const now = Date.now();
            if (r.phase === "open") {
              // Kickoff in 2 s: the engine's published lock moves too (it must stay in the future).
              r.kickoffAt = now + 2_000;
              r.phaseEndsAt = r.kickoffAt;
              r.published = false;
            }
            else if (r.phase === "live") r.liveEndsAt = now;
            else r.settleAt = now;
            store.touch();
            void tick();
          }
          return json({ ok: true, round: r?.round, phase: r?.phase });
        }
      }
    } catch (e: any) {
      return json({ error: e.message ?? String(e) }, 500);
    }
    return json({ error: "not found" }, 404);
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ type: "hello", round: S.round?.round ?? null, phase: S.round?.phase ?? null }));
    },
    close(ws) {
      sockets.delete(ws);
    },
    message() {},
  },
});

// ------------------------------------------------------------------ boot

assignIds();
for (;;) {
  try {
    await refreshEngine();
    break;
  } catch (e: any) {
    log(`waiting for score-node at ${NODE_URL}: ${e.message}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
for (const p of PLAYERS) if (listed(p.id)) S.listedAt[p.id] ??= Date.now();
planListings();
log(`listening on http://127.0.0.1:${PORT} · rounds: ${OPEN_S}s open, ${LIVE_S}s live, ${FREEZE_S}s freeze · faucet ${OPEN_FAUCET ? "open (no Privy check)" : "Privy-verified"}`);
await tick();
setInterval(() => void tick(), 1_000);
process.on("SIGINT", () => {
  store.flush();
  process.exit(0);
});
process.on("SIGTERM", () => {
  store.flush();
  process.exit(0);
});
