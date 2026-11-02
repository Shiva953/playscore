"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";
import { Delta } from "@/components/common/bits";
import { EmptyState, LoadingRows, QueryState, SignedOutState } from "@/components/common/states";
import { formatPct, formatPrice, formatTokens, formatUsd } from "@/lib/format";
import type { PlayerDetail, PriceRange } from "@/lib/protocol/types";
import { usePlayers, usePortfolio, useSession } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";
import { BondingCurveChart, PriceChart, RangeControl, type Indicators } from "./charts";
import { ImpactLadder, RecentTrades } from "./market-depth";
import { TradePanel } from "./trade-panel";

/** Terminal layout: watchlist · chart + indicators · depth/trades · ticket · positions. */
export function ProView({ player }: { player: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  const [ind, setInd] = useState<Indicators>({ ma: true, ema: false, bb: false, rsi: false });
  const toggle = (k: keyof Indicators) => setInd((s) => ({ ...s, [k]: !s[k] }));
  return (
    <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_340px]">
      <Card size="sm" className="order-3 lg:order-1">
        <CardHeader>
          <CardTitle>Watchlist</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Watchlist selected={player.id} />
        </CardContent>
      </Card>
      <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
        <Card size="sm">
          <CardContent className="flex flex-col gap-2">
            {player.status === "trading" ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1" role="group" aria-label="Indicators">
                  {(
                    [
                      ["ma", "MA 7"],
                      ["ema", "EMA 14"],
                      ["bb", "Bollinger 20"],
                      ["rsi", "RSI 14"],
                    ] as const
                  ).map(([k, label]) => (
                    <Toggle key={k} size="sm" pressed={ind[k]} onPressedChange={() => toggle(k)} className="h-7 px-3 text-xs">
                      {label}
                    </Toggle>
                  ))}
                </div>
                <RangeControl value={range} onChange={setRange} />
                </div>
                <PriceChart playerId={player.id} range={range} indicators={ind} height={ind.rsi ? 400 : 340} />
              </>
            ) : player.status === "launching" ? (
              <BondingCurveChart sold={player.curve.sold} />
            ) : (
              <EmptyState title="Not launched yet">Charts appear when the launch opens.</EmptyState>
            )}
          </CardContent>
        </Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Depth</CardTitle>
            </CardHeader>
            <CardContent>
              <ImpactLadder player={player} />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Recent trades</CardTitle>
            </CardHeader>
            <CardContent>
              <RecentTrades playerId={player.id} limit={12} />
            </CardContent>
          </Card>
        </div>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Positions</CardTitle>
          </CardHeader>
          <CardContent>
            <PositionsMini />
          </CardContent>
        </Card>
      </div>
      <div className="order-2 lg:order-3">
        <TradePanel player={player} compact />
      </div>
    </div>
  );
}

function Watchlist({ selected }: { selected: string }) {
  const q = usePlayers({ status: "all" });
  return (
    <QueryState query={q} loading={<LoadingRows rows={8} className="p-3" />}>
      {(list) => (
        <ul className="max-h-[600px] overflow-y-auto overscroll-contain px-2 pb-2 text-sm">
          {list
            .filter((p) => p.status !== "scheduled")
            .sort((a, b) => b.volume24h - a.volume24h)
            .map((p) => (
              <li key={p.id}>
                <Link
                  href={`/player/${p.id}`}
                  aria-current={p.id === selected ? "page" : undefined}
                  className={cn("flex items-center justify-between gap-2 rounded-xl px-3 py-2 transition-colors duration-150 hover:bg-raised", p.id === selected && "bg-raised")}
                >
                  <span className="text-[13px] font-semibold text-ink">${p.ticker}</span>
                  <span className="flex flex-col items-end">
                    <span className="num text-xs">{formatPrice(p.price)}</span>
                    {p.status === "trading" ? <Delta value={p.change24h} decimals={1} className="text-xs" /> : <span className="text-xs text-soft">{formatPct(p.bondProgress, { decimals: 0 })} bonded</span>}
                  </span>
                </Link>
              </li>
            ))}
        </ul>
      )}
    </QueryState>
  );
}

function PositionsMini() {
  const session = useSession();
  const pf = usePortfolio();
  if (!session.data) return <SignedOutState title="Sign in to see positions" />;
  return (
    <QueryState
      query={pf}
      isEmpty={(d) => !d || d.positions.length === 0}
      empty={<EmptyState title="No positions yet">Buy a player to see it here.</EmptyState>}
    >
      {(d) => (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Hold age</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Sell tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d!.positions.map((p) => (
                <TableRow key={p.playerId}>
                  <TableCell>
                    <Link href={`/player/${p.playerId}`} className="text-[13px] font-semibold text-ink hover:underline">
                      ${p.ticker}
                    </Link>
                  </TableCell>
                  <TableCell className="num text-right">{formatTokens(p.tokens)}</TableCell>
                  <TableCell className="num text-right">{formatUsd(p.value)}</TableCell>
                  <TableCell className="text-right">
                    <Delta value={p.pnl}>{formatUsd(p.pnl, { signed: true })}</Delta>
                  </TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">{p.holdAgeDays.toFixed(0)}d</TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">{formatPct(p.sellTaxNow)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </QueryState>
  );
}
