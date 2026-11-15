import type { CSSProperties, ReactNode } from "react";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton, TextBone } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading states drawn as the screen they stand in for. Each one keeps the real frame (cards, grid, gaps,
 * paddings) and everything that doesn't depend on data (titles, labels, column heads, tab names), and puts
 * a bone only where a value, a name or a picture will land, at that thing's size. So when the data arrives
 * the page fills in instead of being replaced.
 *
 * Every skeleton here mirrors a component; when you move something in the real layout, move its bone.
 */

/** Widths that repeat without looking stamped: names and figures differ in length, so the bones do too. */
const NAME = ["w-28", "w-24", "w-32", "w-20", "w-28", "w-36", "w-24", "w-28", "w-20", "w-32", "w-24", "w-28"];
const TICK = ["w-10", "w-12", "w-11", "w-8", "w-10", "w-12", "w-9", "w-11", "w-8", "w-10", "w-9", "w-12"];
const at = <T,>(list: T[], i: number): T => list[i % list.length]!;

function Busy({ label, className, children, ...rest }: { label: string; className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="status" aria-busy="true" aria-label={label} data-state="loading" className={className} {...rest}>
      {children}
    </div>
  );
}

/** A player's kit tile (PlayerAvatar): same corner ratio at every size. */
export function KitBone({ size, className }: { size: number; className?: string }) {
  return <Skeleton className={cn("shrink-0 rounded-[28%]", className)} style={{ width: size, height: size }} />;
}

const pill = "h-5 rounded-full";

// ---------------------------------------------------------------- rows

/** A row of the trade feed: a face, who and what on two lines, the amount and the time on the right. */
function FeedRow({ i }: { i: number }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-2">
      <Skeleton className="size-7 rounded-full" />
      <div className="flex min-w-0 flex-col">
        <TextBone className="text-[0.8125rem]" width={at(NAME, i)} />
        <TextBone className="text-[0.75rem]" width={at(["w-24", "w-20", "w-28"], i)} />
      </div>
      <div className="flex flex-col items-end">
        <TextBone className="text-[0.875rem]" width={at(["w-14", "w-12", "w-16"], i)} />
        <TextBone className="text-[0.75rem]" width="w-10" />
      </div>
    </li>
  );
}

export function FeedSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <Busy label="Loading trades" className={className}>
      <ul className="flex flex-col">
        {Array.from({ length: rows }, (_, i) => (
          <FeedRow key={i} i={i} />
        ))}
      </ul>
    </Busy>
  );
}

/** A player in a list: kit, ticker over name, and a figure over its change on the right. */
export function PlayerRowBone({ i, kit = 32, className }: { i: number; kit?: number; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <span className="flex min-w-0 items-center gap-2.5">
        <KitBone size={kit} />
        <span className="flex min-w-0 flex-col">
          <TextBone className="text-[0.8125rem]" width={at(TICK, i)} />
          <TextBone className="text-[0.75rem]" width={at(NAME, i)} />
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <TextBone className="text-[0.75rem]" width="w-14" />
        <TextBone className="text-[0.75rem]" width="w-9" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- chart

/**
 * A chart that hasn't drawn: its own grid lines and axis ticks in place, a faint line where the series
 * will run and the volume bars under it. The plot area is the chart's real height.
 */
export function ChartSkeleton({ height = 340, className, style, volume = true }: { height?: number; className?: string; style?: CSSProperties; volume?: boolean }) {
  const bars = [18, 26, 14, 40, 22, 30, 12, 46, 28, 20, 34, 16, 52, 24, 38, 18, 30, 44, 22, 36, 14, 28, 48, 20];
  return (
    <Busy label="Loading chart" className={cn("relative w-full overflow-hidden", className)} style={{ height, ...style }}>
      {/* grid: four lines, like the chart's */}
      <div className="absolute inset-x-0 top-0 bottom-7 right-14 flex flex-col justify-between py-3">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-px w-full bg-[var(--grid)]" />
        ))}
      </div>
      {/* the line to come */}
      <svg className="absolute inset-x-0 top-0 right-14 h-[calc(100%-28px)] w-[calc(100%-56px)]" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M0 74 L8 71 L15 64 L23 60 L30 67 L38 62 L46 63 L54 58 L61 52 L68 44 L74 53 L80 38 L86 26 L92 24 L100 25"
          fill="none"
          stroke="var(--raised)"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {volume ? (
        <div className="absolute inset-x-0 right-14 bottom-7 flex h-[18%] items-end gap-[3px]">
          {bars.map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-none rounded-t-[2px]" style={{ height: `${h}%` }} />
          ))}
        </div>
      ) : null}
      {/* price ticks */}
      <div className="absolute top-0 right-0 bottom-7 flex w-12 flex-col justify-between py-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-2.5 w-10" />
        ))}
      </div>
      {/* time ticks */}
      <div className="absolute inset-x-0 right-14 bottom-0 flex h-5 items-center justify-around">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-2.5 w-8" />
        ))}
      </div>
    </Busy>
  );
}

/** The scoreboard over a chart (MarketHeadline): the labels are fixed, the two figures are bones at their size. */
function HeadlineBone() {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <div className="flex flex-col gap-2">
        <span className="text-[0.8125rem] leading-none text-soft">Market cap</span>
        <div className="flex items-end gap-2.5">
          <Skeleton className="h-11 w-36 rounded-lg" />
          <Skeleton className="mb-1 h-6 w-[4.5rem] rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8125rem] leading-none text-soft">Price</span>
        <Skeleton className="h-6 w-24" />
      </div>
    </div>
  );
}

/** The row of facts under a chart (MarketFacts). */
function FactsBone() {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
      {["24h volume", "Pool depth", "Form", "Last score"].map((label, i) => (
        <div key={label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-[0.75rem] leading-none text-faint">{label}</dt>
          <dd>
            <Skeleton className={cn("h-[1.125rem]", at(["w-14", "w-16", "w-8", "w-9"], i))} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Ticker chip, position and status badges, then the name: the top of a player's card. */
function IdentityBone({ kit, name = "text-[0.875rem]" }: { kit: number; name?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <KitBone size={kit} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className={cn(pill, "w-10")} />
          <Skeleton className={cn(pill, "w-14")} />
        </div>
        <TextBone className={name} width="w-44" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the trade ticket

/** The ticket with nothing in it yet: its tabs, labels and amounts are real, only the figures are bones. */
export function TicketSkeleton({ compact = false, limit = false }: { compact?: boolean; limit?: boolean }) {
  return (
    <Card size={compact ? "sm" : "default"}>
      <CardContent>
        <Busy label="Loading the trade ticket" className="flex flex-col gap-4">
          <div className="flex h-11 w-full items-center rounded-full p-1 ring-1 ring-edge ring-inset">
            <span className="flex h-full flex-1 items-center justify-center rounded-full bg-up-tint text-[1rem] font-semibold text-up">Buy</span>
            <span className="flex h-full flex-1 items-center justify-center text-[1rem] font-semibold text-soft">Sell</span>
          </div>
          {limit ? (
            <div className="flex gap-4 text-[0.8125rem]">
              <span className="flex h-7 items-center border-b-2 border-ink text-ink">Market</span>
              <span className="flex h-7 items-center border-b-2 border-transparent text-soft">Limit</span>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-soft">You pay</span>
            <div className="flex h-14 items-center gap-2 rounded-2xl bg-ground px-4 ring-1 ring-control">
              <span className="text-2xl text-faint">$</span>
              <span className="fig fig-prop text-[2rem] text-faint">0</span>
            </div>
            <div className="flex gap-1.5">
              {[25, 50, 100, 250].map((v) => (
                <span key={v} className="fig flex h-9 flex-1 items-center justify-center rounded-full bg-up-tint/55 text-[0.875rem] font-medium text-up/70">
                  ${v}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <TextBone className="text-sm" width="w-full" />
            <TextBone className="text-sm" width="w-3/4" />
          </div>
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-[62px] w-full rounded-xl" />
          <div className="flex flex-col gap-2">
            <div className="flex justify-between">
              <TextBone className="text-sm" width="w-16" />
              <TextBone className="text-sm" width="w-28" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
            <TextBone className="text-xs" width="w-4/5" />
          </div>
        </Busy>
      </CardContent>
    </Card>
  );
}

function BookSkeleton() {
  const rows = (n: number, offset: number) =>
    Array.from({ length: n }, (_, i) => (
      <div key={i} className="grid h-6 grid-cols-[1fr_1fr_1fr] items-center px-2">
        <Skeleton className="h-2.5 w-14" />
        <Skeleton className="ml-auto h-2.5 w-9" />
        <Skeleton className={cn("ml-auto h-2.5", at(["w-10", "w-11", "w-9"], i + offset))} />
      </div>
    ));
  return (
    <Busy label="Loading the order book" className="flex flex-col text-[0.75rem]">
      <div className="grid grid-cols-[1fr_1fr_1fr] px-2 pb-1.5 text-faint">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      {rows(6, 0)}
      <div className="my-1 flex items-baseline justify-between rounded-lg bg-raised px-2 py-1.5">
        <Skeleton className="h-3.5 w-16" />
        <span className="text-faint">Pool price</span>
      </div>
      {rows(6, 1)}
    </Busy>
  );
}

// ---------------------------------------------------------------- the trade terminal

/** The watchlist's rows while the players load (the search, filters and sort above them are already live). */
export function WatchlistRowsSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} aria-hidden="true">
          <PlayerRowBone i={i} className="px-2 py-1.5" />
        </li>
      ))}
    </>
  );
}

/** src/components/trade/terminal.tsx: list | chart + tabs | ticket + book. */
export function TerminalSkeleton() {
  return (
    <div data-fullbleed className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 px-3 pt-3 pb-24 md:px-4 md:pb-6" aria-busy="true">
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <Card size="sm" className="order-4 max-lg:max-h-[560px] lg:order-none lg:min-h-[640px]">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
            <div className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-ground px-3 ring-1 ring-control">
              <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <span className="text-[0.8125rem] text-faint">Search players</span>
            </div>
            <div className="flex shrink-0 gap-1">
              {["All", "FWD", "MID", "DEF", "GK"].map((x, i) => (
                <span key={x} className={cn("flex h-7 flex-1 items-center justify-center rounded-full text-[0.75rem] font-semibold", i === 0 ? "bg-raised text-ink" : "text-soft")}>
                  {x}
                </span>
              ))}
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-1.5">
              <Skeleton className="h-8 rounded-full" />
              <Skeleton className="h-8 rounded-full" />
            </div>
            <Skeleton className="h-8 w-36 shrink-0 rounded-full" />
            <ul className="-mx-1 flex min-h-0 flex-1 flex-col overflow-hidden px-1">
              <WatchlistRowsSkeleton rows={11} />
            </ul>
          </CardContent>
        </Card>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3">
          <Card size="sm" className="order-1 min-w-0 lg:order-none">
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-6 max-lg:hidden" />
                  <IdentityBone kit={48} />
                </div>
                <Skeleton className="h-8 w-44 rounded-full" />
              </div>
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                <HeadlineBone />
                <div className="flex gap-1">
                  {["w-14", "w-16", "w-24", "w-14", "w-16"].map((w, i) => (
                    <Skeleton key={i} className={cn("h-7 rounded-full", w)} />
                  ))}
                </div>
              </div>
              <ChartSkeleton height={380} />
              <FactsBone />
            </CardContent>
          </Card>
          <Card size="sm" className="order-3 min-w-0 lg:order-none lg:flex-1">
            <CardContent className="flex flex-col gap-3">
              <div className="flex h-9 items-center gap-5 text-sm font-medium text-soft">
                <span className="text-ink">Trades</span>
                <span>Positions</span>
                <span>Liquidity</span>
                <span>Open orders</span>
              </div>
              <FeedSkeleton rows={5} />
            </CardContent>
          </Card>
        </div>

        <div className="order-2 flex flex-col gap-3 lg:order-none">
          <TicketSkeleton compact limit />
          <Card size="sm" className="lg:flex-1">
            <CardContent>
              <BookSkeleton />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a player's page

/** src/components/player/player-hub.tsx: the title row, then chart beside ticket. */
export function PlayerHubSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <KitBone size={88} className="max-sm:hidden" />
          <KitBone size={64} className="sm:hidden" />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className={cn(pill, "w-10")} />
              <Skeleton className={cn(pill, "w-14")} />
            </div>
            <Skeleton className="h-[1.9rem] w-56 rounded-lg sm:h-9 sm:w-72" />
            <TextBone className="text-sm" width="w-64" />
            <TextBone className="text-sm" width="w-52" />
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <HeadlineBone />
              <Skeleton className="h-8 w-44 rounded-full" />
            </div>
            <ChartSkeleton height={340} />
            <FactsBone />
          </CardContent>
        </Card>
        <TicketSkeleton />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- portfolio

function TileBone({ i }: { i: number }) {
  return (
    <li className="flex flex-col gap-4 rounded-2xl p-4 ring-1 ring-edge ring-inset">
      <div className="flex items-center gap-3">
        <KitBone size={48} />
        <span className="flex min-w-0 flex-col">
          <TextBone className="text-[0.9375rem]" width={at(NAME, i)} />
          <TextBone className="text-[0.75rem]" width="w-10" />
        </span>
        <Skeleton className="ml-auto h-6 w-16" />
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <Skeleton className="h-7 w-24" />
          <TextBone className="text-[0.75rem]" width="w-20" />
        </span>
        <span className="flex flex-col items-end gap-1">
          <TextBone className="text-[0.9375rem]" width="w-14" />
          <Skeleton className="h-[22px] w-16 rounded-full" />
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-rule pt-3">
        <TextBone className="text-[0.75rem]" width="w-28" />
        <TextBone className="text-[0.75rem]" width="w-20" />
      </div>
    </li>
  );
}

/** src/components/portfolio/portfolio-page.tsx: who you are, the headline figure over its line, your players. */
export function PortfolioSkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-busy="true">
      <div className="flex flex-col gap-4">
        <header className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-5 w-40" />
            <div className="flex gap-1.5">
              <Skeleton className={cn(pill, "w-14")} />
              <Skeleton className={cn(pill, "w-16")} />
              <Skeleton className={cn(pill, "w-24")} />
            </div>
          </div>
        </header>
        <section className="flex flex-col gap-5 rounded-2xl p-5 ring-1 ring-edge ring-inset md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="flex flex-col gap-2">
              <span className="text-[0.8125rem] text-soft">Portfolio value</span>
              <Skeleton className="h-12 w-64 rounded-xl md:h-16 md:w-80" />
              <TextBone className="text-[0.9375rem]" width="w-72" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28 rounded-full" />
              <Skeleton className="h-9 w-28 rounded-full" />
            </div>
          </div>
          <div className="flex justify-end gap-1">
            {["1H", "24H", "7D", "All"].map((r, i) => (
              <span key={r} className={cn("flex h-7 items-center rounded-full px-3 text-xs font-medium", i === 3 ? "bg-raised text-ink" : "text-soft")}>
                {r}
              </span>
            ))}
          </div>
          <ChartSkeleton height={240} volume={false} />
          <div className="flex flex-col gap-3">
            <div className="flex h-7 gap-[2px]">
              <Skeleton className="flex-[35] rounded-[4px]" />
              <Skeleton className="flex-[65] rounded-[4px]" />
            </div>
            <div className="flex gap-5">
              <TextBone className="text-[0.8125rem]" width="w-24" />
              <TextBone className="text-[0.8125rem]" width="w-28" />
            </div>
          </div>
        </section>
        <Skeleton className="h-[54px] w-full rounded-2xl" />
      </div>
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[1.5rem] leading-[1.17] font-semibold text-ink">Your players</h2>
          <TextBone className="text-sm" width="w-40" />
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <TileBone key={i} i={i} />
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- matchday

function BoardBone({ label }: { label: string }) {
  return (
    <div className="flex flex-col rounded-2xl px-5 py-4 ring-1 ring-edge ring-inset">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-medium text-ink">{label}</h3>
        <TextBone className="text-xs" width="w-14" />
      </div>
      <ol className="mt-2 flex flex-col">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-3 py-2 text-sm">
            <span className="num w-4 text-xs text-faint">{i + 1}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <Skeleton className="size-[26px] rounded-[8px]" />
              <TextBone width={at(NAME, i + label.length)} />
            </span>
            <Skeleton className="h-3 w-6" />
            <Skeleton className="h-3 w-8" />
          </li>
        ))}
      </ol>
      <TextBone className="mt-1 text-xs" width="w-16" />
    </div>
  );
}

/** The matchday strip (the signature line): its track and its three labels are fixed, the times are bones. */
export function StripSkeleton({ className }: { className?: string }) {
  return (
    <Busy label="Loading the matchday" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <TextBone className="text-sm" width="w-52" />
        <TextBone className="text-sm" width="w-24" />
      </div>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-4 h-1 rounded-full bg-raised" />
        <span className="absolute top-2 left-[22%] h-5 w-0.5 rounded-full bg-control" />
        <span className="absolute top-2 left-[86%] h-5 w-0.5 rounded-full bg-control" />
      </div>
      <div className="-mt-2 grid grid-cols-[22fr_64fr_14fr] text-xs text-faint">
        <span className="max-sm:hidden">Trading open</span>
        <span className="col-start-2">Snapshot</span>
        <span className="text-right">Final</span>
      </div>
    </Busy>
  );
}

/** src/components/matchday/matchday-page.tsx. */
export function MatchdaySkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-busy="true">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2.5 text-[2rem] leading-[1.12] font-semibold text-ink">
              Matchday <Skeleton className="h-7 w-14 rounded-lg" />
            </h1>
            <TextBone className="text-sm" width="w-80 max-w-full" />
          </div>
          <TextBone className="text-sm" width="w-24" />
        </div>
        <Card>
          <CardContent>
            <StripSkeleton />
          </CardContent>
        </Card>
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="text-[1.5rem] leading-[1.17] font-semibold text-ink">Your players</h2>
        <Skeleton className="h-[120px] w-full rounded-2xl" />
      </section>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-[1.5rem] leading-[1.17] font-semibold text-ink">Reward boards</h2>
            <TextBone className="text-sm" width="w-full max-w-xl" />
          </div>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            {["FWD", "MID", "DEF", "GK"].map((b) => (
              <BoardBone key={b} label={b} />
            ))}
          </div>
        </section>
        <div className="flex min-w-0 flex-col gap-10">
          <section className="flex flex-col gap-4">
            <h2 className="text-[1.5rem] leading-[1.17] font-semibold text-ink">Live feed</h2>
            <Skeleton className="h-[52px] w-full rounded-2xl" />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-[1.5rem] leading-[1.17] font-semibold text-ink">Top performers</h2>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-rule">
              {["Goals", "Assists", "Cards"].map((l) => (
                <div key={l} className="flex flex-col gap-1 bg-surface px-4 py-3">
                  <span className="text-[0.75rem] text-soft">{l}</span>
                  <Skeleton className="h-7 w-8" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- launch

/** The launch in focus (launch-page.tsx `Focus`): who, the raise toward $25k, the curve, and the ticket. */
export function LaunchFocusSkeleton() {
  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true">
      <div className="flex min-w-0 flex-col gap-5 rounded-2xl p-5 ring-1 ring-edge ring-inset md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <KitBone size={72} />
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-14 rounded-full" />
                <Skeleton className={cn(pill, "w-10")} />
              </div>
              <Skeleton className="h-6 w-48" />
              <TextBone className="text-sm" width="w-32" />
            </div>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <span className="text-[0.75rem] text-soft">Curve price</span>
            <Skeleton className="h-[1.875rem] w-28 rounded-lg" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <TextBone className="text-sm" width="w-40" />
            <TextBone className="text-sm" width="w-8" />
          </div>
          <div className="h-1.5 w-full rounded-full bg-raised" />
          <TextBone className="text-[0.8125rem]" width="w-80 max-w-full" />
        </div>
        <ChartSkeleton height={300} volume={false} />
      </div>
      <TicketSkeleton compact />
    </section>
  );
}

function LaunchCardBone({ i }: { i: number }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl px-5 py-4 ring-1 ring-edge ring-inset">
      <div className="flex items-center justify-between">
        <KitBone size={44} />
        <Skeleton className="h-7 w-14 rounded-full" />
      </div>
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center justify-between gap-2">
          <TextBone className="text-[0.8125rem]" width={at(TICK, i)} />
          <TextBone className="text-[0.8125rem]" width="w-14" />
        </span>
        <TextBone className="text-base" width={at(NAME, i)} />
        <TextBone className="text-xs" width="w-20" />
      </span>
      <div className="h-1.5 w-full rounded-full bg-raised" />
      <span className="flex justify-between">
        <TextBone className="text-xs" width="w-24" />
        <TextBone className="text-xs" width="w-6" />
      </span>
    </li>
  );
}

/** src/components/launch/launch-page.tsx: the header copy is fixed, so it's already there. */
export function LaunchSkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-busy="true">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[60ch] flex-col gap-1.5">
          <h1 className="text-[2rem] leading-[1.12] font-semibold text-ink">Launch</h1>
          <p className="text-sm text-soft">
            Players launch on a bonding curve: the earlier you buy, the cheaper they are. Once the curve bonds, a trading pool is launched.
          </p>
        </div>
        <dl className="flex gap-6 text-[0.8125rem]">
          <div className="flex flex-col gap-1">
            <dt className="text-soft">Live now</dt>
            <dd>
              <Skeleton className="h-7 w-8" />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-soft">Next launch</dt>
            <dd>
              <Skeleton className="h-7 w-16" />
            </dd>
          </div>
        </dl>
      </header>
      <LaunchFocusSkeleton />
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-base font-medium text-ink">Live launches</h2>
          <span className="text-[0.8125rem] text-soft">Closest to bonding first</span>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <LaunchCardBone key={i} i={i} />
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- claim

/** The claim panel (claim-panel.tsx): the amount, the players it came from, the two ways to take it. */
export function ClaimSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <Busy label="Loading your dividends" className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <span className="text-sm text-soft">ready to claim</span>
      </div>
      {!compact ? (
        <ul className="flex flex-col divide-y divide-rule">
          {[0, 1].map((i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2.5">
                <Skeleton className="size-6 rounded-[7px]" />
                <TextBone className="text-sm" width={at(NAME, i)} />
              </span>
              <TextBone className="text-sm" width="w-32" />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-11 rounded-full" />
        <Skeleton className="h-11 rounded-full" />
      </div>
    </Busy>
  );
}
