"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Delta, KeyValue, Section, Stat } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingBlock, SignedOutState } from "@/components/common/states";
import { formatPct, formatPrice, formatRelative, formatTokens, formatUsd } from "@/lib/format";
import type { ActivityItem, Portfolio } from "@/lib/protocol/types";
import { useFaucet, useNow, usePortfolio, useSession } from "@/lib/protocol/react/hooks";
import { ClaimPanel } from "./claim-panel";

export function PortfolioPage() {
  const session = useSession();
  const pf = usePortfolio();
  if (session.isPending || (session.data && pf.isPending)) {
    return (
      <div className="flex flex-col gap-4">
        <LoadingBlock className="h-24" />
        <LoadingBlock className="h-48" />
      </div>
    );
  }
  if (!session.data) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <SignedOutState title="Sign in to see your portfolio">Your positions, dividends, liquidity and history live here.</SignedOutState>
      </div>
    );
  }
  if (pf.isError || !pf.data) return <ErrorState error={pf.error} onRetry={() => void pf.refetch()} />;
  const d = pf.data;
  return (
    <div className="flex flex-col gap-8">
      <Summary d={d} />
      <Section title="Claimable dividends" id="claim">
        <Card size="sm">
          <CardContent>
            <ClaimPanel />
          </CardContent>
        </Card>
      </Section>
      <Positions d={d} />
      <LpPositions d={d} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <History items={d.history} />
        <Points d={d} />
      </div>
    </div>
  );
}

function Summary({ d }: { d: Portfolio }) {
  const faucet = useFaucet();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Portfolio</h1>
          <p className="text-sm text-muted-foreground">{d.user.label}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => faucet.mutate(1_000)} disabled={faucet.isPending}>
          Get 1,000 test USDC
        </Button>
      </div>
      <Card size="sm">
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7" data-testid="portfolio-summary">
          <Stat label="Total value" value={formatUsd(d.totalValue)} />
          <Stat label="USDC" value={formatUsd(d.usdc)} />
          <Stat label="Positions" value={formatUsd(d.positionsValue)} />
          <Stat label="Liquidity" value={formatUsd(d.lpValue)} />
          <Stat label="P&L" value={<Delta value={d.pnl}>{formatUsd(d.pnl, { signed: true })}</Delta>} hint={`Realised ${formatUsd(d.realizedPnl, { signed: true })}`} />
          <Stat label="Dividends earned" value={formatUsd(d.dividendsEarned)} hint={d.claimable.totalUsd > 0 ? `+${formatUsd(d.claimable.totalUsd)} to claim` : undefined} />
          <Stat label="Fees paid" value={formatUsd(d.feesPaid)} />
        </CardContent>
      </Card>
    </div>
  );
}

function Positions({ d }: { d: Portfolio }) {
  return (
    <Section title="Positions" id="positions">
      {d.positions.length === 0 ? (
        <EmptyState
          title="No positions yet"
          action={
            <Button asChild size="sm">
              <Link href="/markets">Find players</Link>
            </Button>
          }
        >
          Buy a launching player on the curve, or a bonded one in its pool.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="hidden text-right md:table-cell">Price</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Hold age</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Sell tax now</TableHead>
                <TableHead className="hidden lg:table-cell">Next kickoff</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.positions.map((p) => (
                <TableRow key={p.playerId}>
                  <TableCell>
                    <Link href={`/player/${p.playerId}`} className="hover:underline">
                      <span className="font-mono text-xs font-semibold">${p.ticker}</span> <span className="hidden sm:inline">{p.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="num text-right">{formatTokens(p.tokens)}</TableCell>
                  <TableCell className="num hidden text-right md:table-cell">{formatPrice(p.price)}</TableCell>
                  <TableCell className="num text-right">{formatUsd(p.value)}</TableCell>
                  <TableCell className="text-right">
                    <Delta value={p.pnl}>{formatUsd(p.pnl, { signed: true })}</Delta>
                  </TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">{p.status === "trading" ? `${p.holdAgeDays.toFixed(0)}d` : "—"}</TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">{formatPct(p.sellTaxNow)}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{p.countsNextKickoff ? "Counted" : "Not yet (launching)"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="xs" variant="outline">
                      <Link href={`/player/${p.playerId}`}>Trade</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Value is at the current price. Selling pays the sell tax and moves the price; the player page shows exactly what you&apos;d receive.
      </p>
    </Section>
  );
}

function LpPositions({ d }: { d: Portfolio }) {
  return (
    <Section title="Liquidity" id="lp">
      {d.lp.length === 0 ? (
        <EmptyState title="No liquidity positions">Add USDC and tokens to a bonded player&apos;s pool from its Liquidity tab.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pool</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Fees earned</TableHead>
                <TableHead className="hidden text-right sm:table-cell">IL</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.lp.map((l) => (
                <TableRow key={l.playerId}>
                  <TableCell className="font-mono text-xs font-semibold">${l.ticker} / USDC</TableCell>
                  <TableCell className="num text-right">{formatPct(l.poolShare, { decimals: 3 })}</TableCell>
                  <TableCell className="num text-right">{formatUsd(l.valueUsd)}</TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">{formatUsd(l.feesEarnedUsd)}</TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">{formatPct(l.impermanentLoss)}</TableCell>
                  <TableCell className="text-right">
                    <Delta value={l.pnl}>{formatUsd(l.pnl, { signed: true })}</Delta>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="xs" variant="outline">
                      <Link href={`/player/${l.playerId}`}>Manage</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}

const KIND_LABEL: Record<ActivityItem["kind"], string> = {
  buy: "Buy",
  sell: "Sell",
  "lp-add": "Add liquidity",
  "lp-remove": "Remove liquidity",
  "claim-usdc": "Claim (USDC)",
  "claim-tokens": "Claim (tokens)",
  faucet: "Faucet",
  dividend: "Dividends",
};

function History({ items }: { items: ActivityItem[] }) {
  const now = useNow();
  return (
    <Section title="History" id="history">
      {items.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="history">
          {items.slice(0, 40).map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {KIND_LABEL[a.kind]} {a.ticker ? <span className="font-mono text-xs">${a.ticker}</span> : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">{a.detail}</span>
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <span className="num">{formatUsd(a.usdc)}</span>
                <span className="text-xs text-muted-foreground">{now ? formatRelative(a.at, now) : ""}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Points({ d }: { d: Portfolio }) {
  const p = d.points;
  return (
    <Section title="Activity points" id="points">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="num">{formatTokens(p.total)} pts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <KeyValue
            rows={[
              ["Launch buys", formatTokens(p.launch)],
              ["Holding at kickoff", formatTokens(p.holding)],
              ["Dividends", formatTokens(p.dividends)],
              ["Fees paid", formatTokens(p.fees)],
              ["Volume", formatTokens(p.volume)],
              ["Liquidity", formatTokens(p.liquidity)],
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Activity rank becomes voting weight for new launches from Season 1. The weighting isn&apos;t final; this is a plain sum in USD.
          </p>
        </CardContent>
      </Card>
    </Section>
  );
}
