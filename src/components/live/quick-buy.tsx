"use client";

import { Zap } from "lucide-react";
import { useState } from "react";
import { formatTokens, formatUsd, parseAmount } from "@/lib/format";
import { useBuy, useSession } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";
import { cn } from "@/lib/utils";
import { momentToast } from "./moment-toast";

/**
 * One tap from a list to a position (pump.fun and the terminals built on it put this on every row).
 * Buys your quick-buy amount at market and answers with a toast carrying the player's kit.
 */
export function QuickBuy({ playerId, ticker, className }: { playerId: string; ticker: string; className?: string }) {
  const usd = useUi((s) => s.quickBuyUsd);
  const openSignIn = useUi((s) => s.openSignIn);
  const session = useSession();
  const buy = useBuy({ silent: true });
  return (
    <button
      type="button"
      aria-label={`Buy ${formatUsd(usd, { decimals: 0 })} of $${ticker}`}
      title={`Buy ${formatUsd(usd, { decimals: 0 })} of $${ticker} at market`}
      disabled={buy.isPending}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!session.data) return openSignIn();
        buy.mutate(
          { id: playerId, usdc: usd },
          {
            onSuccess: (r) =>
              momentToast({
                playerId,
                title: `Bought ${formatTokens(r.tokens ?? 0)} $${ticker}`,
                body: `for ${formatUsd(r.usdc ?? usd)}`,
                tone: "up",
                href: `/trade/${playerId}`,
              }),
          }
        );
      }}
      className={cn(
        "fig inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-up-tint px-2.5 text-[0.75rem] font-semibold text-up transition-[background-color,transform,opacity] duration-150 hover:bg-up-tint-hover motion-safe:active:scale-[0.96] disabled:opacity-50",
        className
      )}
    >
      <Zap className="size-3" aria-hidden="true" />
      {buy.isPending ? "…" : formatUsd(usd, { decimals: 0 })}
    </button>
  );
}

/** Set the quick-buy amount: a compact field that keeps whatever you last typed. */
export function QuickBuyAmount({ className }: { className?: string }) {
  const usd = useUi((s) => s.quickBuyUsd);
  const set = useUi((s) => s.setQuickBuyUsd);
  const [draft, setDraft] = useState(String(usd));
  const commit = () => {
    const v = Math.round(parseAmount(draft) * 100) / 100;
    if (v > 0) set(v);
    else setDraft(String(usd));
  };
  return (
    <label className={cn("flex h-8 items-center gap-1.5 rounded-full bg-ground pr-1 pl-2.5 text-[0.75rem] text-soft ring-1 ring-control focus-within:ring-ink", className)}>
      <Zap className="size-3 text-up" aria-hidden="true" />
      Quick buy $
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        inputMode="decimal"
        aria-label="Quick buy amount in USDC"
        className="fig w-12 min-w-0 bg-transparent text-base font-semibold text-ink outline-none sm:text-[0.8125rem]"
      />
    </label>
  );
}
