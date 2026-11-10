import { DEMO_DEFAULTS, RESTRICTED_COUNTRIES } from "@score/core";
import { DemoClock, type ClockPhase } from "../demo-clock";
import { ProtocolError } from "../errors";
import { STORAGE_KEY, loadJson, removeKey, saveJson } from "../storage";
import type {
  ValuePoint,
  ValueRange,
  AuthClient,
  ClaimMode,
  DemoControls,
  DemoSettings,
  LiquidityQuote,
  PlayerDetail,
  PlayerFilter,
  PlayerId,
  PlayerSummary,
  Portfolio,
  PricePoint,
  PriceRange,
  ProtocolClient,
  ProtocolConfigView,
  ProtocolEvent,
  ProtocolStats,
  Quote,
  RoundResult,
  RoundState,
  TradeRecord,
  TxResult,
  SignInInput,
  Unsubscribe,
  UserSession,
} from "../types";
import {
  ambientTick,
  kickoff,
  launchDue,
  launchNextScheduled,
  liveTick,
  settle,
  simulateLaunchDemand,
  startRound,
  userAddLiquidity,
  userBuy,
  placeLimitOrder,
  cancelLimitOrder,
  fillLimitOrders,
  userClaim,
  userFaucet,
  userRemoveLiquidity,
  userSell,
  type EngineCtx,
} from "./engine";
import { DAY_MS } from "./helpers";
import { DEFAULT_SETTINGS, createInitialState, isMockState, newUser, type MockState } from "./state";
import {
  buyQuoteOf,
  configView,
  detailOf,
  listOf,
  liquidityQuoteOf,
  portfolioOf,
  priceHistoryOf,
  roundStateOf,
  sellQuoteOf,
  statsOf,
} from "./views";

const SAVE_THROTTLE_MS = 2_000;

export interface MockClientOptions {
  /** Persist to localStorage (default true in the browser). */
  persist?: boolean;
  /** Clock source (tests). */
  now?: () => number;
  /** Override the initial settings (tests). */
  settings?: Partial<DemoSettings>;
}

/**
 * In-memory protocol driven by `packages/core`, persisted to localStorage, ticked by a `DemoClock`.
 * Implements the production seam (`ProtocolClient`) plus mock sign-in and demo-only controls.
 */
const VALUE_SAMPLE_MS = 3_000;
const VALUE_LOG_MAX = 4_000;
const VALUE_SPAN: Record<ValueRange, number | null> = { "1H": 3_600_000, "24H": DAY_MS, "7D": 7 * DAY_MS, ALL: null };

export class MockProtocolClient implements ProtocolClient, AuthClient, DemoControls {
  readonly mode = "mock" as const;
  private s: MockState;
  private clock: DemoClock;
  private listeners = new Set<(e: ProtocolEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSave = 0;
  private dirty = false;
  private readonly persist: boolean;
  private readonly clockNow: () => number;

  constructor(opts: MockClientOptions = {}) {
    this.persist = opts.persist ?? typeof window !== "undefined";
    this.clockNow = opts.now ?? (() => Date.now());
    const loaded = this.persist ? loadJson(STORAGE_KEY, isMockState) : null;
    this.s = loaded ?? createInitialState(this.clockNow(), { ...DEFAULT_SETTINGS, ...opts.settings });
    this.clock = new DemoClock(this.s.settings.clockMode, this.s.settings);
    if (!loaded && this.s.settings.clockMode === "calendar") this.applyPhase(this.clock.initial(this.clockNow()), true);
  }

  // ------------------------------------------------------------ lifecycle

  /** Start the 1-second clock loop (browser only). Idempotent. */
  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.save(true);
  }

  /** One clock step: phase transitions, live sim, ambient market. Public for tests. */
  tick(now = this.clockNow()): void {
    const pin = this.s.settings.pinned ? this.s.pin : null;
    if (pin) {
      // Pinned (lab): slide the phase window along with the clock so nothing moves.
      this.s.round.phaseStartedAt = now - pin.elapsed;
      this.s.round.phaseEndsAt = now + pin.remaining;
      this.emit({ type: "clock" });
      return;
    }
    this.step(now);
  }

  private step(now: number): void {
    const ctx = this.ctx(now);
    const r = this.s.round;
    const { steps, restarted } = this.clock.catchUp(
      { round: r.round, phase: r.phase, startedAt: r.phaseStartedAt, endsAt: r.phaseEndsAt },
      now
    );
    if (restarted) this.applyPhase(restarted, true, now);
    for (const step of steps) this.applyPhase(step, false, step.startedAt);
    if (this.s.round.phase === "live") {
      const rr = this.s.round;
      const span = rr.phaseEndsAt - rr.phaseStartedAt;
      liveTick(ctx, span > 0 ? (now - rr.phaseStartedAt) / span : 1);
    }
    if (this.s.settings.clockMode === "calendar") launchDue(ctx);
    ambientTick(ctx);
    fillLimitOrders(ctx);
    this.sampleValue(now);
    this.dirty = true;
    this.save(false);
  }

  /** Move the round state into `next`, running kickoff / settlement as boundaries are crossed. */
  private applyPhase(next: ClockPhase, jump: boolean, now = this.clockNow()): void {
    const ctx = this.ctx(now);
    const r = this.s.round;
    const prevPhase = r.phase;
    const sameRound = next.round === r.round;

    if (jump) {
      // No backlog replay: keep or reset the round, then set the phase directly.
      if (!sameRound) startRound(ctx, next.round, next.phase, next.startedAt, next.endsAt);
      else Object.assign(r, { phase: next.phase, phaseStartedAt: next.startedAt, phaseEndsAt: next.endsAt });
      if (next.phase !== "open" && !this.s.round.snapshot) kickoff(ctx);
      this.emit({ type: "phase", round: next.round, phase: next.phase });
      return;
    }

    if (sameRound) {
      if (prevPhase === "open" && next.phase !== "open") kickoff(ctx);
      if (next.phase === "ended" && this.s.round.plan) liveTick(ctx, 1);
      Object.assign(this.s.round, { phase: next.phase, phaseStartedAt: next.startedAt, phaseEndsAt: next.endsAt });
    } else {
      // Freeze passed: settle the finished round, then open the next one.
      if (prevPhase !== "open") settle(ctx);
      startRound(ctx, next.round, next.phase, next.startedAt, next.endsAt);
      if (this.s.settings.clockMode === "demo") launchNextScheduled(ctx, 2);
      if (next.phase !== "open") kickoff(ctx);
    }
    this.emit({ type: "phase", round: next.round, phase: next.phase });
  }

  /** Every few seconds, note what the signed-in account is worth, for the portfolio chart. */
  private sampleValue(now: number, force = false): void {
    const u = this.s.user;
    if (!u) return;
    const log = (u.valueLog ??= []);
    const last = log[log.length - 1];
    if (!force && last && now - last.t < VALUE_SAMPLE_MS) return;
    const pf = portfolioOf(this.s, now);
    if (!pf) return;
    log.push({ t: now, value: pf.totalValue, pnl: pf.pnl });
    // Keep the log bounded: thin the older half to every other point.
    if (log.length > VALUE_LOG_MAX) {
      const half = Math.floor(log.length / 2);
      u.valueLog = log.slice(0, half).filter((_, i) => i % 2 === 0).concat(log.slice(half));
    }
  }

  private ctx(now: number): EngineCtx {
    return { s: this.s, now, emit: (e) => this.emit(e) };
  }

  private emit(e: ProtocolEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // a listener error must never break the engine
      }
    }
  }

  private save(force: boolean): void {
    if (!this.persist || !this.dirty) return;
    const now = this.clockNow();
    if (!force && now - this.lastSave < SAVE_THROTTLE_MS) return;
    saveJson(STORAGE_KEY, this.s);
    this.lastSave = now;
    this.dirty = false;
  }

  private async read<T>(fn: () => T): Promise<T> {
    const { latencyMs, failureRate } = this.s.settings;
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    if (failureRate > 0 && Math.random() < failureRate) {
      throw new ProtocolError("NETWORK", "Couldn't reach the network (simulated). Try again.");
    }
    return fn();
  }

  private async act<T>(fn: (ctx: EngineCtx) => T): Promise<T> {
    const { latencyMs, failureRate } = this.s.settings;
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, Math.max(250, latencyMs * 2)));
    if (failureRate > 0 && Math.random() < failureRate) {
      throw new ProtocolError("NETWORK", "Transaction failed to send (simulated). Nothing was charged.");
    }
    const out = fn(this.ctx(this.clockNow()));
    this.sampleValue(this.clockNow(), true);
    this.dirty = true;
    this.save(true);
    return out;
  }

  // ------------------------------------------------------------ reads

  getConfig(): Promise<ProtocolConfigView> {
    return this.read(() => configView());
  }

  listPlayers(filter?: PlayerFilter): Promise<PlayerSummary[]> {
    return this.read(() => listOf(this.s, filter, this.clockNow()));
  }

  getPlayer(id: PlayerId): Promise<PlayerDetail> {
    return this.read(() => detailOf(this.s, id, this.clockNow()));
  }

  getPriceHistory(id: PlayerId, range: PriceRange): Promise<PricePoint[]> {
    return this.read(() => priceHistoryOf(this.s, id, range, this.clockNow()));
  }

  getRound(): Promise<RoundState> {
    return this.read(() => roundStateOf(this.s));
  }

  getRoundHistory(limit: number): Promise<RoundResult[]> {
    // Strip internal per-player data from stored results.
    return this.read(() => this.s.results.slice(0, limit).map(publicResult));
  }

  getPortfolio(): Promise<Portfolio | null> {
    return this.read(() => portfolioOf(this.s, this.clockNow()));
  }

  getValueHistory(range: ValueRange): Promise<ValuePoint[]> {
    return this.read(() => {
      const now = this.clockNow();
      const pf = portfolioOf(this.s, now);
      if (!pf) return [];
      const span = VALUE_SPAN[range];
      const from = span ? now - span : -Infinity;
      const pts = (this.s.user?.valueLog ?? []).filter((p) => p.t >= from && p.t < now);
      // The line always ends on the value the page shows right now.
      return [...pts, { t: now, value: pf.totalValue, pnl: pf.pnl }];
    });
  }

  getProtocolStats(): Promise<ProtocolStats> {
    return this.read(() => statsOf(this.s, this.clockNow()));
  }

  getRecentTrades(id: PlayerId | null, limit: number): Promise<TradeRecord[]> {
    return this.read(() => (id ? (this.s.players[id]?.trades ?? []) : this.s.tape).slice(0, limit));
  }

  // ------------------------------------------------------------ quotes

  quoteBuy(id: PlayerId, usdc: number): Quote {
    return buyQuoteOf(this.s, id, usdc);
  }

  quoteSell(id: PlayerId, input: { usdc: number } | { tokens: number }): Quote {
    return sellQuoteOf(this.s, id, input, this.clockNow());
  }

  quoteLiquidity(id: PlayerId, usdc: number, mode: "pair" | "zap"): LiquidityQuote {
    return liquidityQuoteOf(this.s, id, usdc, mode);
  }

  // ------------------------------------------------------------ actions

  buy(id: PlayerId, usdc: number): Promise<TxResult> {
    return this.act((ctx) => userBuy(ctx, id, usdc));
  }

  sell(id: PlayerId, input: { usdc: number } | { tokens: number }): Promise<TxResult> {
    return this.act((ctx) => userSell(ctx, id, input));
  }

  placeLimit(id: PlayerId, side: "buy" | "sell", amount: number, price: number): Promise<TxResult> {
    return this.act((ctx) => placeLimitOrder(ctx, id, side, amount, price));
  }

  cancelOrder(orderId: string): Promise<TxResult> {
    return this.act((ctx) => cancelLimitOrder(ctx, orderId));
  }

  addLiquidity(id: PlayerId, usdc: number, mode: "pair" | "zap"): Promise<TxResult> {
    return this.act((ctx) => userAddLiquidity(ctx, id, usdc, mode));
  }

  removeLiquidity(id: PlayerId, fraction = 1): Promise<TxResult> {
    return this.act((ctx) => userRemoveLiquidity(ctx, id, fraction));
  }

  claim(mode: ClaimMode): Promise<TxResult> {
    return this.act((ctx) => userClaim(ctx, mode));
  }

  faucet(amount: number = DEMO_DEFAULTS.faucetUsdc): Promise<TxResult> {
    return this.act((ctx) => userFaucet(ctx, amount));
  }

  subscribe(handler: (e: ProtocolEvent) => void): Unsubscribe {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  // ------------------------------------------------------------ auth (mock)

  async getSession(): Promise<UserSession | null> {
    return this.s.user?.session ?? null;
  }

  async signIn(input: SignInInput): Promise<UserSession> {
    if (this.s.settings.latencyMs > 0) await new Promise((r) => setTimeout(r, 400));
    const country = input.country ?? "";
    if ((RESTRICTED_COUNTRIES as readonly string[]).includes(country)) {
      throw new ProtocolError("RESTRICTED", `score isn't available to people located in ${country}.`);
    }
    if (!input.acceptedTerms) throw new ProtocolError("TERMS_NOT_ACCEPTED", "Accept the Terms to continue.");
    const id = input.identity?.id ?? `usr_${Math.random().toString(36).slice(2, 8)}`;
    // The same Privy user signing in again keeps their devnet balance and holdings.
    if (this.s.user && this.s.user.session.id === id) return this.s.user.session;
    const handle = input.identity?.handle ?? id.slice(-6);
    const label = { google: "Google", email: "Email", phantom: "Phantom", demo: "Demo" }[input.method];
    const session: UserSession = {
      id,
      method: input.method,
      label: `${label} · ${handle}`,
      address: input.identity?.address ?? mockAddress(id),
      country: input.country,
      createdAt: this.clockNow(),
    };
    this.s.user = newUser(session);
    const ctx = this.ctx(this.clockNow());
    // First sign-in gets the devnet faucet (prototype behaviour).
    userFaucet(ctx, DEMO_DEFAULTS.faucetUsdc);
    if (input.method === "demo") seedDemoHoldings(ctx);
    this.dirty = true;
    this.save(true);
    this.emit({ type: "session" });
    return session;
  }

  async signOut(): Promise<void> {
    this.s.user = null;
    this.dirty = true;
    this.save(true);
    this.emit({ type: "session" });
  }

  // ------------------------------------------------------------ demo controls

  getDemoSettings(): DemoSettings {
    return { ...this.s.settings };
  }

  updateDemoSettings(patch: Partial<Omit<DemoSettings, "timeOffsetDays" | "pinned">>): void {
    const modeChanged = patch.clockMode && patch.clockMode !== this.s.settings.clockMode;
    this.s.settings = { ...this.s.settings, ...patch };
    this.clock.mode = this.s.settings.clockMode;
    this.clock.durations = this.s.settings;
    if (modeChanged) {
      const now = this.clockNow();
      // Switching clocks abandons the current round (no settlement) and starts from the new clock.
      const start = this.clock.initial(now, this.s.round.round + 1);
      startRound(this.ctx(now), start.round, start.phase, start.startedAt, start.endsAt);
      if (start.phase !== "open") kickoff(this.ctx(now));
      this.emit({ type: "phase", round: start.round, phase: start.phase });
    }
    this.dirty = true;
    this.save(true);
    this.emit({ type: "user" });
  }

  fastForwardDays(days: number): void {
    this.s.settings.timeOffsetDays += days;
    this.dirty = true;
    this.save(true);
    this.emit({ type: "user" });
  }

  /** End the current phase now (demo clock only). */
  skipPhase(): void {
    if (this.s.settings.clockMode !== "demo") return;
    const now = this.clockNow();
    this.s.round.phaseEndsAt = now;
    this.step(now);
    // A skip while pinned holds the start of the next phase.
    if (this.s.settings.pinned) this.s.pin = { elapsed: 0, remaining: this.s.round.phaseEndsAt - now };
  }

  setPinned(pinned: boolean): void {
    const now = this.clockNow();
    const r = this.s.round;
    this.s.settings.pinned = pinned;
    this.s.pin = pinned ? { elapsed: Math.max(0, now - r.phaseStartedAt), remaining: Math.max(0, r.phaseEndsAt - now) } : null;
    this.dirty = true;
    this.save(true);
    this.emit({ type: "user" });
  }

  seekPhase(progress: number): void {
    if (this.s.settings.clockMode !== "demo") return;
    const now = this.clockNow();
    const r = this.s.round;
    const span = r.phaseEndsAt - r.phaseStartedAt;
    const k = Math.min(0.99, Math.max(0, progress));
    r.phaseStartedAt = now - k * span;
    r.phaseEndsAt = r.phaseStartedAt + span;
    this.step(now);
    if (this.s.settings.pinned) this.s.pin = { elapsed: k * span, remaining: (1 - k) * span };
    this.dirty = true;
    this.save(true);
    this.emit({ type: "user" });
  }

  simulateLaunchDemand(id: PlayerId, targetProgress = 0.96): void {
    simulateLaunchDemand(this.ctx(this.clockNow()), id, targetProgress);
    this.dirty = true;
    this.save(true);
  }

  launchNextScheduled(): void {
    launchNextScheduled(this.ctx(this.clockNow()), 2);
    this.dirty = true;
    this.save(true);
  }

  reset(): void {
    const settings = { ...this.s.settings, timeOffsetDays: 0, pinned: false };
    removeKey(STORAGE_KEY);
    this.s = createInitialState(this.clockNow(), settings);
    this.clock = new DemoClock(settings.clockMode, settings);
    if (settings.clockMode === "calendar") this.applyPhase(this.clock.initial(this.clockNow()), true);
    this.dirty = true;
    this.save(true);
    this.emit({ type: "reset" });
    this.emit({ type: "session" });
  }

  /** Days the hold-age clock is fast-forwarded (demo). */
  get timeOffsetMs(): number {
    return this.s.settings.timeOffsetDays * DAY_MS;
  }

  /** Test helper: direct state access. */
  get state(): MockState {
    return this.s;
  }
}

function publicResult(r: MockState["results"][number]): RoundResult {
  const { perPlayer, ...rest } = r;
  void perPlayer;
  return rest;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/**
 * The demo account: a spread of bonded players bought from the faucet balance, plus one launch on its curve,
 * so the portfolio, claims and terminal all have something to show. Picks by status at the time, so it
 * works whatever the clock has launched or bonded.
 */
function seedDemoHoldings(ctx: EngineCtx): void {
  const bonded = Object.values(ctx.s.players).filter((p) => p.status === "trading");
  const launching = Object.values(ctx.s.players).filter((p) => p.status === "launching");
  const buys: [string, number][] = [
    ...bonded.slice(0, 4).map((p, i): [string, number] => [p.id, [180, 120, 90, 60][i]!]),
    ...launching.slice(0, 1).map((p): [string, number] => [p.id, 40]),
  ];
  for (const [id, usdc] of buys) {
    try {
      userBuy(ctx, id, usdc);
    } catch {
      // A cap or a closed curve skips that player; the rest still seed.
    }
  }
}

function mockAddress(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let out = "";
  for (let i = 0; i < 44; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    out += B58[h % B58.length];
  }
  return out;
}
