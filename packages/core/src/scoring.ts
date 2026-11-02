import {
  EVENT_CODES,
  EVENT_MATRIX,
  PROTOCOL_CONFIG,
  positionIndex,
  type EventCode,
  type PositionCode,
} from "./config";

const S = PROTOCOL_CONFIG.scoring;

/** Raw match stats for one player in one window. `cleanSheet` is 1 if no goal was conceded while on the pitch. */
export type StatLine = { minutes: number } & Partial<Record<EventCode, number>>;

export function emptyStatLine(): StatLine {
  return { minutes: 0 };
}

export function eventValue(code: EventCode, pos: PositionCode): number {
  return EVENT_MATRIX[code].points[positionIndex(pos)] ?? 0;
}

export interface PointsBreakdownRow {
  code: EventCode | "minutes";
  label: string;
  count: number;
  points: number;
}

/**
 * Points before the competition coefficient. Clean sheet scales with minutes/90, capped at 1.
 * SPEC-QUESTION: SQ-34 (extra time: spec says "× minutes/90" without a cap).
 */
export function breakdown(stat: StatLine, pos: PositionCode): PointsBreakdownRow[] {
  const rows: PointsBreakdownRow[] = [];
  for (const code of EVENT_CODES) {
    const count = stat[code] ?? 0;
    if (!count) continue;
    const factor = code === "cleanSheet" ? Math.min(1, stat.minutes / 90) : 1;
    rows.push({ code, label: EVENT_MATRIX[code].label, count, points: count * factor * eventValue(code, pos) });
  }
  if (stat.minutes > 0) {
    rows.push({ code: "minutes", label: "Minutes", count: stat.minutes, points: stat.minutes * S.minutePoints });
  }
  return rows;
}

export function basePoints(stat: StatLine, pos: PositionCode): number {
  let p = 0;
  for (const r of breakdown(stat, pos)) p += r.points;
  return p;
}

/** Ranking points P = coefficient × base points (prototype applies the coefficient to minutes too). */
export function scorePoints(stat: StatLine, pos: PositionCode, coefficient: number): number {
  return basePoints(stat, pos) * coefficient;
}

/**
 * UI-only 0–10 score: 10·P / (P + 6). P = 6 → 5.0.
 * Clamped to 0 for P ≤ 0 because the formula breaks for negative P (SPEC-QUESTION: SQ-20).
 */
export function displayScore(points: number): number {
  if (!(points > 0)) return 0;
  return (10 * points) / (points + S.displayK);
}

/** A player "played" if they were on the pitch at all (SPEC-QUESTION: SQ-20; the prototype used score > 0). */
export function hasPlayed(stat: StatLine | undefined): boolean {
  return !!stat && stat.minutes > 0;
}

export function addStats(a: StatLine, b: Partial<StatLine>): StatLine {
  const out: StatLine = { ...a, minutes: a.minutes + (b.minutes ?? 0) };
  for (const code of EVENT_CODES) {
    const v = b[code];
    if (v) out[code] = (out[code] ?? 0) + v;
  }
  return out;
}
