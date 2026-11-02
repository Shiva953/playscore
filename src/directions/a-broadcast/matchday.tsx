"use client";

import Link from "next/link";
import { PLAYERS_BY_ID, type PositionCode } from "@score/core";
import { formatCountdown, formatPct, formatPoints, formatScore, formatUsd } from "@/lib/format";
import type { BoardView, MatchEventView, RoundState } from "@/lib/protocol/types";
import { useNow, useRound } from "@/lib/protocol/react/hooks";
import { matchMinute, sortedBoards, surname } from "@/directions/lab/derive";
import { cn } from "@/lib/utils";
import { BarHeading, PosBlock } from "./bits";

const pos = (id: string | null): PositionCode | null => (id ? (PLAYERS_BY_ID[id]?.position ?? null) : null);

/**
 * Matchday live centre as a broadcast: the scorebug band with the clock, your players as a lower
 * third with your provisional money as the biggest figure, the boards as league-table graphics,
 * and the event feed as wipe-in banners.
 */
export function AMatchday() {
  const q = useRound();
  if (!q.data) return <div className="h-[70vh] bg-[var(--a-panel)]" aria-busy="true" />;
  const r = q.data;
  return (
    <main className="flex flex-col">
      <Bug r={r} />
      <div className="mx-auto grid w-full max-w-[1440px] gap-8 px-4 py-8 md:px-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-8">
          <YourPlayers r={r} />
          <Boards r={r} />
        </div>
        <Feed r={r} />
      </div>
    </main>
  );
}

function Bug({ r }: { r: RoundState }) {
  const now = useNow();
  const left = now ? Math.max(0, r.phaseEndsAt - now) : 0;
  const minute = matchMinute(r);
  return (
    <section aria-label="Matchday clock" className="bg-black text-white">
      <div className="mx-auto grid max-w-[1440px] items-stretch md:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-col justify-center gap-1 px-4 py-4 md:px-8 md:py-6">
          <h1 className="a-display text-[44px] md:text-[64px]" style={{ textTransform: "none" }}>
            Matchday {r.round}
          </h1>
          <p className="text-[14px] text-white/70">{r.window.title}</p>
        </div>
        <div className="flex items-stretch">
          {r.phase === "live" ? (
            <>
              <span className="a-num flex items-center bg-[var(--a-signal)] px-5 text-[28px] text-black">Live</span>
              <span className="a-num flex items-center bg-white px-5 text-[64px] leading-none text-black md:text-[88px]" aria-label={`Minute ${minute}`}>
                {minute}′
              </span>
            </>
          ) : r.phase === "open" ? (
            <>
              <span className="a-num flex items-center bg-[var(--a-signal)] px-5 text-[24px] text-black">Kickoff in</span>
              <span className="a-num flex items-center bg-white px-5 text-[56px] leading-none text-black md:text-[76px]">
                {now ? formatCountdown(left) : "–"}
              </span>
            </>
          ) : (
            <span className="a-num flex items-center bg-[var(--a-signal)] px-6 text-[40px] text-black md:text-[56px]">Full time</span>
          )}
        </div>
        <div className="flex flex-col items-start justify-center gap-1 px-4 py-4 md:items-end md:px-8">
          <span className="text-[13px] text-white/70">Round pool{r.projection ? ", projected" : ""}</span>
          <span className="a-num text-[40px] leading-none md:text-[52px]">{formatUsd(r.pool.usd, { decimals: 0 })}</span>
          <span className="text-[13px] text-white/70">
            {formatPct(r.pool.effectiveRate, { decimals: 1 })} of the {formatUsd(r.pool.vault, { decimals: 0 })} vault
            {r.pool.capped ? ", capped" : ""}
          </span>
        </div>
      </div>
      <Progress r={r} />
    </section>
  );
}

/** The window as one bar: yellow fill to now, a white tick at each club's kickoff. */
function Progress({ r }: { r: RoundState }) {
  const k = r.phase === "open" ? 0 : r.phase === "ended" ? 1 : r.liveProgress;
  return (
    <div className="relative h-2 bg-white/15" aria-hidden="true">
      <div className="absolute inset-y-0 left-0 bg-[var(--a-signal)]" style={{ width: `${k * 100}%` }} />
      {r.fixtures.map((f) => (
        <span key={f.club} className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${f.kickoff * 100}%` }} />
      ))}
    </div>
  );
}

function YourPlayers({ r }: { r: RoundState }) {
  const my = r.my;
  const scores = new Map(r.scores.map((s) => [s.playerId, s]));
  const rank = (id: string) => {
    let best: { rank: number; board: string } | null = null;
    for (const b of r.boards) {
      const row = b.rows.find((x) => x.playerId === id);
      if (row && (!best || row.rank < best.rank)) best = { rank: row.rank, board: b.label };
    }
    return best;
  };
  return (
    <section aria-label="Your players" className="flex flex-col gap-4">
      <BarHeading aside={<span>{my.snapshotTaken ? "Counted at kickoff" : "Counts at kickoff"}</span>}>Your players</BarHeading>
      {!my.signedIn || !my.players.length ? (
        <p className="text-[15px] text-[var(--a-mute)]">Hold a trading player at kickoff and their board finish pays you here.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-end">
          <div className="flex flex-col">
            <span className="a-label">{r.phase === "ended" ? "You earned" : "You'd earn if it ended now"}</span>
            <span className="a-num text-[72px] leading-[0.9] md:text-[104px]" style={{ color: "var(--a-up)" }}>
              {formatUsd(my.provisionalUsd)}
            </span>
          </div>
          <ul className="flex flex-col">
            {my.players.map((p) => {
              const s = scores.get(p.playerId);
              const best = rank(p.playerId);
              const position = pos(p.playerId);
              return (
                <li key={p.playerId} className="grid grid-cols-[auto_1fr_auto_auto] items-stretch border-b-2 border-black">
                  {position ? <PosBlock position={position} className="h-auto self-stretch" /> : <span />}
                  <Link href={`/lab/a-broadcast/player?player=${p.playerId}`} className="a-num flex items-center px-3 py-2 text-[22px] hover:underline">
                    {surname(p.name)}
                  </Link>
                  <span className="a-num flex items-center px-3 text-[22px]" aria-label="Points">
                    {s ? formatScore(s.display) : "–"}
                    <span className="ml-1 text-[13px] font-medium text-[var(--a-mute)]">pts</span>
                  </span>
                  <span className={cn("a-num flex min-w-[118px] items-center justify-end px-3 text-[22px]", best ? "bg-[var(--a-signal)]" : "")}>
                    {best ? `#${best.rank} ${best.board}` : formatUsd(p.provisionalUsd)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Boards({ r }: { r: RoundState }) {
  const boards = sortedBoards(r).slice(0, 4);
  return (
    <section aria-label="Boards" className="flex flex-col gap-4">
      <BarHeading aside={<span>Top five on each board are paid</span>}>{r.projection ? "Boards, projected from form" : "Boards"}</BarHeading>
      <div className="grid gap-6 md:grid-cols-2">
        {boards.map((b) => (
          <Board key={b.key} b={b} />
        ))}
      </div>
    </section>
  );
}

function Board({ b }: { b: BoardView }) {
  const open = Math.max(0, 5 - b.rows.length);
  return (
    <div className="flex flex-col self-start">
      <div className="a-num flex items-baseline justify-between bg-[var(--a-panel)] px-3 py-2 text-[18px]">
        <h3>{b.label}</h3>
        <span className="text-[15px]">
          {formatUsd(b.poolUsd, { decimals: 0 })} <span className="font-medium text-[var(--a-mute)]">to share</span>
        </span>
      </div>
      <table className="w-full border-collapse">
        <caption className="sr-only">{b.label} board, top five</caption>
        <thead className="sr-only">
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Points</th>
            <th>Payout</th>
          </tr>
        </thead>
        <tbody>
          {b.rows.map((row) => {
            const position = pos(row.playerId);
            return (
              <tr key={row.playerId} className={cn("border-b border-black", row.mine && "bg-[var(--a-signal)]")}>
                <td className="w-10 p-0">
                  <span className="a-num flex h-10 w-10 items-center justify-center bg-black text-[20px] text-white">{row.rank}</span>
                </td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    {position ? <PosBlock position={position} size="sm" /> : null}
                    <span className="a-num text-[18px]">{surname(row.name)}</span>
                    {row.mine ? <span className="sr-only">(you hold)</span> : null}
                  </span>
                </td>
                <td className="a-num px-2 text-right text-[18px]">{formatScore(row.display)}</td>
                <td className="a-num px-3 text-right text-[18px]">{formatUsd(row.usd)}</td>
              </tr>
            );
          })}
          {Array.from({ length: open }, (_, i) => (
            <tr key={`open-${i}`} className="border-b border-[var(--a-panel-2)]">
              <td className="w-10 p-0">
                <span className="a-num flex h-10 w-10 items-center justify-center bg-[var(--a-panel)] text-[20px] text-[var(--a-mute)]">
                  {b.rows.length + i + 1}
                </span>
              </td>
              <td colSpan={3} className="px-3 text-[14px] text-[var(--a-mute)]">
                Open place
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-1.5 text-[13px] text-[var(--a-mute)]">
        {b.others.length ? `${b.others.length} more ranked below the paid places` : "Only bonded players at kickoff can rank"}
      </p>
    </div>
  );
}

function Feed({ r }: { r: RoundState }) {
  const events = r.events.slice(0, 14); // newest first
  return (
    <section aria-label="Live events" className="flex flex-col gap-4 xl:sticky xl:top-[112px] xl:self-start">
      <BarHeading aside={<span>{r.totals.goals} goals</span>}>Events</BarHeading>
      {events.length ? (
        <ol className="flex flex-col gap-1.5" aria-live="polite">
          {events.map((e) => (
            <EventBanner key={e.id} e={e} />
          ))}
        </ol>
      ) : (
        <p className="text-[15px] text-[var(--a-mute)]">Events appear here from kickoff.</p>
      )}
    </section>
  );
}

function EventBanner({ e }: { e: MatchEventView }) {
  if (e.code === "kickoff" || e.code === "fulltime") {
    return (
      <li className="a-wipe flex items-center gap-3 py-1 text-[13px] text-[var(--a-mute)]">
        <span className="a-num w-[52px] text-center text-[15px] text-black">{e.minute}′</span>
        {e.code === "kickoff" ? "Kickoff" : "Full time"}: {e.club}
      </li>
    );
  }
  const position = pos(e.playerId);
  const big = e.code === "goal";
  return (
    <li className="a-wipe grid grid-cols-[52px_1fr_auto] items-stretch">
      <span className="a-num flex items-center justify-center bg-[var(--a-signal)] text-[18px] text-black">{e.minute}′</span>
      <span className={cn("flex min-w-0 flex-col justify-center px-3 py-1.5", big ? "bg-black text-white" : "bg-[var(--a-panel)]")}>
        <span className="flex items-center gap-2">
          {position ? <PosBlock position={position} size="sm" /> : null}
          <span className="a-num truncate text-[17px]">{e.name ? surname(e.name) : e.club}</span>
        </span>
        <span className={cn("truncate text-[13px]", big ? "text-white/75" : "text-[var(--a-mute)]")}>
          {e.label}
          {e.ranked ? "" : ", not ranked"}
        </span>
      </span>
      <span className={cn("a-num flex min-w-14 items-center justify-end px-2 text-[18px]", big ? "bg-black text-white" : "bg-[var(--a-panel)]")}>
        {e.points ? formatPoints(e.points) : ""}
      </span>
    </li>
  );
}
