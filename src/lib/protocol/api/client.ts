/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from score-node / the oracle, shaped at the point of use */
/**
 * The app on the real backend: score-node (engine, read model, relayer) + the oracle (listings,
 * rounds, faucet). Implements the same ProtocolClient as the mock, so every screen works unchanged.
 * Amounts arrive in base units (6 decimals; prices × 10⁹) and leave here as plain numbers.
 */
import {
  BOND_PRICE,
  LAUNCH_PRICE,
  LEAGUE_NAMES,
  PLAYERS,
  PLAYERS_BY_ID,
  POOL_OPEN_PRICE,
  PROTOCOL_CONFIG,
  RESTRICTED_COUNTRIES,
  S_MAX,
  ammBook,
  competitionsFor,
  emptyPoints,
  holdAgeDays,
  quoteClaim,
  quoteCurveBuy,
  sellTaxRate,
  totalPoints,
  type ClaimMode,
} from "@score/core";
import { isAddress } from "@solana/kit";
import { ApiError, NodeApi, type ScoreSigner } from "@/lib/score-api/node";
import { addressBytes } from "@/lib/score-api/node";
import { ProtocolError, type ProtocolErrorCode } from "../errors";
import { configView } from "../mock/views";
import { loadJson, removeKey, saveJson } from "../storage";
import type {
  ActivityItem,
  ActivityKind,
  BoardView,
  ClaimableView,
  FundsClient,
  FundsView,
  HolderRow,
  LimitOrder,
  LiquidityQuote,
  LpPositionView,
  MatchEventView,
  PlayerDetail,
  PlayerFilter,
  PlayerId,
  PlayerSummary,
  Portfolio,
  PositionView,
  PricePoint,
  PriceRange,
  ProtocolClient,
  ProtocolConfigView,
  ProtocolEvent,
  ProtocolStats,
  Quote,
  RoundResult,
  RoundState,
  SignInInput,
  TradeRecord,
  TxResult,
  Unsubscribe,
  UserSession,
  ValuePoint,
  ValueRange,
} from "../types";

const M = 1e6; // base units per USDC / token
const PX = 1e9; // price scale
const SLIPPAGE = 0.01;
const SESSION_KEY = "score:session:devnet:v1";
const BURNER_KEY = "score:burner:v1";

const usd = (micro: number | null | undefined) => (micro ?? 0) / M;
const tok = (base: number | null | undefined) => (base ?? 0) / M;
const px = (p: number | null | undefined) => (p ?? 0) / PX;
const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const fmtTok = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ backend shapes

interface MarketRow {
  player: number;
  state: "launching" | "bonded";
  listedTs: number | null;
  bondedTs: number | null;
  sold: number;
  raised: number;
  threshold: number;
  minted: number;
  reserveLeft: number;
  px: number;
  px24: number;
  volume24h: number;
  poolUsdc: number | null;
  poolTokens: number | null;
  protocolTokens: number;
  sparkline: number[];
}
interface MarketDetail extends MarketRow {
  bids: { px: number; usdc: number; orders: number }[];
  asks: { px: number; tokens: number; orders: number }[];
  holders: { user: string; tokens: number; lp: boolean; mine: boolean }[];
  holderCount: number;
  protocolShare: number;
  activeLiquidity: string | null;
  trades: TradeRow[];
  dividends: { round: number; payout: number; circulating: number; ts: number }[];
  dividendsPaid: number;
}
interface TradeRow {
  id: number;
  player: number;
  user: string;
  side: "buy" | "sell";
  venue: "curve" | "pool";
  usdc: number;
  tokens: number;
  fee: number;
  ts: number;
  mine: boolean;
}
interface UserView {
  seq: number;
  free: number;
  locked: number;
  inOrders: number;
  value: number;
  positionsValue: number;
  lpValue: number;
  fees: number;
  dividends: number;
  deposits: number;
  withdrawals: number;
  realized: number;
  positions: { player: number; amount: number; locked: number; entryTs: number; capBought: number; cost: number; costTokens: number; realized: number; px: number }[];
  lps: { id: number; player: number; liquidity: string; share: number; tokens: number; usdc: number; feeTokens: number; feeUsdc: number; value: number; deposited: number; entryPx: number; entryTs: number }[];
  orders: { id: number; player: number; side: "buy" | "sell"; px: number; remaining: number }[];
  claims: { round: number; player: number; amount: number; electionPx: number | null }[];
  activity: { id: string; seq: number; ts: number; kind: string; player: number | null; usdc: number; tokens: number; detail: string }[];
}
interface OraclePlayer {
  id: string;
  engineId: number;
  listed: boolean;
  launchAt: number | null;
  listedAt: number | null;
  avgScore: number;
  form: PlayerDetail["form"];
  lastScore: number | null;
  lastBoardRank: number | null;
  liveScore: number | null;
  playsThisWindow: boolean;
}
type OracleRound = Omit<RoundState, "my"> & { payouts: Record<string, number> };
interface OracleResult {
  round: number;
  windowLabel: string;
  kind: "league" | "ucl";
  settledAt: number;
  pool: number;
  bps: number;
  effectiveRate: number;
  boards: BoardView[];
  payouts: Record<string, number>;
}
interface QuoteOut {
  ok: boolean;
  error?: string;
  outcome?: any;
  pxBefore: number;
  pxAfter?: number;
  curve?: boolean;
  graduated?: boolean;
  capBought?: number;
  held?: number;
  entryTs?: number;
  tokensIn?: number;
  swap?: any;
  share?: number;
  maxTokens?: number;
  needTokens?: number;
  liquidity?: string;
}

// ------------------------------------------------------------------ errors

function engineError(code: string | null | undefined, ctx: { ticker?: string } = {}): ProtocolError {
  const t = ctx.ticker ? `$${ctx.ticker}` : "tokens";
  const map: Record<string, [ProtocolErrorCode, string]> = {
    InsufficientFunds: ["INSUFFICIENT_USDC", "Not enough USDC in your balance."],
    InsufficientTokens: ["INSUFFICIENT_TOKENS", `You don't hold enough ${t}.`],
    Slippage: ["INVALID_AMOUNT", "The price moved before your order landed. Check the new quote and try again."],
    AccountLimit: ["CAP_PER_ACCOUNT", "You've reached the 240,000-token launch limit for this player."],
    PurchaseLimit: ["CAP_PER_PURCHASE", "Launch limit: 240,000 tokens per purchase."],
    WrongState: ["ALREADY_BONDED", "This player's market just changed (it may have bonded). Try again."],
    Paused: ["NETWORK", "Trading is paused for a moment. Deposits, withdrawals and claims still work."],
    NoFill: ["INSUFFICIENT_LIQUIDITY", "Nothing fills at that size or price."],
    TooManyOrders: ["INVALID_AMOUNT", "You have the most open orders allowed. Cancel one first."],
    TooManyPositions: ["INVALID_AMOUNT", "You have the most liquidity positions allowed."],
    BadAmount: ["INVALID_AMOUNT", "That amount is too small. Orders and liquidity start at $1."],
    BadPrice: ["INVALID_AMOUNT", "That limit price isn't allowed."],
    WouldCross: ["INVALID_AMOUNT", "That price would trade right away."],
    NothingToClaim: ["NOTHING_TO_CLAIM", "Nothing left to claim."],
    ReserveLow: ["INSUFFICIENT_LIQUIDITY", "The player's token reserve is too low for a token claim. Take USDC instead."],
    UnknownPlayer: ["NOT_LAUNCHED", "This player hasn't launched yet."],
    UnknownPosition: ["INSUFFICIENT_SHARES", "That liquidity position is gone."],
    UnknownOrder: ["NOT_FOUND", "That order already filled or was cancelled."],
    NotOwner: ["NOT_FOUND", "That isn't yours."],
    BadNonce: ["NETWORK", "Another tab sent an order at the same moment. Try again."],
    BadSignature: ["NOT_SIGNED_IN", "Your wallet signature didn't check out. Sign in again."],
    NETWORK: ["NETWORK", "Can't reach the score server. Check your connection and try again."],
  };
  const hit = code ? map[code] : undefined;
  return hit ? new ProtocolError(hit[0], hit[1]) : new ProtocolError("NETWORK", "Something went wrong on the server. Try again.");
}

function rethrow(e: unknown, ctx: { ticker?: string } = {}): never {
  if (e instanceof ProtocolError) throw e;
  if (e instanceof ApiError) {
    if (e.code) throw engineError(e.code, ctx);
    if (e.status === 409) throw new ProtocolError("NETWORK", "The protocol is closed (exit mode). Withdraw on-chain from the docs page.");
    if (e.status === 503) throw new ProtocolError("NETWORK", e.message);
    throw new ProtocolError("NETWORK", e.message || "Something went wrong. Try again.");
  }
  if (e instanceof Error && /reject|denied|cancel/i.test(e.message)) throw new ProtocolError("INVALID_AMOUNT", "You cancelled the signature.");
  throw new ProtocolError("NETWORK", e instanceof Error ? e.message : "Something went wrong. Try again.");
}

// ------------------------------------------------------------------ client

export interface ApiClientOptions {
  node: string;
  oracle: string;
  /** No Privy: use a test key kept in this browser. */
  burner: boolean;
}

export class ApiProtocolClient implements ProtocolClient {
  readonly mode = "devnet" as const;
  readonly node: NodeApi;
  private oracle: string;
  private listeners = new Set<(e: ProtocolEvent) => void>();
  private signer: ScoreSigner | null = null;
  private signerWaiters: ((s: ScoreSigner) => void)[] = [];
  private session: UserSession | null = null;
  private accessToken: (() => Promise<string | null>) | null = null;
  /** Highest log sequence number our own commands reached: reads wait for the read model to catch up. */
  private seenSeq = 0;
  private ids = new Map<string, number>();
  private slugs = new Map<number, string>();
  private oraclePlayers = new Map<string, OraclePlayer>();
  private oracleAt = 0;
  private markets = new Map<number, MarketRow>();
  private lastRound: OracleRound | null = null;
  private user: UserView | null = null;
  private sockets: WebSocket[] = [];
  private running = false;
  /** Bumped on stop(): a socket from an earlier start never reconnects or reports. */
  private gen = 0;
  private stoppedOnce = false;
  private settling = new Map<number, { pool: number; timer: ReturnType<typeof setTimeout> }>();
  private funding = false;

  constructor(private opts: ApiClientOptions) {
    this.node = new NodeApi(opts.node);
    this.oracle = opts.oracle;
    this.session = loadJson<UserSession>(SESSION_KEY, (v): v is UserSession => !!v && typeof (v as UserSession).address === "string");
    if (opts.burner && this.session) void this.burnerSigner().then((s) => this.setSigner(s));
  }

  // ------------------------------------------------------------ wiring

  /** The wallet that signs for the session (Privy's, Phantom's, or the dev burner). */
  setSigner(s: ScoreSigner | null): void {
    this.signer = s;
    if (s) {
      for (const w of this.signerWaiters.splice(0)) w(s);
    }
  }
  setAccessToken(f: (() => Promise<string | null>) | null): void {
    this.accessToken = f;
  }
  private async needSigner(waitMs = 8_000): Promise<ScoreSigner> {
    if (!this.session) throw new ProtocolError("NOT_SIGNED_IN", "Sign in to trade.");
    if (this.signer && this.signer.address === this.session.address) return this.signer;
    // Privy restores its wallet a moment after load (and creates it on a first sign-in): wait for it.
    const s = await Promise.race([new Promise<ScoreSigner>((ok) => this.signerWaiters.push(ok)), sleep(waitMs).then(() => null)]);
    if (!s || s.address !== this.session.address) throw new ProtocolError("NOT_SIGNED_IN", "Your wallet isn't connected. Sign in again.");
    return s;
  }

  private async burnerSigner(): Promise<ScoreSigner> {
    const { createKeyPairSignerFromBytes, createKeyPairFromPrivateKeyBytes } = await import("@solana/kit");
    const { keypairSigner } = await import("@/lib/score-api/node");
    let bytes = loadJson<number[]>(BURNER_KEY, (v): v is number[] => Array.isArray(v) && v.length === 64);
    if (!bytes) {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      const kp = await createKeyPairFromPrivateKeyBytes(seed, true);
      const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
      bytes = [...seed, ...pub];
      saveJson(BURNER_KEY, bytes);
    }
    return keypairSigner(await createKeyPairSignerFromBytes(new Uint8Array(bytes)));
  }

  private emit(e: ProtocolEvent): void {
    for (const l of this.listeners) l(e);
  }

  subscribe(handler: (e: ProtocolEvent) => void): Unsubscribe {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const gen = this.gen;
    this.connect(`${this.opts.node.replace(/^http/, "ws")}/v1/view/stream`, (m) => this.onNodeEvent(m), gen);
    this.connect(`${this.oracle.replace(/^http/, "ws")}/v1/stream`, (m) => this.onOracleEvent(m), gen);
    // Back from a hidden tab: prices and rounds moved on while we weren't listening.
    if (this.stoppedOnce) this.emit({ type: "session" });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stoppedOnce = true;
    this.gen++;
    for (const s of this.sockets.splice(0)) s.close();
  }

  private connect(url: string, onMsg: (m: any) => void, gen: number, attempt = 0): void {
    if (!this.running || gen !== this.gen || typeof WebSocket === "undefined") return;
    const ws = new WebSocket(url);
    this.sockets.push(ws);
    let opened = false;
    ws.onopen = () => {
      if (gen !== this.gen) return ws.close();
      opened = true;
      // Back after a drop: anything may have changed while we were away.
      if (attempt > 0) {
        this.emit({ type: "connection", online: true });
        this.emit({ type: "session" });
      }
    };
    ws.onmessage = (m) => {
      if (gen !== this.gen) return;
      try {
        onMsg(JSON.parse(String(m.data)));
      } catch {
        // ignore malformed
      }
    };
    ws.onclose = () => {
      this.sockets = this.sockets.filter((s) => s !== ws);
      if (!this.running || gen !== this.gen) return;
      // Say "reconnecting" only when a stream we had actually been reading drops. A socket that
      // never opened (a slow first connect, a devnet blip) retries quietly: the app still reads
      // everything over HTTP, so a notice then is noise, not news.
      if (opened) this.emit({ type: "connection", online: false });
      setTimeout(() => this.connect(url, onMsg, gen, attempt + 1), Math.min(10_000, 500 * 2 ** Math.min(attempt, 5)));
    };
  }

  private me(): string | null {
    return this.session?.address ?? null;
  }

  private onNodeEvent(m: any): void {
    const id = typeof m.player === "number" ? this.slugs.get(m.player) : undefined;
    switch (m.type) {
      case "trade": {
        if (!id) return;
        this.emit({ type: "trade", trade: this.tradeOf({ ...m, id: m.seq, mine: m.user === this.me() }) });
        return;
      }
      case "market":
      case "listed":
        if (id) this.emit({ type: "market", playerIds: [id] });
        return;
      case "bonded":
        if (id) this.emit({ type: "bonded", playerId: id, mine: m.user === this.me(), split: { pool: usd(m.split?.pool), vault: usd(m.split?.vault), treasury: usd(m.split?.treasury) } });
        return;
      case "fill":
        if (id && m.user === this.me()) {
          const order: LimitOrder = { id: `fill-${m.seq}`, playerId: id, ticker: PLAYERS_BY_ID[id]?.ticker ?? id, side: m.side, price: m.tokens > 0 ? m.usdc / m.tokens : 0, usdc: usd(m.usdc), tokens: tok(m.tokens), createdAt: Date.now() };
          this.emit({ type: "order-filled", order, summary: `${m.side === "buy" ? "Bought" : "Sold"} ${fmtTok(tok(m.tokens))} $${order.ticker} for ${fmtUsd(usd(m.usdc))}` });
        }
        return;
      case "user":
        if (m.user === this.me()) this.emit({ type: "user" });
        return;
      case "credited": {
        const mine = Array.isArray(m.users) && m.users.includes(this.me());
        const s = this.settling.get(m.round);
        if (s) {
          clearTimeout(s.timer);
          this.settling.delete(m.round);
          void this.settledFor(m.round, s.pool, mine);
        } else if (mine) {
          this.emit({ type: "user" });
        }
        return;
      }
      case "resync":
        this.emit({ type: "session" });
        return;
    }
  }

  private async settledFor(round: number, pool: number, mine: boolean): Promise<void> {
    let myDividends = 0;
    if (mine && this.me()) {
      const res = await this.node.get<{ round: number; mine: { player: number; amount: number }[] }[]>(`/v1/view/results?limit=3&user=${this.me()}`).catch(() => []);
      myDividends = usd(res.find((r) => r.round === round)?.mine.reduce((a, x) => a + x.amount, 0) ?? 0);
    }
    this.emit({ type: "settled", round, pool, myDividends });
  }

  private onOracleEvent(m: any): void {
    switch (m.type) {
      case "phase":
        this.emit({ type: "phase", round: m.round, phase: m.phase });
        return;
      case "match":
        this.emit({ type: "match", events: m.events as MatchEventView[] });
        return;
      case "snapshot":
        void this.myKickoffTokens(m.round).then((myTokens) => this.emit({ type: "snapshot", round: m.round, myTokens }));
        return;
      case "launched":
        this.oracleAt = 0;
        this.emit({ type: "launched", playerIds: m.playerIds });
        return;
      case "settled": {
        // Dividends are credited once the batch moving them is final on Solana (~1–3 s later).
        const timer = setTimeout(() => {
          this.settling.delete(m.round);
          void this.settledFor(m.round, m.pool, false);
        }, 20_000);
        this.settling.set(m.round, { pool: m.pool, timer });
        this.oracleAt = 0;
        return;
      }
      case "clock":
        this.emit({ type: "clock" });
        return;
    }
  }

  private async myKickoffTokens(round: number): Promise<number> {
    const me = this.me();
    if (!me) return 0;
    const snap = await this.node.get<{ players: { mine: number }[] } | null>(`/v1/view/rounds/${round}/snapshot?user=${me}`).catch(() => null);
    return tok(snap?.players.reduce((a, p) => a + p.mine, 0) ?? 0);
  }

  // ------------------------------------------------------------ registry + markets

  private async loadOracle(force = false): Promise<void> {
    if (!force && this.oraclePlayers.size && Date.now() - this.oracleAt < 15_000) return;
    const r = await fetch(`${this.oracle}/v1/players`).then((x) => x.json() as Promise<{ ids: Record<string, number>; players: OraclePlayer[] }>);
    this.ids = new Map(Object.entries(r.ids));
    this.slugs = new Map(Object.entries(r.ids).map(([k, v]) => [v, k]));
    this.oraclePlayers = new Map(r.players.map((p) => [p.id, p]));
    this.oracleAt = Date.now();
  }

  private engineId(id: PlayerId): number {
    const n = this.ids.get(id);
    if (n === undefined) throw new ProtocolError("NOT_FOUND", `No player "${id}".`);
    return n;
  }

  private after(): string {
    return this.seenSeq ? `after=${this.seenSeq}` : "";
  }

  private marketsLoad: { at: number; seq: number; p: Promise<void> } | null = null;
  /** All markets. Concurrent and back-to-back reads (one per player list on screen) share one request. */
  private loadMarkets(): Promise<void> {
    const hit = this.marketsLoad;
    if (hit && hit.seq >= this.seenSeq && Date.now() - hit.at < 250) return hit.p;
    const p = this.node.get<{ markets: MarketRow[] }>(`/v1/view/markets?${this.after()}`).then((r) => {
      this.markets = new Map(r.markets.map((m) => [m.player, m]));
    });
    this.marketsLoad = { at: Date.now(), seq: this.seenSeq, p };
    p.catch(() => (this.marketsLoad = null));
    return p;
  }

  private async loadRound(): Promise<OracleRound> {
    const t0 = Date.now();
    const r = await fetch(`${this.oracle}/v1/round`).then((x) => x.json() as Promise<OracleRound & { serverNow?: number }>);
    // Countdowns run on this device's clock: shift the server's times by the difference.
    if (r.serverNow) {
      const skew = (t0 + Date.now()) / 2 - r.serverNow;
      if (Math.abs(skew) > 1_000) {
        r.phaseStartedAt += skew;
        r.phaseEndsAt += skew;
      }
    }
    this.lastRound = r;
    return r;
  }

  private async loadUser(): Promise<UserView | null> {
    const me = this.me();
    if (!me) return (this.user = null);
    this.user = await this.node.get<UserView>(`/v1/view/users/${me}?${this.after()}`);
    return this.user;
  }

  private async base(): Promise<void> {
    await Promise.all([this.loadOracle(), this.loadMarkets()]).catch(rethrow);
  }

  private statusOf(id: PlayerId): PlayerSummary["status"] {
    const m = this.markets.get(this.ids.get(id) ?? -1);
    return !m ? "scheduled" : m.state === "bonded" ? "trading" : "launching";
  }

  private summaryOf(id: PlayerId): PlayerSummary {
    const pr = PLAYERS_BY_ID[id]!;
    const o = this.oraclePlayers.get(id);
    const m = this.markets.get(this.ids.get(id) ?? -1);
    const status = this.statusOf(id);
    const price = m ? px(m.px) : LAUNCH_PRICE;
    const p24 = m ? px(m.px24) : price;
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
      avgScore: o?.avgScore ?? pr.avgScore,
      inUcl: pr.inUcl,
      status,
      launchAt: m ? (m.listedTs ?? 0) * 1000 : (o?.launchAt ?? null),
      bondedAt: m?.bondedTs ? m.bondedTs * 1000 : null,
      price,
      change24h: p24 > 0 ? price / p24 - 1 : 0,
      volume24h: usd(m?.volume24h),
      raised: m ? (m.state === "bonded" ? PROTOCOL_CONFIG.curve.bondThresholdUsdc : usd(m.raised)) : 0,
      bondProgress: !m ? 0 : m.state === "bonded" ? 1 : Math.min(1, m.raised / m.threshold),
      marketCap: price * tok(m?.minted),
      liquidityUsd: m?.poolUsdc != null ? usd(m.poolUsdc) * 2 : null,
      sparkline: (m?.sparkline ?? []).map(px),
      lastScore: o?.lastScore ?? null,
      lastBoardRank: o?.lastBoardRank != null && o.lastBoardRank <= 5 ? o.lastBoardRank : null,
      liveScore: o?.liveScore ?? null,
      playsThisWindow: o?.playsThisWindow ?? true,
    };
  }

  // ------------------------------------------------------------ reads

  async getConfig(): Promise<ProtocolConfigView> {
    return configView();
  }

  async listPlayers(filter?: PlayerFilter): Promise<PlayerSummary[]> {
    await this.base();
    const q = filter?.search?.trim().toLowerCase();
    return PLAYERS.map((p) => this.summaryOf(p.id))
      .filter((x) => !filter?.status || filter.status === "all" || x.status === filter.status)
      .filter((x) => !filter?.league || filter.league === "all" || x.league === filter.league)
      .filter((x) => !filter?.position || filter.position === "all" || x.position === filter.position)
      .filter((x) => !q || x.name.toLowerCase().includes(q) || x.ticker.toLowerCase().includes(q) || x.club.toLowerCase().includes(q));
  }

  private impactCache = new Map<string, { at: number; rows: PlayerDetail["impactLadder"] }>();
  private async impactLadder(n: number): Promise<PlayerDetail["impactLadder"]> {
    const key = String(n);
    const hit = this.impactCache.get(key);
    if (hit && Date.now() - hit.at < 8_000) return hit.rows;
    const sizes = [100, 500, 1_000, 5_000];
    const rows = await Promise.all(
      sizes.map(async (u) => {
        const [b, s] = await Promise.all([
          this.node.post<QuoteOut>("/v1/quote", { kind: "buy", player: n, usdc: u * M }),
          this.node.post<QuoteOut>("/v1/quote", { kind: "sell", player: n, usdc: u * M }),
        ]);
        const imp = (q: QuoteOut) => (q.ok && q.pxAfter && q.pxBefore ? Math.abs(q.pxAfter / q.pxBefore - 1) : NaN);
        return { usdc: u, buyImpact: imp(b), sellImpact: imp(s) };
      })
    ).catch(() => null);
    this.impactCache.set(key, { at: Date.now(), rows });
    return rows;
  }

  async getPlayer(id: PlayerId): Promise<PlayerDetail> {
    await this.base();
    const pr = PLAYERS_BY_ID[id];
    if (!pr || !this.ids.has(id)) throw new ProtocolError("NOT_FOUND", `No player "${id}".`);
    const n = this.engineId(id);
    const summary = this.summaryOf(id);
    const listed = this.markets.has(n);
    // The impact ladder only needs to know the market is bonded, which the cached market list says,
    // so it runs beside the detail read instead of after it (one round trip, not two).
    const [d, user, results, early] = await Promise.all([
      listed ? this.node.get<MarketDetail>(`/v1/view/markets/${n}?${this.after()}${this.me() ? `&user=${this.me()}` : ""}`).catch(rethrow) : Promise.resolve(null),
      this.loadUser().catch(() => null),
      this.oracleResults(),
      this.markets.get(n)?.state === "bonded" ? this.impactLadder(n) : Promise.resolve(null),
    ]);
    const o = this.oraclePlayers.get(id);
    const bondedNow = d?.state === "bonded";
    const ladder = bondedNow ? (early ?? (await this.impactLadder(n))) : null;
    const sold = tok(d?.sold);
    const emitted = d ? 2_000_000 - tok(d.reserveLeft) : 0;
    const minted = tok(d?.minted);
    const inPool = tok(d?.poolTokens);
    const holding = user ? this.positionOf(user, id, n) : null;
    const lp = user ? this.lpOf(user, id, n) : null;
    const holders: HolderRow[] = [];
    if (d) {
      for (const h of d.holders) {
        const t = tok(h.tokens);
        holders.push({ label: h.mine ? "You" : short(h.user), tokens: t, share: minted > 0 ? t / minted : 0, isYou: h.mine, kind: h.lp ? "lp" : "holder" });
      }
      const seed = tok(d.protocolTokens);
      if (seed > 0) holders.push({ label: "Pool · locked protocol seed", tokens: seed, share: minted > 0 ? seed / minted : 0, isYou: false, kind: "protocol" });
      holders.sort((a, b) => b.tokens - a.tokens);
    }
    const labels = new Map(results.map((r) => [r.round, r.windowLabel]));
    return {
      ...summary,
      competitions: competitionsFor(pr),
      curve: {
        sold: bondedNow ? S_MAX : sold,
        raised: bondedNow ? PROTOCOL_CONFIG.curve.bondThresholdUsdc : usd(d?.raised),
        threshold: PROTOCOL_CONFIG.curve.bondThresholdUsdc,
        sMax: S_MAX,
        spot: bondedNow ? BOND_PRICE : summary.price,
        launchPrice: LAUNCH_PRICE,
        bondPrice: BOND_PRICE,
        poolOpenPrice: POOL_OPEN_PRICE,
      },
      pool: bondedNow
        ? {
            usdc: usd(d!.poolUsdc),
            tokens: inPool,
            depthUsd: usd(d!.poolUsdc) * 2,
            totalShares: 1,
            protocolShare: d!.protocolShare,
            lpFeeRate: PROTOCOL_CONFIG.pool.lpFeeRate,
            feeAprDemo: d!.poolUsdc ? (summary.volume24h * PROTOCOL_CONFIG.pool.lpFeeRate * 365) / (usd(d!.poolUsdc) * 2) : 0,
          }
        : null,
      supply: {
        max: PROTOCOL_CONFIG.supply.maxSupply,
        curveSold: sold,
        poolSeed: bondedNow ? Math.max(0, minted - sold - emitted) : 0,
        minted: emitted,
        reserveLeft: d ? tok(d.reserveLeft) : PROTOCOL_CONFIG.supply.reserve,
        circulating: minted,
        holderTokens: Math.max(0, minted - inPool),
        inPool,
      },
      dividendsPaid: usd(d?.dividendsPaid),
      form: o?.form ?? [],
      impactLadder: ladder,
      book: bondedNow ? this.bookOf(d!) : null,
      recentTrades: (d?.trades ?? []).slice(0, 20).map((t) => this.tradeOf(t)),
      holders,
      dividendHistory: (d?.dividends ?? []).map((x) => ({ round: x.round, label: labels.get(x.round) ?? `Round ${x.round}`, playerPayout: usd(x.payout), per10kTokens: x.circulating > 0 ? (x.payout / x.circulating) * 10_000 : 0 })),
      holding,
      lpPosition: lp,
    };
  }

  /** The book: resting orders plus the pool's liquidity near the price (as levels). */
  private bookOf(d: MarketDetail): PlayerDetail["book"] {
    const mid = px(d.px);
    // Virtual reserves of the active range: x = L/√P, y = L·√P (Q64.64 sqrt, base units).
    const L = Number(d.activeLiquidity ?? "0");
    const sqrt = Math.sqrt(d.px / PX) * 2 ** 64; // Q64.64 √price (both assets have 6 decimals)
    const tokens = L > 0 && sqrt > 0 ? (L * 2 ** 64) / sqrt / M : tok(d.poolTokens);
    const usdcV = L > 0 && sqrt > 0 ? (L * sqrt) / 2 ** 64 / M : usd(d.poolUsdc);
    const amm = ammBook({ usdc: usdcV, tokens, totalShares: 1, protocolShares: 1, feeGrowthPerShare: 0 } as never, 10, 0.005);
    const asks = amm.asks.map((l) => ({ ...l }));
    const bids = amm.bids.map((l) => ({ ...l }));
    const place = (levels: typeof asks, price: number, t: number) => {
      const i = levels.findIndex((l) => (levels === asks ? price <= l.price : price >= l.price));
      const at = i < 0 ? levels.length - 1 : i;
      if (at >= 0) {
        levels[at]!.tokens += t;
        levels[at]!.usdc += t * levels[at]!.price;
      }
    };
    for (const a of d.asks) place(asks, px(a.px), tok(a.tokens));
    for (const b of d.bids) place(bids, px(b.px), px(b.px) > 0 ? usd(b.usdc) / px(b.px) : 0);
    return { mid, asks, bids };
  }

  private tradeOf(t: TradeRow): TradeRecord {
    const id = this.slugs.get(t.player) ?? String(t.player);
    const tokens = tok(t.tokens);
    const usdc = usd(t.usdc);
    return { id: String(t.id), playerId: id, ticker: PLAYERS_BY_ID[id]?.ticker ?? id, side: t.side, venue: t.venue, usdc, tokens, price: tokens > 0 ? usdc / tokens : 0, fee: usd(t.fee), at: t.ts * 1000, mine: t.mine };
  }

  async getPriceHistory(id: PlayerId, range: PriceRange): Promise<PricePoint[]> {
    await this.loadOracle();
    const pts = await this.node.get<[number, number, number][]>(`/v1/view/markets/${this.engineId(id)}/history?range=${range}`).catch(rethrow);
    return pts.map(([t, p, v]) => ({ t: t * 1000, p: px(p), v: usd(v) }));
  }

  private async oracleResults(limit = 20): Promise<OracleResult[]> {
    return fetch(`${this.oracle}/v1/rounds?limit=${limit}`)
      .then((x) => x.json() as Promise<OracleResult[]>)
      .catch(() => []);
  }

  async getRound(): Promise<RoundState> {
    await this.base();
    const [r, user] = await Promise.all([this.loadRound().catch(rethrow), this.loadUser().catch(() => null)]);
    const me = this.me();
    const snapshotTaken = r.phase !== "open";
    let players: RoundState["my"]["players"] = [];
    if (me && user) {
      if (snapshotTaken) {
        const snap = await this.node.get<{ players: { player: number; circulating: number; mine: number }[] } | null>(`/v1/view/rounds/${r.round}/snapshot?user=${me}`).catch(() => null);
        players = (snap?.players ?? [])
          .filter((p) => p.mine > 0 && this.slugs.has(p.player))
          .map((p) => {
            const id = this.slugs.get(p.player)!;
            const share = p.circulating > 0 ? p.mine / p.circulating : 0;
            return { playerId: id, ticker: PLAYERS_BY_ID[id]!.ticker, name: PLAYERS_BY_ID[id]!.name, tokens: tok(p.mine), eligibleShare: share, playing: r.scores.some((s) => s.playerId === id && s.playing), provisionalUsd: (r.payouts[id] ?? 0) * share };
          });
      } else {
        players = user.positions
          .filter((p) => this.markets.get(p.player)?.state === "bonded" && this.slugs.has(p.player))
          .map((p) => {
            const id = this.slugs.get(p.player)!;
            const m = this.markets.get(p.player)!;
            const lpTokens = user.lps.filter((l) => l.player === p.player).reduce((a, l) => a + l.tokens, 0);
            const mine = p.amount + p.locked + lpTokens;
            const supply = Math.max(1, m.minted - m.protocolTokens);
            const share = mine / supply;
            return { playerId: id, ticker: PLAYERS_BY_ID[id]!.ticker, name: PLAYERS_BY_ID[id]!.name, tokens: tok(mine), eligibleShare: share, playing: r.scores.some((s) => s.playerId === id && s.playing), provisionalUsd: (r.payouts[id] ?? 0) * share };
          })
          .filter((p) => p.tokens > 0);
      }
      players.sort((a, b) => b.provisionalUsd - a.provisionalUsd);
    }
    const mine = new Set(players.map((p) => p.playerId));
    const boards = r.boards.map((b) => ({ ...b, rows: b.rows.map((x) => ({ ...x, mine: mine.has(x.playerId) })), others: b.others.map((x) => ({ ...x, mine: mine.has(x.playerId) })) }));
    const { payouts: _p, ...rest } = r;
    void _p;
    return {
      ...rest,
      boards,
      my: { signedIn: !!me, snapshotTaken, players, totalTokens: players.reduce((a, x) => a + x.tokens, 0), provisionalUsd: players.reduce((a, x) => a + x.provisionalUsd, 0) },
    };
  }

  async getRoundHistory(limit: number): Promise<RoundResult[]> {
    await this.loadOracle();
    const me = this.me();
    const [res, mineRows] = await Promise.all([
      this.oracleResults(limit),
      me ? this.node.get<{ round: number; mine: { player: number; amount: number }[] }[]>(`/v1/view/results?limit=${limit}&user=${me}`).catch(() => []) : Promise.resolve([]),
    ]);
    const byRound = new Map(mineRows.map((r) => [r.round, r.mine]));
    return res.slice(0, limit).map((r) => {
      const mine = (byRound.get(r.round) ?? []).filter((x) => this.slugs.has(x.player)).map((x) => ({ playerId: this.slugs.get(x.player)!, ticker: PLAYERS_BY_ID[this.slugs.get(x.player)!]!.ticker, usd: usd(x.amount) }));
      const held = new Set(mine.map((x) => x.playerId));
      return {
        round: r.round,
        windowLabel: r.windowLabel,
        kind: r.kind,
        settledAt: r.settledAt,
        pool: r.pool,
        bps: r.bps,
        effectiveRate: r.effectiveRate,
        boards: r.boards.map((b) => ({ ...b, rows: b.rows.map((x) => ({ ...x, mine: held.has(x.playerId) })), others: b.others.map((x) => ({ ...x, mine: held.has(x.playerId) })) })),
        myDividends: mine.reduce((a, x) => a + x.usd, 0),
        myRows: mine,
      };
    });
  }

  private positionOf(u: UserView, id: PlayerId, n: number): PositionView | null {
    const p = u.positions.find((x) => x.player === n);
    if (!p || p.amount + p.locked <= 0) return null;
    const pr = PLAYERS_BY_ID[id]!;
    const status = this.statusOf(id);
    const tokens = tok(p.amount + p.locked);
    const price = px(p.px);
    const value = tokens * price;
    const cost = usd(p.cost);
    const age = p.entryTs ? holdAgeDays(p.entryTs * 1000, Date.now()) : 0;
    const trading = status === "trading";
    const tax = trading ? sellTaxRate(age) : PROTOCOL_CONFIG.curve.feeRate;
    return {
      playerId: id,
      ticker: pr.ticker,
      name: pr.name,
      position: pr.position,
      status,
      tokens,
      price,
      value,
      costBasis: cost,
      pnl: value - cost,
      pnlPct: cost > 0 ? value / cost - 1 : 0,
      holdAgeDays: age,
      sellTaxNow: tax,
      // Estimate: tax and the LP fee off the marked value (the sell ticket shows the exact quote).
      realisableUsd: value * (1 - tax - (trading ? PROTOCOL_CONFIG.pool.lpFeeRate : 0)),
      curvePurchased: tok(p.capBought),
      snapshotTokens: null,
      countsNextKickoff: trading,
    };
  }

  private lpOf(u: UserView, id: PlayerId, n: number): LpPositionView | null {
    const ls = u.lps.filter((l) => l.player === n);
    if (!ls.length) return null;
    const pr = PLAYERS_BY_ID[id]!;
    const m = this.markets.get(n);
    const price = px(m?.px);
    const value = ls.reduce((a, l) => a + usd(l.value), 0);
    const deposited = ls.reduce((a, l) => a + usd(l.deposited), 0);
    const fees = ls.reduce((a, l) => a + usd(l.feeUsdc) + tok(l.feeTokens) * price, 0);
    const entry = ls[0]!.entryPx ? px(ls[0]!.entryPx) : price;
    const ratio = entry > 0 ? price / entry : 1;
    return {
      playerId: id,
      ticker: pr.ticker,
      name: pr.name,
      shares: ls.reduce((a, l) => a + Number(l.liquidity), 0),
      poolShare: ls.reduce((a, l) => a + l.share, 0),
      usdc: ls.reduce((a, l) => a + usd(l.usdc), 0),
      tokens: ls.reduce((a, l) => a + tok(l.tokens), 0),
      valueUsd: value,
      depositedUsd: deposited,
      feesEarnedUsd: fees,
      pnl: value - deposited,
      impermanentLoss: Math.max(0, 1 - (2 * Math.sqrt(ratio)) / (1 + ratio)),
      entryPrice: entry,
      holdAgeDays: holdAgeDays(ls[0]!.entryTs * 1000, Date.now()),
    };
  }

  private claimableOf(u: UserView): ClaimableView {
    const rows = u.claims.filter((c) => this.slugs.has(c.player)).map((c) => ({ roundId: c.round, playerId: this.slugs.get(c.player)!, usd: usd(c.amount), ticker: PLAYERS_BY_ID[this.slugs.get(c.player)!]!.ticker }));
    const latestPx = new Map<string, number>();
    for (const c of u.claims) if (c.electionPx && this.slugs.has(c.player)) latestPx.set(this.slugs.get(c.player)!, px(c.electionPx));
    const market = (id: string) => {
      const m = this.markets.get(this.ids.get(id) ?? -1);
      return { price: latestPx.get(id) ?? px(m?.px), reserveLeft: tok(m?.reserveLeft) };
    };
    return { totalUsd: rows.reduce((a, r) => a + r.usd, 0), rows, usdc: quoteClaim(rows, "usdc", market), tokens: quoteClaim(rows, "tokens", market) };
  }

  async getPortfolio(): Promise<Portfolio | null> {
    if (!this.session) return null;
    await this.base();
    const u = await this.loadUser().catch(rethrow);
    if (!u) return null;
    const positions = u.positions
      .filter((p) => this.slugs.has(p.player))
      .map((p) => this.positionOf(u, this.slugs.get(p.player)!, p.player))
      .filter((x): x is PositionView => !!x)
      .sort((a, b) => b.value - a.value);
    const lpIds = [...new Set(u.lps.map((l) => l.player))].filter((n) => this.slugs.has(n));
    const lp = lpIds.map((n) => this.lpOf(u, this.slugs.get(n)!, n)).filter((x): x is LpPositionView => !!x);
    const positionsValue = positions.reduce((a, p) => a + p.value, 0);
    const lpValue = lp.reduce((a, p) => a + p.valueUsd, 0);
    const unrealized = positions.reduce((a, p) => a + p.pnl, 0) + lp.reduce((a, p) => a + p.pnl, 0);
    const realizedPnl = usd(u.realized);
    const points = emptyPoints();
    const history: ActivityItem[] = u.activity.map((a) => {
      const id = a.player != null ? this.slugs.get(a.player) : undefined;
      const kind = a.kind as ActivityKind;
      if (kind === "buy" && a.detail.startsWith("Launch")) points.launch += Math.abs(usd(a.usdc));
      if (kind === "buy" || kind === "sell" || kind === "order-fill") points.volume += Math.abs(usd(a.usdc));
      if (kind === "lp-add") points.liquidity += Math.abs(usd(a.usdc));
      if (kind === "dividend") points.dividends += usd(a.usdc);
      return { id: a.id, at: a.ts * 1000, kind, playerId: id, ticker: id ? PLAYERS_BY_ID[id]?.ticker : undefined, usdc: Math.abs(usd(a.usdc)), tokens: a.tokens ? Math.abs(tok(a.tokens)) : undefined, detail: a.detail };
    });
    points.fees = usd(u.fees);
    const orders: LimitOrder[] = u.orders
      .filter((o) => this.slugs.has(o.player))
      .map((o) => {
        const id = this.slugs.get(o.player)!;
        const placed = u.activity.find((a) => a.kind === "order" && a.player === o.player);
        return { id: String(o.id), playerId: id, ticker: PLAYERS_BY_ID[id]!.ticker, side: o.side, price: px(o.px), usdc: o.side === "buy" ? usd(o.remaining) : 0, tokens: o.side === "sell" ? tok(o.remaining) : 0, createdAt: (placed?.ts ?? 0) * 1000 };
      });
    const cash = usd(u.free);
    return {
      user: this.session,
      usdc: cash,
      positionsValue,
      lpValue,
      totalValue: cash + usd(u.locked) + usd(u.inOrders) + positionsValue + lpValue,
      pnl: unrealized + realizedPnl,
      realizedPnl,
      dividendsEarned: usd(u.dividends),
      feesPaid: usd(u.fees),
      positions,
      lp,
      claimable: this.claimableOf(u),
      history,
      orders,
      points: { ...points, total: totalPoints(points) },
    };
  }

  async getValueHistory(range: ValueRange): Promise<ValuePoint[]> {
    const me = this.me();
    if (!me) return [];
    const pts = await this.node.get<[number, number, number][]>(`/v1/view/users/${me}/value?range=${range}`).catch(rethrow);
    return pts.map(([t, v, p]) => ({ t: t * 1000, value: usd(v), pnl: usd(p) }));
  }

  async getProtocolStats(): Promise<ProtocolStats> {
    await this.base();
    const [st, r, results] = await Promise.all([this.node.get<any>("/v1/view/stats").catch(rethrow), this.lastRound ? Promise.resolve(this.lastRound) : this.loadRound(), this.oracleResults(40)]);
    const reg = PLAYERS.map((p) => this.statusOf(p.id));
    const bonded = reg.filter((s) => s === "trading").length;
    const vault = usd(st.vault);
    const tvl = bonded * 17_500 + vault;
    const avgPay = results.length ? results.slice(0, 8).reduce((a, x) => a + x.pool, 0) / Math.min(8, results.length) : 0;
    return {
      tvl,
      vault,
      treasury: usd(st.treasury),
      runwayRounds: avgPay > 0 ? vault / avgPay : Infinity,
      vaultToTvl: tvl > 0 ? vault / tvl : 0,
      roundPool: { ...r.pool, capPerRound: (tvl * 0.12) / 38, matrixBps: r.pool.bps },
      bondedCount: bonded,
      launchingCount: reg.filter((s) => s === "launching").length,
      scheduledCount: reg.filter((s) => s === "scheduled").length,
      volume24h: usd(st.volume24h),
      totalPaidOut: usd(st.paidOut),
      roundsSettled: results.length,
      reserveLeftTotal: usd(st.reserveLeft),
      externalLpDepth: usd(st.externalLp),
      poolUsdcTotal: usd(st.poolUsdc),
      curveUsdcTotal: usd(st.curveUsdc),
      feesCollected: usd(st.fees),
    };
  }

  async getRecentTrades(id: PlayerId | null, limit: number): Promise<TradeRecord[]> {
    await this.loadOracle();
    const me = this.me();
    const q = `limit=${limit}${id ? `&player=${this.engineId(id)}` : ""}${me ? `&user=${me}` : ""}`;
    const rows = await this.node.get<TradeRow[]>(`/v1/view/trades?${q}`).catch(rethrow);
    return rows.filter((t) => this.slugs.has(t.player)).map((t) => this.tradeOf(t));
  }

  // ------------------------------------------------------------ quotes

  private async rawQuote(body: Record<string, unknown>): Promise<QuoteOut> {
    return this.node.post<QuoteOut>("/v1/quote", { ...body, user: this.me() ?? undefined });
  }

  private emptyQuote(side: "buy" | "sell", venue: "curve" | "pool", id: PlayerId, error?: { code: string; message: string }): Quote {
    return { ok: false, error, side, venue, playerId: id, usdc: 0, tokens: 0, avgPrice: 0, spotBefore: 0, spotAfter: 0, priceImpact: 0, fees: [], totalFees: 0, receive: 0, refund: 0, bonds: false, cap: null, holdAgeDays: null, warnings: [] };
  }

  async quoteBuy(id: PlayerId, usdc: number): Promise<Quote> {
    await this.base();
    const status = this.statusOf(id);
    const pr = PLAYERS_BY_ID[id]!;
    if (status === "scheduled") return this.emptyQuote("buy", "curve", id, { code: "NOT_LAUNCHED", message: "This player hasn't launched yet." });
    const n = this.engineId(id);
    const venue = status === "launching" ? "curve" : "pool";
    const q = await this.rawQuote({ kind: "buy", player: n, usdc: Math.floor(usdc * M) }).catch(rethrow);
    const m = this.markets.get(n)!;
    const purchased = tok(q.capBought);
    const cap = venue === "curve" ? quoteCurveBuy({ sold: tok(m.sold), raised: usd(m.raised) }, usdc, purchased).cap : null;
    if (!q.ok) {
      const e = engineError(q.error, { ticker: pr.ticker });
      let message = e.message;
      if (cap && (q.error === "AccountLimit" || q.error === "PurchaseLimit")) message = cap.maxTokensNow > 1 ? `Launch limit: 240,000 tokens per account. You can buy ${fmtTok(cap.maxTokensNow)} more (up to ${fmtUsd(cap.maxUsdcNow)}).` : "You've reached the 240,000-token launch limit for this player.";
      return { ...this.emptyQuote("buy", venue, id, { code: e.code, message }), cap };
    }
    const o = q.outcome.Bought ?? q.outcome.Traded;
    const tokens = tok(o.tokens);
    const spent = venue === "curve" ? usd(o.cost + o.fee) : usd(o.usdc);
    const fee = usd(o.fee);
    const before = px(q.pxBefore);
    const after = px(q.pxAfter);
    const warnings: string[] = [];
    if (q.graduated) warnings.push("This buy completes the launch: the player bonds and the rest of your order buys from the new pool.");
    const impact = before > 0 ? after / before - 1 : 0;
    if (venue === "pool" && impact > 0.03) warnings.push(`High price impact: ${(impact * 100).toFixed(1)}%.`);
    if (venue === "pool" && this.lastRound && this.lastRound.phase !== "open") warnings.push("Kickoff has passed: tokens bought now count from the next round.");
    const fees =
      venue === "curve"
        ? [{ label: "Launch fee", rate: PROTOCOL_CONFIG.curve.feeRate, usd: fee, to: "Treasury" }]
        : [
            { label: "Buy fee", rate: PROTOCOL_CONFIG.pool.buyFeeRate, usd: fee, to: "Treasury" },
            { label: "LP fee", rate: PROTOCOL_CONFIG.pool.lpFeeRate, usd: (spent - fee) * PROTOCOL_CONFIG.pool.lpFeeRate, to: "Liquidity providers" },
          ];
    let quote: Quote = {
      ok: true,
      side: "buy",
      venue,
      playerId: id,
      usdc: spent,
      tokens,
      avgPrice: tokens > 0 ? spent / tokens : 0,
      spotBefore: before,
      spotAfter: after,
      priceImpact: Math.max(0, impact),
      fees,
      totalFees: fees.reduce((a, f) => a + f.usd, 0),
      receive: 0,
      refund: Math.max(0, usdc - spent),
      bonds: !!q.graduated,
      cap: cap ? { ...cap, usedAfter: purchased + tokens } : null,
      holdAgeDays: venue === "pool" ? 0 : null,
      warnings,
    };
    const u = this.user;
    if (u && this.session && spent > usd(u.free) + 1e-9) quote = { ...quote, ok: false, error: { code: "INSUFFICIENT_USDC", message: `Not enough USDC. Balance ${fmtUsd(usd(u.free))}.` } };
    return quote;
  }

  async quoteSell(id: PlayerId, input: { usdc: number } | { tokens: number }): Promise<Quote> {
    await this.base();
    const status = this.statusOf(id);
    const pr = PLAYERS_BY_ID[id]!;
    if (status === "scheduled") return this.emptyQuote("sell", "curve", id, { code: "NOT_LAUNCHED", message: "This player hasn't launched yet." });
    const n = this.engineId(id);
    const venue = status === "launching" ? "curve" : "pool";
    const body: Record<string, unknown> = { kind: "sell", player: n };
    if ("tokens" in input) body.tokens = venue === "curve" ? Math.floor(input.tokens * 1000) * 1000 : Math.floor(input.tokens * M);
    else body.usdc = Math.ceil(input.usdc * M);
    const q = await this.rawQuote(body).catch(rethrow);
    const age = q.entryTs ? holdAgeDays(q.entryTs * 1000, Date.now()) : 0;
    const held = tok(q.held);
    if (!q.ok) return this.emptyQuote("sell", venue, id, { code: engineError(q.error).code, message: engineError(q.error, { ticker: pr.ticker }).message });
    const tokensIn = tok(q.tokensIn ?? 0);
    if (this.session && tokensIn > held + 1e-9) return this.emptyQuote("sell", venue, id, { code: "INSUFFICIENT_TOKENS", message: `You hold ${fmtTok(held)} $${pr.ticker}.` });
    const o = q.outcome.Sold ?? q.outcome.Traded;
    const net = venue === "curve" ? usd(o.usdc_out) : usd(o.usdc);
    const fee = venue === "curve" ? usd(o.fee) : usd(o.tax);
    const gross = net + fee;
    const before = px(q.pxBefore);
    const after = px(q.pxAfter);
    const rate = venue === "curve" ? PROTOCOL_CONFIG.curve.feeRate : sellTaxRate(age);
    const warnings: string[] = [];
    const impact = before > 0 ? 1 - after / before : 0;
    if (venue === "pool" && impact > 0.03) warnings.push(`High price impact: ${(impact * 100).toFixed(1)}%.`);
    return {
      ok: true,
      side: "sell",
      venue,
      playerId: id,
      usdc: gross,
      tokens: tokensIn,
      avgPrice: tokensIn > 0 ? gross / tokensIn : 0,
      spotBefore: before,
      spotAfter: after,
      priceImpact: Math.max(0, impact),
      fees:
        venue === "curve"
          ? [{ label: "Launch fee", rate, usd: fee, to: "90% vault · 10% treasury" }]
          : [
              { label: `Sell tax (${age.toFixed(0)}-day hold)`, rate, usd: fee, to: "90% vault · 10% treasury" },
              { label: "LP fee", rate: PROTOCOL_CONFIG.pool.lpFeeRate, usd: gross * PROTOCOL_CONFIG.pool.lpFeeRate, to: "Liquidity providers" },
            ],
      totalFees: fee + (venue === "pool" ? gross * PROTOCOL_CONFIG.pool.lpFeeRate : 0),
      receive: net,
      refund: 0,
      bonds: false,
      cap: null,
      holdAgeDays: this.session ? age : null,
      warnings,
    };
  }

  async quoteLiquidity(id: PlayerId, usdc: number, mode: "pair" | "zap"): Promise<LiquidityQuote> {
    await this.base();
    const empty: LiquidityQuote = { ok: false, mode, usdc, tokens: 0, sharesMinted: 0, poolShareAfter: 0, swapFees: 0, leftoverUsdc: 0, leftoverTokens: 0, lpTokens: 0 };
    if (this.statusOf(id) !== "trading") return { ...empty, error: { code: "NOT_TRADING", message: "Liquidity opens once the player bonds." } };
    const pr = PLAYERS_BY_ID[id]!;
    const q = await this.rawQuote({ kind: mode === "pair" ? "add" : "zap", player: this.engineId(id), usdc: Math.floor(usdc * M) }).catch(rethrow);
    const need = tok(q.needTokens);
    const held = tok(q.held);
    if (mode === "pair" && need > held + 1e-9) return { ...empty, tokens: need, error: { code: "INSUFFICIENT_TOKENS", message: `Pairing needs ${fmtTok(need)} $${pr.ticker}. You hold ${fmtTok(held)}. Use USDC only, or buy more.` } };
    if (!q.ok) return { ...empty, error: { code: engineError(q.error).code, message: engineError(q.error, { ticker: pr.ticker }).message } };
    const o = q.outcome.Liquidity;
    const sw = q.swap?.Traded;
    const usedUsdc = usd(o.usdc) + (sw ? usd(sw.usdc) : 0);
    const res: LiquidityQuote = {
      ok: true,
      mode,
      usdc: mode === "pair" ? usd(o.usdc) : usdc,
      tokens: tok(o.tokens),
      sharesMinted: Number(o.liquidity),
      poolShareAfter: q.share ?? 0,
      swapFees: sw ? usd(sw.fee) + usd(sw.usdc) * PROTOCOL_CONFIG.pool.lpFeeRate : 0,
      leftoverUsdc: Math.max(0, usdc - usedUsdc),
      leftoverTokens: sw ? Math.max(0, tok(sw.tokens) - tok(o.tokens)) : 0,
      lpTokens: tok(o.tokens),
    };
    if (this.user && this.session && (mode === "pair" ? usd(o.usdc) : usdc) > usd(this.user.free) + 1e-9) return { ...res, ok: false, error: { code: "INSUFFICIENT_USDC", message: "Not enough USDC." } };
    return res;
  }

  // ------------------------------------------------------------ actions

  private done(seq: number): void {
    this.seenSeq = Math.max(this.seenSeq, seq);
  }

  private key(): Uint8Array {
    return addressBytes(this.session!.address);
  }

  async buy(id: PlayerId, usdc: number): Promise<TxResult> {
    const s = await this.needSigner();
    const q = await this.quoteBuy(id, usdc);
    if (!q.ok) throw new ProtocolError((q.error?.code as ProtocolErrorCode) ?? "INVALID_AMOUNT", q.error?.message ?? "Can't buy that.");
    const n = this.engineId(id);
    const ticker = PLAYERS_BY_ID[id]!.ticker;
    const minTokens = BigInt(Math.floor(q.tokens * (1 - SLIPPAGE) * M));
    const usdcIn = BigInt(Math.floor(usdc * M));
    const r = await this.node
      .submit(s, (nonce) => (q.venue === "curve" ? { BuyCurve: { user: this.key(), nonce, player: n, usdcIn, minTokens } } : { Buy: { user: this.key(), nonce, player: n, usdcIn, minTokens, limitPx: 0n } }))
      .catch((e) => rethrow(e, { ticker }));
    this.done(r.seq);
    const o = r.outcome.Bought ?? r.outcome.Traded;
    const tokens = tok(o.tokens);
    const spent = q.venue === "curve" ? usd(o.cost + o.fee) : usd(o.usdc);
    return { ok: true, id: String(r.seq), summary: `Bought ${fmtTok(tokens)} $${ticker} for ${fmtUsd(spent)}`, tokens, usdc: spent, bonded: o.graduated ? id : undefined };
  }

  async sell(id: PlayerId, input: { usdc: number } | { tokens: number }): Promise<TxResult> {
    const s = await this.needSigner();
    const q = await this.quoteSell(id, input);
    if (!q.ok) throw new ProtocolError((q.error?.code as ProtocolErrorCode) ?? "INVALID_AMOUNT", q.error?.message ?? "Can't sell that.");
    const n = this.engineId(id);
    const ticker = PLAYERS_BY_ID[id]!.ticker;
    const tokens = q.venue === "curve" ? BigInt(Math.floor(q.tokens * 1000)) * 1000n : BigInt(Math.floor(q.tokens * M));
    const minUsdc = BigInt(Math.floor(q.receive * (1 - SLIPPAGE) * M));
    const r = await this.node
      .submit(s, (nonce) => (q.venue === "curve" ? { SellCurve: { user: this.key(), nonce, player: n, tokens, minUsdc } } : { Sell: { user: this.key(), nonce, player: n, tokensIn: tokens, minUsdc, limitPx: 0n } }))
      .catch((e) => rethrow(e, { ticker }));
    this.done(r.seq);
    const o = r.outcome.Sold ?? r.outcome.Traded;
    const got = q.venue === "curve" ? usd(o.usdc_out) : usd(o.usdc);
    return { ok: true, id: String(r.seq), summary: `Sold ${fmtTok(tok(Number(tokens)))} $${ticker} for ${fmtUsd(got)}`, tokens: tok(Number(tokens)), usdc: got };
  }

  async placeLimit(id: PlayerId, side: "buy" | "sell", amount: number, price: number): Promise<TxResult> {
    const s = await this.needSigner();
    await this.base();
    if (this.statusOf(id) !== "trading") throw new ProtocolError("NOT_TRADING", "Limit orders open once the player bonds.");
    if (!(amount > 0) || !(price > 0)) throw new ProtocolError("INVALID_AMOUNT", "Enter an amount and a price.");
    const n = this.engineId(id);
    const ticker = PLAYERS_BY_ID[id]!.ticker;
    const pxv = BigInt(Math.round(price * PX));
    const amt = BigInt(Math.floor(amount * M));
    const r = await this.node.submit(s, (nonce) => ({ PlaceOrder: { user: this.key(), nonce, player: n, side: side === "buy" ? "bid" : "ask", px: pxv, amount: amt, postOnly: false } })).catch((e) => rethrow(e, { ticker }));
    this.done(r.seq);
    const o = r.outcome.Traded;
    const filled = o && o.tokens > 0 ? ` · ${fmtTok(tok(o.tokens))} filled now` : "";
    const what = side === "buy" ? `${fmtUsd(amount)} of $${ticker}` : `${fmtTok(amount)} $${ticker}`;
    return { ok: true, id: String(o?.order ?? r.seq), summary: `Limit ${side} placed: ${what} at $${price.toFixed(5)}${filled}` };
  }

  async cancelOrder(orderId: string): Promise<TxResult> {
    const s = await this.needSigner();
    const r = await this.node.submit(s, (nonce) => ({ CancelOrder: { user: this.key(), nonce, order: BigInt(orderId) } })).catch((e) => rethrow(e));
    this.done(r.seq);
    return { ok: true, id: String(r.seq), summary: "Order cancelled. Funds are back in your balance." };
  }

  async addLiquidity(id: PlayerId, usdc: number, mode: "pair" | "zap"): Promise<TxResult> {
    const s = await this.needSigner();
    const q = await this.quoteLiquidity(id, usdc, mode);
    if (!q.ok) throw new ProtocolError((q.error?.code as ProtocolErrorCode) ?? "INVALID_AMOUNT", q.error?.message ?? "Can't add that.");
    const n = this.engineId(id);
    const ticker = PLAYERS_BY_ID[id]!.ticker;
    let maxUsdc = BigInt(Math.floor(usdc * M));
    let maxTokens = BigInt(Math.ceil(q.tokens * 1.02 * M));
    if (mode === "zap") {
      const half = maxUsdc / 2n;
      const b = await this.node.submit(s, (nonce) => ({ Buy: { user: this.key(), nonce, player: n, usdcIn: half, minTokens: BigInt(Math.floor(q.tokens * (1 - SLIPPAGE) * M)), limitPx: 0n } })).catch((e) => rethrow(e, { ticker }));
      this.done(b.seq);
      maxUsdc -= half;
      maxTokens = BigInt(b.outcome.Traded.tokens);
    }
    const r = await this.node.submit(s, (nonce) => ({ AddLiquidity: { user: this.key(), nonce, player: n, lowerPx: 0n, upperPx: 0n, maxUsdc, maxTokens, minLiquidity: 0n } })).catch((e) => rethrow(e, { ticker }));
    this.done(r.seq);
    const o = r.outcome.Liquidity;
    return { ok: true, id: String(r.seq), summary: `Added ${fmtUsd(usd(o.usdc))} + ${fmtTok(tok(o.tokens))} $${ticker} to the pool`, usdc: usd(o.usdc), tokens: tok(o.tokens) };
  }

  async removeLiquidity(id: PlayerId, fraction = 1): Promise<TxResult> {
    const s = await this.needSigner();
    await this.base();
    const n = this.engineId(id);
    const u = await this.loadUser();
    const mine = (u?.lps ?? []).filter((l) => l.player === n);
    if (!mine.length) throw new ProtocolError("INSUFFICIENT_SHARES", "You have no liquidity in this pool.");
    let usdc = 0;
    let tokens = 0;
    for (const l of mine) {
      const L = BigInt(l.liquidity);
      const take = fraction >= 0.9999 ? L : (L * BigInt(Math.round(fraction * 1e6))) / 1_000_000n;
      if (take <= 0n) continue;
      const r = await this.node.submit(s, (nonce) => ({ RemoveLiquidity: { user: this.key(), nonce, position: BigInt(l.id), liquidity: take, minUsdc: 0n, minTokens: 0n } })).catch((e) => rethrow(e));
      this.done(r.seq);
      usdc += usd(r.outcome.Liquidity.usdc);
      tokens += tok(r.outcome.Liquidity.tokens);
    }
    const ticker = PLAYERS_BY_ID[id]!.ticker;
    return { ok: true, id: `lp-${Date.now()}`, summary: `Removed ${fmtUsd(usdc)} + ${fmtTok(tokens)} $${ticker} (fees included)`, usdc, tokens };
  }

  /**
   * One signed `ClaimAll` pays every credited row in a single engine step (one signature, one
   * round trip). Rows whose token election can't be filled are paid in USDC by the engine.
   */
  async claim(mode: ClaimMode): Promise<TxResult> {
    const s = await this.needSigner();
    const u = await this.loadUser();
    if (!u?.claims.length) throw new ProtocolError("NOTHING_TO_CLAIM", "Nothing to claim yet.");
    const takeTokens = mode === "tokens";
    const r = await this.node.submit(s, (nonce) => ({ ClaimAll: { user: this.key(), nonce, takeTokens } })).catch((x) => rethrow(x));
    this.done(r.seq);
    const rows: [number, number, number, number][] = r.outcome.ClaimedAll.rows;
    let usdc = 0;
    let tokens = 0;
    let fellBack = 0;
    for (const [, , c, t] of rows) {
      usdc += usd(c);
      tokens += tok(t);
      if (takeTokens && t === 0) fellBack++;
    }
    const parts = [usdc > 0 ? fmtUsd(usdc) : null, tokens > 0 ? `${fmtTok(tokens)} tokens` : null].filter(Boolean).join(" + ");
    return { ok: true, id: `claim-${Date.now()}`, summary: `Claimed ${parts}${fellBack ? ` (${fellBack} as USDC: the player's reserve was low)` : ""}`, usdc, tokens };
  }

  /** Devnet: mint test USDC to the wallet, then deposit it. Resolves once it's spendable. */
  async faucet(amount = 1_000): Promise<TxResult> {
    const s = await this.needSigner(20_000);
    if (this.funding) throw new ProtocolError("INVALID_AMOUNT", "Test USDC is already on its way.");
    this.funding = true;
    this.emit({ type: "funds", stage: "pending", amount, message: "Minting test USDC to your wallet…" });
    try {
      const token = (await this.accessToken?.()) ?? null;
      const r = await fetch(`${this.oracle}/v1/faucet`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ address: s.address }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; amount?: number };
      if (!r.ok) throw new ProtocolError("NETWORK", j.error ?? "The faucet couldn't send right now.");
      const got = j.amount ?? amount;
      this.emit({ type: "funds", stage: "pending", amount: got, message: "Depositing it into score…" });
      const res = await this.depositAndWait(s, got);
      this.emit({ type: "funds", stage: "done", amount: got, message: `${fmtUsd(got)} test USDC is ready to trade.`, signature: res.signature });
      return { ...res, summary: `${fmtUsd(got)} test USDC added to your balance` };
    } catch (e) {
      const err = e instanceof ProtocolError ? e : new ProtocolError("NETWORK", e instanceof Error ? e.message : "Faucet failed.");
      this.emit({ type: "funds", stage: "failed", amount, message: err.message });
      throw err;
    } finally {
      this.funding = false;
    }
  }

  private async depositAndWait(s: ScoreSigner, amount: number): Promise<TxResult> {
    const before = (await this.node.get<UserView>(`/v1/view/users/${s.address}`)).deposits;
    const sig = await this.node.deposit(s, BigInt(Math.floor(amount * M))).catch((e) => rethrow(e));
    const t0 = Date.now();
    while (Date.now() - t0 < 75_000) {
      await sleep(400);
      const u = await this.node.get<UserView>(`/v1/view/users/${s.address}`).catch(() => null);
      if (u && u.deposits >= before + Math.floor(amount * M)) {
        this.done(u.seq);
        this.emit({ type: "user" });
        return { ok: true, id: sig, signature: sig, summary: `${fmtUsd(amount)} moved to trading`, usdc: amount };
      }
      if ((Date.now() - t0) % 2000 < 450) {
        const st = await this.node.get<{ status: string }>(`/v1/tx/${sig}`).catch(() => null);
        if (st?.status === "failed") throw new ProtocolError("NETWORK", "The deposit failed on Solana. Nothing was taken from your wallet.");
      }
    }
    throw new ProtocolError("NETWORK", "The deposit is taking longer than usual. It will show up in your balance once Solana finalizes it.");
  }

  /**
   * Money movements run one at a time, so the automatic sweep never races a withdrawal or the faucet
   * over the same wallet USDC. `fundsBusy` counts what's queued or running.
   */
  private fundsBusy = 0;
  private fundsChain: Promise<unknown> = Promise.resolve();
  private fundsOp<T>(fn: () => Promise<T>): Promise<T> {
    this.fundsBusy++;
    const run = this.fundsChain.then(fn);
    this.fundsChain = run.catch(() => {});
    return run.finally(() => {
      this.fundsBusy--;
    });
  }

  private walletRaw(addr: string): Promise<number> {
    return this.node.get<{ confirmed: number }>(`/v1/wallet/${addr}`).then((w) => w.confirmed);
  }

  /**
   * Trading → wallet, `raw` base units. Resolves once the USDC is in the wallet, or as soon as the
   * transaction is away when `settle` is false (the caller watches the balance itself).
   */
  private async moveToWallet(s: ScoreSigner, raw: number, opts: { settle?: boolean; nonce?: bigint } = {}): Promise<TxResult & { mode: "instant" | "request" }> {
    const amount = raw / M;
    const u = await this.node.get<UserView>(`/v1/view/users/${s.address}`);
    if (u.free < raw) throw new ProtocolError("INSUFFICIENT_USDC", `You have ${fmtUsd(usd(u.free))} free to move.`);
    const w0 = await this.walletRaw(s.address).catch(() => 0);
    const r = await this.node.withdraw(s, BigInt(raw), { nonce: opts.nonce }).catch((e) => rethrow(e));
    this.emit({ type: "user" });
    if (opts.settle === false) return { ok: true, id: r.signature, signature: r.signature, summary: `${fmtUsd(amount)} moved to your wallet`, usdc: amount, mode: r.mode };
    // Instant: wait for the USDC to reach the wallet. Request: paid after the next batch (seconds).
    const t0 = Date.now();
    let landed = false;
    while (Date.now() - t0 < 60_000) {
      await sleep(500);
      const w = await this.walletRaw(s.address).catch(() => null);
      if (w !== null && w >= w0 + raw) {
        landed = true;
        break;
      }
      const st = await this.node.get<{ status: string }>(`/v1/tx/${r.signature}`).catch(() => null);
      if (st?.status === "failed") throw new ProtocolError("NETWORK", "The withdrawal transaction failed. Your USDC goes back to your balance when the permit expires (a few minutes).");
    }
    if (!landed) throw new ProtocolError("NETWORK", "Your USDC is taking longer than usual to leave score. It will show up in your balance; try again in a minute.");
    this.emit({ type: "user" });
    return { ok: true, id: r.signature, signature: r.signature, summary: `${fmtUsd(amount)} moved to your wallet`, usdc: amount, mode: r.mode };
  }

  /** Wait until the destination's token account has received `raw` (final on Solana). */
  private async settle(sig: string, dest: string, raw: number): Promise<void> {
    const t0 = Date.now();
    for (;;) {
      await sleep(300);
      const d = await this.node.get<{ confirmed: number }>(`/v1/wallet/${dest}`).catch(() => null);
      if (d && d.confirmed >= raw) return;
      const st = await this.node.get<{ status: string }>(`/v1/tx/${sig}`).catch(() => null);
      if (st?.status === "failed") throw new ProtocolError("NETWORK", "The withdrawal failed on Solana. Your cash is unchanged in your wallet.");
      if (Date.now() - t0 > 60_000) throw new ProtocolError("NETWORK", "The withdrawal is taking longer than usual. Check the address in a minute before trying again.");
    }
  }

  /** Wallet → another address, `raw` base units. Resolves once final. */
  private async sendOut(s: ScoreSigner, dest: string, raw: number, opts: { nonce?: bigint; settle?: boolean } = {}): Promise<TxResult> {
    const amount = raw / M;
    const [w, d] = await Promise.all([this.walletRaw(s.address).catch(rethrow), this.node.get<{ exists: boolean }>(`/v1/wallet/${dest}`).catch(rethrow)]);
    if (w < raw) throw new ProtocolError("INSUFFICIENT_USDC", `Your wallet holds ${fmtUsd(usd(w))}.`);
    const sig = await this.node.send(s, dest, BigInt(raw), !d.exists, opts.nonce).catch((e) => rethrow(e));
    if (opts.settle !== false) await this.settle(sig, dest, raw);
    this.emit({ type: "user" });
    return { ok: true, id: sig, signature: sig, summary: `${fmtUsd(amount)} sent to ${short(dest)}`, usdc: amount };
  }

  private checkDest(s: ScoreSigner, to: string, amount: number): string {
    const dest = to.trim();
    if (!isAddress(dest)) throw new ProtocolError("INVALID_AMOUNT", "That isn't a Solana address.");
    if (dest === s.address) throw new ProtocolError("INVALID_AMOUNT", "That's your own deposit address.");
    if (!(amount >= 1)) throw new ProtocolError("INVALID_AMOUNT", "Withdrawals start at $1.");
    return dest;
  }

  readonly funds: FundsClient = {
    getFunds: async (): Promise<FundsView> => {
      const me = this.me();
      if (!me) return { wallet: 0, app: 0, locked: 0, inOrders: 0 };
      const [w, u] = await Promise.all([this.node.get<{ confirmed: number }>(`/v1/wallet/${me}`).catch(() => ({ confirmed: 0 })), this.node.get<UserView>(`/v1/view/users/${me}?${this.after()}`).catch(rethrow)]);
      return { wallet: usd(w.confirmed), app: usd(u.free), locked: usd(u.locked), inOrders: usd(u.inOrders) };
    },
    toTrading: async (amount: number) => {
      const s = await this.needSigner();
      if (!(amount > 0)) throw new ProtocolError("INVALID_AMOUNT", "Enter an amount.");
      return this.fundsOp(async () => {
        const w = await this.walletRaw(s.address).catch(() => 0);
        if (usd(w) + 1e-9 < amount) throw new ProtocolError("INSUFFICIENT_USDC", `Your wallet holds ${fmtUsd(usd(w))} USDC.`);
        return this.depositAndWait(s, amount);
      });
    },
    toWallet: async (amount: number) => {
      const s = await this.needSigner();
      if (!(amount > 0)) throw new ProtocolError("INVALID_AMOUNT", "Enter an amount.");
      return this.fundsOp(() => this.moveToWallet(s, Math.round(amount * M)));
    },
    send: async (to: string, amount: number) => {
      const s = await this.needSigner();
      const dest = this.checkDest(s, to, amount);
      return this.fundsOp(() => this.sendOut(s, dest, Math.round(amount * M)));
    },
    withdraw: async (to: string, amount: number) => {
      const s = await this.needSigner();
      const dest = this.checkDest(s, to, amount);
      const raw = Math.round(amount * M);
      return this.fundsOp(async () => {
        const [w, u] = await Promise.all([this.walletRaw(s.address).catch(rethrow), this.node.get<UserView>(`/v1/view/users/${s.address}`).catch(rethrow)]);
        if (w + u.free < raw) throw new ProtocolError("INSUFFICIENT_USDC", `You have ${fmtUsd(usd(w + u.free))} free to withdraw.`);
        // Trading → wallet → destination. Instant withdrawals do both in one transaction (the relayer
        // accepts a withdraw followed by the transfer that spends it), so this is one round trip; only
        // a withdrawal over the instant cap pays the wallet first and sends from there.
        if (raw > w) {
          const r = await this.node.withdraw(s, BigInt(raw), { to: dest, createAccount: !(await this.node.get<{ exists: boolean }>(`/v1/wallet/${dest}`).then((d) => d.exists).catch(() => true)) }).catch((e) => rethrow(e));
          if (r.mode === "instant") {
            await this.settle(r.signature, dest, raw);
            return { ok: true, id: r.signature, signature: r.signature, summary: `${fmtUsd(amount)} sent to ${short(dest)}`, usdc: amount };
          }
          await this.moveToWallet(s, raw - w, { settle: true });
          return this.sendOut(s, dest, raw);
        }
        return this.sendOut(s, dest, raw);
      });
    },
    sweep: async (min = 1) => {
      // Never queue behind another movement, and never wait for a signer: the next poll tries again.
      const s = this.signer;
      if (!s || this.funding || this.fundsBusy > 0 || s.address !== this.session?.address) return null;
      return this.fundsOp(async () => {
        const w = await this.walletRaw(s.address).catch(() => 0);
        // Whole cents only; sub-cent dust stays put rather than costing a transaction.
        const amount = Math.floor(w / 10_000) / 100;
        if (amount < min) return null;
        this.emit({ type: "funds", stage: "pending", amount, message: `Adding ${fmtUsd(amount)} to your cash…` });
        try {
          const r = await this.depositAndWait(s, amount);
          this.emit({ type: "funds", stage: "done", amount, message: `${fmtUsd(amount)} received. Ready to trade.`, signature: r.signature });
          return { ...r, summary: `${fmtUsd(amount)} added to your cash` };
        } catch (e) {
          const err = e instanceof ProtocolError ? e : new ProtocolError("NETWORK", e instanceof Error ? e.message : "The deposit failed.");
          this.emit({ type: "funds", stage: "failed", amount, title: "Couldn't add your deposit", message: `${err.message} We'll try again shortly.` });
          throw err;
        }
      });
    },
  };

  // ------------------------------------------------------------ session

  async getSession(): Promise<UserSession | null> {
    return this.session;
  }

  async signIn(input: SignInInput): Promise<UserSession> {
    const country = input.country ?? "";
    if ((RESTRICTED_COUNTRIES as readonly string[]).includes(country)) throw new ProtocolError("RESTRICTED", `score isn't available to people located in ${country}.`);
    if (!input.acceptedTerms) throw new ProtocolError("TERMS_NOT_ACCEPTED", "Accept the Terms to continue.");
    let address = input.identity?.address;
    let id = input.identity?.id;
    let handle = input.identity?.handle;
    if (!address) {
      if (!this.opts.burner) throw new ProtocolError("NOT_SIGNED_IN", "Sign in with Privy to continue.");
      const b = await this.burnerSigner();
      this.setSigner(b);
      address = b.address;
      id = `burner:${address}`;
      handle = short(address);
    }
    const label = { google: "Google", email: "Email", phantom: "Phantom", demo: "Test wallet" }[input.method];
    const same = this.session?.address === address;
    const session: UserSession = same
      ? { ...this.session!, country: input.country }
      : { id: id!, method: input.method, label: `${label} · ${handle}`, address, country: input.country, createdAt: Date.now() };
    this.session = session;
    saveJson(SESSION_KEY, session);
    this.seenSeq = 0;
    this.emit({ type: "session" });
    void (async () => {
      const token = (await this.accessToken?.()) ?? null;
      await fetch(`${this.oracle}/v1/profile`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ country: input.country, acceptedTerms: input.acceptedTerms, address }) }).catch(() => {});
      // First visit: start them with test USDC (the mock's sign-in gift), unless they already have funds.
      const u = await this.node.get<UserView>(`/v1/view/users/${address}`).catch(() => null);
      if (u && u.deposits === 0 && u.free === 0) await this.faucet().catch(() => {});
    })();
    return session;
  }

  async signOut(): Promise<void> {
    this.session = null;
    this.user = null;
    this.signer = null;
    this.seenSeq = 0;
    removeKey(SESSION_KEY);
    this.emit({ type: "session" });
  }
}
