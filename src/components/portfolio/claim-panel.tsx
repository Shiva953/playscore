"use client";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingRows, SignedOutState, ErrorState } from "@/components/common/states";
import { formatTokens, formatUsd } from "@/lib/format";
import { PLAYERS_BY_ID } from "@score/core";
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
        Hold bonded players at kickoff. If they finish top 5 on a board, your share becomes claimable here after full time.
      </EmptyState>
    );
  }
  const tokens = c.tokens;
  const partial = tokens.usdcOut > 0.005;
  return (
    <div className="flex flex-col gap-3" data-testid="claim-panel">
      <p className="text-sm">
        Dividends to claim: <span className="num text-lg font-semibold">{formatUsd(c.totalUsd)}</span>
      </p>
      {!compact ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead className="text-right">USDC</TableHead>
              <TableHead className="text-right">Or tokens (+10%)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.lines.map((l) => (
              <TableRow key={l.playerId}>
                <TableCell>
                  <span className="font-mono text-xs">${PLAYERS_BY_ID[l.playerId]?.ticker}</span>
                </TableCell>
                <TableCell className="num text-right">{formatUsd(l.usd)}</TableCell>
                <TableCell className="num text-right">
                  {formatTokens(l.tokens)}
                  {l.usdc > 0.005 ? <span className="text-muted-foreground"> + {formatUsd(l.usdc)}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Tokens come from each player&apos;s reserve and the USDC stays in the dividend vault. New tokens start a fresh hold age, so
        they carry a higher sell tax for a while.
        {partial ? " Part of this claim is paid in USDC because a reserve is running out." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => claim.mutate("usdc", { onSuccess: onClaimed })}
          disabled={claim.isPending}
          data-testid="claim-usdc"
        >
          Take {formatUsd(c.usdc.usdcOut)} USDC
        </Button>
        <Button
          variant="outline"
          onClick={() => claim.mutate("tokens", { onSuccess: onClaimed })}
          disabled={claim.isPending}
          data-testid="claim-tokens"
        >
          Take tokens +10%
        </Button>
      </div>
    </div>
  );
}
