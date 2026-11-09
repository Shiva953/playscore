"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Delta, KeyValue } from "@/components/common/bits";
import { EmptyState, SignedOutState } from "@/components/common/states";
import { formatPct, formatPrice, formatScore, formatTokens, formatUsd } from "@/lib/format";
import type { PlayerDetail } from "@/lib/protocol/types";
import { usePortfolio, useSession } from "@/lib/protocol/react/hooks";
import { LiquidityPanel } from "./liquidity-panel";
import { ImpactLadder } from "./market-depth";
import { TradeFeed } from "@/components/live/trade-feed";

export function PlayerTabs({ player }: { player: PlayerDetail }) {
  const trading = player.status === "trading";
  return (
    <Tabs defaultValue="overview" className="flex flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1 py-1 -my-1">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="form">Form</TabsTrigger>
          <TabsTrigger value="dividends">Dividends</TabsTrigger>
          {trading ? <TabsTrigger value="liquidity">Liquidity</TabsTrigger> : null}
          <TabsTrigger value="holders">Holders</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="overview">
        <Overview player={player} />
      </TabsContent>
      <TabsContent value="form">
        <Form player={player} />
      </TabsContent>
      <TabsContent value="dividends">
        <Dividends player={player} />
      </TabsContent>
      {trading ? (
        <TabsContent value="liquidity">
          <LiquidityPanel player={player} />
        </TabsContent>
      ) : null}
      <TabsContent value="holders">
        <Holders player={player} />
      </TabsContent>
    </Tabs>
  );
}

export function YourPosition({ player }: { player: PlayerDetail }) {
  const session = useSession();
  const h = player.holding;
  if (!session.data) return <SignedOutState title="Sign in to hold this player" />;
  if (!h) return <EmptyState title={`You don't hold ${player.ticker}`}>Buy any amount to start. Holdings at kickoff earn that round&apos;s dividends.</EmptyState>;
  return (
    <KeyValue
      rows={[
        ["Tokens", formatTokens(h.tokens)],
        ["Value", formatUsd(h.value)],
        ["Cost basis", formatUsd(h.costBasis)],
        ["P&L", <Delta key="pnl" value={h.pnl}>{formatUsd(h.pnl, { signed: true })} ({formatPct(h.pnlPct, { signed: true })})</Delta>],
        ["If you sold everything now", formatUsd(h.realisableUsd)],
        ...(player.status === "trading"
          ? ([
              ["Hold age", `${h.holdAgeDays.toFixed(0)} days`],
              ["Sell tax now", formatPct(h.sellTaxNow)],
              ["Counted at kickoff", h.snapshotTokens !== null ? `${formatTokens(h.snapshotTokens)} this round` : "Yes, if held at kickoff"],
            ] as [string, string][])
          : ([["Launch limit used", `${formatTokens(h.curvePurchased)} / 240,000`]] as [string, string][])),
      ]}
    />
  );
}

function Overview({ player }: { player: PlayerDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card size="sm" className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Your position</CardTitle>
        </CardHeader>
        <CardContent>
          <YourPosition player={player} />
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Player</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <KeyValue
            rows={[
              ["Club", player.club],
              ["League", player.leagueName],
              ["Position", player.position],
              ["Age", player.age],
              ["Country", player.country],
              ["Form rating", formatScore(player.avgScore)],
              ["Plays this window", player.playsThisWindow ? "Yes" : "No (not in the Champions League)"],
            ]}
          />
          <div className="flex flex-wrap gap-1">
            {player.competitions.map((c) => (
              <Badge key={c} variant="outline">
                {c}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Supply</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValue
            rows={[
              ["Max supply", formatTokens(player.supply.max)],
              ["Sold on the curve", formatTokens(player.supply.curveSold)],
              ["Paired into the pool at bonding", formatTokens(player.supply.poolSeed)],
              ["Minted from reserve (dividends)", formatTokens(player.supply.minted)],
              ["Reserve left", formatTokens(player.supply.reserveLeft)],
              ["Circulating", formatTokens(player.supply.circulating)],
              ["Held by holders", formatTokens(player.supply.holderTokens)],
              ["In the pool", formatTokens(player.supply.inPool)],
            ]}
          />
        </CardContent>
      </Card>
      <Card size="sm" className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{player.pool ? "Pool depth & price impact" : "Launch curve"}</CardTitle>
        </CardHeader>
        <CardContent>
          {player.pool ? (
            <ImpactLadder player={player} />
          ) : (
            <KeyValue
              rows={[
                ["Raised", `${formatUsd(player.curve.raised, { decimals: 0 })} of $25,000`],
                ["Tokens sold", formatTokens(player.curve.sold)],
                ["Price now", formatPrice(player.curve.spot)],
                ["Launch price", formatPrice(player.curve.launchPrice)],
                ["Price at bonding", formatPrice(player.curve.bondPrice)],
                ["Pool opens at", formatPrice(player.curve.poolOpenPrice)],
              ]}
            />
          )}
        </CardContent>
      </Card>
      <Card size="sm" className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Recent trades</CardTitle>
        </CardHeader>
        <CardContent>
          <TradeFeed playerId={player.id} limit={10} />
        </CardContent>
      </Card>
    </div>
  );
}

function Form({ player }: { player: PlayerDetail }) {
  const rows = [...player.form].reverse();
  return (
    <div className="flex flex-col gap-3">
      {player.liveScore !== null ? (
        <p className="text-sm">
          This window (provisional): <span className="num font-semibold">{formatScore(player.liveScore)}</span>
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No matchdays yet">Scores appear here after each settled round.</EmptyState>
      ) : (
        <div className="rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5 py-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Matchday</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Best board rank</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((f, i) => (
                <TableRow key={`${f.label}-${i}`}>
                  <TableCell>{f.round ? `Round ${f.round}` : `${f.label} (pre-launch)`}</TableCell>
                  <TableCell className="num text-right">{formatScore(f.score)}</TableCell>
                  <TableCell className="num text-right">{f.rank <= 5 ? `#${f.rank} · paid` : f.rank >= 99 ? "unranked" : `#${f.rank}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-soft">Score is 0–10 for display (10·P/(P+6)). Boards rank on raw points. Top 5 on any board get paid.</p>
    </div>
  );
}

function Dividends({ player }: { player: PlayerDetail }) {
  const pf = usePortfolio();
  const mine = (pf.data?.claimable.rows ?? []).filter((r) => r.playerId === player.id);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Paid to {player.ticker} holders to date: <span className="num font-semibold">{formatUsd(player.dividendsPaid, { decimals: 0 })}</span>
      </p>
      {mine.length ? (
        <p className="text-sm">
          Your claimable from {player.ticker}: <span className="num font-semibold">{formatUsd(mine.reduce((a, r) => a + r.usd, 0))}</span> (claim on
          Portfolio)
        </p>
      ) : null}
      {player.dividendHistory.length === 0 ? (
        <EmptyState title="No dividends in this demo yet">
          {player.status === "trading" ? "When this player finishes top 5 on a board, holders at kickoff share the payout." : "Dividends start after the player bonds."}
        </EmptyState>
      ) : (
        <div className="rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5 py-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Round</TableHead>
                <TableHead className="text-right">Player payout</TableHead>
                <TableHead className="text-right">Per 10,000 tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {player.dividendHistory.map((d) => (
                <TableRow key={d.round}>
                  <TableCell>
                    <span className="text-soft">{d.label}</span>
                  </TableCell>
                  <TableCell className="num text-right">{formatUsd(d.playerPayout)}</TableCell>
                  <TableCell className="num text-right">{formatUsd(d.per10kTokens)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-soft">
        Dividends are not guaranteed. Each round pays a share of the dividend vault, set by a controller, split across boards and then pro rata
        to tokens held at kickoff.
      </p>
    </div>
  );
}

function Holders({ player }: { player: PlayerDetail }) {
  if (!player.holders.length) return <EmptyState title="No holders yet">Holders appear once the launch opens.</EmptyState>;
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5 py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Holder</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {player.holders.map((h) => (
              <TableRow key={h.label} data-you={h.isYou || undefined}>
                <TableCell className={h.isYou ? "font-semibold" : undefined}>{h.label}</TableCell>
                <TableCell className="num text-right">{formatTokens(h.tokens)}</TableCell>
                <TableCell className="num text-right">{formatPct(h.share)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-soft">Other holder names are illustrative in this demo.</p>
    </div>
  );
}
