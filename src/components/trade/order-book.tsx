"use client";

import { formatPrice, formatTokensCompact, formatUsdCompact } from "@/lib/format";
import type { BookLevel } from "@score/core";
import type { LimitOrder, PlayerDetail } from "@/lib/protocol/types";
import { cn } from "@/lib/utils";

const LEVELS = 8;

/**
 * The pool's liquidity as an order book: asks above, bids below, cumulative depth as bars behind each
 * row. Levels come from x·y = k (packages/core `ammBook`), before fees. Your resting limit orders are
 * marked at the nearest level.
 */
export function OrderBook({ player, orders }: { player: PlayerDetail; orders: LimitOrder[] }) {
  if (!player.book) {
    return (
      <p className="px-1 py-3 text-[13px] leading-[1.5] text-soft">
        The book opens when {player.name.split(" ").slice(-1)[0]} bonds. Until then, buys fill on the launch curve.
      </p>
    );
  }
  const { mid, asks, bids } = player.book;
  const a = asks.slice(0, LEVELS);
  const b = bids.slice(0, LEVELS);
  const max = Math.max(a.at(-1)?.cumulativeTokens ?? 0, b.at(-1)?.cumulativeTokens ?? 0, 1);
  const mine = orders.filter((o) => o.playerId === player.id);
  const markAt = (levels: BookLevel[], side: "buy" | "sell") => {
    const marks = new Set<number>();
    for (const o of mine.filter((x) => x.side === side)) {
      let best = 0;
      levels.forEach((l, i) => {
        if (Math.abs(l.price - o.price) < Math.abs(levels[best]!.price - o.price)) best = i;
      });
      marks.add(best);
    }
    return marks;
  };
  const askMarks = markAt(a, "sell");
  const bidMarks = markAt(b, "buy");

  return (
    <div className="flex flex-col text-[12px]" aria-label={`Order book for $${player.ticker}`} role="table">
      <div role="row" className="grid grid-cols-[1fr_1fr_1fr] px-2 pb-1.5 text-faint">
        <span role="columnheader">Price</span>
        <span role="columnheader" className="text-right">
          Size
        </span>
        <span role="columnheader" className="text-right">
          Total
        </span>
      </div>
      {[...a].reverse().map((l, ri) => (
        <Row key={`a${ri}`} level={l} max={max} side="ask" mine={askMarks.has(a.length - 1 - ri)} />
      ))}
      <div role="row" className="my-1 flex items-baseline justify-between rounded-lg bg-raised px-2 py-1.5">
        <span role="cell" className="fig text-[14px] font-semibold text-ink">
          {formatPrice(mid)}
        </span>
        <span role="cell" className="text-faint">
          Pool price
        </span>
      </div>
      {b.map((l, i) => (
        <Row key={`b${i}`} level={l} max={max} side="bid" mine={bidMarks.has(i)} />
      ))}
      <p className="px-2 pt-2 text-[11px] leading-[1.45] text-faint">Pool liquidity as levels (x·y=k), before fees. Your limit orders are marked with a dot.</p>
    </div>
  );
}

function Row({ level, max, side, mine }: { level: BookLevel; max: number; side: "ask" | "bid"; mine: boolean }) {
  return (
    <div role="row" className="relative grid h-6 grid-cols-[1fr_1fr_1fr] items-center px-2">
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0.5 right-0 rounded-sm", side === "ask" ? "bg-down-tint" : "bg-up-tint")}
        style={{ width: `${(level.cumulativeTokens / max) * 100}%` }}
      />
      <span role="cell" className={cn("fig relative flex items-center gap-1.5", side === "ask" ? "text-down" : "text-up")}>
        {formatPrice(level.price)}
        {mine ? (
          <span className="size-1.5 rounded-full bg-ink" role="img" aria-label="Your order" />
        ) : null}
      </span>
      <span role="cell" className="fig relative text-right text-soft">
        {formatTokensCompact(level.tokens)}
      </span>
      <span role="cell" className="fig relative text-right text-ink">
        {formatUsdCompact(level.usdc)}
      </span>
    </div>
  );
}
