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
import { TradeFeed } from "@/components/live/trade-feed";
import { QuickBuy, QuickBuyAmount } from "@/components/live/quick-buy";
import { PlayerAvatar } from "@/components/common/kit";
import { PositionsMini } from "@/components/player/positions-mini";
import { LiquidityPanel } from "@/components/player/liquidity-panel";
import { TradePanel } from "@/components/player/trade-panel";
import { formatPct, formatPrice, formatUsd } from "@/lib/format";
import type { LimitOrder, PlayerDetail, PlayerSummary, PriceRange } from "@/lib/protocol/types";
import { useCancelOrder, usePlayer, usePlayers, usePortfolio, useRecentTrades, useSession } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";
import { OrderBook } from "./order-book";
import { MarketFacts, MarketHeadline } from "@/components/player/market-header";
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
        <LoadingBlock className="h-[640px]" />
        <LoadingBlock className="h-[640px]" />
        <LoadingBlock className="h-[640px]" />
      </div>
    );
  }

  return (
    <div
      data-fullbleed
      // While the next player loads, the last one stays on screen (no empty flash) but reads as stale.
      aria-busy={q.isPlaceholderData || undefined}
      className={cn("mx-auto flex w-full max-w-[1680px] flex-col gap-3 px-3 pt-3 pb-24 transition-opacity duration-150 md:px-4 md:pb-6", q.isPlaceholderData && "opacity-60")}
    >
      {/*
        Phones: chart, ticket and book, the tabs, then the list. Desktop: list | chart + tabs | ticket + book,
        and all three columns end on the same line: the list fills the row and scrolls inside it, and the
        last card in the middle and right columns stretches to meet it.
      */}
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <Card size="sm" className="order-4 min-h-0 max-lg:max-h-[560px] lg:relative lg:order-none lg:min-h-[640px] lg:py-0">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 lg:absolute lg:inset-0 lg:py-4">
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

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3">
          <div className="order-1 min-w-0 lg:order-none">
            <ChartCard p={p} onPrev={() => go(nav.prev)} onNext={() => go(nav.next)} />
          </div>
          <BottomTabs p={p} orders={pf.data?.orders ?? []} className="order-3 min-w-0 lg:order-none lg:flex-1" />
        </div>

        <div className="order-2 flex flex-col gap-3 lg:order-none">
          <TradePanel key={p.id} player={p} compact allowLimit shortcuts />
          <Card size="sm" className="lg:flex-1">
            <CardContent>
              <OrderBook player={p} orders={pf.data?.orders ?? []} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- who (top of the chart card)

function Identity({ p, onPrev, onNext }: { p: PlayerDetail; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex flex-col max-lg:hidden">
        <Button variant="ghost" size="icon-xs" onClick={onPrev} aria-label="Previous player" title="Previous player (↑)">
          <ChevronUp aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onNext} aria-label="Next player" title="Next player (↓)">
          <ChevronDown aria-hidden="true" />
        </Button>
      </div>
      <PlayerAvatar id={p.id} size={48} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Ticker ticker={p.ticker} chip />
          <PositionBadge position={p.position} />
          <StatusBadge status={p.status} progress={p.bondProgress} />
        </div>
        <h1 className="truncate font-sans text-[0.875rem] font-medium tracking-normal">
          <Link href={`/player/${p.id}`} className="text-ink hover:underline">
            {p.name} <span className="font-normal text-soft">{p.club}</span>
          </Link>
        </h1>
      </div>
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
  // Keep the selected row in view as ↑/↓ move through the list. Scroll the list only, never the page:
  // scrollIntoView also scrolled the window, which on a phone (list at the bottom) jumped the page on load.
  useEffect(() => {
    const ul = box.current;
    const row = ul?.querySelector<HTMLElement>(`[data-id="${selected}"]`);
    if (!ul || !row) return;
    const top = row.offsetTop - ul.offsetTop;
    if (top < ul.scrollTop) ul.scrollTop = top;
    else if (top + row.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = top + row.offsetHeight - ul.clientHeight;
  }, [selected]);
  return (
    <>
      <label className="flex h-9 items-center gap-2 rounded-full bg-ground px-3 ring-1 ring-control focus-within:ring-ink">
        <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
        <span className="sr-only">Search players</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search players" className="w-full min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-faint sm:text-[0.8125rem]" />
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
            className={cn("h-7 flex-1 rounded-full text-[0.75rem] font-semibold transition-colors duration-150", position === x ? "bg-raised text-ink" : "text-soft hover:text-ink")}
          >
            {x === "ALL" ? "All" : x}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={league} onValueChange={(v) => setLeague(v as LeagueFilter)}>
          <SelectTrigger aria-label="League" className="w-full pl-3 text-[0.75rem]">
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
          <SelectTrigger aria-label="Sort by" className="w-full pl-3 text-[0.75rem]">
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
      <QuickBuyAmount className="self-start" />
      <ul ref={box} className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 max-lg:max-h-[420px]" aria-label="Players">
        {loading ? <li className="px-2 py-3 text-[0.8125rem] text-soft">Loading players…</li> : null}
        {!loading && list.length === 0 ? <li className="px-2 py-3 text-[0.8125rem] text-soft">No players match.</li> : null}
        {list.map((p) => (
          <li key={p.id} data-id={p.id} className="group/row relative">
            <button
              type="button"
              onClick={() => onPick(p.id)}
              aria-current={p.id === selected ? "true" : undefined}
              className={cn("flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left transition-colors duration-150 hover:bg-raised/60", p.id === selected && "bg-raised [--kit-ring:var(--raised)]")}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <PlayerAvatar id={p.id} size={32} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[0.8125rem] font-semibold text-ink">${p.ticker}</span>
                  <span className="truncate text-[0.75rem] text-faint">{p.name}</span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end transition-opacity duration-150 [@media(hover:hover)]:group-focus-within/row:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-0">
                <LiveFigure value={p.price} format={formatPrice} className="text-[0.75rem] text-ink" />
                {p.status === "trading" ? (
                  <Delta value={p.change24h} decimals={1} className="text-[0.75rem]" />
                ) : (
                  <span className="text-[0.75rem] text-soft">{formatPct(p.bondProgress, { decimals: 0 })} bonded</span>
                )}
              </span>
            </button>
            {/* One-tap buy takes the price's place while the pointer is on the row (pointer devices only). */}
            <QuickBuy
              playerId={p.id}
              ticker={p.ticker}
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 opacity-0 [@media(hover:hover)]:group-focus-within/row:pointer-events-auto [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:group-hover/row:pointer-events-auto [@media(hover:hover)]:group-hover/row:opacity-100"
            />
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------- the chart

/**
 * The chart card is the page's centre: who, the market cap and price as a scoreboard over the line, the
 * line itself, and the other facts in one row under it. Everything about the market lives on the chart.
 */
function ChartCard({ p, onPrev, onNext }: { p: PlayerDetail; onPrev: () => void; onNext: () => void }) {
  const [range, setRange] = useState<PriceRange>("6D");
  const [ind, setInd] = useState<Indicators>({ ma: true, ema: false, bb: false, rsi: false, vol: true });
  return (
    <Card size="sm" aria-label={`${p.name} market`}>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Identity p={p} onPrev={onPrev} onNext={onNext} />
          {p.status === "trading" ? <RangeControl value={range} onChange={setRange} /> : null}
        </div>
        <h2 className="sr-only">{p.status === "trading" ? "Price chart" : p.status === "launching" ? "Launch curve" : "Upcoming launch"}</h2>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <MarketHeadline p={p} />
          {p.status === "trading" ? (
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
          ) : null}
        </div>
        {p.status === "trading" ? (
          <PriceChart key={p.id} playerId={p.id} range={range} indicators={ind} height={ind.rsi ? 440 : 380} />
        ) : p.status === "launching" ? (
          <BondingCurveChart sold={p.curve.sold} myAvgEntry={p.holding && p.holding.tokens > 0 ? p.holding.costBasis / p.holding.tokens : null} />
        ) : (
          <EmptyState title="Not launched yet">Charts appear when the launch opens.</EmptyState>
        )}
        {p.status !== "scheduled" ? <MarketFacts p={p} /> : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- under the chart

function BottomTabs({ p, orders, className }: { p: PlayerDetail; orders: LimitOrder[]; className?: string }) {
  return (
    <Card size="sm" className={className}>
      <CardContent>
        <Tabs defaultValue="trades" className="gap-3">
          <TabsList>
            <TabsTrigger value="trades">
              <span className="live-dot relative mr-1.5 inline-block size-1.5 rounded-full bg-brand text-brand" aria-hidden="true" />
              Trades
            </TabsTrigger>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            {p.status === "trading" ? <TabsTrigger value="liquidity">Liquidity</TabsTrigger> : null}
            <TabsTrigger value="orders">
              Open orders{orders.length ? <span className="fig ml-1.5 text-soft">{orders.length}</span> : null}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="trades">
            <TerminalTrades p={p} />
          </TabsContent>
          <TabsContent value="positions">
            <PositionsMini />
          </TabsContent>
          {p.status === "trading" ? (
            <TabsContent value="liquidity">
              <LiquidityPanel player={p} />
            </TabsContent>
          ) : null}
          <TabsContent value="orders">
            <OpenOrders orders={orders} current={p.id} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** This player's trades; while they're few, the rest of the market fills in under them. */
function TerminalTrades({ p }: { p: PlayerDetail }) {
  const own = useRecentTrades(p.id, 10);
  const n = own.data?.length ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <TradeFeed playerId={p.id} limit={10} />
      {own.data && n < 6 ? (
        <section aria-labelledby="market-trades" className="flex flex-col gap-1">
          <h3 id="market-trades" className="px-2 text-[0.8125rem] font-medium text-soft">
            Across the market
          </h3>
          <TradeFeed playerId={null} limit={8 - n} />
        </section>
      ) : null}
    </div>
  );
}

function OpenOrders({ orders, current }: { orders: LimitOrder[]; current: string }) {
  const session = useSession();
  const cancel = useCancelOrder();
  if (!session.data) return <SignedOutState title="Sign in to place limit orders" />;
  if (!orders.length) return <p className="py-3 text-sm text-soft">No open orders. Switch the ticket to Limit to rest one on the pool.</p>;
  const sorted = [...orders].sort((a, b) => Number(b.playerId === current) - Number(a.playerId === current) || b.createdAt - a.createdAt);
  return (
    <ul className="flex flex-col divide-y divide-rule text-[0.8125rem]">
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
