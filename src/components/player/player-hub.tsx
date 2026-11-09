"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PositionBadge, StatusBadge, Ticker } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/common/states";
import { formatDateTime, formatPrice, formatScore, formatUsd } from "@/lib/format";
import { isProtocolError } from "@/lib/protocol/errors";
import { ChevronDown, ChevronUp } from "lucide-react";
import { neighbours, usePlayerOrder } from "@/components/trade/player-order";
import type { PlayerDetail, PriceRange } from "@/lib/protocol/types";
import { usePlayer } from "@/lib/protocol/react/hooks";
import { BondingCurveChart, PriceChart, RangeControl } from "./charts";
import { PlayerTabs } from "./player-tabs";
import { TradePanel } from "./trade-panel";
import { MarketFacts, MarketHeadline } from "./market-header";
import { PlayerAvatar } from "@/components/common/kit";

/** The hub: one page, two states (launching on the curve / trading in the pool). */
export function PlayerHub({ id }: { id: string }) {
  const q = usePlayer(id);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <LoadingBlock className="h-24" />
        <LoadingBlock className="h-20" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <LoadingBlock className="h-[360px]" />
          <LoadingBlock className="h-[360px]" />
        </div>
      </div>
    );
  }
  if (q.isError || !q.data) {
    if (isProtocolError(q.error) && q.error.code === "NOT_FOUND") {
      return (
        <EmptyState
          title="Player not found"
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/trade">Go to trading</Link>
            </Button>
          }
        >
          There&apos;s no player with that ID.
        </EmptyState>
      );
    }
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  const p = q.data;
  return (
    <div className="flex flex-col gap-6">
      <TitleRow player={p} />
      <StandardLayout player={p} />
    </div>
  );
}

/** One line under the title saying what matters about this player right now. */
function finding(p: PlayerDetail): string {
  if (p.status === "scheduled") return `Launches ${p.launchAt ? formatDateTime(p.launchAt) : "soon"} at ${formatPrice(p.curve.launchPrice)}.`;
  if (p.status === "launching") {
    const left = Math.max(0, p.curve.threshold - p.raised);
    return `${formatUsd(left, { decimals: 0 })} left to raise before ${p.name.split(" ").slice(-1)[0]} bonds and starts earning dividends.`;
  }
  if (p.liveScore !== null) return `Playing this window: provisional score ${formatScore(p.liveScore)}.`;
  if (!p.playsThisWindow) return "Not playing this window (club not in the Champions League).";
  if (p.lastBoardRank) return `Finished #${p.lastBoardRank} on a board last time out.`;
  return `Form ${formatScore(p.avgScore)} · ${p.leagueName}.`;
}

function TitleRow({ player: p }: { player: PlayerDetail }) {
  return (
    <div className="flex flex-col gap-5" data-testid="player-header">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <PlayerAvatar id={p.id} size={88} className="max-sm:hidden" />
          <PlayerAvatar id={p.id} size={64} className="sm:hidden" />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Ticker ticker={p.ticker} chip />
              <PositionBadge position={p.position} />
              <StatusBadge status={p.status} progress={p.bondProgress} />
            </div>
            <h1 className="text-[1.75rem] leading-[1.1] font-semibold text-ink sm:text-[2.125rem] sm:leading-[1.06]">{p.name}</h1>
            <p className="text-sm text-soft">
              {p.club}, {p.leagueName} · {p.country}, {p.age}
            </p>
            <p className="text-sm text-ink">{finding(p)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <PlayerStepper id={p.id} />
          {p.status === "trading" ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/trade/${p.id}`}>Open in terminal</Link>
            </Button>
          ) : null}
        </div>
      </div>

    </div>
  );
}

function StandardLayout({ player: p }: { player: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="min-w-0 lg:col-start-1 lg:row-start-1">
        <CardContent className="flex flex-col gap-4">
          {/* The market lives on its chart: the scoreboard figures over the line, the facts under it. */}
          <h2 className="sr-only">{p.status === "trading" ? "Price chart" : p.status === "launching" ? "Launch curve" : "Upcoming launch"}</h2>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <MarketHeadline p={p} />
            {p.status === "trading" ? <RangeControl value={range} onChange={setRange} /> : null}
          </div>
          {p.status === "trading" ? (
            <PriceChart playerId={p.id} range={range} height={340} />
          ) : p.status === "launching" ? (
            <>
              <BondingCurveChart sold={p.curve.sold} myAvgEntry={p.holding && p.holding.tokens > 0 ? p.holding.costBasis / p.holding.tokens : null} />
              <p className="text-sm text-soft">
                At $25,000 the curve closes: 70% seeds a permanent pool, 20% goes to the dividend vault, 10% to the treasury. The pool opens at{" "}
                {formatPrice(p.curve.poolOpenPrice)}, where the curve ends.
              </p>
            </>
          ) : (
            <EmptyState title={`Launches ${p.launchAt ? formatDateTime(p.launchAt) : "soon"}`}>
              The curve starts at {formatPrice(p.curve.launchPrice)}. Each account can buy up to 240,000 tokens during the launch.
            </EmptyState>
          )}
          {p.status !== "scheduled" ? <MarketFacts p={p} /> : null}
        </CardContent>
      </Card>
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="lg:sticky lg:top-16">
          {/* Keyed per player: the ticket (amount, side, a receipt) never carries over to the next player. */}
          <TradePanel key={p.id} player={p} />
        </div>
      </div>
      <div className="min-w-0 pt-2 lg:col-start-1 lg:row-start-2">
        <PlayerTabs player={p} />
      </div>
    </div>
  );
}


/** Previous / next player, in the same order as the trade terminal's list ("click top down"). */
function PlayerStepper({ id }: { id: string }) {
  const order = usePlayerOrder();
  const { prev, next } = neighbours(order, id);
  if (!prev || !next) return null;
  return (
    <div className="flex items-center rounded-full bg-surface ring-1 ring-edge ring-inset" role="group" aria-label="Switch player">
      <Button asChild variant="ghost" size="icon-sm" aria-label="Previous player">
        <Link href={`/player/${prev}`} scroll={false}>
          <ChevronUp aria-hidden="true" />
        </Link>
      </Button>
      <Button asChild variant="ghost" size="icon-sm" aria-label="Next player">
        <Link href={`/player/${next}`} scroll={false}>
          <ChevronDown aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
