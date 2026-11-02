"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Delta, PositionBadge, Stat, StatusBadge } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/common/states";
import { formatDateTime, formatPct, formatPrice, formatScore, formatUsd, formatUsdCompact } from "@/lib/format";
import { isProtocolError } from "@/lib/protocol/errors";
import type { PlayerDetail, PriceRange } from "@/lib/protocol/types";
import { usePlayer } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";
import { BondingCurveChart, PriceChart } from "./charts";
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
      <div className="flex flex-col gap-4">
        <LoadingBlock className="h-20" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <LoadingBlock className="h-80" />
          <LoadingBlock className="h-80" />
        </div>
      </div>
    );
  }
  if (q.isError || !q.data) {
    if (isProtocolError(q.error) && q.error.code === "NOT_FOUND") {
      return (
        <EmptyState title="Player not found" action={<Button asChild variant="outline"><Link href="/markets">Back to markets</Link></Button>}>
          There&apos;s no player with that ID.
        </EmptyState>
      );
    }
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  const p = q.data;
  return (
    <div className="flex flex-col gap-4">
      <HeaderStrip player={p} proView={proView} onProView={setProView} />
      {proView ? <ProView player={p} /> : <StandardLayout player={p} />}
    </div>
  );
}

function HeaderStrip({ player: p, proView, onProView }: { player: PlayerDetail; proView: boolean; onProView: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4" data-testid="player-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">${p.ticker}</span>
            <PositionBadge position={p.position} />
            <StatusBadge status={p.status} progress={p.bondProgress} />
          </div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <span className="text-sm text-muted-foreground">
            {p.club} · {p.leagueName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="pro-view" checked={proView} onCheckedChange={onProView} />
          <Label htmlFor="pro-view">Pro view</Label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Price" value={p.status === "scheduled" ? "—" : formatPrice(p.price)} />
        <Stat label="24h" value={p.status === "trading" ? <Delta value={p.change24h} /> : "—"} />
        <Stat label="24h volume" value={p.status === "scheduled" ? "—" : formatUsdCompact(p.volume24h)} />
        <Stat label={p.status === "trading" ? "Pool depth" : "Raised"} value={p.status === "trading" ? formatUsdCompact(p.liquidityUsd) : formatUsd(p.raised, { decimals: 0 })} />
        <Stat label="Last score" value={formatScore(p.lastScore)} hint={p.lastBoardRank ? `#${p.lastBoardRank} on a board` : undefined} />
        <Stat label="Live score" value={p.liveScore !== null ? formatScore(p.liveScore) : "—"} hint={p.liveScore !== null ? "provisional" : undefined} />
      </div>
    </div>
  );
}

function StandardLayout({ player: p }: { player: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0 lg:col-start-1 lg:row-start-1">
        <CardHeader>
          <CardTitle>{p.status === "trading" ? "Price" : p.status === "launching" ? "Launch progress" : "Upcoming launch"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {p.status === "trading" ? (
            <PriceChart playerId={p.id} range={range} onRange={setRange} />
          ) : p.status === "launching" ? (
            <>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <span className="num">{formatUsd(p.raised, { decimals: 0 })} of $25,000 raised</span>
                  <span className="num">{formatPct(p.bondProgress, { decimals: 0 })}</span>
                </div>
                <Progress value={p.bondProgress * 100} aria-label="Bonding progress" />
              </div>
              <BondingCurveChart sold={p.curve.sold} />
              <p className="text-xs text-muted-foreground">
                At $25,000 raised the player bonds: 70% seeds a permanent pool, 20% goes to the dividend vault, 10% to the treasury. The pool
                opens at {formatPrice(p.curve.poolOpenPrice)}, continuous with the curve.
              </p>
            </>
          ) : (
            <EmptyState title={`Launches ${p.launchAt ? formatDateTime(p.launchAt) : "soon"}`}>
              The curve starts at {formatPrice(p.curve.launchPrice)}. Max 240,000 tokens per account during launch.
            </EmptyState>
          )}
        </CardContent>
      </Card>
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="lg:sticky lg:top-20">
          <TradePanel player={p} />
        </div>
      </div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <PlayerTabs player={p} />
      </div>
    </div>
  );
}
