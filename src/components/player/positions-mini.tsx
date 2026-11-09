"use client";

import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Delta } from "@/components/common/bits";
import { PlayerAvatar } from "@/components/common/kit";
import { EmptyState, QueryState, SignedOutState } from "@/components/common/states";
import { formatPct, formatTokens, formatUsd } from "@/lib/format";
import { usePortfolio, useSession } from "@/lib/protocol/react/hooks";

/** Your positions as a table: the trade terminal's Positions tab. */
export function PositionsMini() {
  const session = useSession();
  const pf = usePortfolio();
  if (!session.data) return <SignedOutState title="Sign in to see positions" />;
  return (
    <QueryState
      query={pf}
      isEmpty={(d) => !d || d.positions.length === 0}
      empty={<EmptyState title="No positions yet">Buy a player to see it here.</EmptyState>}
    >
      {(d) => (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Hold age</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Sell tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d!.positions.map((p) => (
                <TableRow key={p.playerId}>
                  <TableCell>
                    <Link href={`/trade/${p.playerId}`} className="inline-flex items-center gap-2 text-[0.8125rem] font-semibold text-ink hover:underline">
                      <PlayerAvatar id={p.playerId} size={24} mark={false} className="rounded-[7px]" />${p.ticker}
                    </Link>
                  </TableCell>
                  <TableCell className="num text-right">{formatTokens(p.tokens)}</TableCell>
                  <TableCell className="num text-right">{formatUsd(p.value)}</TableCell>
                  <TableCell className="text-right">
                    <Delta value={p.pnl}>{formatUsd(p.pnl, { signed: true })}</Delta>
                  </TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">{p.holdAgeDays.toFixed(0)}d</TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">{formatPct(p.sellTaxNow)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </QueryState>
  );
}
