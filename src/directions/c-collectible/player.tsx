"use client";

import { useState } from "react";
import { formatPct, formatPrice, formatScore, formatTokens, formatUsd, formatUsdCompact } from "@/lib/format";
import type { PlayerDetail, PriceRange } from "@/lib/protocol/types";
import { usePlayer, useRound } from "@/lib/protocol/react/hooks";
import { matchMinute } from "@/directions/lab/derive";
import { useSize } from "@/directions/lab/use-width";
import { cn } from "@/lib/utils";
import { FACE, PlayerCard } from "./card";
import { FormBars, PriceArea, RangePills } from "./chart";
import { Ticket } from "./ticket";

/**
 * Player hub, trading state. On desktop the three columns fill the screen's height with real content,
 * never an empty half-screen: the card and this matchday; the market with a chart that grows into the
 * space; the ticket and the latest trades.
 */
export function CPlayer({ id }: { id: string }) {
  const q = usePlayer(id);
  if (q.isPending) return <div className="mx-auto mt-3 h-[calc(100svh-96px)] max-w-[1120px] rounded-[16px] bg-white/70" aria-busy="true" />;
  if (!q.data) return <p className="p-8">There&apos;s no player with that ID.</p>;
  return <Hub p={q.data} />;
}

function Hub({ p }: { p: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  const [back, setBack] = useState(false);
  const face = FACE[p.position];
  const h = p.holding;
  const up = p.change24h >= 0;

  return (
    <main className="mx-auto grid max-w-[1120px] gap-4 px-3 pt-3 pb-6 md:px-6 lg:min-h-[calc(100svh-68px)] lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          aria-pressed={back}
          aria-label={back ? "Show the front of the card" : "Turn the card over"}
          onClick={() => setBack((b) => !b)}
          className="c-flip mx-auto block rounded-[16px]"
          data-back={back}
          style={{ width: 260, height: 364 }}
        >
          <span className="c-flip-inner block">
            <span className="c-face c-face-front block">
              <PlayerCard p={p} width={260} as="div" />
            </span>
            <span className="c-face c-face-back flex flex-col gap-3 rounded-[16px] bg-white p-4 text-left ring-1 ring-[var(--c-line)]">
              <span className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">Form</span>
                <span className="c-num text-[12px] text-[var(--c-mute)]">avg {formatScore(p.avgScore)}</span>
              </span>
              <FormBars form={p.form} color={face.bg} />
              <span className="text-[12px] leading-[1.4] text-[var(--c-mute)]">Coloured bars finished top five on a board and paid holders.</span>
              <span className="mt-auto grid grid-cols-2 gap-2 text-[12px]">
                <Small label="Last score" value={formatScore(p.lastScore)} />
                <Small label="Best finish" value={p.lastBoardRank ? `#${p.lastBoardRank}` : "—"} />
                <Small label="Age" value={String(p.age)} />
                <Small label="League" value={p.leagueName} />
              </span>
            </span>
          </span>
        </button>
        {h && h.tokens > 0 ? (
          <div className="flex items-center justify-between rounded-[14px] bg-[var(--c-ink)] px-4 py-3 text-white">
            <span className="flex flex-col leading-tight">
              <span className="text-[12px] text-white/65">You own</span>
              <span className="c-num text-[15px] font-semibold">{formatTokens(h.tokens)}</span>
            </span>
            <span className="flex flex-col items-end leading-tight">
              <span className="text-[12px] text-white/65">Worth</span>
              <span className="c-num text-[15px] font-semibold">{formatUsd(h.value)}</span>
            </span>
          </div>
        ) : null}
        <ThisMatchday p={p} />
      </div>

      <section aria-label="Market" className="c-panel flex min-h-[420px] min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[13px] font-semibold">
              {p.name} <span className="font-normal text-[var(--c-mute)]">{p.club}</span>
            </h1>
            <span className="flex items-baseline gap-2">
              <span className="c-num text-[28px] leading-none font-bold tracking-[-0.02em]">{formatPrice(p.price)}</span>
              <span className="c-num text-[13px] font-semibold" style={{ color: up ? "var(--c-up)" : "var(--c-down)" }}>
                {up ? "+" : "−"}
                {formatPct(Math.abs(p.change24h))} today
              </span>
            </span>
          </div>
          <RangePills value={range} onChange={setRange} />
        </div>
        <FillChart playerId={p.id} range={range} color={face.bg} />
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Tile label="Market cap" value={formatUsdCompact(p.marketCap)} />
          <Tile label="24h volume" value={formatUsdCompact(p.volume24h)} />
          <Tile label="Pool depth" value={formatUsdCompact(p.liquidityUsd)} />
          <Tile label="Paid to holders" value={formatUsdCompact(p.dividendsPaid)} />
        </dl>
      </section>

      <div className="flex flex-col gap-3">
        <Ticket player={p} />
        <Holders p={p} />
      </div>
    </main>
  );
}

/** The chart takes whatever height the market panel has left (absolutely placed, so it can't feed back into it). */
function FillChart({ playerId, range, color }: { playerId: string; range: PriceRange; color: string }) {
  const [box, size] = useSize<HTMLDivElement>(600, 0);
  return (
    <div ref={box} className="relative min-h-[200px] flex-1">
      {size.height > 0 ? (
        <div className="absolute inset-0">
          <PriceArea playerId={playerId} range={range} color={color} height={size.height} />
        </div>
      ) : null}
    </div>
  );
}

/** This player in the current matchday: live score, and where they sit on the boards right now. */
function ThisMatchday({ p }: { p: PlayerDetail }) {
  const q = useRound();
  if (!q.data) return <div className="c-panel min-h-[120px] flex-1" aria-busy="true" />;
  const r = q.data;
  const s = r.scores.find((x) => x.playerId === p.id);
  const finishes = r.boards.flatMap((b) => b.rows.filter((x) => x.playerId === p.id).map((x) => ({ board: b.label, rank: x.rank, usd: x.usd })));
  return (
    <section aria-label="This matchday" className="c-panel flex flex-1 flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Matchday {r.round}</h2>
        <span className="text-[12px] text-[var(--c-mute)]">{r.phase === "live" ? `Live ${matchMinute(r)}′` : r.phase === "open" ? "Before kickoff" : "Full time"}</span>
      </div>
      {s && s.playing ? (
        <div className="flex items-baseline gap-2">
          <span className="c-num text-[26px] leading-none font-bold tracking-[-0.02em]">{formatScore(s.display)}</span>
          <span className="text-[12px] text-[var(--c-mute)]">
            {r.projection ? "projected" : "points"}
            {s.goals ? `, ${s.goals} goal${s.goals > 1 ? "s" : ""}` : ""}
            {s.assists ? `, ${s.assists} assist${s.assists > 1 ? "s" : ""}` : ""}
          </span>
        </div>
      ) : (
        <p className="text-[13px] text-[var(--c-mute)]">Not playing this window.</p>
      )}
      {finishes.length ? (
        <ul className="flex flex-col gap-1 text-[13px]">
          {finishes.map((f) => (
            <li key={f.board} className="flex items-center justify-between rounded-[10px] bg-[var(--c-chip)] px-2.5 py-1.5">
              <span>
                <span className="c-num font-semibold">#{f.rank}</span> <span className="text-[var(--c-mute)]">on {f.board}</span>
              </span>
              <span className="c-num font-semibold">{formatUsd(f.usd)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-[var(--c-mute)]">Outside the top five on every board right now.</p>
      )}
      <p className="mt-auto text-[12px] leading-[1.4] text-[var(--c-mute)]">Holders at kickoff share these payouts when the data freezes.</p>
    </section>
  );
}

/** Who holds this player: always populated (holders, liquidity providers, the locked seed), you marked. */
function Holders({ p }: { p: PlayerDetail }) {
  const rows = p.holders.slice(0, 8);
  const top = Math.max(...rows.map((r) => r.share), 0.0001);
  return (
    <section aria-label="Top holders" className="c-panel flex flex-1 flex-col gap-2 p-4">
      <h2 className="text-[13px] font-semibold">Top holders</h2>
      <ul className="flex flex-col gap-1.5 text-[12px]">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn("truncate", r.isYou ? "font-semibold" : "text-[var(--c-mute)]")}>{r.isYou ? "You" : r.label}</span>
              <span className="c-num font-semibold">{formatPct(r.share, { decimals: 1 })}</span>
            </span>
            <span className="h-1 rounded-full bg-[var(--c-chip)]">
              <span className="block h-full rounded-full" style={{ width: `${(r.share / top) * 100}%`, background: r.isYou ? "var(--c-ink)" : "var(--c-line)" }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-[var(--c-chip)] px-3 py-2">
      <dt className="text-[12px] text-[var(--c-mute)]">{label}</dt>
      <dd className="c-num text-[15px] font-semibold">{value}</dd>
    </div>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[var(--c-mute)]">{label}</span>
      <span className="c-num text-[13px] font-semibold">{value}</span>
    </span>
  );
}
