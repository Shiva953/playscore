"use client";

import type { ReactNode } from "react";
import { Delta, LiveFigure } from "@/components/common/bits";
import { Progress } from "@/components/ui/progress";
import { formatDateTime, formatPct, formatPrice, formatScore, formatUsd, formatUsdCompact } from "@/lib/format";
import type { PlayerDetail } from "@/lib/protocol/types";
import { cn } from "@/lib/utils";

/**
 * The market, read off the chart it belongs to (pump.fun, vector, sapling lead with market cap over the
 * line). One big figure on a scoreboard (market cap, or the raise while launching), the price beside it in
 * the colour of its move, and the other facts as one quiet row under the chart. No boxes, no rules: space
 * and size carry the grouping.
 */
export function MarketHeadline({ p, className }: { p: PlayerDetail; className?: string }) {
  const dir = Math.abs(p.change24h) < 1e-9 ? "flat" : p.change24h > 0 ? "up" : "down";
  if (p.status === "launching") {
    return (
      <div className={cn("flex min-w-0 flex-col gap-2", className)}>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <Figure label="Raised">
            <LiveFigure value={p.raised} format={(n) => formatUsd(n, { decimals: 0 })} tick className="fig-prop text-[2.75rem] leading-none text-ink" />
            <span className="pb-1 text-[0.9375rem] text-soft">of $25,000</span>
          </Figure>
          <Figure label="Curve price" small>
            <LiveFigure value={p.price} format={formatPrice} className="fig-prop text-[1.5rem] leading-none text-ink" />
          </Figure>
        </div>
        <div className="flex max-w-[28rem] items-center gap-3">
          <Progress value={p.bondProgress * 100} tone="brand" aria-label={`${p.name} bonding progress`} />
          <span className="fig shrink-0 text-[0.8125rem] text-brand">{formatPct(p.bondProgress, { decimals: 0 })}</span>
        </div>
      </div>
    );
  }
  if (p.status === "scheduled") {
    return (
      <Figure label="Launches" className={className}>
        <span className="fig-prop fig text-[2rem] leading-none text-ink">{p.launchAt ? formatDateTime(p.launchAt) : "Soon"}</span>
      </Figure>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-end gap-x-6 gap-y-2", className)}>
      <Figure label="Market cap">
        <LiveFigure value={p.marketCap} format={formatUsdCompact} flash={false} className="fig-prop text-[2.75rem] leading-none text-ink" />
        <span className={cn("mb-1 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[0.8125rem] font-semibold", dir === "down" ? "bg-down-tint" : dir === "up" ? "bg-up-tint" : "bg-raised")}>
          <Delta value={p.change24h} />
          <span className="text-[0.6875rem] font-medium text-soft">24h</span>
        </span>
      </Figure>
      <Figure label="Price" small>
        <span className={cn(dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-ink")} aria-label="Price">
          <LiveFigure value={p.price} format={formatPrice} className="fig-prop text-[1.5rem] leading-none" />
        </span>
      </Figure>
    </div>
  );
}

function Figure({ label, children, small = false, className }: { label: string; children: ReactNode; small?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col", small ? "gap-1.5" : "gap-2", className)}>
      <span className="text-[0.8125rem] leading-none text-soft">{label}</span>
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1">{children}</div>
    </div>
  );
}

/** The rest of the market as one row under the chart: label over figure, spaced, nothing boxed. */
export function MarketFacts({ p, className }: { p: PlayerDetail; className?: string }) {
  const trading = p.status === "trading";
  const items: { label: string; value: ReactNode; hint?: string }[] = trading
    ? [
        { label: "24h volume", value: formatUsdCompact(p.volume24h) },
        { label: "Pool depth", value: formatUsdCompact(p.liquidityUsd) },
        { label: "Form", value: formatScore(p.avgScore) },
        { label: "Last score", value: formatScore(p.lastScore), hint: p.lastBoardRank ? `#${p.lastBoardRank} on a board` : undefined },
      ]
    : [
        { label: "To bond", value: formatUsd(Math.max(0, p.curve.threshold - p.raised), { decimals: 0 }) },
        { label: "Pool opens at", value: formatPrice(p.curve.poolOpenPrice) },
        { label: "Form", value: formatScore(p.avgScore) },
        { label: "Last score", value: formatScore(p.lastScore), hint: p.lastBoardRank ? `#${p.lastBoardRank} on a board` : undefined },
      ];
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10", className)}>
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-[0.75rem] leading-none text-faint">{it.label}</dt>
          <dd className="flex items-baseline gap-2">
            <span className="fig text-[1.125rem] leading-none font-semibold text-ink">{it.value}</span>
            {it.hint ? <span className="text-[0.75rem] text-faint">{it.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
