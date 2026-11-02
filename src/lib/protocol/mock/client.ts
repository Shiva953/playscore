import { DEMO_DEFAULTS, RESTRICTED_COUNTRIES } from "@score/core";
import { DemoClock, type ClockPhase } from "../demo-clock";
import { ProtocolError } from "../errors";
import { STORAGE_KEY, loadJson, removeKey, saveJson } from "../storage";
import type {
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
  SignInMethod,
  TradeRecord,
  TxResult,
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
export class MockProtocolClient implements ProtocolClient, AuthClient, DemoControls {
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
    return this.read(() => roundStateOf(this.s, this.clockNow()));
  }

  getRoundHistory(limit: number): Promise<RoundResult[]> {
    // Strip internal per-player data from stored results.
    return this.read(() => this.s.results.slice(0, limit).map(({ perPlayer: _perPlayer, ...r }) => r));
  }

  getPortfolio(): Promise<Portfolio | null> {
    return this.read(() => portfolioOf(this.s, this.clockNow()));
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

  async signIn(input: { method: SignInMethod; country: string; acceptedTerms: boolean }): Promise<UserSession> {
    if (this.s.settings.latencyMs > 0) await new Promise((r) => setTimeout(r, 400));
    if ((RESTRICTED_COUNTRIES as readonly string[]).includes(input.country)) {
      throw new ProtocolError("RESTRICTED", `score isn't available to people located in ${input.country}.`);
    }
    if (!input.acceptedTerms) throw new ProtocolError("TERMS_NOT_ACCEPTED", "Accept the Terms to continue.");
    const handle = Math.random().toString(36).slice(2, 8);
    const label = { google: "Google", email: "Email", phantom: "Phantom" }[input.method];
    const session: UserSession = {
      id: `usr_${handle}`,
      method: input.method,
      label: `${label} · ${handle}`,
      address: mockAddress(handle),
      country: input.country,
      createdAt: this.clockNow(),
    };
    this.s.user = newUser(session);
    // First sign-in gets the devnet faucet (prototype behaviour).
    userFaucet(this.ctx(this.clockNow()), DEMO_DEFAULTS.faucetUsdc);
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

  updateDemoSettings(patch: Partial<Omit<DemoSettings, "timeOffsetDays">>): void {
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
    this.tick(now);
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
    const settings = { ...this.s.settings, timeOffsetDays: 0 };
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

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
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
