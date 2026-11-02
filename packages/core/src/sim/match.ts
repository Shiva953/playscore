import type { EventCode, LeagueCode, PositionCode } from "../config";
import type { WindowKind } from "../calendar";
import type { StatLine } from "../scoring";
import { between, createRng, intBetween, poisson, type Rng } from "./rng";

/**
 * Demo match simulator. Each club plays one match per window. Players accumulate a full stat line
 * (every row of the event matrix that can be simulated), so `scoring.ts` computes the points exactly
 * as it will from real data. The prototype's 5-event table was a demo shortcut (ARCHITECTURE §4.7).
 */

export type SimMode = "demo" | "calendar";

export interface SimPlayerInput {
  id: string;
  club: string;
  position: PositionCode;
  league: LeagueCode;
  avgScore: number;
  inUcl: boolean;
}

interface Slot {
  label: string;
  /** Hours after the window's first kickoff. */
  offsetH: number;
}

const LEAGUE_SLOTS: Slot[] = [
  { label: "Fri 19:00", offsetH: 0 },
  { label: "Sat 11:30", offsetH: 16.5 },
  { label: "Sat 14:00", offsetH: 19 },
  { label: "Sat 16:30", offsetH: 21.5 },
  { label: "Sat 19:00", offsetH: 24 },
  { label: "Sun 13:00", offsetH: 42 },
  { label: "Sun 15:30", offsetH: 44.5 },
  { label: "Sun 18:00", offsetH: 47 },
  { label: "Mon 19:30", offsetH: 72.5 },
];
const LEAGUE_WINDOW_H = 74.5;

const UCL_SLOTS: Slot[] = [
  { label: "Tue 17:45", offsetH: 0 },
  { label: "Tue 20:00", offsetH: 2.25 },
  { label: "Wed 17:45", offsetH: 24 },
  { label: "Wed 20:00", offsetH: 26.25 },
  { label: "Thu 18:45", offsetH: 49 },
];
const UCL_WINDOW_H = 51.25;

/** In demo mode one match lasts this share of the LIVE phase (50s → 15s per match). */
const DEMO_MATCH_SPAN = 0.3;
const MATCH_HOURS = 1.9;

export interface ClubMatch {
  club: string;
  label: string;
  /** Kickoff as a fraction of the live window (0..1). */
  kickoff: number;
  /** Minutes at which this club concedes. */
  conceded: number[];
}

export interface PlayerPlan {
  playerId: string;
  club: string;
  /** Minute the player comes on (0 = starter). */
  on: number;
  /** Minute the player goes off (90 = full match). */
  off: number;
}

export interface MatchPlan {
  round: number;
  kind: WindowKind;
  mode: SimMode;
  /** Fraction of the live window one 90-minute match takes. */
  span: number;
  clubs: Record<string, ClubMatch>;
  /** Players who will play. Anyone absent doesn't play (0 minutes → not ranked). */
  players: Record<string, PlayerPlan>;
}

export function planRound(args: {
  round: number;
  kind: WindowKind;
  mode: SimMode;
  players: readonly SimPlayerInput[];
  seed: number;
}): MatchPlan {
  const rng = createRng(args.seed);
  const slots = args.kind === "league" ? LEAGUE_SLOTS : UCL_SLOTS;
  const windowH = args.kind === "league" ? LEAGUE_WINDOW_H : UCL_WINDOW_H;
  const span = args.mode === "demo" ? DEMO_MATCH_SPAN : MATCH_HOURS / windowH;
  const eligible = args.players.filter((p) => args.kind === "league" || p.inUcl);
  const clubNames = [...new Set(eligible.map((p) => p.club))].sort();
  // Shuffle so slot assignment varies by round; the first club always takes the opening slot.
  for (let i = clubNames.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [clubNames[i], clubNames[j]] = [clubNames[j]!, clubNames[i]!];
  }
  const clubs: Record<string, ClubMatch> = {};
  clubNames.forEach((club, i) => {
    const slotIndex = i === 0 ? 0 : intBetween(rng, 0, slots.length - 1);
    const slot = slots[slotIndex]!;
    const kickoff =
      args.mode === "demo" ? (slotIndex / (slots.length - 1)) * (1 - span) : slot.offsetH / windowH;
    const n = poisson(rng, 1.05);
    const conceded = Array.from({ length: n }, () => intBetween(rng, 1, 90)).sort((a, b) => a - b);
    clubs[club] = { club, label: slot.label, kickoff, conceded };
  });
  const players: Record<string, PlayerPlan> = {};
  for (const p of eligible) {
    const starts = rng.next() < (p.avgScore >= 7.5 ? 0.9 : 0.75);
    if (starts) {
      const off = rng.next() < 0.3 ? intBetween(rng, 60, 88) : 90;
      players[p.id] = { playerId: p.id, club: p.club, on: 0, off };
    } else if (rng.next() < 0.65) {
      players[p.id] = { playerId: p.id, club: p.club, on: intBetween(rng, 55, 80), off: 90 };
    }
  }
  return { round: args.round, kind: args.kind, mode: args.mode, span, clubs, players };
}

/** Expected events per 90 minutes by position: [FWD, MID, DEF, GK]. */
const RATES: Partial<Record<EventCode, [number, number, number, number]>> = {
  goal: [0.45, 0.14, 0.06, 0],
  assist: [0.22, 0.2, 0.08, 0.01],
  shotOnTarget: [1.3, 0.6, 0.25, 0],
  keyPass: [1.4, 1.8, 0.6, 0.05],
  dribble: [1.6, 1.2, 0.5, 0],
  progressive: [6, 9, 6.5, 1],
  passCompleted: [22, 58, 55, 25],
  passFailed: [6, 7, 6, 8],
  tackleWon: [0.5, 1.6, 1.5, 0],
  interception: [0.3, 1.0, 1.3, 0.1],
  clearance: [0.4, 1.0, 4, 0.5],
  recovery: [3, 6, 5, 1],
  aerialWon: [1.2, 1.0, 2.5, 0.3],
  save: [0, 0, 0, 2.8],
  penaltySaved: [0, 0, 0, 0.02],
  penaltyWon: [0.06, 0.03, 0.01, 0],
  penaltyConceded: [0.005, 0.02, 0.04, 0.01],
  penaltyMissed: [0.015, 0.005, 0, 0],
  ownGoal: [0.002, 0.004, 0.01, 0.005],
  errorToGoal: [0, 0.01, 0.02, 0.02],
  errorToShot: [0.02, 0.05, 0.08, 0.04],
  yellow: [0.12, 0.2, 0.18, 0.03],
  red: [0.005, 0.008, 0.01, 0.002],
  foul: [1.0, 1.2, 1.0, 0.05],
  dispossessed: [1.6, 1.0, 0.5, 0],
  offside: [0.6, 0.05, 0.02, 0],
};

/** Events scaled by form; everything else by √form or not at all. */
const ATTACKING = new Set<EventCode>(["goal", "assist", "shotOnTarget", "keyPass", "dribble", "penaltyWon"]);
const DEFENSIVE = new Set<EventCode>(["tackleWon", "interception", "clearance", "recovery", "aerialWon", "save", "progressive"]);

/** Events worth a line in the live feed. */
export const NOTABLE_EVENTS = new Set<EventCode>([
  "goal",
  "assist",
  "shotOnTarget",
  "save",
  "penaltySaved",
  "penaltyWon",
  "penaltyMissed",
  "ownGoal",
  "errorToGoal",
  "yellow",
  "red",
  "cleanSheet",
]);

const POS_INDEX: Record<PositionCode, number> = { FWD: 0, MID: 1, DEF: 2, GK: 3 };

/** Prototype form factor f = 0.6 + (avg − 6) / 2.5, clamped. */
export function formFactor(avgScore: number): number {
  return Math.min(2, Math.max(0.5, 0.6 + (avgScore - 6) / 2.5));
}

export interface SimState {
  rngState: number;
  /** Last processed match minute per club (−1 = not kicked off). */
  clubMinute: Record<string, number>;
  stats: Record<string, StatLine>;
}

export interface SimEvent {
  playerId: string | null;
  club: string;
  code: EventCode | "kickoff" | "fulltime";
  minute: number;
  /** Club kickoff slot label, e.g. "Sat 14:00". */
  slot: string;
}

export function initialSimState(plan: MatchPlan, seed: number): SimState {
  const clubMinute: Record<string, number> = {};
  for (const c of Object.keys(plan.clubs)) clubMinute[c] = -1;
  return { rngState: seed >>> 0, clubMinute, stats: {} };
}

function clubMinuteAt(match: ClubMatch, span: number, progress: number): number {
  if (progress < match.kickoff) return -1;
  return Math.min(90, Math.floor(((progress - match.kickoff) / span) * 90));
}

function addCount(stat: StatLine, code: EventCode, n: number): void {
  if (n) stat[code] = (stat[code] ?? 0) + n;
}

/**
 * Advance every match to `progress` (0..1 of the live window). Pure: returns new state + events.
 * Calling it twice with the same progress is a no-op.
 */
export function advanceRound(
  plan: MatchPlan,
  prev: SimState,
  progress: number,
  players: Readonly<Record<string, SimPlayerInput>>
): { state: SimState; events: SimEvent[] } {
  const rng: Rng = createRng(prev.rngState);
  const state: SimState = {
    rngState: prev.rngState,
    clubMinute: { ...prev.clubMinute },
    stats: { ...prev.stats },
  };
  const events: SimEvent[] = [];
  const p = Math.min(1, Math.max(0, progress));

  for (const match of Object.values(plan.clubs)) {
    const from = state.clubMinute[match.club] ?? -1;
    const to = clubMinuteAt(match, plan.span, p);
    if (to <= from) continue;
    if (from < 0) events.push({ playerId: null, club: match.club, code: "kickoff", minute: 0, slot: match.label });
    const a0 = Math.max(0, from);

    for (const pp of Object.values(plan.players)) {
      if (pp.club !== match.club) continue;
      const info = players[pp.playerId];
      if (!info) continue;
      const a = Math.max(a0, pp.on);
      const b = Math.min(to, pp.off);
      if (b <= a) continue;
      const delta = b - a;
      const stat: StatLine = { ...(state.stats[pp.playerId] ?? { minutes: 0 }) };
      stat.minutes += delta;
      const f = formFactor(info.avgScore);
      const pi = POS_INDEX[info.position];
      for (const [codeKey, rates] of Object.entries(RATES)) {
        const code = codeKey as EventCode;
        const base = rates![pi] ?? 0;
        if (!base) continue;
        const scale = ATTACKING.has(code) ? f : DEFENSIVE.has(code) ? Math.sqrt(f) : 1;
        const n = poisson(rng, (base * delta * scale) / 90);
        if (!n) continue;
        addCount(stat, code, n);
        if (code === "keyPass") {
          let xg = 0;
          for (let i = 0; i < n; i++) xg += between(rng, 0.03, 0.35);
          stat.xgCreated = (stat.xgCreated ?? 0) + xg;
        }
        if (NOTABLE_EVENTS.has(code)) {
          for (let i = 0; i < n; i++) {
            events.push({
              playerId: pp.playerId,
              club: match.club,
              code,
              minute: Math.min(90, a + 1 + Math.floor(rng.next() * delta)),
              slot: match.label,
            });
          }
        }
      }
      const concededNow = match.conceded.filter((m) => m > a && m <= b).length;
      addCount(stat, "goalConceded", concededNow);
      // Participation complete: clean sheet if nothing conceded while on the pitch.
      if (b >= pp.off && a < pp.off) {
        const any = match.conceded.some((m) => m > pp.on && m <= pp.off);
        if (!any && (info.position !== "FWD")) {
          stat.cleanSheet = 1;
          events.push({ playerId: pp.playerId, club: match.club, code: "cleanSheet", minute: pp.off, slot: match.label });
        }
      }
      state.stats[pp.playerId] = stat;
    }
    if (to >= 90 && from < 90) events.push({ playerId: null, club: match.club, code: "fulltime", minute: 90, slot: match.label });
    state.clubMinute[match.club] = to;
  }
  events.sort((x, y) => x.minute - y.minute);
  return { state: { ...state, rngState: rng.state }, events };
}

/** Club match minute at `progress`, for "67'" labels (−1 before kickoff). */
export function matchMinute(plan: MatchPlan, club: string, progress: number): number {
  const m = plan.clubs[club];
  return m ? clubMinuteAt(m, plan.span, progress) : -1;
}
