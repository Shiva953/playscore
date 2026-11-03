"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Delta, LiveFigure, PositionBadge, Stat, StatStrip, StripCell, StatusBadge, Ticker } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/common/states";
import { formatDateTime, formatPct, formatPrice, formatScore, formatUsd, formatUsdCompact } from "@/lib/format";
import { isProtocolError } from "@/lib/protocol/errors";
import { cn } from "@/lib/utils";
import type { PlayerDetail, PriceRange } from "@/lib/protocol/types";
import { usePlayer } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";
import { BondingCurveChart, PriceChart, RangeControl } from "./charts";
import { PlayerTabs } from "./player-tabs";
import { ProView } from "./pro-view";
import { TradePanel } from "./trade-panel";

/** The hub: one page, two states (launching on the curve / trading in the pool). */
export function PlayerHub({ id }: { id: string }) {
  const q = usePlayer(id);
  const proView = useUi((s) => s.proView);
  const setProView = useUi((s) => s.setProView);

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
              <Link href="/markets">Back to markets</Link>
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
      <TitleRow player={p} proView={proView} onProView={setProView} />
      {proView ? <ProView player={p} /> : <StandardLayout player={p} />}
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

function TitleRow({ player: p, proView, onProView }: { player: PlayerDetail; proView: boolean; onProView: (v: boolean) => void }) {
  const trading = p.status === "trading";
  const dir = !trading || Math.abs(p.change24h) < 1e-9 ? "flat" : p.change24h > 0 ? "up" : "down";
  return (
    <div className="flex flex-col gap-5" data-testid="player-header">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Ticker ticker={p.ticker} chip />
            <PositionBadge position={p.position} />
            <StatusBadge status={p.status} progress={p.bondProgress} />
          </div>
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.02em] text-ink">{p.name}</h1>
          <p className="text-sm text-soft">
            {p.club}, {p.leagueName} · {p.country}, {p.age}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Switch id="pro-view" checked={proView} onCheckedChange={onProView} />
          <Label htmlFor="pro-view" className="text-sm text-soft">
            Pro view
          </Label>
        </div>
      </div>

      {/* The price is the page's headline: the number face, large, in the colour of its 24h move. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={cn("text-[44px] leading-none font-semibold tracking-[-0.03em]", dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-ink")}
          aria-label="Price"
        >
          {p.status === "scheduled" ? "—" : <LiveFigure value={p.price} format={formatPrice} />}
        </span>
        {trading ? (
          <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold", dir === "down" ? "bg-down-tint" : "bg-up-tint")}>
            <Delta value={p.change24h} />
            <span className="text-[12px] font-medium text-soft">24h</span>
          </span>
        ) : null}
        <p className="basis-full text-sm text-soft lg:basis-auto">{finding(p)}</p>
      </div>

      <StatStrip>
        <StripCell>
          <Stat size="lg" label="Market cap" value={p.status === "scheduled" ? "—" : formatUsdCompact(p.marketCap)} />
        </StripCell>
        <StripCell>
          <Stat size="lg" label="24h volume" value={p.status === "scheduled" ? "—" : formatUsdCompact(p.volume24h)} />
        </StripCell>
        <StripCell>
          <Stat size="lg" label={trading ? "Pool depth" : "Raised"} value={trading ? formatUsdCompact(p.liquidityUsd) : `${formatUsd(p.raised, { decimals: 0 })}`} />
        </StripCell>
        <StripCell>
          <Stat size="lg" label="Last score" value={formatScore(p.lastScore)} hint={p.lastBoardRank ? `#${p.lastBoardRank} on a board, paid` : "Not in a top five"} />
        </StripCell>
      </StatStrip>
    </div>
  );
}

function StandardLayout({ player: p }: { player: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="min-w-0 lg:col-start-1 lg:row-start-1">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-medium text-ink">{p.status === "trading" ? "Price" : p.status === "launching" ? "Launch curve" : "Upcoming launch"}</h2>
            {p.status === "trading" ? <RangeControl value={range} onChange={setRange} /> : null}
          </div>
          {p.status === "trading" ? (
            <PriceChart playerId={p.id} range={range} height={360} />
          ) : p.status === "launching" ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="num flex items-baseline justify-between text-sm">
                  <span className="text-soft">
                    <span className="text-ink">{formatUsd(p.raised, { decimals: 0 })}</span> of $25,000 raised
                  </span>
                  <span className="text-ink">{formatPct(p.bondProgress, { decimals: 0 })}</span>
                </div>
                <Progress value={p.bondProgress * 100} tone="up" aria-label="Bonding progress" />
              </div>
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
        </CardContent>
      </Card>
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="lg:sticky lg:top-16">
          <TradePanel player={p} />
        </div>
      </div>
      <div className="min-w-0 pt-2 lg:col-start-1 lg:row-start-2">
        <PlayerTabs player={p} />
      </div>
    </div>
  );
}
