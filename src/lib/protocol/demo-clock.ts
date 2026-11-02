import { calendarPositionAt, type RoundPhase } from "@score/core";
import type { ClockMode } from "./types";

/**
 * Round clock. Demo mode compresses a window into OPEN → LIVE → ENDED (freeze) with configurable
 * seconds (prototype: 40s / 50s). Calendar mode follows the real fixture calendar.
 * Phases are timestamp-driven: after a reload or tab sleep the clock steps through the boundaries it
 * missed, so the round still snapshots, plays out and settles in order. If it fell behind by more than
 * a whole cycle, it restarts the current phase instead of replaying a backlog of rounds.
 */
export interface ClockPhase {
  round: number;
  phase: RoundPhase;
  startedAt: number;
  endsAt: number;
}

export interface ClockDurations {
  openSeconds: number;
  liveSeconds: number;
  freezeSeconds: number;
}

const MAX_CALENDAR_STEPS = 4;

export class DemoClock {
  constructor(
    public mode: ClockMode,
    public durations: ClockDurations
  ) {}

  private seconds(phase: RoundPhase): number {
    const d = this.durations;
    return phase === "open" ? d.openSeconds : phase === "live" ? d.liveSeconds : d.freezeSeconds;
  }

  /** Starting phase for a fresh world. */
  initial(now: number, round = 1): ClockPhase {
    if (this.mode === "calendar") {
      const c = calendarPositionAt(now);
      return { round: c.round, phase: c.phase, startedAt: c.phaseStartedAt, endsAt: c.phaseEndsAt };
    }
    return { round, phase: "open", startedAt: now, endsAt: now + this.seconds("open") * 1000 };
  }

  /** The phase that follows `cur`. */
  next(cur: ClockPhase): ClockPhase {
    if (this.mode === "calendar") {
      const c = calendarPositionAt(cur.endsAt + 1);
      return { round: c.round, phase: c.phase, startedAt: c.phaseStartedAt, endsAt: c.phaseEndsAt };
    }
    const start = cur.endsAt;
    if (cur.phase === "open") return { round: cur.round, phase: "live", startedAt: start, endsAt: start + this.seconds("live") * 1000 };
    if (cur.phase === "live") return { round: cur.round, phase: "ended", startedAt: start, endsAt: start + this.seconds("ended") * 1000 };
    return { round: cur.round + 1, phase: "open", startedAt: start, endsAt: start + this.seconds("open") * 1000 };
  }

  /** Restart `cur`'s phase from `now` (used when far behind or when a phase is skipped). */
  restart(cur: ClockPhase, now: number): ClockPhase {
    if (this.mode === "calendar") return this.initial(now);
    return { ...cur, startedAt: now, endsAt: now + this.seconds(cur.phase) * 1000 };
  }

  /**
   * Phases to step through so the clock reaches `now`, in order.
   * `restarted` is set when the clock gave up replaying and jumped instead.
   */
  catchUp(cur: ClockPhase, now: number): { steps: ClockPhase[]; restarted: ClockPhase | null } {
    if (now < cur.endsAt) return { steps: [], restarted: null };
    if (this.mode === "demo") {
      const cycle = (this.durations.openSeconds + this.durations.liveSeconds + this.durations.freezeSeconds) * 1000;
      if (now - cur.endsAt > cycle) return { steps: [], restarted: this.restart(cur, now) };
    }
    const steps: ClockPhase[] = [];
    let c = cur;
    while (now >= c.endsAt) {
      c = this.next(c);
      steps.push(c);
      if (this.mode === "calendar" && steps.length > MAX_CALENDAR_STEPS) {
        return { steps: [], restarted: this.initial(now) };
      }
    }
    return { steps, restarted: null };
  }
}
