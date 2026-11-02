/**
 * The ProtocolClient seam (ARCHITECTURE §7.2). The UI only talks to this interface.
 * `MockProtocolClient` implements it now; `OnchainProtocolClient` (Codama + indexer) later.
 */
import type {
  ActivityPoints,
  BoardKind,
  CapUsage,
  ClaimMode,
  ClaimQuote,
  CompetitionCode,
  EventCode,
  FormEntry,
  ImpactRow,
  LeagueCode,
  MatchWindow,
  PlayerStatus,
  PositionCode,
  RoundPhase,
} from "@score/core";

export type PlayerId = string;
export type UserId = string;
export type Unsubscribe = () => void;
export type PriceRange = "24H" | "3D" | "6D" | "ALL";
export type SignInMethod = "google" | "email" | "phantom";
export type ClockMode = "demo" | "calendar";

export type { ClaimMode, PlayerStatus, RoundPhase };

export interface PlayerFilter {
  status?: PlayerStatus | "all";
  league?: LeagueCode | "all";
  position?: PositionCode | "all";
  search?: string;
}

export interface PlayerSummary {
  id: PlayerId;
  name: string;
  ticker: string;
  club: string;
  country: string;
  age: number;
  league: LeagueCode;
  leagueName: string;
  position: PositionCode;
  /** Average display score (form rating). */
  avgScore: number;
  inUcl: boolean;
  status: PlayerStatus;
  launchAt: number | null;
  bondedAt: number | null;
  /** Spot price: curve price while launching, pool price after bonding. */
  price: number;
  /** Fractional change vs ~24h ago (0.05 = +5%). */
  change24h: number;
  volume24h: number;
  /** USDC raised on the curve. */
  raised: number;
  /** 0..1, 1 once bonded. */
  bondProgress: number;
  /** price × circulating supply */
  marketCap: number;
  /** Pool depth (both sides) once trading. */
  liquidityUsd: number | null;
  /** Recent prices for a sparkline (oldest first). */
  sparkline: number[];
  /** Display score of the last settled round the player played. */
  lastScore: number | null;
  /** Best board rank in the last settled round (null if unranked). */
  lastBoardRank: number | null;
  /** Provisional display score in the current live round. */
  liveScore: number | null;
  /** Plays in the current window (false midweek for non-UCL clubs). */
  playsThisWindow: boolean;
}

export interface TradeRecord {
  id: string;
  playerId: PlayerId;
  ticker: string;
  side: "buy" | "sell";
  venue: "curve" | "pool";
  usdc: number;
  tokens: number;
  price: number;
  fee: number;
  at: number;
  mine: boolean;
}

export interface HolderRow {
  label: string;
  tokens: number;
  share: number;
  isYou: boolean;
  kind: "holder" | "lp" | "protocol";
}

export interface PositionView {
  playerId: PlayerId;
  ticker: string;
  name: string;
  position: PositionCode;
  status: PlayerStatus;
  tokens: number;
  price: number;
  value: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  holdAgeDays: number;
  /** Current sell tax (curve fee while launching). */
  sellTaxNow: number;
  /** USDC you'd receive selling everything now (after tax and price impact). */
  realisableUsd: number;
  /** Tokens bought on the launch curve (counts toward the 240k cap). */
  curvePurchased: number;
  /** Tokens counted at the current round's kickoff snapshot (null before kickoff). */
  snapshotTokens: number | null;
  /** Whether the position counts at the next kickoff (bonded at kickoff and held). */
  countsNextKickoff: boolean;
}

export interface LpPositionView {
  playerId: PlayerId;
  ticker: string;
  name: string;
  shares: number;
  /** Share of the pool (0..1). */
  poolShare: number;
  usdc: number;
  tokens: number;
  valueUsd: number;
  depositedUsd: number;
  feesEarnedUsd: number;
  pnl: number;
  /** Loss vs holding since entry (0..1). */
  impermanentLoss: number;
  entryPrice: number;
  holdAgeDays: number;
}

export interface ClaimRowView {
  roundId: number;
  playerId: PlayerId;
  ticker: string;
  usd: number;
}

export interface ClaimableView {
  totalUsd: number;
  rows: ClaimRowView[];
  usdc: ClaimQuote;
  tokens: ClaimQuote;
}

export type ActivityKind =
  | "buy"
  | "sell"
  | "lp-add"
  | "lp-remove"
  | "claim-usdc"
  | "claim-tokens"
  | "faucet"
  | "dividend";

export interface ActivityItem {
  id: string;
  at: number;
  kind: ActivityKind;
  playerId?: PlayerId;
  ticker?: string;
  usdc: number;
  tokens?: number;
  detail: string;
}

export interface UserSession {
  id: UserId;
  method: SignInMethod;
  /** Display handle, e.g. "Google · k3x9qa". */
  label: string;
  address: string;
  country: string;
  createdAt: number;
}

export interface Portfolio {
  user: UserSession;
  usdc: number;
  positionsValue: number;
  lpValue: number;
  totalValue: number;
  /** Unrealised + realised P&L on positions. */
  pnl: number;
  realizedPnl: number;
  dividendsEarned: number;
  feesPaid: number;
  positions: PositionView[];
  lp: LpPositionView[];
  claimable: ClaimableView;
  history: ActivityItem[];
  points: ActivityPoints & { total: number };
}

export interface PlayerDetail extends PlayerSummary {
  competitions: string[];
  curve: {
    sold: number;
    raised: number;
    threshold: number;
    sMax: number;
    spot: number;
    launchPrice: number;
    bondPrice: number;
    poolOpenPrice: number;
  };
  pool: {
    usdc: number;
    tokens: number;
    depthUsd: number;
    totalShares: number;
    /** Share of LP owned by the locked protocol seed (0..1). */
    protocolShare: number;
    lpFeeRate: number;
    /** Annualised LP fee APR at demo volume (heavily overstated). */
    feeAprDemo: number;
  } | null;
  supply: {
    max: number;
    curveSold: number;
    poolSeed: number;
    minted: number;
    reserveLeft: number;
    circulating: number;
    holderTokens: number;
    inPool: number;
  };
  dividendsPaid: number;
  form: FormEntry[];
  impactLadder: ImpactRow[] | null;
  recentTrades: TradeRecord[];
  holders: HolderRow[];
  dividendHistory: { round: number; label: string; playerPayout: number; per10kTokens: number }[];
  holding: PositionView | null;
  lpPosition: LpPositionView | null;
}

export interface PricePoint {
  t: number;
  p: number;
}

export interface BoardRowView {
  playerId: PlayerId;
  ticker: string;
  name: string;
  rank: number;
  points: number;
  display: number;
  /** Payout if the round ended now (or final, once settled). */
  usd: number;
  mine: boolean;
}

export interface BoardView {
  key: string;
  kind: BoardKind;
  label: string;
  multiplier: number;
  weight: number;
  poolUsd: number;
  /** Top 5 (paid). */
  rows: BoardRowView[];
  /** Everyone else ranked on the board. */
  others: BoardRowView[];
}

export interface LiveScoreView {
  playerId: PlayerId;
  ticker: string;
  name: string;
  position: PositionCode;
  league: LeagueCode;
  club: string;
  bondedAtKickoff: boolean;
  /** Has a match this window and will (or did) get minutes. */
  playing: boolean;
  /** Kickoff slot label, e.g. "Sat 14:00". */
  slot: string | null;
  /** Match minute now (−1 before kickoff, 90 at full time). */
  matchMinute: number;
  minutes: number;
  points: number;
  display: number;
  goals: number;
  assists: number;
}

export interface MatchEventView {
  id: string;
  round: number;
  at: number;
  slot: string;
  minute: number;
  playerId: PlayerId | null;
  ticker: string | null;
  name: string | null;
  club: string;
  code: EventCode | "kickoff" | "fulltime";
  label: string;
  /** Points delta (coefficient applied). */
  points: number;
  /** Player is bonded at kickoff, so this counts for the boards. */
  ranked: boolean;
}

export interface MyRoundView {
  signedIn: boolean;
  snapshotTaken: boolean;
  /** Your players counted at kickoff (or that would count, while open). */
  players: {
    playerId: PlayerId;
    ticker: string;
    name: string;
    tokens: number;
    eligibleShare: number;
    playing: boolean;
    provisionalUsd: number;
  }[];
  totalTokens: number;
  provisionalUsd: number;
}

export interface RoundPoolView {
  vault: number;
  usd: number;
  bps: number;
  /** usd / vault, what the UI shows as "% of the vault". */
  effectiveRate: number;
  capped: boolean;
}

export interface RoundState {
  round: number;
  window: MatchWindow;
  phase: RoundPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  clockMode: ClockMode;
  /** 0..1 through the live window. */
  liveProgress: number;
  pool: RoundPoolView;
  /** Boards are a projection from form ratings while OPEN. */
  projection: boolean;
  scores: LiveScoreView[];
  boards: BoardView[];
  events: MatchEventView[];
  totals: { goals: number; assists: number; shotsOnTarget: number; saves: number; cards: number };
  my: MyRoundView;
}

export interface RoundResult {
  round: number;
  windowLabel: string;
  kind: "league" | "ucl";
  settledAt: number;
  pool: number;
  bps: number;
  effectiveRate: number;
  boards: BoardView[];
  myDividends: number;
  myRows: { playerId: PlayerId; ticker: string; usd: number }[];
}

export interface ProtocolStats {
  /** Controller TVL: bonded × 17,500 + vault (SQ-2). */
  tvl: number;
  vault: number;
  treasury: number;
  runwayRounds: number;
  vaultToTvl: number;
  roundPool: RoundPoolView & { capPerRound: number; matrixBps: number };
  bondedCount: number;
  launchingCount: number;
  scheduledCount: number;
  volume24h: number;
  totalPaidOut: number;
  roundsSettled: number;
  reserveLeftTotal: number;
  externalLpDepth: number;
  poolUsdcTotal: number;
  curveUsdcTotal: number;
  feesCollected: number;
}

export interface FeeLine {
  label: string;
  rate: number;
  usd: number;
  /** Where it goes. */
  to: string;
}

export interface QuoteError {
  code: string;
  message: string;
}

export interface Quote {
  ok: boolean;
  error?: QuoteError;
  side: "buy" | "sell";
  venue: "curve" | "pool";
  playerId: PlayerId;
  /** Buy: USDC spent (after any refund). Sell: gross USDC before tax. */
  usdc: number;
  tokens: number;
  avgPrice: number;
  spotBefore: number;
  spotAfter: number;
  priceImpact: number;
  fees: FeeLine[];
  totalFees: number;
  /** Sell: USDC received. */
  receive: number;
  refund: number;
  bonds: boolean;
  cap: CapUsage | null;
  holdAgeDays: number | null;
  warnings: string[];
}

export interface LiquidityQuote {
  ok: boolean;
  error?: QuoteError;
  mode: "pair" | "zap";
  usdc: number;
  tokens: number;
  sharesMinted: number;
  poolShareAfter: number;
  /** Zap only: fees paid on the swap half. */
  swapFees: number;
  leftoverUsdc: number;
  leftoverTokens: number;
  /** Tokens your new LP share represents (counted at kickoff). */
  lpTokens: number;
}

export interface TxResult {
  ok: true;
  id: string;
  summary: string;
  bonded?: PlayerId;
  tokens?: number;
  usdc?: number;
  refund?: number;
}

export interface ProtocolConfigView {
  bondThresholdUsdc: number;
  curveFeeRate: number;
  capTokensPerAccount: number;
  buyFeeRate: number;
  lpFeeRate: number;
  sellTaxMax: number;
  sellTaxMin: number;
  sellTaxDays: number;
  tokenBonus: number;
  launchPrice: number;
  bondPrice: number;
  poolOpenPrice: number;
  restrictedCountries: readonly string[];
  signInCountries: readonly string[];
  coefficients: Record<CompetitionCode, number>;
}

export type ProtocolEvent =
  | { type: "market"; playerIds: PlayerId[] }
  | { type: "trade"; trade: TradeRecord }
  | { type: "match"; events: MatchEventView[] }
  | { type: "phase"; round: number; phase: RoundPhase }
  | { type: "snapshot"; round: number; myTokens: number }
  | { type: "bonded"; playerId: PlayerId; mine: boolean; split: { pool: number; vault: number; treasury: number } }
  | { type: "launched"; playerIds: PlayerId[] }
  | { type: "settled"; round: number; pool: number; myDividends: number }
  | { type: "user" }
  | { type: "session" }
  | { type: "reset" };

export interface ProtocolClient {
  // reads
  getConfig(): Promise<ProtocolConfigView>;
  listPlayers(filter?: PlayerFilter): Promise<PlayerSummary[]>;
  getPlayer(id: PlayerId): Promise<PlayerDetail>;
  getPriceHistory(id: PlayerId, range: PriceRange): Promise<PricePoint[]>;
  getRound(): Promise<RoundState>;
  getRoundHistory(limit: number): Promise<RoundResult[]>;
  getPortfolio(user?: UserId): Promise<Portfolio | null>;
  getProtocolStats(): Promise<ProtocolStats>;
  getRecentTrades(id: PlayerId | null, limit: number): Promise<TradeRecord[]>;
  // quotes (pure, no side effects)
  quoteBuy(id: PlayerId, usdc: number): Quote;
  quoteSell(id: PlayerId, input: { usdc: number } | { tokens: number }): Quote;
  quoteLiquidity(id: PlayerId, usdc: number, mode: "pair" | "zap"): LiquidityQuote;
  // actions
  buy(id: PlayerId, usdc: number): Promise<TxResult>;
  sell(id: PlayerId, input: { usdc: number } | { tokens: number }): Promise<TxResult>;
  addLiquidity(id: PlayerId, usdc: number, mode: "pair" | "zap"): Promise<TxResult>;
  removeLiquidity(id: PlayerId, fraction?: number): Promise<TxResult>;
  claim(mode: ClaimMode): Promise<TxResult>;
  faucet(amount: number): Promise<TxResult>;
  // live
  subscribe(handler: (e: ProtocolEvent) => void): Unsubscribe;
}

/** Sign-in (Privy-style embedded wallet or Phantom later). Mocked in Step 0. */
export interface AuthClient {
  getSession(): Promise<UserSession | null>;
  signIn(input: { method: SignInMethod; country: string; acceptedTerms: boolean }): Promise<UserSession>;
  signOut(): Promise<void>;
}

export interface DemoSettings {
  clockMode: ClockMode;
  openSeconds: number;
  liveSeconds: number;
  freezeSeconds: number;
  ambientMarket: boolean;
  /** 0..1 chance that a request fails (to exercise error states). */
  failureRate: number;
  /** Extra latency on reads/actions in ms (to exercise loading states). */
  latencyMs: number;
  /** Days added to the hold-age clock (demo fast-forward). */
  timeOffsetDays: number;
}

/** Demo-only controls. Never part of the production client. */
export interface DemoControls {
  getDemoSettings(): DemoSettings;
  updateDemoSettings(patch: Partial<Omit<DemoSettings, "timeOffsetDays">>): void;
  fastForwardDays(days: number): void;
  skipPhase(): void;
  simulateLaunchDemand(id: PlayerId, targetProgress?: number): void;
  launchNextScheduled(): void;
  reset(): void;
}
