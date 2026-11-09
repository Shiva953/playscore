"use client";

import Link from "next/link";
import { PlayerAvatar } from "@/components/common/kit";
import { UserAvatar } from "@/components/common/user-avatar";
import { formatUsd } from "@/lib/format";
import { tradeWeight, traderFor } from "@/lib/identity/traders";
import { useRecentTrades, useSession } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";
import { useArrivals } from "./use-arrivals";

/**
 * The market's pulse under the header (trades that don't fit wrap onto a hidden second line, so none is
 * ever cut in half at the edge): the latest trades across every player, newest on the left.
 * A new trade slides in and tints toward its side; big trades read louder. Each one links to its player.
 */
export function LiveTape({ className }: { className?: string }) {
  const q = useRecentTrades(null, 14);
  const session = useSession();
  const trades = q.data ?? [];
  const arrived = useArrivals(q.data?.map((t) => t.id));
  if (!trades.length) return null;
  return (
    <div className={cn("relative flex h-9 items-center", className)} aria-label="Latest trades" role="region">
      <span className="z-10 flex shrink-0 items-center gap-2 bg-ground pr-4 text-[0.8125rem] font-medium text-soft">
        <span className="live-dot relative inline-block size-1.5 rounded-full bg-brand text-brand" aria-hidden="true" />
        Live
      </span>
      <ol className="flex h-7 min-w-0 flex-1 flex-wrap items-center gap-x-2 overflow-hidden" aria-live="off">
        {trades.map((t) => {
          const who = traderFor(t, session.data?.address);
          const w = tradeWeight(t.usdc);
          const isNew = arrived(t.id);
          return (
            <li key={t.id} className={cn("shrink-0", isNew && "tape-enter")}>
              <Link
                href={`/trade/${t.playerId}`}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-full pr-2.5 pl-1 text-[0.8125rem] transition-colors duration-150 hover:bg-raised",
                  isNew && (t.side === "buy" ? "tint-up" : "tint-down"),
                  who.mine && "bg-raised"
                )}
              >
                <UserAvatar seed={who.seed} size={18} />
                <span className={cn(who.mine ? "font-medium text-ink" : "text-soft")}>{who.label}</span>
                <span className={t.side === "buy" ? "text-up" : "text-down"}>{t.side === "buy" ? "bought" : "sold"}</span>
                <span className={cn("fig", w === "big" ? "font-semibold text-ink" : w === "mid" ? "text-ink" : "text-soft")}>{formatUsd(t.usdc, { decimals: t.usdc >= 100 ? 0 : 2 })}</span>
                <PlayerAvatar id={t.playerId} size={18} mark={false} className="ml-0.5 rounded-[5px]" />
                <span className="font-semibold text-ink">${t.ticker}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
