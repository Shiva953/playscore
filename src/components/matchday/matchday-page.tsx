"use client";

import Link from "next/link";
import { memo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Countdown, Section, Stat } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingBlock, LoadingRows, QueryState, SignedOutState } from "@/components/common/states";
import { ClaimPanel } from "@/components/portfolio/claim-panel";
import { formatPct, formatPoints, formatScore, formatTokens, formatUsd } from "@/lib/format";
import type { BoardView, MatchEventView, RoundState } from "@/lib/protocol/types";
import { usePortfolio, useRound, useRoundHistory } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

export function MatchdayPage() {
  const q = useRound();
  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <LoadingBlock className="h-32" />
        <LoadingBlock className="h-24" />
        <LoadingBlock className="h-64" />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  return (
    <div className="flex flex-col gap-8">
      <RoundHeader r={r} />
      <ClaimMoment />
      <YourPlayers r={r} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Boards r={r} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Totals r={r} />
          <EventFeed events={r.events} phase={r.phase} />
          <TopPerformers r={r} />
        </div>
      </div>
      <ResultsHistory />
    </div>
  );
}

function RoundHeader({ r }: { r: RoundState }) {
  return (
    <Card data-testid="round-header">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{r.window.title}</Badge>
              <Badge variant={r.phase === "live" ? "default" : "secondary"}>
                {r.phase === "open" ? "Before kickoff" : r.phase === "live" ? "Live" : "Full time · freezing"}
              </Badge>
              {r.clockMode === "demo" ? <Badge variant="ghost">Demo clock</Badge> : null}
            </div>
            <h1 className="text-2xl font-semibold">
              Matchday {r.round} · {r.window.fromLabel} → {r.window.toLabel}
            </h1>
            <p className="text-sm text-muted-foreground">
              {r.phase === "open" ? (
                <>
                  Snapshot at the first kickoff in <Countdown to={r.phaseEndsAt} className="font-medium text-foreground" />. Hold before then to earn
                  this round. Trading never pauses.
                </>
              ) : r.phase === "live" ? (
                <>Live from first kickoff to last whistle. Scores are provisional until the data freezes.</>
              ) : (
                <>
                  Last whistle. Data freezes in <Countdown to={r.phaseEndsAt} className="font-medium text-foreground" /> (12h in real time), then the boards
                  are ranked on final data and paid.
                </>
              )}
            </p>
          </div>
          <div className="flex gap-6">
            <Stat
              label="Round pool"
              value={formatUsd(r.pool.usd, { decimals: 0 })}
              hint={`${formatPct(r.pool.effectiveRate)} of the ${formatUsd(r.pool.vault, { decimals: 0 })} vault${r.pool.capped ? " · annual cap" : ""}`}
            />
          </div>
        </div>
        {r.phase === "live" ? (
          <div className="flex flex-col gap-1">
            <Progress value={r.liveProgress * 100} aria-label="Matchday progress" />
            <span className="text-xs text-muted-foreground">
              {r.window.days[Math.min(r.window.days.length - 1, Math.floor(r.liveProgress * r.window.days.length))]} · ends in{" "}
              <Countdown to={r.phaseEndsAt} />
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ClaimMoment() {
  const pf = usePortfolio();
  if (!pf.data || pf.data.claimable.totalUsd <= 0.005) return null;
  return (
    <Card data-testid="claim-moment">
      <CardHeader>
        <CardTitle>Full time: your dividends are ready</CardTitle>
      </CardHeader>
      <CardContent>
        <ClaimPanel compact />
      </CardContent>
    </Card>
  );
}

function YourPlayers({ r }: { r: RoundState }) {
  const my = r.my;
  return (
    <Section
      title="Your players"
      id="your-players"
      action={
        my.players.length ? (
          <span className="num text-sm">
            {r.phase === "open" ? "Projected" : "Provisional"} <span className="font-semibold">{formatUsd(my.provisionalUsd)}</span>
          </span>
        ) : null
      }
    >
      {!my.signedIn ? (
        <SignedOutState title="Sign in to follow your players">Holders at kickoff share each player&apos;s winnings.</SignedOutState>
      ) : my.players.length === 0 ? (
        <EmptyState
          title={r.phase === "open" ? "You don't hold any bonded players yet" : "You weren't holding at kickoff"}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/markets">Find players</Link>
            </Button>
          }
        >
          {r.phase === "open" ? "Buy before kickoff to be counted this round." : "Buy now to be counted at the next kickoff."}
        </EmptyState>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-1" data-testid="your-players">
          {my.players.map((p) => (
            <li key={p.playerId} className="min-w-[180px] flex-1 rounded-lg border p-3">
              <Link href={`/player/${p.playerId}`} className="font-mono text-xs font-semibold hover:underline">
                ${p.ticker}
              </Link>
              <p className="truncate text-sm">{p.name}</p>
              <p className="num text-xs text-muted-foreground">
                {formatTokens(p.tokens)} tokens · {formatPct(p.eligibleShare, { decimals: 3 })} of holders
              </p>
              <p className="num mt-1 text-sm font-semibold">{formatUsd(p.provisionalUsd)}</p>
              {!p.playing ? <p className="text-xs text-muted-foreground">Not playing this window</p> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {r.phase === "open"
          ? "Projection uses form ratings. Real payouts are decided by final match data."
          : "Provisional: based on live scores and the round pool sized now. Final after the data freeze."}
      </p>
    </Section>
  );
}

function Totals({ r }: { r: RoundState }) {
  const t = r.totals;
  return (
    <Card size="sm">
      <CardContent className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-3">
        <Stat label="Goals" value={t.goals} />
        <Stat label="Assists" value={t.assists} />
        <Stat label="Shots on target" value={t.shotsOnTarget} />
        <Stat label="Saves" value={t.saves} />
        <Stat label="Cards" value={t.cards} />
      </CardContent>
    </Card>
  );
}

const EventRow = memo(function EventRow({ e }: { e: MatchEventView }) {
  return (
    <li className="flex items-baseline gap-2 border-b py-1.5 text-sm last:border-b-0">
      <span className="num w-20 shrink-0 text-xs text-muted-foreground">
        {e.slot} · {e.minute}&apos;
      </span>
      <span className="min-w-0 flex-1">
        {e.playerId ? (
          <>
            <Link href={`/player/${e.playerId}`} className="font-medium hover:underline">
              {e.name}
            </Link>{" "}
            {e.label.toLowerCase()}
            {!e.ranked ? <span className="text-xs text-muted-foreground"> · not ranked</span> : null}
          </>
        ) : (
          <span className="text-muted-foreground">
            {e.label} · {e.club}
          </span>
        )}
      </span>
      {e.playerId ? <span className={cn("num shrink-0 text-xs", e.points >= 0 ? "text-up" : "text-down")}>{formatPoints(e.points)}</span> : null}
    </li>
  );
});

function EventFeed({ events, phase }: { events: MatchEventView[]; phase: RoundState["phase"] }) {
  return (
    <Section title="Live feed" id="feed">
      <Card size="sm">
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{phase === "open" ? "Events appear here from the first kickoff." : "Waiting for the next event…"}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto" aria-live="polite" aria-relevant="additions" data-testid="event-feed">
              {events.slice(0, 40).map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Points include the competition coefficient. Players still on the launch curve at kickoff aren&apos;t ranked.</p>
    </Section>
  );
}

function BoardCard({ b, projection }: { b: BoardView; projection: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? b.rows : b.rows.slice(0, 3);
  return (
    <Card size="sm" data-testid="board">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{b.label}</span>
          <span className="num text-xs font-normal text-muted-foreground">
            ×{b.multiplier.toFixed(2)} · {formatUsd(b.poolUsd, { decimals: 0 })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Table>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.playerId} data-mine={row.mine || undefined}>
                <TableCell className="num w-8 text-muted-foreground">#{row.rank}</TableCell>
                <TableCell>
                  <Link href={`/player/${row.playerId}`} className={cn("hover:underline", row.mine && "font-semibold")}>
                    {row.name}
                  </Link>
                  {row.mine ? <span className="ml-1 text-xs text-muted-foreground">(held)</span> : null}
                </TableCell>
                <TableCell className="num text-right">{projection ? formatScore(row.points) : formatScore(row.display)}</TableCell>
                <TableCell className="num text-right">{formatUsd(row.usd, { decimals: 0 })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {b.rows.length > 3 ? (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Show top 3" : "Show top 5"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Boards({ r }: { r: RoundState }) {
  const [all, setAll] = useState(false);
  const boards = all ? r.boards : r.boards.filter((b) => b.kind !== "league" || b.rows.length >= 3);
  return (
    <Section
      title={r.projection ? "Boards (projection)" : r.phase === "ended" ? "Boards (final whistle, freezing)" : "Boards (provisional)"}
      id="boards"
      action={
        r.boards.length > boards.length || all ? (
          <Button variant="outline" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Show main boards" : `Show all ${r.boards.length} boards`}
          </Button>
        ) : null
      }
    >
      {r.boards.length === 0 ? (
        <EmptyState title="No ranked players">Only bonded players who play in this window are ranked.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {boards.map((b) => (
            <BoardCard key={b.key} b={b} projection={r.projection} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Each board&apos;s share of the pool = players ranked (max 5) × its multiplier. Top 5 get 35 / 25 / 20 / 12 / 8%. A player can win on several
        boards. {r.projection ? "Before kickoff, boards are projected from form ratings." : ""}
      </p>
    </Section>
  );
}

function TopPerformers({ r }: { r: RoundState }) {
  const top = r.scores.filter((s) => s.minutes > 0).slice(0, 10);
  return (
    <Section title="Top performers" id="top">
      {top.length === 0 ? (
        <EmptyState title={r.phase === "open" ? "Scores appear at kickoff" : "No minutes played yet"} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead className="text-right">G+A</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {top.map((s) => (
              <TableRow key={s.playerId}>
                <TableCell>
                  <Link href={`/player/${s.playerId}`} className="hover:underline">
                    {s.name}
                  </Link>{" "}
                  <span className="text-xs text-muted-foreground">
                    {s.position}
                    {s.matchMinute >= 0 && s.matchMinute < 90 ? ` · ${s.matchMinute}'` : s.matchMinute >= 90 ? " · FT" : ""}
                    {!s.bondedAtKickoff ? " · not ranked" : ""}
                  </span>
                </TableCell>
                <TableCell className="num text-right">{s.goals + s.assists}</TableCell>
                <TableCell className="num text-right font-medium">{formatScore(s.display)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function ResultsHistory() {
  const q = useRoundHistory(6);
  return (
    <Section title="Results and payouts" id="results">
      <QueryState
        query={q}
        loading={<LoadingRows rows={3} />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="No rounds settled yet">The first matchday settles after full time and the data freeze.</EmptyState>}
      >
        {(results) => (
          <div className="flex flex-col gap-3" data-testid="results">
            {results.map((x) => (
              <Card key={`${x.round}-${x.settledAt}`} size="sm">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Matchday {x.round} · <span className="font-normal text-muted-foreground">{x.windowLabel}</span>
                    </span>
                    <span className="num text-sm font-normal">
                      Pool {formatUsd(x.pool, { decimals: 0 })} · you {formatUsd(x.myDividends)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {x.boards.slice(0, 8).map((b) => (
                    <div key={b.key} className="text-xs">
                      <p className="mb-1 text-muted-foreground">{b.label}</p>
                      {b.rows.slice(0, 3).map((row) => (
                        <p key={row.playerId} className="num flex justify-between gap-2">
                          <span className={cn("truncate", row.mine && "font-semibold")}>
                            #{row.rank} {row.name}
                          </span>
                          <span>{formatUsd(row.usd, { decimals: 0 })}</span>
                        </p>
                      ))}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
    </Section>
  );
}
