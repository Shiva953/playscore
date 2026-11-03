"use client";

import { useState } from "react";
import { formatPct, formatPrice, formatScore, formatTokens, formatUsd, formatUsdCompact } from "@/lib/format";
import type { PlayerDetail, PriceRange } from "@/lib/protocol/types";
import { usePlayer } from "@/lib/protocol/react/hooks";
import { FACE, PlayerCard } from "./card";
import { FormBars, PriceArea, RangePills } from "./chart";
import { Ticket } from "./ticket";

/**
 * Player hub, trading state, in one screen: the card (it turns over to show form), the market
 * (price, chart, four figures), the ticket. Colour lives on the card and the chart only.
 */
export function CPlayer({ id }: { id: string }) {
  const q = usePlayer(id);
  if (q.isPending) return <div className="mx-auto mt-4 h-[60vh] max-w-[1120px] rounded-[16px] bg-white/70" aria-busy="true" />;
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
    <main className="mx-auto grid max-w-[1120px] gap-4 px-3 pt-3 pb-20 md:px-6 lg:grid-cols-[240px_minmax(0,1fr)_300px] lg:items-start">
      <section aria-label="Card" className="flex flex-col items-center gap-3 lg:sticky lg:top-20">
        <button
          type="button"
          aria-pressed={back}
          aria-label={back ? "Show the front of the card" : "Turn the card over"}
          onClick={() => setBack((b) => !b)}
          className="c-flip block rounded-[16px]"
          data-back={back}
          style={{ width: 240, height: 336 }}
        >
          <span className="c-flip-inner block">
            <span className="c-face c-face-front block">
              <PlayerCard p={p} width={240} as="div" />
            </span>
            <span className="c-face c-face-back flex flex-col gap-3 rounded-[16px] bg-white p-4 text-left ring-1 ring-[var(--c-line)]">
              <span className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">Form</span>
                <span className="c-num text-[12px] text-[var(--c-mute)]">avg {formatScore(p.avgScore)}</span>
              </span>
              <FormBars form={p.form} color={face.bg} />
              <span className="text-[11px] leading-[1.4] text-[var(--c-mute)]">Coloured bars finished top five on a board and paid holders.</span>
              <span className="mt-auto grid grid-cols-2 gap-2 text-[11px]">
                <Small label="Last score" value={formatScore(p.lastScore)} />
                <Small label="Best finish" value={p.lastBoardRank ? `#${p.lastBoardRank}` : "—"} />
                <Small label="Age" value={String(p.age)} />
                <Small label="League" value={p.leagueName} />
              </span>
            </span>
          </span>
        </button>
        <span className="text-[12px] text-[var(--c-mute)]">Tap the card to turn it over</span>
        {h && h.tokens > 0 ? (
          <div className="flex w-full items-center justify-between rounded-[14px] bg-[var(--c-ink)] px-4 py-3 text-white">
            <span className="flex flex-col leading-tight">
              <span className="text-[11px] text-white/65">You own</span>
              <span className="c-num text-[15px] font-semibold">{formatTokens(h.tokens)}</span>
            </span>
            <span className="flex flex-col items-end leading-tight">
              <span className="text-[11px] text-white/65">Worth</span>
              <span className="c-num text-[15px] font-semibold">{formatUsd(h.value)}</span>
            </span>
          </div>
        ) : null}
      </section>

      <section aria-label="Market" className="c-panel flex min-w-0 flex-col gap-3 p-4">
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
        <PriceArea playerId={p.id} range={range} color={face.bg} height={190} />
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Tile label="Market cap" value={formatUsdCompact(p.marketCap)} />
          <Tile label="24h volume" value={formatUsdCompact(p.volume24h)} />
          <Tile label="Pool depth" value={formatUsdCompact(p.liquidityUsd)} />
          <Tile label="Paid to holders" value={formatUsdCompact(p.dividendsPaid)} />
        </dl>
      </section>

      <div className="lg:sticky lg:top-20">
        <Ticket player={p} />
      </div>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-[var(--c-chip)] px-3 py-2">
      <dt className="text-[11px] text-[var(--c-mute)]">{label}</dt>
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
