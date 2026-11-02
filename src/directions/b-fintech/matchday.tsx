"use client";

import Link from "next/link";
import NumberFlow from "@number-flow/react";
import { formatCountdown, formatPct, formatPoints, formatScore, formatTokens, formatUsd } from "@/lib/format";
import type { BoardView, RoundState } from "@/lib/protocol/types";
import { useNow, useRound } from "@/lib/protocol/react/hooks";
import { matchMinute, sortedBoards, surname } from "@/directions/lab/derive";
import { cn } from "@/lib/utils";
import { Card, Pill } from "./bits";

/**
 * Matchday overview. Screen question: "How much am I making this matchday, and from whom?"
 * Your provisional earnings lead in the one tinted card; the boards and the feed are calm tables.
 */
export function BMatchday() {
  const q = useRound();
  if (!q.data) return <div className="h-[70vh] rounded-[var(--b-radius-card)] bg-[var(--b-raised)]" aria-busy="true" />;
  const r = q.data;
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-8">
      <Title r={r} />
      <Track r={r} />
      <div className="grid gap-6 md:grid-cols-3">
        <Earnings r={r} />
        <Card title="Round pool" aside={r.pool.capped ? <Pill>Capped</Pill> : null}>
          <span className="b-num text-[24px] leading-none font-semibold">{formatUsd(r.pool.usd, { decimals: 0 })}</span>
          <p className="text-[13px] text-[var(--b-muted)]">
            {formatPct(r.pool.effectiveRate, { decimals: 1 })} of the {formatUsd(r.pool.vault, { decimals: 0 })} dividend vault, split across the boards.
          </p>
        </Card>
        <Card title="Counted at kickoff">
          <span className="b-num text-[24px] leading-none font-semibold">{formatTokens(r.my.totalTokens)}</span>
          <p className="text-[13px] text-[var(--b-muted)]">
            {r.my.players.length ? `Tokens across ${r.my.players.length} players you held at the snapshot.` : "Nothing held at the snapshot."}
          </p>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title={r.projection ? "Boards (projected from form)" : "Boards"} aside={<span>Top five on each board are paid</span>}>
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
            {sortedBoards(r)
              .slice(0, 4)
              .map((b) => (
                <Board key={b.key} b={b} />
              ))}
          </div>
        </Card>
        <Feed r={r} />
      </div>
    </div>
  );
}

function Title({ r }: { r: RoundState }) {
  const now = useNow();
  const left = now ? Math.max(0, r.phaseEndsAt - now) : 0;
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[32px] leading-tight font-bold tracking-[-0.015em]">Matchday {r.round}</h1>
        <p className="text-[14px] text-[var(--b-muted)]">{r.window.title}</p>
      </div>
      <div className="flex items-center gap-3 text-[14px]">
        {r.phase === "live" ? (
          <Pill tone="accent" className="h-7 px-3 text-[13px]">
            Live · {matchMinute(r)}′
          </Pill>
        ) : (
          <Pill className="h-7 px-3 text-[13px]">{r.phase === "open" ? "Before kickoff" : "Full time"}</Pill>
        )}
        <span className="b-num text-[var(--b-muted)]">
          {r.phase === "open" ? "Kickoff in" : r.phase === "live" ? "Final whistle in" : "Next window in"} {now ? formatCountdown(left) : "–"}
        </span>
      </div>
    </header>
  );
}

/** The window as a progress track, kickoffs marked. */
function Track({ r }: { r: RoundState }) {
  const k = r.phase === "open" ? 0 : r.phase === "ended" ? 1 : r.liveProgress;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-2 rounded-full bg-[var(--b-accent-track)]" role="img" aria-label={`Window ${Math.round(k * 100)}% played`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--b-accent)]" style={{ width: `${k * 100}%` }} />
        {r.fixtures.map((f) => (
          <span key={f.club} className="absolute -top-1 h-4 w-px bg-[var(--b-accent-ink)]/40" style={{ left: `${f.kickoff * 100}%` }} />
        ))}
      </div>
      <div className="flex justify-between text-[12px] text-[var(--b-muted)]">
        <span>Snapshot at first kickoff</span>
        <span>{r.fixtures.length} matches</span>
        <span>Final whistle</span>
      </div>
    </div>
  );
}

function Earnings({ r }: { r: RoundState }) {
  const my = r.my;
  return (
    <Card title={r.phase === "ended" ? "You earned" : "Your provisional earnings"} tint>
      <span className="b-num text-[32px] leading-none font-semibold text-[var(--b-accent-ink)]">
        <NumberFlow value={my.provisionalUsd} format={{ style: "currency", currency: "USD" }} />
      </span>
      {my.players.length ? (
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {my.players.map((p) => (
            <li key={p.playerId} className="flex justify-between">
              <Link href={`/lab/b-fintech/player?player=${p.playerId}`} className="text-[var(--b-accent-ink)] underline decoration-[var(--b-accent-track)] underline-offset-2 hover:decoration-[var(--b-accent-ink)]">
                {p.name}
              </Link>
              <span className="b-num font-medium">{formatUsd(p.provisionalUsd)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--b-accent-ink)]">Hold a trading player at the next kickoff to earn from their board finish.</p>
      )}
    </Card>
  );
}

function Board({ b }: { b: BoardView }) {
  const open = Math.max(0, 5 - b.rows.length);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[14px] font-semibold">{b.label}</h3>
        <span className="b-num text-[13px] text-[var(--b-muted)]">{formatUsd(b.poolUsd, { decimals: 0 })}</span>
      </div>
      <table className="w-full text-[13px]">
        <caption className="sr-only">{b.label} board</caption>
        <thead className="sr-only">
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Score</th>
            <th>Payout</th>
          </tr>
        </thead>
        <tbody>
          {b.rows.map((row) => (
            <tr key={row.playerId} className={cn("h-9 border-b border-[var(--b-rule)]", row.mine && "bg-[var(--b-accent-soft)]")}>
              <td className="b-num w-7 pl-1 text-[var(--b-muted)]">{row.rank}</td>
              <td className={cn(row.mine && "font-medium text-[var(--b-accent-ink)]")}>
                {surname(row.name)}
                {row.mine ? <span className="sr-only"> (you hold)</span> : null}
              </td>
              <td className="b-num text-right text-[var(--b-muted)]">{formatScore(row.display)}</td>
              <td className="b-num w-20 pr-1 text-right font-medium">{formatUsd(row.usd)}</td>
            </tr>
          ))}
          {Array.from({ length: open }, (_, i) => (
            <tr key={i} className="h-9 border-b border-[var(--b-rule)]">
              <td className="b-num w-7 pl-1 text-[var(--b-muted)]">{b.rows.length + i + 1}</td>
              <td colSpan={3} className="text-[var(--b-muted)]">
                —
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Feed({ r }: { r: RoundState }) {
  const events = r.events.filter((e) => e.code !== "kickoff" && e.code !== "fulltime").slice(0, 12);
  return (
    <Card title="Live events" aside={<span className="b-num">{r.totals.goals} goals</span>} className="lg:self-start">
      {events.length ? (
        <ol className="flex flex-col" aria-live="polite">
          {events.map((e) => (
            <li key={e.id} className="grid h-[var(--b-row)] grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-[var(--b-rule)] last:border-0">
              <span className="b-num text-[13px] text-[var(--b-muted)]">{e.minute}′</span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[14px] font-medium">{e.name ?? e.club}</span>
                <span className="truncate text-[12px] text-[var(--b-muted)]">
                  {e.label}
                  {e.ranked ? "" : ", not ranked"}
                </span>
              </span>
              <span className="b-num text-[13px] font-medium" style={{ color: e.points >= 0 ? "var(--b-positive)" : "var(--b-negative)" }}>
                {formatPoints(e.points)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-[var(--b-muted)]">Events appear here from the first kickoff.</p>
      )}
    </Card>
  );
}
