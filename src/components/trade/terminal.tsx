"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Delta, LiveFigure, PositionBadge, StatusBadge, Ticker } from "@/components/common/bits";
import { EmptyState, LoadingBlock, SignedOutState } from "@/components/common/states";
import { BondingCurveChart, PriceChart, RangeControl, type Indicators } from "@/components/player/charts";
import { RecentTrades } from "@/components/player/market-depth";
import { PositionsMini } from "@/components/player/pro-view";
import { TradePanel } from "@/components/player/trade-panel";
import { formatPct, formatPrice, formatScore, formatUsd, formatUsdCompact } from "@/lib/format";
import type { LimitOrder, PlayerDetail, PlayerSummary, PriceRange } from "@/lib/protocol/types";
import { useCancelOrder, usePlayer, usePlayers, usePortfolio, useSession } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";
import { OrderBook } from "./order-book";
import { LEAGUES, LEAGUE_NAMES } from "@score/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SORT_LABEL, filterPlayers, neighbours, orderPlayers, sortPlayers, type LeagueFilter, type PlayerSort, type PositionFilter } from "./player-order";

const POSITIONS: PositionFilter[] = ["ALL", "FWD", "MID", "DEF", "GK"];

/**
 * The trade terminal (the v1 prototype's #/trade): a player list on the left (click, or ↑/↓ and j/k,
 * to switch; the URL follows), the chart with indicators in the middle and positions/orders/trades
 * under it, the order book and the ticket (market and limit) on the right.
 */
export function TradeTerminal({ id }: { id: string }) {
  const router = useRouter();
  const players = usePlayers();
  const pf = usePortfolio();
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const [league, setLeague] = useState<LeagueFilter>("ALL");
  const [sort, setSort] = useState<PlayerSort>("default");
  const ordered = useMemo(() => orderPlayers(players.data ?? []), [players.data]);
  // ↑/↓ follow the list as shown, so they step through whatever filter and sort are on.
  const list = useMemo(() => sortPlayers(filterPlayers(ordered, query, position, league), sort), [ordered, query, position, league, sort]);
  const nav = neighbours(list.length ? list : ordered, id);
  const go = (pid: string | null) => pid && router.replace(`/trade/${pid}`, { scroll: false });

  // Switching keeps the last player on screen until the next one has loaded (no empty flash).
  const q = usePlayer(id, { keepPrevious: true });
  const p = q.data ?? null;

  // ↑/↓ (and k/j) move through the visible list, except while typing.
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable=true], [role=combobox], [role=menu], [role=dialog], [role=listbox]") || e.metaKey || e.ctrlKey || e.altKey)) return;
      const up = e.key === "ArrowUp" || e.key === "k";
      const down = e.key === "ArrowDown" || e.key === "j";
      if (!up && !down) return;
      e.preventDefault();
      const target = up ? navRef.current.prev : navRef.current.next;
      if (target) router.replace(`/trade/${target}`, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  if (!p) {
    return (
      <div data-fullbleed className="mx-auto grid w-full max-w-[1680px] gap-3 px-3 py-3 md:px-4 lg:grid-cols-[260px_minmax(0,1fr)_320px]" aria-busy="true">
        <LoadingBlock className="h-[70vh]" />
        <LoadingBlock className="h-[70vh]" />
        <LoadingBlock className="h-[70vh]" />
      </div>
    );
  }

  return (
    <div data-fullbleed className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 px-3 pt-3 pb-24 md:px-4 md:pb-6">
      <Strip p={p} onPrev={() => go(nav.prev)} onNext={() => go(nav.next)} />
      {/* Phones: chart, ticket and book, the tabs, then the list. Desktop: list | chart + tabs | ticket + book. */}
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
        <Card size="sm" className="order-4 min-h-0 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-[calc(100svh-178px)] lg:self-start">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5">
            <Watchlist
              list={list}
              selected={p.id}
              query={query}
              setQuery={setQuery}
              position={position}
              setPosition={setPosition}
              league={league}
              setLeague={setLeague}
              sort={sort}
              setSort={setSort}
              onPick={(pid) => go(pid)}
              loading={players.isPending}
            />
          </CardContent>
        </Card>

        <div className="order-1 min-w-0 lg:order-none lg:col-start-2 lg:row-start-1">
          <ChartCard p={p} />
        </div>
        <div className="order-3 min-w-0 lg:order-none lg:col-start-2 lg:row-start-2 lg:self-start">
          <BottomTabs p={p} orders={pf.data?.orders ?? []} />
        </div>

        <div className="order-2 flex flex-col gap-3 lg:order-none lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-start">
          <TradePanel key={p.id} player={p} compact allowLimit />
          <Card size="sm">
            <CardContent>
              <OrderBook player={p} orders={pf.data?.orders ?? []} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the strip

function Strip({ p, onPrev, onNext }: { p: PlayerDetail; onPrev: () => void; onNext: () => void }) {
  const trading = p.status === "trading";
  const dir = Math.abs(p.change24h) < 1e-9 ? "flat" : p.change24h > 0 ? "up" : "down";
  return (
    <section aria-label={`${p.name} market`} className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <Button variant="ghost" size="icon-xs" onClick={onPrev} aria-label="Previous player" title="Previous player (↑)">
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onNext} aria-label="Next player" title="Next player (↓)">
            <ChevronDown aria-hidden="true" />
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Ticker ticker={p.ticker} chip />
            <PositionBadge position={p.position} />
            <StatusBadge status={p.status} progress={p.bondProgress} />
          </div>
          <h1 className="text-[14px] font-medium">
            <Link href={`/player/${p.id}`} className="text-ink hover:underline">
              {p.name} <span className="font-normal text-soft">{p.club}</span>
            </Link>
          </h1>
        </div>
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className={cn("text-[30px] leading-none font-semibold tracking-[-0.02em]", dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-ink")} aria-label="Price">
          <LiveFigure value={p.price} format={formatPrice} className="fig-prop" />
        </span>
        <Delta value={p.change24h} className="text-[14px] font-semibold" />
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
        <Fact label="24h volume" value={formatUsdCompact(p.volume24h)} />
        <Fact label="Market cap" value={formatUsdCompact(p.marketCap)} />
        <Fact label={trading ? "Pool depth" : "Raised"} value={trading ? formatUsdCompact(p.liquidityUsd) : `${formatUsd(p.raised, { decimals: 0 })} of $25k`} />
        <Fact label="Form" value={formatScore(p.avgScore)} />
        <Fact label="Last score" value={formatScore(p.lastScore)} />
      </dl>
      <span className="ml-auto hidden text-[12px] text-faint xl:inline">↑ ↓ to switch players</span>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-soft">{label}</dt>
      <dd className="fig fig-prop text-[15px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- the list

function Watchlist({
  list,
  selected,
  query,
  setQuery,
  position,
  setPosition,
  league,
  setLeague,
  sort,
  setSort,
  onPick,
  loading,
}: {
  list: PlayerSummary[];
  selected: string;
  query: string;
  setQuery: (q: string) => void;
  position: PositionFilter;
  setPosition: (p: PositionFilter) => void;
  league: LeagueFilter;
  setLeague: (l: LeagueFilter) => void;
  sort: PlayerSort;
  setSort: (s: PlayerSort) => void;
  onPick: (id: string) => void;
  loading: boolean;
}) {
  const box = useRef<HTMLUListElement>(null);
  // Keep the selected row in view as ↑/↓ move through the list.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(`[data-id="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <>
      <label className="flex h-9 items-center gap-2 rounded-full bg-ground px-3 ring-1 ring-control focus-within:ring-ink">
        <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
        <span className="sr-only">Search players</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search players" className="w-full min-w-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint" />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-faint hover:text-ink">
            <X className="size-3.5" />
          </button>
        ) : null}
      </label>
      <div role="radiogroup" aria-label="Position" className="flex gap-1">
        {POSITIONS.map((x) => (
          <button
            key={x}
            type="button"
            role="radio"
            aria-checked={position === x}
            onClick={() => setPosition(x)}
            className={cn("h-7 flex-1 rounded-full text-[11px] font-semibold transition-colors duration-150", position === x ? "bg-raised text-ink" : "text-soft hover:text-ink")}
          >
            {x === "ALL" ? "All" : x}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={league} onValueChange={(v) => setLeague(v as LeagueFilter)}>
          <SelectTrigger aria-label="League" className="w-full pl-3 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All leagues</SelectItem>
            {LEAGUES.map((l) => (
              <SelectItem key={l} value={l}>
                {LEAGUE_NAMES[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as PlayerSort)}>
          <SelectTrigger aria-label="Sort by" className="w-full pl-3 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as PlayerSort[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ul ref={box} className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 max-lg:max-h-[420px]" aria-label="Players">
        {loading ? <li className="px-2 py-3 text-[13px] text-soft">Loading players…</li> : null}
        {!loading && list.length === 0 ? <li className="px-2 py-3 text-[13px] text-soft">No players match.</li> : null}
        {list.map((p) => (
          <li key={p.id} data-id={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.id)}
              aria-current={p.id === selected ? "true" : undefined}
              className={cn("flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-raised/60", p.id === selected && "bg-raised")}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold text-ink">${p.ticker}</span>
                <span className="truncate text-[11px] text-faint">{p.name}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="fig text-[12px] text-ink">{formatPrice(p.price)}</span>
                {p.status === "trading" ? (
                  <Delta value={p.change24h} decimals={1} className="text-[11px]" />
                ) : (
                  <span className="text-[11px] text-soft">{formatPct(p.bondProgress, { decimals: 0 })} bonded</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------- the chart

function ChartCard({ p }: { p: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  const [ind, setInd] = useState<Indicators>({ ma: true, ema: false, bb: false, rsi: false, vol: true });
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        {p.status === "trading" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Indicators">
                {(
                  [
                    ["ma", "MA 7"],
                    ["ema", "EMA 14"],
                    ["bb", "Bollinger 20"],
                    ["rsi", "RSI 14"],
                    ["vol", "Volume"],
                  ] as const
                ).map(([k, label]) => (
                  <Toggle key={k} size="sm" pressed={!!ind[k]} onPressedChange={() => setInd((s) => ({ ...s, [k]: !s[k] }))} className="h-7 px-3 text-xs">
                    {label}
                  </Toggle>
                ))}
              </div>
              <RangeControl value={range} onChange={setRange} />
            </div>
            <PriceChart key={p.id} playerId={p.id} range={range} indicators={ind} height={ind.rsi ? 460 : 400} />
          </>
        ) : p.status === "launching" ? (
          <>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-ink">Launch curve</h2>
              <span className="fig text-[13px] text-soft">
                {formatUsd(p.raised, { decimals: 0 })} of $25,000 · {formatPct(p.bondProgress, { decimals: 0 })}
              </span>
            </div>
            <BondingCurveChart sold={p.curve.sold} myAvgEntry={p.holding && p.holding.tokens > 0 ? p.holding.costBasis / p.holding.tokens : null} />
          </>
        ) : (
          <EmptyState title="Not launched yet">Charts appear when the launch opens.</EmptyState>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- under the chart

function BottomTabs({ p, orders }: { p: PlayerDetail; orders: LimitOrder[] }) {
  return (
    <Card size="sm">
      <CardContent>
        <Tabs defaultValue="positions" className="gap-3">
          <TabsList>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="orders">
              Open orders{orders.length ? <span className="fig ml-1.5 text-soft">{orders.length}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="trades">Trades</TabsTrigger>
          </TabsList>
          <TabsContent value="positions">
            <PositionsMini />
          </TabsContent>
          <TabsContent value="orders">
            <OpenOrders orders={orders} current={p.id} />
          </TabsContent>
          <TabsContent value="trades">
            <RecentTrades playerId={p.id} limit={12} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function OpenOrders({ orders, current }: { orders: LimitOrder[]; current: string }) {
  const session = useSession();
  const cancel = useCancelOrder();
  if (!session.data) return <SignedOutState title="Sign in to place limit orders" />;
  if (!orders.length) return <p className="py-3 text-sm text-soft">No open orders. Switch the ticket to Limit to rest one on the pool.</p>;
  const sorted = [...orders].sort((a, b) => Number(b.playerId === current) - Number(a.playerId === current) || b.createdAt - a.createdAt);
  return (
    <ul className="flex flex-col divide-y divide-rule text-[13px]">
      {sorted.map((o) => (
        <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
          <span className="flex items-center gap-2">
            <span className={cn("font-semibold", o.side === "buy" ? "text-up" : "text-down")}>{o.side === "buy" ? "Buy" : "Sell"}</span>
            <Link href={`/trade/${o.playerId}`} className="font-medium text-ink hover:underline">
              ${o.ticker}
            </Link>
            <span className="text-soft">
              {o.side === "buy" ? <span className="fig">{formatUsd(o.usdc)}</span> : <span className="fig">{Math.floor(o.tokens).toLocaleString("en-US")} tokens</span>} at{" "}
              <span className="fig text-ink">{formatPrice(o.price)}</span>
            </span>
          </span>
          <Button variant="ghost" size="xs" onClick={() => cancel.mutate(o.id)} disabled={cancel.isPending}>
            Cancel
          </Button>
        </li>
      ))}
    </ul>
  );
}
