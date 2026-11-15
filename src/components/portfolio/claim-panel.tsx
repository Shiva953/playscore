"use client";

import { useEffect, useRef, useState } from "react";
import { PLAYERS_BY_ID } from "@score/core";
import { ActionButton, type Phase } from "@/components/ui/action-button";
import { CheckDraw } from "@/components/ui/status";
import { AutoHeight } from "@/components/common/auto-height";
import { Ticker, TickUp } from "@/components/common/bits";
import { PlayerAvatar } from "@/components/common/kit";
import { OrbLink } from "@/components/common/orb-link";
import { ClaimSkeleton } from "@/components/common/skeletons";
import { EmptyState, ErrorState, SignedOutState } from "@/components/common/states";
import { formatTokens, formatUsd } from "@/lib/format";
import type { ClaimMode, ClaimableView } from "@/lib/protocol/types";
import { useClaim, usePortfolio, useSession } from "@/lib/protocol/react/hooks";

/** What a claim paid, kept after the portfolio has refreshed and there's nothing left to claim. */
type Claimed = { mode: ClaimMode; usd: number; tokens: number; signature?: string };

/** The tick on the button, then the confirmation in the panel's place, then the panel gives way. */
const TICK_MS = 700;
const CONFIRM_MS = 3200;

/**
 * Claimable dividends: USDC, or the same players' tokens +10% from their reserve.
 * The claim is answered where it was made: the button you pressed works, then ticks; the panel then
 * becomes the confirmation (the amount counting up in gold, where it went) for a few seconds before it
 * steps aside. `onBusy` lets a parent keep this mounted through that, since the claimable amount drops
 * to zero the moment the claim lands. `onClaimed` fires when the confirmation has been read.
 */
export function ClaimPanel({ onClaimed, onBusy, compact = false }: { onClaimed?: () => void; onBusy?: (busy: boolean) => void; compact?: boolean }) {
  const session = useSession();
  const pf = usePortfolio();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const claim = useClaim({ shown: () => alive.current });
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  const [confirming, setConfirming] = useState(false);
  // What was claimable when you pressed the button. The portfolio refreshes the moment the claim lands
  // (to nothing), so the panel shows this until it has finished confirming, instead of emptying mid-tick.
  const [frozen, setFrozen] = useState<ClaimableView | null>(null);

  // Latest callbacks, so the timers below don't restart when a parent re-renders.
  const cb = useRef({ onClaimed, onBusy });
  useEffect(() => {
    cb.current = { onClaimed, onBusy };
  });
  useEffect(() => {
    if (!claimed) return;
    const a = setTimeout(() => setConfirming(true), TICK_MS);
    const b = setTimeout(() => {
      cb.current.onBusy?.(false);
      cb.current.onClaimed?.();
      setClaimed(null);
      setConfirming(false);
      setFrozen(null);
    }, TICK_MS + CONFIRM_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [claimed]);

  if (claimed && confirming) return <Confirmation claimed={claimed} />;
  if (session.isPending || pf.isPending) return <ClaimSkeleton compact={compact} />;
  if (!session.data) return <SignedOutState title="Sign in to claim dividends" />;
  if (pf.isError || !pf.data) return <ErrorState error={pf.error} onRetry={() => void pf.refetch()} />;
  const c = frozen ?? pf.data.claimable;
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

  const take = (mode: ClaimMode) => {
    // Read the amounts now: once the claim lands the portfolio refreshes and they're gone.
    const paid: Claimed = { mode, usd: mode === "usdc" ? c.usdc.usdcOut : c.totalUsd, tokens: tokenCount };
    onBusy?.(true);
    setFrozen(c);
    claim.mutate(mode, {
      onSuccess: (r) => setClaimed({ ...paid, signature: r.signature }),
      onError: () => {
        setFrozen(null);
        onBusy?.(false);
      },
    });
  };
  // One mutation, two buttons: the one you pressed shows the state, the other waits.
  const phaseOf = (mode: ClaimMode): Phase => {
    if (claimed) return claimed.mode === mode ? "success" : "idle";
    if (claim.variables !== mode) return "idle";
    return claim.status === "pending" ? "pending" : claim.status === "error" ? "error" : "idle";
  };
  const working = claim.isPending || !!claimed;

  return (
    <AutoHeight innerClassName="flex flex-col gap-4" data-testid="claim-panel">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-2xl font-medium tracking-[-0.02em] text-brand">{formatUsd(c.totalUsd)}</span>
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
            <li key={l.playerId} className="num flex items-center justify-between gap-3 py-2.5 text-sm">
              {/* The kit is centred on the row; ticker and name share one text baseline beside it. */}
              <span className="flex min-w-0 items-center gap-2.5">
                <PlayerAvatar id={l.playerId} size={24} mark={false} className="rounded-[7px]" />
                <span className="flex min-w-0 items-baseline gap-2">
                  <Ticker ticker={PLAYERS_BY_ID[l.playerId]?.ticker ?? l.playerId} className="shrink-0 text-[0.8125rem] text-ink" />
                  <span className="truncate text-soft">{PLAYERS_BY_ID[l.playerId]?.name}</span>
                </span>
              </span>
              <span className="shrink-0 text-right text-soft">
                <span className="block whitespace-nowrap">
                  <span className="text-ink">{formatUsd(l.usd)}</span> or {formatTokens(l.tokens)} tokens
                </span>
                {l.usdc > 0.005 ? <span className="block whitespace-nowrap">+ {formatUsd(l.usdc)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <ActionButton
          size="lg"
          onClick={() => take("usdc")}
          phase={phaseOf("usdc")}
          disabled={working && phaseOf("usdc") === "idle"}
          pending="Claiming USDC"
          success="Claimed"
          data-testid="claim-usdc"
        >
          Take {formatUsd(c.usdc.usdcOut)} USDC
        </ActionButton>
        <ActionButton
          size="lg"
          variant="secondary"
          onClick={() => take("tokens")}
          phase={phaseOf("tokens")}
          disabled={working && phaseOf("tokens") === "idle"}
          pending="Claiming tokens"
          success="Claimed"
          data-testid="claim-tokens"
        >
          Take {formatTokens(tokenCount)} tokens · +10%
        </ActionButton>
      </div>
      <p className="text-xs text-faint">
        Tokens come from each player&apos;s reserve and the USDC stays in the dividend vault, which keeps it funded for everyone. New tokens start a
        fresh hold age, so they carry a higher sell tax for a while.
        {partial ? " Part of this claim is paid in USDC because a reserve is running out." : ""}
      </p>
    </AutoHeight>
  );
}

/** The claim landed. Gold is the colour of what you earned, so this is the one place it fills a figure this size. */
function Confirmation({ claimed }: { claimed: Claimed }) {
  const usdc = claimed.mode === "usdc";
  return (
    <div className="step-in flex flex-col gap-3" role="status" data-testid="claim-confirmed">
      <div className="flex items-center gap-3">
        <CheckDraw ring className="size-9 text-brand" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-soft">{usdc ? "Claimed to your cash" : "Claimed as tokens"}</span>
          <span className="text-[2.125rem] leading-[1.06] text-brand">
            {usdc ? (
              <TickUp value={claimed.usd} format={(n) => formatUsd(n)} className="fig-prop" />
            ) : (
              <TickUp value={claimed.tokens} format={(n) => formatTokens(n)} className="fig-prop" />
            )}
          </span>
        </div>
      </div>
      <p className="text-sm text-soft">
        {usdc
          ? "It's in your cash now, ready to trade or withdraw."
          : `Worth ${formatUsd(claimed.usd)} at today's prices, added to the players that earned it. They start a fresh hold age.`}
      </p>
      {claimed.signature ? <OrbLink signature={claimed.signature} /> : null}
    </div>
  );
}
