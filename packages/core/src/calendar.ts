import { PROTOCOL_CONFIG } from "./config";

/**
 * Matchday windows (ARCHITECTURE §4.6, §5.2). League weekend Fri→Mon, Champions League midweek Tue→Thu,
 * one round per window. Round 1 = Fri 30 Oct 2026, the prototype's first window.
 * Kickoff and whistle times are representative UTC slots, not real fixtures (SPEC-QUESTION: SQ-33).
 */

export type WindowKind = "league" | "ucl";

export type RoundPhase = "open" | "live" | "ended";

export interface MatchWindow {
  round: number;
  kind: WindowKind;
  /** "League weekend" | "Champions League midweek" */
  title: string;
  firstKickoff: number;
  lastWhistle: number;
  /** lastWhistle + 12h: data final. */
  freezeAt: number;
  /** Day labels in the window, e.g. ["Fri 30 Oct", …]. */
  days: string[];
  fromLabel: string;
  toLabel: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Fri 30 Oct 2026 00:00 UTC. */
export const SEASON_WEEK0 = Date.UTC(2026, 9, 30);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Deterministic "Fri 30 Oct" label in UTC (no locale APIs, so server and client agree). */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function windowForRound(round: number): MatchWindow {
  const r = Math.max(1, Math.floor(round));
  const week = Math.floor((r - 1) / 2);
  const kind: WindowKind = r % 2 === 1 ? "league" : "ucl";
  const friday = SEASON_WEEK0 + week * 7 * DAY;
  let first: number;
  let last: number;
  let dayCount: number;
  if (kind === "league") {
    first = friday + 19 * HOUR; // Fri 19:00
    last = friday + 3 * DAY + 21.5 * HOUR; // Mon 21:30
    dayCount = 4;
  } else {
    const tuesday = friday + 4 * DAY;
    first = tuesday + 17.75 * HOUR; // Tue 17:45
    last = tuesday + 2 * DAY + 21 * HOUR; // Thu 21:00
    dayCount = 3;
  }
  const startDay = kind === "league" ? friday : friday + 4 * DAY;
  const days = Array.from({ length: dayCount }, (_, i) => dayLabel(startDay + i * DAY));
  return {
    round: r,
    kind,
    title: kind === "league" ? "League weekend" : "Champions League midweek",
    firstKickoff: first,
    lastWhistle: last,
    freezeAt: last + PROTOCOL_CONFIG.calendar.freezeHours * HOUR,
    days,
    fromLabel: days[0]!,
    toLabel: days[days.length - 1]!,
  };
}

export interface CalendarPosition {
  round: number;
  phase: RoundPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  window: MatchWindow;
}

/** Real-calendar phase at `now`: open until first kickoff, live until last whistle, ended until freeze. */
export function calendarPositionAt(now: number): CalendarPosition {
  // Rounds alternate roughly every 3.5 days; start from an estimate and walk.
  let round = Math.max(1, Math.floor((now - SEASON_WEEK0) / (3.5 * DAY)));
  while (round > 1 && windowForRound(round - 1).freezeAt > now) round--;
  while (windowForRound(round).freezeAt <= now) round++;
  const w = windowForRound(round);
  const prevFreeze = round > 1 ? windowForRound(round - 1).freezeAt : w.firstKickoff - 3 * DAY;
  if (now < w.firstKickoff) {
    return { round, phase: "open", phaseStartedAt: prevFreeze, phaseEndsAt: w.firstKickoff, window: w };
  }
  if (now < w.lastWhistle) {
    return { round, phase: "live", phaseStartedAt: w.firstKickoff, phaseEndsAt: w.lastWhistle, window: w };
  }
  return { round, phase: "ended", phaseStartedAt: w.lastWhistle, phaseEndsAt: w.freezeAt, window: w };
}

/** Launch slots: weekdays at 14:00 and 20:00 UTC, starting at or after `from`. */
export function launchSlots(from: number, count: number): number[] {
  const out: number[] = [];
  const hours = PROTOCOL_CONFIG.launch.slotHoursUtc;
  let day = Math.floor(from / DAY) * DAY;
  while (out.length < count) {
    const dow = new Date(day).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      for (const h of hours) {
        const t = day + h * HOUR;
        if (t >= from && out.length < count) out.push(t);
      }
    }
    day += DAY;
  }
  return out;
}
