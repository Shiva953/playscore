"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta, PositionBadge, Section, Sparkline, Stat } from "@/components/common/bits";
import { EmptyState, LoadingRows, QueryState } from "@/components/common/states";
import { MatchdayCard } from "@/components/markets/matchday-card";
import { formatPrice, formatScore, formatUsd } from "@/lib/format";
import { usePlayers, useStats } from "@/lib/protocol/react/hooks";

const STEPS: [string, string][] = [
  ["1 · Launch", "Every player starts on a bonding curve. Early buyers get the lowest price. 10M tokens: 8M float, 2M dividend reserve."],
  ["2 · Bond", "At $25k raised the curve closes: 70% seeds a permanent trading pool, 20% goes to the dividend vault, 10% to the treasury."],
  ["3 · Hold", "Whoever holds at the first kickoff of a matchday is counted. Trading never stops."],
  ["4 · Earn", "The top 5 on every board earn from the round pool. Holders take USDC, or more of the player's tokens with a 10% bonus."],
];

export function LandingPage() {
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-5 pt-6 md:pt-12" aria-labelledby="hero-title">
        <p className="text-sm text-muted-foreground">Football performance, on-chain · Solana devnet</p>
        <h1 id="hero-title" className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
          Own the players. Earn when they perform.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Back real footballers as tokens. Buy in when a player launches, hold through matchday, and earn when they finish top 5 in their position or
          league. Early sellers fund the holders.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href="/markets">Explore players</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/matchday">Watch the matchday</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Dividends are paid from a funded vault and are never guaranteed. Devnet demo with test USDC.</p>
      </section>

      <MatchdayCard />

      <ProofStats />

      <Section title="How it works" id="how">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, b]) => (
            <Card key={t} size="sm">
              <CardHeader>
                <CardTitle>{t}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{b}</CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <FeaturedPlayers />

      <Section title="Why it doesn't end like Football Index" id="trust">
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["Dividends are a % of a funded vault", "Each round pays 0.2–2.5% of the vault, smoothed ±10% a round. Liabilities can't outgrow assets."],
              ["There's always an exit", "Every bonded player has a permanent, locked trading pool. No operator-controlled instant sell."],
              ["Fixed supply", "10M tokens per player. New tokens only when holders choose dividends as tokens."],
            ] as [string, string][]
          ).map(([t, b]) => (
            <Card key={t} size="sm">
              <CardHeader>
                <CardTitle>{t}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{b}</CardContent>
            </Card>
          ))}
        </div>
        <Link href="/docs/boards" className="text-sm underline">
          How payouts are sized
        </Link>
      </Section>
    </div>
  );
}

function ProofStats() {
  const q = useStats();
  return (
    <Card size="sm">
      <CardContent>
        <QueryState query={q} loading={<LoadingRows rows={1} />}>
          {(s) => (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="proof-stats">
              <Stat label="Dividend vault" value={formatUsd(s.vault, { decimals: 0 })} />
              <Stat label="Paid to holders" value={formatUsd(s.totalPaidOut, { decimals: 0 })} hint="this demo session" />
              <Stat label="Players trading" value={s.bondedCount} />
              <Stat label="Launching now" value={s.launchingCount} />
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function FeaturedPlayers() {
  const q = usePlayers({ status: "all" });
  return (
    <Section
      title="Featured players"
      id="featured"
      action={
        <Link href="/markets" className="text-sm underline">
          All players
        </Link>
      }
    >
      <QueryState query={q} loading={<LoadingRows rows={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No players yet" />}>
        {(list) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[...list]
              .filter((p) => p.status !== "scheduled")
              .sort((a, b) => b.avgScore - a.avgScore)
              .slice(0, 4)
              .map((p) => (
                <Link key={p.id} href={`/player/${p.id}`} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Card size="sm" className="h-full hover:bg-muted/40">
                    <CardContent className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-semibold">${p.ticker}</span>
                        <PositionBadge position={p.position} />
                      </div>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.club}</span>
                      <Sparkline values={p.sparkline} width={160} height={32} />
                      <div className="flex items-center justify-between text-sm">
                        <span className="num">{formatPrice(p.price)}</span>
                        {p.status === "trading" ? <Delta value={p.change24h} /> : <span className="text-xs text-muted-foreground">{Math.round(p.bondProgress * 100)}% to bond</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">Form {formatScore(p.avgScore)}</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
          </div>
        )}
      </QueryState>
    </Section>
  );
}
