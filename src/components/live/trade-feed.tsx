"use client";

import Link from "next/link";
import { EmptyState, LoadingRows, QueryState } from "@/components/common/states";
import { PlayerAvatar } from "@/components/common/kit";
import { UserAvatar } from "@/components/common/user-avatar";
import { formatPrice, formatRelative, formatTokens, formatUsd } from "@/lib/format";
import { tradeWeight, traderFor } from "@/lib/identity/traders";
import { useNow, useRecentTrades, useSession } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";
import { useArrivals } from "./use-arrivals";

/**
 * Trades as people doing things: a face, who, bought or sold, how much, at what price, how long ago.
 * New trades slide in at the top and tint toward their side. With no `playerId` it shows every player
 * and each row carries the player's kit.
 */
export function TradeFeed({ playerId, limit = 12, className }: { playerId: string | null; limit?: number; className?: string }) {
  const q = useRecentTrades(playerId, limit);
  const session = useSession();
  const now = useNow();
  const arrived = useArrivals(q.data?.map((t) => t.id));
  return (
    <QueryState
      query={q}
      loading={<LoadingRows rows={5} />}
      isEmpty={(d) => d.length === 0}
      empty={<EmptyState title="No trades yet">Trades appear here the moment they happen.</EmptyState>}
    >
      {(trades) => (
        <ol className={cn("flex flex-col", className)} aria-label="Recent trades">
          {trades.map((t) => {
            const who = traderFor(t, session.data?.address);
            const w = tradeWeight(t.usdc);
            const isNew = arrived(t.id);
            return (
              <li
                key={t.id}
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl px-2 py-2",
                  isNew && "feed-enter",
                  isNew && (t.side === "buy" ? "tint-up" : "tint-down"),
                  who.mine && "bg-raised/60"
                )}
              >
                <UserAvatar seed={who.seed} size={28} />
                <div className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[0.8125rem]">
                    {/* The handle gives way before the ticker on a narrow screen. */}
                    <span className={cn("min-w-[3ch] shrink-[6] truncate", who.mine ? "font-semibold text-ink" : "text-soft")}>{who.label}</span>
                    <span className={cn("shrink-0", t.side === "buy" ? "text-up" : "text-down")}>{t.side === "buy" ? "bought" : "sold"}</span>
                    {playerId === null ? (
                      <Link href={`/trade/${t.playerId}`} title={`$${t.ticker}`} className="inline-flex min-w-0 items-center gap-1 font-semibold text-ink hover:underline">
                        <PlayerAvatar id={t.playerId} size={18} mark={false} className="rounded-[5px]" />
                        <span className="truncate">${t.ticker}</span>
                      </Link>
                    ) : null}
                  </span>
                  <span className="fig truncate text-[0.75rem] text-faint">
                    {formatTokens(t.tokens)} at {formatPrice(t.price)}
                    {t.venue === "curve" ? " on the curve" : ""}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className={cn("fig text-[0.875rem]", w === "big" ? "font-semibold text-ink" : w === "mid" ? "text-ink" : "text-soft")}>{formatUsd(t.usdc)}</span>
                  <span className="fig text-[0.75rem] text-faint">{now ? formatRelative(t.at, now) : ""}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </QueryState>
  );
}
