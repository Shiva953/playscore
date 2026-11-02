"use client";

import Link from "next/link";
import { Countdown } from "@/components/common/bits";
import { Skeleton } from "@/components/ui/skeleton";
import { useRound } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/** Header pill: next kickoff countdown, live state, or freeze countdown. Re-renders only on phase changes + its own countdown. */
export function MatchdayPill({ className }: { className?: string }) {
  const q = useRound((r) => ({ round: r.round, phase: r.phase, endsAt: r.phaseEndsAt, kind: r.window.kind }));
  if (q.isPending) return <Skeleton className={cn("h-8 w-40", className)} />;
  if (q.isError || !q.data) return null;
  const { round, phase, endsAt, kind } = q.data;
  return (
    <Link
      href="/matchday"
      className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs hover:bg-muted", className)}
      aria-label={`Matchday ${round}, ${phase}`}
    >
      {phase === "live" ? (
        <>
          <span className="size-2 rounded-full bg-up" aria-hidden="true" />
          <span className="font-medium">Live</span>
          <span className="text-muted-foreground">MD {round}</span>
        </>
      ) : phase === "ended" ? (
        <>
          <span className="font-medium">Full time</span>
          <span className="text-muted-foreground">final in</span>
          <Countdown to={endsAt} />
        </>
      ) : (
        <>
          <span className="text-muted-foreground">MD {round}{kind === "ucl" ? " · UCL" : ""}</span>
          <span className="font-medium">Kickoff</span>
          <Countdown to={endsAt} />
        </>
      )}
    </Link>
  );
}
