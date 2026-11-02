"use client";

import Link from "next/link";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LiveFigure, PositionBadge, Section, Stat, StatStrip, StripCell, Ticker } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingBlock, LoadingRows, QueryState, SignedOutState } from "@/components/common/states";
import { MatchdayStrip } from "@/components/common/matchday-strip";
import { ClaimPanel } from "@/components/portfolio/claim-panel";
import { formatPct, formatPoints, formatScore, formatTokens, formatUsd } from "@/lib/format";
import type { BoardView, MatchEventView, RoundState } from "@/lib/protocol/types";
import { usePortfolio, useRound, useRoundHistory } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/** Matchday live centre. Its question: are my players earning right now? */
export function MatchdayPage() {
  const q = useRound();
  if (q.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <LoadingBlock className="h-16" />
        <LoadingBlock className="h-28" />
        <LoadingBlock className="h-40" />
        <LoadingBlock className="h-72" />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-6">
        <TitleRow r={r} />
        <Card>
          <CardContent>
            <MatchdayStrip round={r} />
          </CardContent>
        </Card>
      </div>
      <ClaimMoment />
      <YourPlayers r={r} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <Boards r={r} />
        <div className="flex min-w-0 flex-col gap-10">
          <EventFeed events={r.events} phase={r.phase} />
          <TopPerformers r={r} />
        </div>
      </div>
      <ResultsHistory />
    </div>
  );
}

function TitleRow({ r }: { r: RoundState }) {
  const status = r.phase === "open" ? "Before kickoff" : r.phase === "live" ? "Live" : "Full time";
  return (
    <div className="flex flex-wrap items-end justify-between gap-3" data-testid="round-header">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.02em] text-ink">Matchday {r.round}</h1>
        <p className="text-sm text-soft">
          {r.window.title} · {r.window.fromLabel} → {r.window.toLabel}
          {r.clockMode === "demo" ? " · demo clock" : ""}
        </p>
      </div>
      <p className={cn("text-sm font-medium", r.phase === "live" ? "text-up" : "text-soft")}>{status}</p>
    </div>
  );
}

function ClaimMoment() {
  const pf = usePortfolio();
  if (!pf.data || pf.data.claimable.totalUsd <= 0.005) return null;
  return (
    <Card data-testid="claim-moment">
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-ink">Your dividends are ready</h2>
        <ClaimPanel compact />
      </CardContent>
    </Card>
  );
}

function YourPlayers({ r }: { r: RoundState }) {
  const my = r.my;
  const label = r.phase === "open" ? "Projected this round" : r.phase === "live" ? "Provisional this round" : "Final whistle, before the freeze";
  return (
    <Section title="Your players" id="your-players">
      {!my.signedIn ? (
        <SignedOutState title="Sign in to follow your players">Whoever holds a player at kickoff shares that player&apos;s winnings.</SignedOutState>
      ) : my.players.length === 0 ? (
        <EmptyState
          title={r.phase === "open" ? "You don't hold a bonded player yet" : "You weren't holding a bonded player at kickoff"}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/markets">Find a player</Link>
            </Button>
          }
        >
          {r.phase === "open" ? "Buy before the kickoff snapshot to be counted this round." : "Buy now to be counted at the next kickoff."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className={cn("text-[32px] leading-9 font-medium tracking-[-0.02em]", my.provisionalUsd > 0.005 ? "text-up" : "text-ink")}>
              <LiveFigure value={my.provisionalUsd} format={(n) => formatUsd(n)} tick />
            </span>
            <span className="text-sm text-soft">
              {label} · {formatTokens(my.totalTokens)} tokens counted
            </span>
          </div>
          <ul
            className={cn(
              "grid gap-px overflow-hidden rounded-2xl bg-rule",
              my.players.length >= 2 && "sm:grid-cols-2",
              my.players.length >= 3 && my.players.length % 2 === 1 && "lg:grid-cols-3"
            )}
            data-testid="your-players"
          >
            {my.players.map((p) => {
              const live = r.scores.find((s) => s.playerId === p.playerId);
              return (
                <li key={p.playerId} className="flex items-start justify-between gap-3 bg-surface px-5 py-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link href={`/player/${p.playerId}`} className="flex items-center gap-2 hover:text-ink">
                      <Ticker ticker={p.ticker} className="text-[13px] text-ink" />
                      <span className="truncate text-sm text-soft">{p.name}</span>
                    </Link>
                    <span className="num text-xs text-faint">
                      {formatTokens(p.tokens)} tokens · {formatPct(p.eligibleShare, { decimals: 3 })} of holders
                    </span>
                    <span className="num text-xs text-faint">
                      {!p.playing
                        ? "Not playing this window"
                        : live && live.matchMinute >= 0
                          ? `${live.matchMinute >= 90 ? "Full time" : `${live.matchMinute}′`} · score ${formatScore(live.display)}`
                          : live?.slot
                            ? `Kicks off ${live.slot}`
                            : "Plays this window"}
                    </span>
                  </div>
                  <span className={cn("num text-base font-medium", p.provisionalUsd > 0.005 ? "text-up" : "text-faint")}>
                    <LiveFigure value={p.provisionalUsd} format={(n) => formatUsd(n)} tick />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-faint">
            {r.phase === "open"
              ? "Projected from form ratings. Payouts are decided by match data frozen 12 hours after the last whistle."
              : "Provisional: live scores and the round pool as sized now. Final after the data freeze."}
          </p>
        </div>
      )}
    </Section>
  );
}

const EventRow = memo(function EventRow({ e }: { e: MatchEventView }) {
  return (
    <li className="feed-enter flex items-baseline gap-3 py-2.5 text-sm">
      <span className="num w-[76px] shrink-0 text-xs text-faint">
        {e.slot} · {e.minute}′
      </span>
      <span className="min-w-0 flex-1 text-soft">
        {e.playerId ? (
          <>
            <Link href={`/player/${e.playerId}`} className="text-ink underline decoration-control underline-offset-4 hover:decoration-ink">
              {e.name}
            </Link>{" "}
            {e.label.toLowerCase()}
            {!e.ranked ? <span className="text-faint"> · not ranked</span> : null}
          </>
        ) : (
          <>
            {e.label} · {e.club}
          </>
        )}
      </span>
      {e.playerId ? <span className={cn("num shrink-0 text-xs", e.points > 0 ? "text-up" : e.points < 0 ? "text-down" : "text-faint")}>{formatPoints(e.points)}</span> : null}
    </li>
  );
});

function EventFeed({ events, phase }: { events: MatchEventView[]; phase: RoundState["phase"] }) {
  return (
    <Section title="Live feed" id="feed">
      {events.length === 0 ? (
        <p className="rounded-2xl bg-surface px-5 py-4 text-sm text-soft">{phase === "open" ? "Events appear here from the first kickoff." : "Waiting for the next event."}</p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-rule overflow-y-auto overscroll-contain rounded-2xl bg-surface px-5" aria-live="polite" aria-relevant="additions" data-testid="event-feed">
          {events.slice(0, 40).map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
        </ul>
      )}
      <p className="text-xs text-faint">Points include the competition coefficient. Players still on the launch curve at kickoff aren&apos;t ranked.</p>
    </Section>
  );
}

function BoardCard({ b, projection }: { b: BoardView; projection: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? b.rows : b.rows.slice(0, 3);
  return (
    <div className="flex flex-col rounded-2xl bg-surface px-5 py-4" data-testid="board">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">{b.label}</h3>
        <span className="num text-xs text-faint">
          ×{b.multiplier.toFixed(2)} · {formatUsd(b.poolUsd, { decimals: 0 })}
        </span>
      </div>
      <ol className="mt-2 flex flex-col">
        {rows.map((row) => (
          <li key={row.playerId} className="num flex items-center gap-3 py-2 text-sm">
            <span className="w-4 text-xs text-faint">{row.rank}</span>
            <Link href={`/player/${row.playerId}`} className={cn("min-w-0 flex-1 truncate hover:underline", row.mine ? "text-ink" : "text-soft")}>
              {row.name}
            </Link>
            {row.mine ? <span className="size-1.5 shrink-0 rounded-full bg-up" role="img" aria-label="You hold this player" /> : null}
            <span className="w-8 text-right text-faint">{projection ? formatScore(row.points) : formatScore(row.display)}</span>
            <span className="w-12 text-right text-ink">{formatUsd(row.usd, { decimals: 0 })}</span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, 3 - rows.length) }, (_, i) => (
          <li key={`empty-${i}`} className="num flex items-center gap-3 py-2 text-sm text-faint">
            <span className="w-4 text-xs">{rows.length + i + 1}</span>
            <span className="flex-1">—</span>
          </li>
        ))}
      </ol>
      {b.rows.length > 3 ? (
        <button type="button" className="mt-1 self-start text-xs text-soft hover:text-ink" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Show top 3" : `Show top ${b.rows.length}`}
        </button>
      ) : (
        <p className="mt-1 text-xs text-faint">{b.rows.length === 1 ? "Only one player ranked" : `${b.rows.length} players ranked`}</p>
      )}
    </div>
  );
}

function Boards({ r }: { r: RoundState }) {
  const [all, setAll] = useState(false);
  const main = r.boards.filter((b) => b.kind !== "league" || b.rows.length >= 3);
  const boards = all ? r.boards : main;
  const title = r.projection ? "Boards · projection" : r.phase === "ended" ? "Boards · final whistle" : "Boards · provisional";
  return (
    <Section
      title={title}
      id="boards"
      description={`Top five on each board share ${formatUsd(r.pool.usd, { decimals: 0 })}: 35 / 25 / 20 / 12 / 8%.`}
      action={
        r.boards.length > main.length ? (
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Main boards" : `All ${r.boards.length} boards`}
          </Button>
        ) : null
      }
    >
      {r.boards.length === 0 ? (
        <EmptyState title="Nobody ranked yet">Only bonded players who play in this window are ranked.</EmptyState>
      ) : (
        <div className="grid items-start gap-3 sm:grid-cols-2">
          {boards.map((b) => (
            <BoardCard key={b.key} b={b} projection={r.projection} />
          ))}
        </div>
      )}
      <p className="text-xs text-faint">
        A board&apos;s share of the pool is the players ranked (up to five) times its multiplier. One player can win on several boards.
        {r.projection ? " Before kickoff the boards are projected from form ratings." : ""}
      </p>
    </Section>
  );
}

function TopPerformers({ r }: { r: RoundState }) {
  const top = r.scores.filter((s) => s.minutes > 0).slice(0, 8);
  const t = r.totals;
  return (
    <Section title="Top performers" id="top">
      <StatStrip className="sm:grid-flow-row sm:grid-cols-3">
        <StripCell className="px-4 py-3">
          <Stat label="Goals" value={t.goals} />
        </StripCell>
        <StripCell className="px-4 py-3">
          <Stat label="Assists" value={t.assists} />
        </StripCell>
        <StripCell className="px-4 py-3">
          <Stat label="Cards" value={t.cards} />
        </StripCell>
      </StatStrip>
      {top.length === 0 ? (
        <p className="text-sm text-soft">{r.phase === "open" ? "Scores appear from the first kickoff." : "No minutes played yet."}</p>
      ) : (
        <ol className="flex flex-col rounded-2xl bg-surface px-5 py-2">
          {top.map((s) => (
            <li key={s.playerId} className="num flex items-center gap-3 py-2 text-sm">
              <Link href={`/player/${s.playerId}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
                {s.name}
              </Link>
              <PositionBadge position={s.position} />
              <span className="w-10 text-right text-xs text-faint">{s.matchMinute >= 90 ? "FT" : s.matchMinute >= 0 ? `${s.matchMinute}′` : ""}</span>
              <span className={cn("w-8 text-right font-medium", s.bondedAtKickoff ? "text-ink" : "text-faint")}>{formatScore(s.display)}</span>
            </li>
          ))}
        </ol>
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
        empty={<EmptyState title="No rounds settled yet">The first matchday settles after the last whistle and the data freeze.</EmptyState>}
      >
        {(results) => (
          <div className="flex flex-col gap-3" data-testid="results">
            {results.map((x) => (
              <div key={`${x.round}-${x.settledAt}`} className="rounded-2xl bg-surface px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink">
                    Matchday {x.round} <span className="font-normal text-soft">· {x.windowLabel}</span>
                  </h3>
                  <span className="num text-sm text-soft">
                    Paid {formatUsd(x.pool, { decimals: 0 })} · you <span className={x.myDividends > 0.005 ? "text-up" : "text-ink"}>{formatUsd(x.myDividends)}</span>
                  </span>
                </div>
                <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  {x.boards.slice(0, 8).map((b) => (
                    <div key={b.key} className="text-xs">
                      <p className="mb-1 text-faint">{b.label}</p>
                      {b.rows.slice(0, 3).map((row) => (
                        <p key={row.playerId} className="num flex justify-between gap-2 py-0.5">
                          <span className={cn("truncate", row.mine ? "text-ink" : "text-soft")}>
                            {row.rank}. {row.name}
                          </span>
                          <span className="text-ink">{formatUsd(row.usd, { decimals: 0 })}</span>
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </Section>
  );
}
