"use client";

import { Countdown } from "@/components/common/bits";
import { StripSkeleton } from "@/components/common/skeletons";
import { formatUsd } from "@/lib/format";
import type { RoundState } from "@/lib/protocol/types";
import { useNow, useRound } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/**
 * The signature element: the matchday as one line, from the kickoff snapshot through live play
 * to the data freeze, with every club's kickoff on it and "now" moving along.
 * Zones are drawn at fixed proportions (the real "before kickoff" period can be days long).
 */
const ZONES = { open: 0.22, live: 0.64, ended: 0.14 } as const;

type StripRound = Pick<RoundState, "round" | "phase" | "phaseStartedAt" | "phaseEndsAt" | "window" | "fixtures" | "pool" | "liveProgress">;

function nowPosition(r: StripRound, now: number): number {
  const span = r.phaseEndsAt - r.phaseStartedAt;
  const f = span > 0 && now > 0 ? Math.min(1, Math.max(0, (now - r.phaseStartedAt) / span)) : 0;
  if (r.phase === "open") return f * ZONES.open;
  if (r.phase === "live") return ZONES.open + Math.max(f, r.liveProgress) * ZONES.live;
  return ZONES.open + ZONES.live + f * ZONES.ended;
}

function phaseLine(r: StripRound) {
  if (r.phase === "open") {
    return (
      <>
        Snapshot at first kickoff in <Countdown to={r.phaseEndsAt} className="text-brand" />
      </>
    );
  }
  if (r.phase === "live") {
    return (
      <>
        <span className="text-brand">Live</span> · last whistle in <Countdown to={r.phaseEndsAt} className="text-ink" />
      </>
    );
  }
  return (
    <>
      Full time · data final in <Countdown to={r.phaseEndsAt} className="text-ink" />
    </>
  );
}

export function MatchdayStrip({ round: r, showPool = true, className }: { round: StripRound; showPool?: boolean; className?: string }) {
  const now = useNow();
  const pos = nowPosition(r, now);
  const liveStart = ZONES.open;
  const liveEnd = ZONES.open + ZONES.live;
  const firstSlot = r.fixtures[0]?.slot ?? r.window.fromLabel;
  return (
    <div className={cn("@container flex flex-col gap-3", className)} data-testid="matchday-strip">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-soft">{phaseLine(r)}</p>
        {showPool ? (
          <p className="num text-sm text-soft">
            Round pool <span className={r.pool.usd >= 0.5 ? "text-brand" : "text-ink"}>{formatUsd(r.pool.usd, { decimals: 0 })}</span>
          </p>
        ) : null}
      </div>
      <div className="relative h-10" role="img" aria-label={`Matchday ${r.round}: ${r.phase === "open" ? "before kickoff" : r.phase === "live" ? "live" : "full time, data freezing"}`}>
        {/* track */}
        <div className="absolute inset-x-0 top-4 h-1 rounded-full bg-raised" />
        {/* elapsed, in gold: quieter before kickoff and while freezing, full while the matches are live */}
        <div className="absolute top-4 left-0 h-1 rounded-full bg-brand/55" style={{ width: `${Math.min(pos, liveStart) * 100}%` }} />
        {pos > liveStart ? (
          <div className="absolute top-4 h-1 bg-brand" style={{ left: `${liveStart * 100}%`, width: `${(Math.min(pos, liveEnd) - liveStart) * 100}%` }} />
        ) : null}
        {pos > liveEnd ? (
          <div className="absolute top-4 h-1 rounded-r-full bg-brand/55" style={{ left: `${liveEnd * 100}%`, width: `${(pos - liveEnd) * 100}%` }} />
        ) : null}
        {/* kickoffs */}
        {r.fixtures.map((f) => (
          <span
            key={f.club}
            title={`${f.club} · ${f.slot}`}
            className="absolute top-3 h-3 w-px bg-faint"
            style={{ left: `${(liveStart + f.kickoff * ZONES.live) * 100}%` }}
          />
        ))}
        {/* snapshot, whistle and freeze marks */}
        <span className="absolute top-2 h-5 w-0.5 rounded-full bg-ink" style={{ left: `${liveStart * 100}%` }} />
        <span className="absolute top-2 h-5 w-0.5 rounded-full bg-faint" style={{ left: `${liveEnd * 100}%` }} />
        {/* now */}
        <span
          className="absolute top-[11px] size-[14px] -translate-x-1/2 rounded-full border-2 border-ground bg-brand motion-safe:transition-[left] motion-safe:duration-1000 motion-safe:ease-linear"
          style={{ left: `${pos * 100}%` }}
          aria-hidden="true"
        />
      </div>
      {/* Labels sit in columns sized like the zones, so they can never run into each other. */}
      <div className="-mt-2 grid text-xs text-faint" style={{ gridTemplateColumns: `minmax(0,${ZONES.open * 100}fr) minmax(0,${ZONES.live * 100}fr) minmax(0,${ZONES.ended * 100}fr)` }}>
        <span className="hidden min-w-0 truncate pr-2 @md:inline">Trading open</span>
        <span className="col-start-2 flex min-w-0 justify-between gap-3">
          <span className="truncate text-ink">Snapshot · {firstSlot}</span>
          <span className="hidden truncate @lg:inline">
            {r.window.fromLabel} → {r.window.toLabel}
          </span>
        </span>
        <span className="truncate text-right">Final</span>
      </div>
    </div>
  );
}

/** Self-loading strip for places that don't already hold the round. */
export function LiveMatchdayStrip({ showPool = true, className }: { showPool?: boolean; className?: string }) {
  const q = useRound((r) => ({
    round: r.round,
    phase: r.phase,
    phaseStartedAt: r.phaseStartedAt,
    phaseEndsAt: r.phaseEndsAt,
    window: r.window,
    fixtures: r.fixtures,
    pool: r.pool,
    liveProgress: r.liveProgress,
  }));
  if (!q.data) return <StripSkeleton className={className} />;
  return <MatchdayStrip round={q.data} showPool={showPool} className={className} />;
}
