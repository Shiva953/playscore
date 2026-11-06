"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Countdown, Delta, PositionBadge, Ticker } from "@/components/common/bits";
import { EmptyState, LoadingBlock } from "@/components/common/states";
import { Progress } from "@/components/ui/progress";
import { BondingCurveChart } from "@/components/player/charts";
import { TradePanel } from "@/components/player/trade-panel";
import { formatDateTime, formatPct, formatPrice, formatRelative, formatUsd } from "@/lib/format";
import type { PlayerSummary } from "@/lib/protocol/types";
import { useNow, usePlayer, usePlayers } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/**
 * Launch: where the ICOs happen (the v1 prototype's #/ico). One live launch in focus with its curve and
 * a ticket, every live launch as a card, what starts next, and what just bonded.
 */
export function LaunchPage({ selected }: { selected?: string }) {
  const router = useRouter();
  const q = usePlayers();
  const all = useMemo(() => q.data ?? [], [q.data]);
  const live = useMemo(() => all.filter((p) => p.status === "launching").sort((a, b) => b.bondProgress - a.bondProgress), [all]);
  const next = useMemo(() => all.filter((p) => p.status === "scheduled").sort((a, b) => (a.launchAt ?? Infinity) - (b.launchAt ?? Infinity)), [all]);
  const bonded = useMemo(() => all.filter((p) => p.status === "trading" && p.bondedAt).sort((a, b) => (b.bondedAt ?? 0) - (a.bondedAt ?? 0)), [all]);
  const focus = live.find((p) => p.id === selected) ?? live[0];

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <LoadingBlock className="h-16" />
        <LoadingBlock className="h-[420px]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[60ch] flex-col gap-1.5">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.02em] text-ink">Launch</h1>
          <p className="text-sm text-soft">
            Every player starts on a bonding curve: the earlier you buy, the lower the price. At $25,000 raised the player bonds, a trading pool opens, and holders
            start earning from matchday boards.
          </p>
        </div>
        <dl className="flex gap-6 text-[13px]">
          <div className="flex flex-col">
            <dt className="text-soft">Live now</dt>
            <dd className="fig fig-prop text-[20px] font-semibold text-ink">{live.length}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-soft">Next launch</dt>
            <dd className="fig text-[20px] font-semibold text-ink">{next[0]?.launchAt ? <Countdown to={next[0].launchAt} /> : "—"}</dd>
          </div>
        </dl>
      </header>

      {focus ? (
        <Focus id={focus.id} />
      ) : (
        <EmptyState title="No live launches right now">The next players launch at 14:00 and 20:00 UTC. They appear here the moment their curve opens.</EmptyState>
      )}

      {live.length ? (
        <section aria-labelledby="live-title" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="live-title" className="text-base font-medium text-ink">
              Live launches
            </h2>
            <span className="text-[13px] text-soft">Closest to bonding first</span>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {live.map((p) => (
              <li key={p.id}>
                <LaunchCard p={p} active={p.id === focus?.id} onPick={() => router.replace(`/launch?p=${p.id}`, { scroll: false })} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-6">
        <StartingNext list={next.slice(0, 8)} />
        <JustBonded list={bonded.slice(0, 6)} />
      </div>
    </div>
  );
}

/** The launch in focus: curve, raise and an inline ticket (buys fill on the curve). */
function Focus({ id }: { id: string }) {
  const q = usePlayer(id);
  if (!q.data) return <LoadingBlock className="h-[420px]" />;
  const p = q.data;
  const left = Math.max(0, p.curve.threshold - p.raised);
  return (
    <section aria-label={`${p.name} launch`} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5 rounded-2xl bg-surface p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Ticker ticker={p.ticker} chip />
              <PositionBadge position={p.position} />
            </div>
            <Link href={`/player/${p.id}`} className="text-xl font-semibold tracking-[-0.01em] text-ink hover:underline">
              {p.name}
            </Link>
            <span className="text-sm text-soft">
              {p.club}, {p.leagueName}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[12px] text-soft">Curve price</span>
            <span className="fig fig-prop text-[30px] leading-none font-semibold text-up">{formatPrice(p.price)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-soft">
              <span className="fig fig-prop text-[20px] font-semibold text-ink">{formatUsd(p.raised, { decimals: 0 })}</span> of $25,000 raised
            </span>
            <span className="fig text-ink">{formatPct(p.bondProgress, { decimals: 0 })}</span>
          </div>
          <Progress value={p.bondProgress * 100} tone="up" aria-label={`${p.name} bonding progress`} />
          <span className="text-[13px] text-soft">
            {formatUsd(left, { decimals: 0 })} to go. The pool opens at {formatPrice(p.curve.poolOpenPrice)}, where the curve ends.
          </span>
        </div>
        <BondingCurveChart sold={p.curve.sold} myAvgEntry={p.holding && p.holding.tokens > 0 ? p.holding.costBasis / p.holding.tokens : null} />
      </div>
      <TradePanel key={p.id} player={p} compact />
    </section>
  );
}

function LaunchCard({ p, active, onPick }: { p: PlayerSummary; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn("flex h-full w-full flex-col gap-3 rounded-2xl bg-surface px-5 py-4 text-left transition-colors duration-150 hover:bg-[#161616]", active && "outline-1 -outline-offset-1 outline-up/40")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Ticker ticker={p.ticker} className="text-[13px] text-ink" />
          <PositionBadge position={p.position} />
        </span>
        <span className="fig text-sm text-ink">{formatPrice(p.price)}</span>
      </div>
      <span className="flex flex-col gap-0.5">
        <span className="text-base font-medium text-ink">{p.name}</span>
        <span className="text-xs text-faint">{p.club}</span>
      </span>
      <Progress value={p.bondProgress * 100} tone="up" aria-label={`${p.name} bonding progress`} />
      <span className="flex justify-between text-xs text-soft">
        <span>
          <span className="fig text-ink">{formatUsd(p.raised, { decimals: 0 })}</span> of $25,000
        </span>
        <span className="fig text-ink">{formatPct(p.bondProgress, { decimals: 0 })}</span>
      </span>
    </button>
  );
}

function StartingNext({ list }: { list: PlayerSummary[] }) {
  return (
    <section aria-labelledby="next-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="next-title" className="text-base font-medium text-ink">
          Starting next
        </h2>
        <span className="text-[13px] text-soft">14:00 and 20:00 UTC on weekdays</span>
      </div>
      {list.length ? (
        <ul className="flex flex-col divide-y divide-rule rounded-2xl bg-surface px-5">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-3">
              <Link href={`/player/${p.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                <Ticker ticker={p.ticker} className="text-[13px] text-ink" />
                <span className="truncate text-sm text-soft">{p.name}</span>
                <PositionBadge position={p.position} />
              </Link>
              <span className="flex shrink-0 flex-col items-end text-[12px]">
                {p.launchAt ? (
                  <>
                    <Countdown to={p.launchAt} className="fig text-[14px] text-ink" />
                    <span className="text-faint">{formatDateTime(p.launchAt)}</span>
                  </>
                ) : (
                  <span className="text-soft">Soon</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Everyone has launched">New launches are chosen by holder vote from Season 1.</EmptyState>
      )}
    </section>
  );
}

function JustBonded({ list }: { list: PlayerSummary[] }) {
  const now = useNow();
  return (
    <section aria-labelledby="bonded-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="bonded-title" className="text-base font-medium text-ink">
          Just bonded
        </h2>
        <span className="text-[13px] text-soft">Now trading in their pool</span>
      </div>
      {list.length ? (
        <ul className="flex flex-col divide-y divide-rule rounded-2xl bg-surface px-5">
          {list.map((p) => (
            <li key={p.id}>
              <Link href={`/trade/${p.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-90">
                <span className="flex min-w-0 items-center gap-2">
                  <Ticker ticker={p.ticker} className="text-[13px] text-ink" />
                  <span className="truncate text-sm text-soft">{p.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-4 text-[12px]">
                  <span className="text-faint">{now && p.bondedAt ? `bonded ${formatRelative(p.bondedAt, now)}` : ""}</span>
                  <span className="flex flex-col items-end">
                    <span className="fig text-[14px] text-ink">{formatPrice(p.price)}</span>
                    <Delta value={p.change24h} decimals={1} className="text-[12px]" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nobody has bonded yet">Players move here the moment their curve reaches $25,000.</EmptyState>
      )}
    </section>
  );
}
