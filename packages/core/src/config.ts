/**
 * Every protocol parameter in one typed object (ARCHITECTURE §4).
 * UI and mock code must read from here, never hard-code numbers.
 */

export const POSITIONS = ["FWD", "MID", "DEF", "GK"] as const;
export type PositionCode = (typeof POSITIONS)[number];

export const LEAGUES = ["PL", "LAL", "BUN", "SA", "L1", "MLS", "SPL"] as const;
export type LeagueCode = (typeof LEAGUES)[number];

export type CompetitionCode = LeagueCode | "UCL";

export const LEAGUE_NAMES: Record<LeagueCode, string> = {
  PL: "Premier League",
  LAL: "La Liga",
  BUN: "Bundesliga",
  SA: "Serie A",
  L1: "Ligue 1",
  MLS: "MLS",
  SPL: "Saudi Pro League",
};

export const COMPETITION_NAMES: Record<CompetitionCode, string> = {
  ...LEAGUE_NAMES,
  UCL: "Champions League",
};

/** Competition coefficients (ARCHITECTURE §4.7). MLS and SPL are provisional. */
export const COEFFICIENTS: Record<CompetitionCode, number> = {
  UCL: 1.05,
  PL: 1.0,
  LAL: 0.97,
  BUN: 0.93,
  SA: 0.93,
  L1: 0.88,
  MLS: 0.85,
  SPL: 0.85,
};

export const PROVISIONAL_COEFFICIENTS: readonly CompetitionCode[] = ["MLS", "SPL"];

/** Points per event by position (ARCHITECTURE §4.7). Order: FWD, MID, DEF, GK. */
export const EVENT_MATRIX = {
  goal: { label: "Goal", points: [6, 7, 9, 12] },
  assist: { label: "Assist", points: [4, 4.5, 5.5, 6] },
  xgCreated: { label: "xG created (per 1.0)", points: [1.5, 1.5, 1.5, 1.5] },
  shotOnTarget: { label: "Shot on target", points: [0.5, 0.7, 1, 1.5] },
  keyPass: { label: "Key pass", points: [0.5, 0.7, 1, 1.2] },
  dribble: { label: "Successful dribble", points: [0.4, 0.4, 0.6, 0.6] },
  progressive: { label: "Progressive pass or carry", points: [0.08, 0.1, 0.12, 0.12] },
  passCompleted: { label: "Pass completed", points: [0.02, 0.02, 0.02, 0.02] },
  passFailed: { label: "Pass failed", points: [-0.03, -0.03, -0.03, -0.03] },
  tackleWon: { label: "Tackle won", points: [0.8, 0.5, 0.35, 0.5] },
  interception: { label: "Interception", points: [0.3, 0.4, 0.4, 0.3] },
  clearance: { label: "Clearance", points: [0.1, 0.15, 0.2, 0.2] },
  recovery: { label: "Ball recovery", points: [0.1, 0.1, 0.1, 0.1] },
  aerialWon: { label: "Aerial duel won", points: [0.2, 0.2, 0.3, 0.2] },
  save: { label: "Save", points: [0, 0, 0, 0.8] },
  penaltySaved: { label: "Penalty saved", points: [0, 0, 0, 4] },
  cleanSheet: { label: "Clean sheet (× minutes/90)", points: [0, 1, 3, 4] },
  goalConceded: { label: "Goal conceded on pitch", points: [0, -0.1, -0.6, -0.9] },
  penaltyWon: { label: "Penalty won", points: [1, 1, 1, 1] },
  penaltyConceded: { label: "Penalty conceded", points: [-1, -1.5, -1.8, -2] },
  penaltyMissed: { label: "Penalty missed", points: [-3, -3, -3, -3] },
  ownGoal: { label: "Own goal", points: [-4, -4, -4, -4] },
  errorToGoal: { label: "Error leading to goal", points: [-2, -2.5, -3.5, -4] },
  errorToShot: { label: "Error leading to shot", points: [-1, -1, -1, -1] },
  yellow: { label: "Yellow card", points: [-0.8, -0.8, -0.8, -0.8] },
  red: { label: "Red card", points: [-3, -3, -3, -3] },
  foul: { label: "Foul committed", points: [-0.2, -0.15, -0.1, -0.2] },
  dispossessed: { label: "Dispossessed", points: [-0.2, -0.2, -0.2, -0.2] },
  offside: { label: "Offside", points: [-0.1, -0.1, -0.1, -0.1] },
} as const satisfies Record<string, { label: string; points: readonly [number, number, number, number] }>;

export type EventCode = keyof typeof EVENT_MATRIX;
export const EVENT_CODES = Object.keys(EVENT_MATRIX) as EventCode[];

/** Round-pool matrix in bps. Rows: runway buckets; columns: vault/TVL buckets (ARCHITECTURE §4.9). */
export const CONTROLLER_MATRIX_BPS: readonly (readonly number[])[] = [
  [25, 40, 50, 60],
  [50, 75, 90, 110],
  [75, 110, 135, 160],
  [100, 140, 170, 200],
  [120, 160, 190, 220],
];

export const RESTRICTED_COUNTRIES = [
  "United States",
  "United Kingdom",
  "Netherlands",
  "France",
  "Belgium",
  "Australia",
  "Singapore",
  "Canada (Ontario)",
  "China",
  "Russia",
  "Iran",
  "North Korea",
  "Syria",
  "Cuba",
] as const;

/** Country list offered at sign-in (prototype `CTRY`): allowed first, then the restricted list. */
export const SIGN_IN_COUNTRIES = [
  "Germany",
  "Spain",
  "Italy",
  "Portugal",
  "Switzerland",
  "Ireland",
  "Brazil",
  "Japan",
  "United Arab Emirates",
  ...RESTRICTED_COUNTRIES,
] as const;

export const PROTOCOL_CONFIG = {
  supply: {
    maxSupply: 10_000_000,
    float: 8_000_000,
    poolSeedTokens: 1_600_000,
    reserve: 2_000_000,
    /** Up to 25% of the reserve may fund airdrops/prizes. */
    prizeReserveShare: 0.25,
  },
  curve: {
    /** R(S) = linear·S + S³ / cubicDivisor */
    linear: 0.00039,
    cubicDivisor: 1.1649e16,
    /** P(S) = linear + S² / priceDivisor (= 3/cubicDivisor inverted) */
    priceDivisor: 3.883e15,
    bondThresholdUsdc: 25_000,
    /** Flat fee on curve buys and sells. */
    feeRate: 0.0125,
    capTokensPerPurchase: 240_000,
    capTokensPerAccount: 240_000,
    bisection: { lo: 0, hi: 8e6, iterations: 60 },
  },
  bond: {
    poolSeedShare: 0.7,
    vaultShare: 0.2,
    treasuryShare: 0.1,
  },
  pool: {
    /** Post-bond buy fee (5 bps) → treasury. */
    buyFeeRate: 0.0005,
    /** Proposed LP swap fee kept in the pool (ARCHITECTURE §4.5). SPEC-QUESTION: SQ-22 */
    lpFeeRate: 0.0025,
  },
  sellTax: {
    max: 0.05,
    min: 0.005,
    decayDays: 90,
  },
  feeRouting: {
    sellSide: { vault: 0.9, treasury: 0.1 },
    buySide: { vault: 0, treasury: 1 },
  },
  scoring: {
    minutePoints: 0.012,
    /** Display score = 10·P / (P + displayK). */
    displayK: 6,
  },
  boards: {
    payoutShares: [0.35, 0.25, 0.2, 0.12, 0.08] as readonly number[],
    maxRanked: 5,
    positionMultiplier: 1,
    uclMultiplier: 1.05,
  },
  controller: {
    matrixBps: CONTROLLER_MATRIX_BPS,
    runwayEdges: [20, 40, 80, 160] as readonly number[],
    ratioEdgesBps: [500, 1500, 3000] as readonly number[],
    defaultBps: 100,
    stepClamp: 0.1,
    minBps: 20,
    maxBps: 250,
    annualTvlCap: 0.12,
    /** SPEC-QUESTION: SQ-16 (≈50–55 windows a season, not 38). */
    roundsPerYear: 38,
    payHistoryLength: 8,
    /** Prototype TVL approximation: bonded players × this + vault. SPEC-QUESTION: SQ-2 */
    tvlPerBondedPlayer: 17_500,
  },
  claims: {
    tokenBonus: 0.1,
  },
  launch: {
    slotHoursUtc: [14, 20] as readonly number[],
    targetPlayers: 200,
    postTargetPerWeek: 1,
  },
  calendar: {
    freezeHours: 12,
  },
  compliance: {
    minAge: 18,
  },
} as const;

export type ProtocolConfig = typeof PROTOCOL_CONFIG;

/** Demo defaults (prototype values). Not protocol parameters. */
export const DEMO_DEFAULTS = {
  openSeconds: 40,
  liveSeconds: 50,
  freezeSeconds: 5,
  initialVault: 60_000,
  faucetUsdc: 1_000,
  bondedAtStart: 6,
  launchingAtStart: 4,
} as const;

export function positionIndex(pos: PositionCode): number {
  return POSITIONS.indexOf(pos);
}
