"use client";

import { PLAYERS_BY_ID } from "@score/core";
import { Button } from "@/components/ui/button";
import { Ticker } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingRows, SignedOutState } from "@/components/common/states";
import { formatTokens, formatUsd } from "@/lib/format";
import { useClaim, usePortfolio, useSession } from "@/lib/protocol/react/hooks";

/** Claimable dividends: USDC, or the same players' tokens +10% from their reserve. */
export function ClaimPanel({ onClaimed, compact = false }: { onClaimed?: () => void; compact?: boolean }) {
  const session = useSession();
  const pf = usePortfolio();
  const claim = useClaim();

  if (session.isPending || pf.isPending) return <LoadingRows rows={3} />;
  if (!session.data) return <SignedOutState title="Sign in to claim dividends" />;
  if (pf.isError || !pf.data) return <ErrorState error={pf.error} onRetry={() => void pf.refetch()} />;
  const c = pf.data.claimable;
  if (c.totalUsd <= 0.005) {
    return (
      <EmptyState title="Nothing to claim yet">
        Hold bonded players at kickoff. When they finish top five on a board, your share lands here after the data freeze.
      </EmptyState>
    );
  }
  const tokens = c.tokens;
  const partial = tokens.usdcOut > 0.005;
  const tokenCount = tokens.lines.reduce((a, l) => a + l.tokens, 0);
  return (
    <div className="flex flex-col gap-4" data-testid="claim-panel">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-2xl font-medium tracking-[-0.02em] text-up">{formatUsd(c.totalUsd)}</span>
        <span className="text-sm text-soft">
          ready to claim
          {(() => {
            const n = new Set(c.rows.map((r) => r.roundId)).size;
            return n > 1 ? ` from ${n} matchdays` : "";
          })()}
        </span>
      </div>
      {!compact ? (
        <ul className="flex flex-col divide-y divide-rule">
          {tokens.lines.map((l) => (
            <li key={l.playerId} className="num flex items-baseline justify-between gap-3 py-2.5 text-sm">
              <span className="flex min-w-0 items-baseline gap-2">
                <Ticker ticker={PLAYERS_BY_ID[l.playerId]?.ticker ?? l.playerId} className="text-[13px] text-ink" />
                <span className="truncate text-soft">{PLAYERS_BY_ID[l.playerId]?.name}</span>
              </span>
              <span className="text-right text-soft">
                <span className="text-ink">{formatUsd(l.usd)}</span> or {formatTokens(l.tokens)} tokens
                {l.usdc > 0.005 ? ` + ${formatUsd(l.usdc)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button size="lg" onClick={() => claim.mutate("usdc", { onSuccess: onClaimed })} disabled={claim.isPending} data-testid="claim-usdc">
          Take {formatUsd(c.usdc.usdcOut)} USDC
        </Button>
        <Button size="lg" variant="secondary" onClick={() => claim.mutate("tokens", { onSuccess: onClaimed })} disabled={claim.isPending} data-testid="claim-tokens">
          Take {formatTokens(tokenCount)} tokens · +10%
        </Button>
      </div>
      <p className="text-xs text-faint">
        Tokens come from each player&apos;s reserve and the USDC stays in the dividend vault, which keeps it funded for everyone. New tokens start a
        fresh hold age, so they carry a higher sell tax for a while.
        {partial ? " Part of this claim is paid in USDC because a reserve is running out." : ""}
      </p>
    </div>
  );
}
