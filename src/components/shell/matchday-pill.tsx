"use client";

import Link from "next/link";
import { Countdown } from "@/components/common/bits";
import { Skeleton } from "@/components/ui/skeleton";
import { useRound } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/** Compact form of the matchday strip: where this window is, in one line. Re-renders on phase changes and its own countdown. */
export function MatchdayPill({ className }: { className?: string }) {
  const q = useRound((r) => ({ round: r.round, phase: r.phase, endsAt: r.phaseEndsAt, kind: r.window.kind }));
  if (q.isPending) return <Skeleton className={cn("h-8 w-36 rounded-full", className)} />;
  if (q.isError || !q.data) return null;
  const { round, phase, endsAt, kind } = q.data;
  return (
    <Link
      href="/matchday"
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full bg-surface px-3 ring-1 ring-edge ring-inset text-[0.8125rem] whitespace-nowrap text-soft transition-colors duration-150 hover:bg-raised",
        className
      )}
    >
      {/* The name is the visible text plus this hint (WCAG 2.5.3: say what you see to activate it). */}
      <span className="sr-only">Open matchday: </span>
      {phase === "live" ? (
        <>
          <span className="size-2 rounded-full bg-brand" aria-hidden="true" />
          <span className="font-medium text-ink">Live</span>
          <span className="hidden sm:inline">MD {round}</span>
        </>
      ) : phase === "ended" ? (
        <>
          <span className="font-medium text-ink">Full time</span>
          <Countdown to={endsAt} className="text-ink" />
        </>
      ) : (
        <>
          <span className="hidden sm:inline">
            MD {round}
            {kind === "ucl" ? " · UCL" : ""}
          </span>
          <span>Kickoff</span>
          <Countdown to={endsAt} className="text-ink" />
        </>
      )}
    </Link>
  );
}
