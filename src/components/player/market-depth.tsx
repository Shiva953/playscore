"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KeyValue } from "@/components/common/bits";
import { EmptyState, QueryState, LoadingRows } from "@/components/common/states";
import { formatPct, formatPrice, formatRelative, formatTokens, formatUsd, formatUsdCompact } from "@/lib/format";
import type { PlayerDetail } from "@/lib/protocol/types";
import { useNow, useRecentTrades } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/** AMM-native depth: what a trade of each size would move the price. Replaces the prototype's synthetic order book. */
export function ImpactLadder({ player }: { player: PlayerDetail }) {
  if (!player.pool || !player.impactLadder) {
    return <EmptyState title="No pool yet">The pool opens when the player bonds. Until then, price follows the launch curve.</EmptyState>;
  }
  return (
    <div className="flex flex-col gap-2">
      <KeyValue
        rows={[
          ["Pool depth", formatUsd(player.pool.depthUsd, { decimals: 0 })],
          ["USDC in pool", formatUsd(player.pool.usdc, { decimals: 0 })],
          [`$${player.ticker} in pool`, formatTokens(player.pool.tokens)],
          ["Locked protocol seed", formatPct(player.pool.protocolShare, { decimals: 1 })],
        ]}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Size</TableHead>
            <TableHead className="text-right">Buy impact</TableHead>
            <TableHead className="text-right">Sell impact</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {player.impactLadder.map((r) => (
            <TableRow key={r.usdc}>
              <TableCell className="num">{formatUsdCompact(r.usdc)}</TableCell>
              <TableCell className="num text-right">{formatPct(r.buyImpact)}</TableCell>
              <TableCell className="num text-right">{formatPct(r.sellImpact)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function RecentTrades({ playerId, limit = 15 }: { playerId: string; limit?: number }) {
  const q = useRecentTrades(playerId, limit);
  const now = useNow();
  return (
    <QueryState
      query={q}
      loading={<LoadingRows rows={5} />}
      isEmpty={(d) => d.length === 0}
      empty={<EmptyState title="No trades yet">Trades appear here as they happen.</EmptyState>}
    >
      {(trades) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">USDC</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="hidden text-right sm:table-cell">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((t) => (
              <TableRow key={t.id}>
                <TableCell className={cn(t.side === "buy" ? "text-up" : "text-down")}>
                  {t.side === "buy" ? "Buy" : "Sell"}
                  {t.mine ? <span className="ml-1 text-xs text-soft">(you)</span> : null}
                </TableCell>
                <TableCell className="num text-right">{formatUsd(t.usdc)}</TableCell>
                <TableCell className="num text-right">{formatPrice(t.price)}</TableCell>
                <TableCell className="num hidden text-right text-soft sm:table-cell">{now ? formatRelative(t.at, now) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </QueryState>
  );
}
