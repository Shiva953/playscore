"use client";

import { UserAvatar } from "@/components/common/user-avatar";
import { traderFor } from "@/lib/identity/traders";
import { useNow, useRecentTrades, useSession } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

const WINDOW_MS = 10 * 60_000;

/**
 * Who's been buying this player lately: the last few buyers' faces, stacked, and how many buys and
 * sells landed in the last ten minutes. Counted from the trade feed, never estimated.
 */
export function BuyerStack({ playerId, className }: { playerId: string; className?: string }) {
  const q = useRecentTrades(playerId, 40);
  const session = useSession();
  const now = useNow();
  const trades = q.data ?? [];
  if (!now || !trades.length) return null;
  const recent = trades.filter((t) => now - t.at < WINDOW_MS);
  const buys = recent.filter((t) => t.side === "buy");
  const sells = recent.length - buys.length;
  const faces: { seed: string; label: string }[] = [];
  for (const t of trades) {
    if (t.side !== "buy") continue;
    const who = traderFor(t, session.data?.address);
    if (!faces.some((f) => f.seed === who.seed)) faces.push(who);
    if (faces.length === 5) break;
  }
  return (
    <div className={cn("flex items-center gap-3 text-[0.8125rem]", className)}>
      {faces.length ? (
        <span className="flex -space-x-1.5" aria-hidden="true">
          {faces.map((f) => (
            <UserAvatar key={f.seed} seed={f.seed} size={22} className="ring-2 ring-[var(--kit-ring)]" />
          ))}
        </span>
      ) : null}
      <span className="text-soft">
        {recent.length ? (
          <>
            <span className="fig text-ink">{buys.length}</span> {buys.length === 1 ? "buy" : "buys"} and <span className="fig text-ink">{sells}</span> {sells === 1 ? "sell" : "sells"} in the last 10 minutes
          </>
        ) : (
          "No trades in the last 10 minutes"
        )}
      </span>
    </div>
  );
}
