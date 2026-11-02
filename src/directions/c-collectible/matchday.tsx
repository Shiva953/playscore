"use client";

import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { PLAYERS_BY_ID, type PositionCode } from "@score/core";
import { formatCountdown, formatPct, formatPoints, formatScore, formatUsd } from "@/lib/format";
import type { BoardView, RoundState } from "@/lib/protocol/types";
import { useNow, usePlayers, useRound } from "@/lib/protocol/react/hooks";
import { matchMinute, sortedBoards, surname } from "@/directions/lab/derive";
import { cn } from "@/lib/utils";
import { useWidth } from "@/directions/lab/use-width";
import { FACE, PlayerCard, type CardPlayer } from "./card";

const EASE = [0.23, 1, 0.32, 1] as const;

/**
 * Matchday. Your hand of cards is the hero: each card wears its live points and what it is earning.
 * The prize sits on a black card; the boards reorder with the scores; events pop in as stickers.
 */
export function CMatchday() {
  const q = useRound();
  if (!q.data) return <div className="mx-auto mt-6 h-[70vh] max-w-[1320px] rounded-[24px] bg-white/60" aria-busy="true" />;
  const r = q.data;
  return (
    <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-3 pt-6 pb-24 md:px-6">
      <Title r={r} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Hand r={r} />
        <Prize r={r} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
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
    <header className="flex flex-wrap items-end justify-between gap-4 px-1">
      <div className="flex flex-col gap-1">
        <h1 className="c-display text-[34px] md:text-[44px]">Matchday {r.round}</h1>
        <p className="text-[15px] text-[var(--c-mute)]">{r.window.title}</p>
      </div>
      <div className="flex items-center gap-2">
        {r.phase === "live" ? (
          <span className="c-num flex h-11 items-center gap-2 rounded-full bg-[var(--c-ink)] px-5 text-[17px] text-white">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-[#3ee08a]" />
            {matchMinute(r)}′
          </span>
        ) : null}
        <span className="flex h-11 items-center rounded-full bg-white px-5 text-[15px] font-semibold">
          {r.phase === "open" ? "Kickoff in" : r.phase === "live" ? "Full time in" : "Next window in"}
          <span className="c-num ml-2">{now ? formatCountdown(left) : "–"}</span>
        </span>
      </div>
    </header>
  );
}

/** Your players as a fanned hand of cards, each with its live score and earnings pinned on. */
function Hand({ r }: { r: RoundState }) {
  const players = usePlayers();
  const reduce = useReducedMotion();
  const [box, boxW] = useWidth<HTMLElement>(600);
  const byId = new Map((players.data ?? []).map((p) => [p.id, p]));
  const scores = new Map(r.scores.map((s) => [s.playerId, s]));
  const mine = r.my.players.flatMap((m) => {
    const p: CardPlayer | undefined = byId.get(m.playerId);
    return p ? [{ m, p }] : [];
  });
  const n = mine.length;
  // Cards overlap by 24px; on a phone they shrink so the whole hand fits.
  const cardW = Math.max(120, Math.min(196, Math.floor((boxW - 48 + 24 * (n - 1)) / Math.max(1, n))));

  return (
    <section ref={box} aria-label="Your hand" className="c-panel flex min-w-0 flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="c-display text-[20px]">Your hand</h2>
        <span className="text-[14px] text-[var(--c-mute)]">{r.my.snapshotTaken ? "Held at kickoff" : "Counts at kickoff"}</span>
      </div>
      {n ? (
        <ul className="flex justify-center pt-4 pb-6">
          {mine.map(({ m, p }, i) => {
            const s = scores.get(m.playerId);
            const angle = n > 1 ? (i - (n - 1) / 2) * 5 : 0;
            const chips = (
              <span className="flex flex-col items-end gap-1 max-[640px]:items-center">
                <span className="c-num rounded-full bg-[var(--c-ink)] px-2.5 py-1 text-[13px] text-white">{s ? formatScore(s.display) : "–"} pts</span>
                <span className="c-num rounded-full bg-white px-2.5 py-1 text-[13px] text-[var(--c-up)] ring-1 ring-[var(--c-line)]">{formatUsd(m.provisionalUsd)}</span>
              </span>
            );
            return (
              <motion.li
                key={m.playerId}
                className="-mx-3 first:ml-0 last:mr-0"
                initial={reduce ? false : { y: 30, opacity: 0 }}
                animate={{ y: Math.abs(angle) * 1.4, opacity: 1, rotate: reduce ? 0 : angle }}
                transition={{ duration: 0.45, ease: EASE, delay: reduce ? 0 : i * 0.06 }}
                whileHover={reduce ? undefined : { y: -12, rotate: 0, zIndex: 10 }}
                style={{ zIndex: i }}
              >
                <Link href={`/lab/c-collectible/player?player=${m.playerId}`} className="block rounded-[24px]">
                  <PlayerCard
                    p={p}
                    width={cardW}
                    tilt={false}
                    as="div"
                    badge={cardW >= 170 ? <span className="absolute top-3 right-3">{chips}</span> : null}
                  />
                  {cardW < 170 ? <span className="mt-2 flex justify-center">{chips}</span> : null}
                </Link>
              </motion.li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[15px] text-[var(--c-mute)]">Collect a trading player before the next kickoff and their board finish pays you here.</p>
      )}
    </section>
  );
}

function Prize({ r }: { r: RoundState }) {
  return (
    <section aria-label="Prize" className="flex flex-col justify-between gap-6 rounded-[24px] bg-[var(--c-ink)] p-6 text-white shadow-[var(--c-sticker)]">
      <div className="flex flex-col gap-1">
        <span className="text-[14px] text-white/70">{r.phase === "ended" ? "You earned" : "You'd take home now"}</span>
        <span className="c-num text-[48px] leading-none text-[#3ee08a]">{formatUsd(r.my.provisionalUsd)}</span>
      </div>
      <div className="flex flex-col gap-2 rounded-[18px] bg-white/10 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[14px] text-white/75">Round prize</span>
          <span className="c-num text-[22px]">{formatUsd(r.pool.usd, { decimals: 0 })}</span>
        </div>
        <p className="text-[13px] text-white/70">
          {formatPct(r.pool.effectiveRate, { decimals: 1 })} of the {formatUsd(r.pool.vault, { decimals: 0 })} vault{r.pool.capped ? ", capped" : ""}, shared by
          the top five on every board.
        </p>
      </div>
    </section>
  );
}

function Boards({ r }: { r: RoundState }) {
  return (
    <section aria-label="Boards" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="c-display text-[20px]">{r.projection ? "Boards, projected" : "Boards"}</h2>
        <span className="text-[14px] text-[var(--c-mute)]">Top five are paid</span>
      </div>
      <LayoutGroup>
        <div className="grid gap-4 md:grid-cols-2">
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
  const reduce = useReducedMotion();
  const pos = (id: string): PositionCode | null => PLAYERS_BY_ID[id]?.position ?? null;
  return (
    <div className="c-panel flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-[15px] font-bold">{b.label}</h3>
        <span className="c-num text-[14px]">{formatUsd(b.poolUsd, { decimals: 0 })}</span>
      </div>
      <ol className="flex flex-col gap-1">
        {b.rows.map((row) => {
          const p = pos(row.playerId);
          return (
            <motion.li
              key={row.playerId}
              layout={!reduce}
              transition={{ duration: 0.35, ease: EASE }}
              className={cn("grid h-11 grid-cols-[28px_10px_1fr_auto_auto] items-center gap-2.5 rounded-[14px] px-2", row.mine ? "bg-[var(--c-ink)] text-white" : "bg-[var(--c-chip)]")}
            >
              <span className="c-num text-center text-[15px]">{row.rank}</span>
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: p ? FACE[p].bg : "transparent" }} />
              <span className="truncate text-[15px] font-semibold">
                {surname(row.name)}
                {row.mine ? <span className="sr-only"> (in your hand)</span> : null}
              </span>
              <span className={cn("c-num text-[13px]", row.mine ? "text-white/75" : "text-[var(--c-mute)]")}>{formatScore(row.display)}</span>
              <span className="c-num w-[72px] text-right text-[14px]">{formatUsd(row.usd)}</span>
            </motion.li>
          );
        })}
        {Array.from({ length: Math.max(0, 5 - b.rows.length) }, (_, i) => (
          <li key={`o${i}`} className="grid h-11 grid-cols-[28px_1fr] items-center gap-2.5 rounded-[14px] border-2 border-dashed border-[var(--c-line)] px-2">
            <span className="c-num text-center text-[15px] text-[var(--c-mute)]">{b.rows.length + i + 1}</span>
            <span className="text-[14px] text-[var(--c-mute)]">Open place</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Feed({ r }: { r: RoundState }) {
  const reduce = useReducedMotion();
  const events = r.events.filter((e) => e.code !== "kickoff" && e.code !== "fulltime").slice(0, 10);
  return (
    <section aria-label="Live events" className="c-panel flex flex-col gap-3 p-5 lg:self-start">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="c-display text-[20px]">Happening</h2>
        <span className="c-num text-[14px] text-[var(--c-mute)]">{r.totals.goals} goals</span>
      </div>
      {events.length ? (
        <ol className="flex flex-col gap-2" aria-live="polite">
          <AnimatePresence initial={false}>
            {events.map((e) => {
              const p = e.playerId ? PLAYERS_BY_ID[e.playerId]?.position : null;
              const goal = e.code === "goal";
              return (
                <motion.li
                  key={e.id}
                  layout={!reduce}
                  initial={reduce ? { opacity: 0 } : { scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 26 }}
                  className={cn("flex items-center gap-3 rounded-[16px] px-3 py-2.5", goal ? "text-[#0f1419]" : "bg-[var(--c-chip)]")}
                  style={goal && p ? { background: FACE[p].bg, color: FACE[p].ink } : undefined}
                >
                  <span className="c-num w-9 text-[14px]">{e.minute}′</span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[15px] font-semibold">{e.name ? surname(e.name) : e.club}</span>
                    <span className={cn("truncate text-[13px]", goal ? "opacity-90" : "text-[var(--c-mute)]")}>
                      {e.label}
                      {e.ranked ? "" : ", not ranked"}
                    </span>
                  </span>
                  <span className="c-num text-[14px]">{formatPoints(e.points)}</span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      ) : (
        <p className="text-[15px] text-[var(--c-mute)]">Events appear from the first kickoff.</p>
      )}
    </section>
  );
}
