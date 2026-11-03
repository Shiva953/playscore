"use client";

import Link from "next/link";
import { LayoutGroup, motion } from "motion/react";
import { PLAYERS_BY_ID, type PositionCode } from "@score/core";
import { formatCountdown, formatPct, formatPoints, formatScore, formatUsd } from "@/lib/format";
import type { BoardView, RoundState } from "@/lib/protocol/types";
import { useNow, usePlayers, useRound } from "@/lib/protocol/react/hooks";
import { matchMinute, sortedBoards, surname } from "@/directions/lab/derive";
import { useWidth } from "@/directions/lab/use-width";
import { cn } from "@/lib/utils";
import { FACE, PlayerCard, type CardPlayer } from "./card";

/**
 * Matchday in one screen: your hand of cards (live points and earnings under each), what you'd take
 * home, the boards (rows slide when ranks change) and the feed (new events pop in).
 */
export function CMatchday() {
  const q = useRound();
  if (!q.data) return <div className="mx-auto mt-4 h-[60vh] max-w-[1320px] rounded-[16px] bg-white/70" aria-busy="true" />;
  const r = q.data;
  return (
    <main className="mx-auto flex max-w-[1320px] flex-col gap-4 px-3 pt-3 pb-20 md:px-6">
      <Title r={r} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Hand r={r} />
        <Prize r={r} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Boards r={r} />
        <Feed r={r} />
      </div>
    </main>
  );
}

function Title({ r }: { r: RoundState }) {
  const now = useNow();
  const left = now ? Math.max(0, r.phaseEndsAt - now) : 0;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex items-baseline gap-2.5">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Matchday {r.round}</h1>
        <span className="text-[13px] text-[var(--c-mute)]">{r.window.title}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        {r.phase === "live" ? (
          <span className="c-num flex h-8 items-center gap-1.5 rounded-full bg-[var(--c-ink)] px-3 text-white">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[#3ee08a]" />
            {matchMinute(r)}′
          </span>
        ) : null}
        <span className="flex h-8 items-center rounded-full border border-[var(--c-line)] bg-white px-3">
          {r.phase === "open" ? "Kickoff in" : r.phase === "live" ? "Full time in" : "Next window in"}
          <span className="c-num ml-1.5">{now ? formatCountdown(left) : "–"}</span>
        </span>
      </div>
    </header>
  );
}

function Hand({ r }: { r: RoundState }) {
  const players = usePlayers();
  const [box, boxW] = useWidth<HTMLElement>(600);
  const byId = new Map((players.data ?? []).map((p) => [p.id, p]));
  const scores = new Map(r.scores.map((s) => [s.playerId, s]));
  const mine = r.my.players.flatMap((m) => {
    const p: CardPlayer | undefined = byId.get(m.playerId);
    return p ? [{ m, p }] : [];
  });
  const n = mine.length;
  const cardW = Math.max(104, Math.min(150, Math.floor((boxW - 32 + 12 * (n - 1)) / Math.max(1, n))));

  return (
    <section ref={box} aria-label="Your hand" className="c-panel flex min-w-0 flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Your hand</h2>
        <span className="text-[12px] text-[var(--c-mute)]">{r.my.snapshotTaken ? "Held at kickoff" : "Counts at kickoff"}</span>
      </div>
      {n ? (
        <ul className="c-fan flex justify-center pt-2">
          {mine.map(({ m, p }, i) => {
            const s = scores.get(m.playerId);
            const mid = (n - 1) / 2;
            return (
              <li
                key={m.playerId}
                className="c-deal relative -mx-1.5 flex flex-col items-center gap-2"
                style={{ "--r": `${(i - mid) * 4}deg`, "--y": `${Math.abs(i - mid) * 6}px`, animationDelay: `${i * 50}ms`, zIndex: i } as React.CSSProperties}
              >
                <Link href={`/lab/c-collectible/player?player=${m.playerId}`} className="block rounded-[16px]">
                  <PlayerCard p={p} width={cardW} tilt={false} as="div" />
                </Link>
                <span className="flex items-center gap-1 text-[12px]">
                  <span className="c-num rounded-full bg-[var(--c-ink)] px-2 py-0.5 font-semibold text-white">{s ? formatScore(s.display) : "–"}</span>
                  <span className="c-num font-semibold text-[var(--c-up)]">{formatUsd(m.provisionalUsd)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-[13px] text-[var(--c-mute)]">Hold a trading player before the next kickoff and their board finish pays you here.</p>
      )}
    </section>
  );
}

function Prize({ r }: { r: RoundState }) {
  return (
    <section aria-label="Prize" className="flex flex-col justify-between gap-4 rounded-[16px] bg-[var(--c-ink)] p-4 text-white">
      <div className="flex flex-col gap-1">
        <span className="text-[12px] text-white/65">{r.phase === "ended" ? "You earned" : "You'd take home now"}</span>
        <span className="c-num text-[30px] leading-none font-bold tracking-[-0.02em] text-[#3ee08a]">{formatUsd(r.my.provisionalUsd)}</span>
      </div>
      {r.my.players.length ? (
        <ul className="flex flex-col gap-1.5 text-[12px]">
          {r.my.players.map((m) => (
            <li key={m.playerId} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-white/80">{m.name}</span>
              <span className="c-num font-semibold">{formatUsd(m.provisionalUsd)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-1 border-t border-white/12 pt-3 text-[12px]">
        <span className="flex items-baseline justify-between">
          <span className="text-white/65">Round prize</span>
          <span className="c-num text-[14px] font-semibold">{formatUsd(r.pool.usd, { decimals: 0 })}</span>
        </span>
        <span className="text-white/65">
          {formatPct(r.pool.effectiveRate, { decimals: 1 })} of the {formatUsd(r.pool.vault, { decimals: 0 })} vault{r.pool.capped ? ", capped" : ""}
        </span>
      </div>
    </section>
  );
}

function Boards({ r }: { r: RoundState }) {
  return (
    <section aria-label="Boards" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-semibold">{r.projection ? "Boards, projected" : "Boards"}</h2>
        <span className="text-[12px] text-[var(--c-mute)]">Top five are paid</span>
      </div>
      <LayoutGroup>
        <div className="grid gap-3 md:grid-cols-2">
          {sortedBoards(r)
            .slice(0, 4)
            .map((b) => (
              <Board key={b.key} b={b} />
            ))}
        </div>
      </LayoutGroup>
    </section>
  );
}

function Board({ b }: { b: BoardView }) {
  const pos = (id: string): PositionCode | null => PLAYERS_BY_ID[id]?.position ?? null;
  return (
    <div className="c-panel flex flex-col gap-1 p-3">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-[13px] font-semibold">{b.label}</h3>
        <span className="c-num text-[12px] text-[var(--c-mute)]">{formatUsd(b.poolUsd, { decimals: 0 })}</span>
      </div>
      <ol className="flex flex-col gap-0.5">
        {b.rows.map((row) => {
          const p = pos(row.playerId);
          return (
            <motion.li
              key={row.playerId}
              layout="position"
              transition={{ duration: 0.3, ease: [0.77, 0, 0.175, 1] }}
              className={cn(
                "grid h-9 grid-cols-[18px_8px_1fr_auto_auto] items-center gap-2 rounded-[10px] px-2 text-[13px]",
                row.mine ? "bg-[var(--c-ink)] text-white" : "odd:bg-[var(--c-chip)]"
              )}
            >
              <span className="c-num text-center font-semibold">{row.rank}</span>
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: p ? FACE[p].bg : "transparent" }} />
              <span className="truncate font-medium">
                {surname(row.name)}
                {row.mine ? <span className="sr-only"> (in your hand)</span> : null}
              </span>
              <span className={cn("c-num text-[12px]", row.mine ? "text-white/70" : "text-[var(--c-mute)]")}>{formatScore(row.display)}</span>
              <span className="c-num w-16 text-right font-semibold">{formatUsd(row.usd)}</span>
            </motion.li>
          );
        })}
        {Array.from({ length: Math.max(0, 5 - b.rows.length) }, (_, i) => (
          <li key={`o${i}`} className="grid h-9 grid-cols-[18px_1fr] items-center gap-2 px-2 text-[13px] text-[var(--c-mute)]">
            <span className="c-num text-center">{b.rows.length + i + 1}</span>
            <span>Open place</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Feed({ r }: { r: RoundState }) {
  const events = r.events.filter((e) => e.code !== "kickoff" && e.code !== "fulltime").slice(0, 10);
  return (
    <section aria-label="Live events" className="c-panel flex flex-col gap-1 p-3 lg:self-start">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h2 className="text-[13px] font-semibold">Happening now</h2>
        <span className="c-num text-[12px] text-[var(--c-mute)]">{r.totals.goals} goals</span>
      </div>
      {events.length ? (
        <ol className="flex flex-col gap-0.5" aria-live="polite">
          {events.map((e) => {
            const p = e.playerId ? PLAYERS_BY_ID[e.playerId]?.position : null;
            const goal = e.code === "goal";
            return (
              <li
                key={e.id}
                className={cn("c-pop grid grid-cols-[30px_1fr_auto] items-center gap-2 rounded-[10px] px-2 py-1.5", !goal && "odd:bg-[var(--c-chip)]")}
                style={goal && p ? { background: FACE[p].bg, color: FACE[p].ink } : undefined}
              >
                <span className="c-num text-[12px] font-semibold">{e.minute}′</span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[13px] font-semibold">{e.name ? surname(e.name) : e.club}</span>
                  <span className={cn("truncate text-[11px]", goal ? "opacity-90" : "text-[var(--c-mute)]")}>
                    {e.label}
                    {e.ranked ? "" : ", not ranked"}
                  </span>
                </span>
                <span className="c-num text-[12px] font-semibold">{formatPoints(e.points)}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-1 py-4 text-[13px] text-[var(--c-mute)]">Events appear from the first kickoff.</p>
      )}
    </section>
  );
}
