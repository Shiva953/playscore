"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Countdown, Stat } from "@/components/common/bits";
import { ErrorState, LoadingBlock } from "@/components/common/states";
import { formatPct, formatUsd } from "@/lib/format";
import { useRound } from "@/lib/protocol/react/hooks";

/** Current matchday at a glance: window, phase, countdown, round pool. Used on Landing and Markets. */
export function MatchdayCard() {
  const q = useRound((r) => ({
    round: r.round,
    phase: r.phase,
    endsAt: r.phaseEndsAt,
    startedAt: r.phaseStartedAt,
    window: r.window,
    pool: r.pool,
    progress: r.liveProgress,
    myTokens: r.my.totalTokens,
    signedIn: r.my.signedIn,
  }));
  if (q.isPending) return <LoadingBlock className="h-36" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  return (
    <Card data-testid="matchday-card">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Matchday {r.round} · {r.window.title}
            </span>
            <span className="text-lg font-semibold">
              {r.window.fromLabel} → {r.window.toLabel}
            </span>
            <span className="text-sm">
              {r.phase === "open" ? (
                <>
                  Kickoff snapshot in <Countdown to={r.endsAt} className="font-semibold" />. Hold before then to earn this round.
                </>
              ) : r.phase === "live" ? (
                <>Live now. Scores are provisional. Trading stays open.</>
              ) : (
                <>
                  Full time. Data is final in <Countdown to={r.endsAt} />, then the round settles.
                </>
              )}
            </span>
            {r.signedIn && r.phase === "open" ? (
              <span className="text-xs text-muted-foreground">
                {r.myTokens > 0 ? "Your bonded holdings will be counted at kickoff." : "You don't hold any bonded players yet."}
              </span>
            ) : null}
          </div>
          <div className="flex gap-6">
            <Stat label="Round pool" value={formatUsd(r.pool.usd, { decimals: 0 })} hint={`${formatPct(r.pool.effectiveRate)} of the vault`} />
          </div>
        </div>
        {r.phase === "live" ? <Progress value={r.progress * 100} aria-label="Matchday progress" /> : null}
        <div>
          <Button asChild variant={r.phase === "live" ? "default" : "outline"}>
            <Link href="/matchday">{r.phase === "live" ? "Watch the live board" : "Open matchday"}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
