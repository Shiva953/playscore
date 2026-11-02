"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LEAGUES, LEAGUE_NAMES, POSITIONS, type LeagueCode, type PositionCode } from "@score/core";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Delta, PositionBadge, Section, Sparkline, StatusBadge } from "@/components/common/bits";
import { EmptyState, QueryState, LoadingRows } from "@/components/common/states";
import { formatDateTime, formatPct, formatPrice, formatScore, formatUsd, formatUsdCompact } from "@/lib/format";
import type { PlayerStatus, PlayerSummary } from "@/lib/protocol/types";
import { usePlayers } from "@/lib/protocol/react/hooks";
import { MatchdayCard } from "./matchday-card";

export function MarketsPage() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">Markets</h1>
      <MatchdayCard />
      <LaunchesInProgress />
      <TopMovers />
      <AllPlayers />
      <LaunchSchedule />
    </div>
  );
}

function LaunchesInProgress() {
  const q = usePlayers({ status: "launching" });
  return (
    <Section title="Launching now" id="launches">
      <QueryState
        query={q}
        loading={<LoadingRows rows={2} />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="No launches right now">The next players launch at 14:00 and 20:00 UTC on weekdays.</EmptyState>}
      >
        {(list) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[...list]
              .sort((a, b) => b.bondProgress - a.bondProgress)
              .map((p) => (
                <Link key={p.id} href={`/player/${p.id}`} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Card size="sm" className="h-full hover:bg-muted/40">
                    <CardContent className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold">${p.ticker}</span>
                        <PositionBadge position={p.position} />
                      </div>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.club} · {p.leagueName}
                      </span>
                      <Progress value={p.bondProgress * 100} aria-label={`${p.name} bonding progress`} />
                      <div className="flex justify-between text-xs">
                        <span className="num">{formatUsd(p.raised, { decimals: 0 })} of $25,000</span>
                        <span className="num">{formatPct(p.bondProgress, { decimals: 0 })}</span>
                      </div>
                      <span className="num text-sm">{formatPrice(p.price)}</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function TopMovers() {
  const q = usePlayers({ status: "trading" });
  return (
    <Section title="Top movers (24h)" id="movers">
      <QueryState
        query={q}
        loading={<LoadingRows rows={3} />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="No bonded players yet">Players appear here once they bond and start trading.</EmptyState>}
      >
        {(list) => (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...list]
              .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
              .slice(0, 6)
              .map((p) => (
                <li key={p.id}>
                  <Link href={`/player/${p.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono text-xs font-semibold">${p.ticker}</span>
                      <span className="truncate text-sm">{p.name}</span>
                    </span>
                    <Sparkline values={p.sparkline} />
                    <span className="flex flex-col items-end">
                      <span className="num text-sm">{formatPrice(p.price)}</span>
                      <Delta value={p.change24h} className="text-xs" />
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </QueryState>
    </Section>
  );
}

type SortKey = "volume" | "change" | "price" | "score" | "name";

function AllPlayers() {
  const [status, setStatus] = useState<PlayerStatus | "all">("all");
  const [league, setLeague] = useState<LeagueCode | "all">("all");
  const [position, setPosition] = useState<PositionCode | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const filter = useMemo(() => ({ status, league, position, search }), [status, league, position, search]);
  const q = usePlayers(filter);
  const rows = useMemo(() => {
    const d = [...(q.data ?? [])];
    const by: Record<SortKey, (a: PlayerSummary, b: PlayerSummary) => number> = {
      volume: (a, b) => b.volume24h - a.volume24h,
      change: (a, b) => b.change24h - a.change24h,
      price: (a, b) => b.price - a.price,
      score: (a, b) => (b.lastScore ?? 0) - (a.lastScore ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return d.sort(by[sort]);
  }, [q.data, sort]);

  return (
    <Section title="All players" id="players">
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search name, ticker or club"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64"
          aria-label="Search players"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as PlayerStatus | "all")}>
          <SelectTrigger className="w-[9.5rem]" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="trading">Trading</SelectItem>
            <SelectItem value="launching">Launching</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={league} onValueChange={(v) => setLeague(v as LeagueCode | "all")}>
          <SelectTrigger className="w-[11rem]" aria-label="League">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All leagues</SelectItem>
            {LEAGUES.map((l) => (
              <SelectItem key={l} value={l}>
                {LEAGUE_NAMES[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={position} onValueChange={(v) => setPosition(v as PositionCode | "all")}>
          <SelectTrigger className="w-[9rem]" aria-label="Position">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All positions</SelectItem>
            {POSITIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-[10rem]" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="volume">Sort: volume</SelectItem>
            <SelectItem value="change">Sort: 24h change</SelectItem>
            <SelectItem value="price">Sort: price</SelectItem>
            <SelectItem value="score">Sort: last score</SelectItem>
            <SelectItem value="name">Sort: name</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <QueryState
        query={q}
        loading={<LoadingRows rows={8} />}
        isEmpty={() => rows.length === 0}
        empty={<EmptyState title="No players match">Try clearing a filter or the search.</EmptyState>}
      >
        {() => (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className="hidden md:table-cell">League</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">24h</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Volume</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Market cap</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Last score</TableHead>
                  <TableHead className="hidden lg:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <PlayerRow key={p.id} p={p} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function PlayerRow({ p }: { p: PlayerSummary }) {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/player/${p.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
          <span className="font-mono text-xs font-semibold">${p.ticker}</span>
          <span className="truncate">{p.name}</span>
          <PositionBadge position={p.position} />
        </Link>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">{p.leagueName}</TableCell>
      <TableCell className="num text-right">{p.status === "scheduled" ? "—" : formatPrice(p.price)}</TableCell>
      <TableCell className="text-right">{p.status === "trading" ? <Delta value={p.change24h} /> : <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="num hidden text-right sm:table-cell">{p.status === "scheduled" ? "—" : formatUsdCompact(p.volume24h)}</TableCell>
      <TableCell className="num hidden text-right lg:table-cell">{p.status === "scheduled" ? "—" : formatUsdCompact(p.marketCap)}</TableCell>
      <TableCell className="num hidden text-right md:table-cell">{formatScore(p.liveScore ?? p.lastScore)}</TableCell>
      <TableCell className="hidden lg:table-cell">
        <StatusBadge status={p.status} progress={p.bondProgress} />
      </TableCell>
    </TableRow>
  );
}

function LaunchSchedule() {
  const q = usePlayers({ status: "scheduled" });
  return (
    <Section title="Launch schedule" id="schedule">
      <p className="text-sm text-muted-foreground">Two curated launches each weekday at 14:00 and 20:00 UTC until 200 players, then one a week by holder vote.</p>
      <QueryState
        query={q}
        loading={<LoadingRows rows={4} />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="Everyone has launched">New launches are chosen by holder vote from Season 1.</EmptyState>}
      >
        {(list) => (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Launch</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead className="hidden sm:table-cell">Club</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...list]
                  .sort((a, b) => (a.launchAt ?? 0) - (b.launchAt ?? 0))
                  .map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="num whitespace-nowrap text-muted-foreground">{p.launchAt ? formatDateTime(p.launchAt) : "—"}</TableCell>
                      <TableCell>
                        <Link href={`/player/${p.id}`} className="flex items-center gap-2 hover:underline">
                          <span className="font-mono text-xs font-semibold">${p.ticker}</span>
                          <span>{p.name}</span>
                          <PositionBadge position={p.position} />
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{p.club}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}
