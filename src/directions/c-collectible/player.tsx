"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { formatPct, formatPrice, formatScore, formatTokens, formatUsd, formatUsdCompact } from "@/lib/format";
import type { PlayerDetail, PriceRange } from "@/lib/protocol/types";
import { usePlayer } from "@/lib/protocol/react/hooks";
import { FACE, PlayerCard } from "./card";
import { FormChart, PriceArea, RangePills } from "./chart";
import { Ticket } from "./ticket";

/**
 * Player hub, trading state. The card is the hero object; it flips to show form and payouts.
 * Beside it the market (price, chart), then the ticket. Colour lives on the card and the chart.
 */
export function CPlayer({ id }: { id: string }) {
  const q = usePlayer(id);
  if (q.isPending) return <div className="mx-auto mt-6 h-[70vh] max-w-[1320px] rounded-[24px] bg-white/60" aria-busy="true" />;
  if (!q.data) return <p className="p-8">There&apos;s no player with that ID.</p>;
  return <Hub p={q.data} />;
}

function Hub({ p }: { p: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  const [back, setBack] = useState(false);
  const reduce = useReducedMotion();
  const face = FACE[p.position];
  const h = p.holding;

  return (
    <main className="mx-auto grid max-w-[1320px] gap-6 px-3 pt-6 pb-24 md:px-6 lg:grid-cols-[340px_minmax(0,1fr)_360px] lg:items-start">
      {/* The card */}
      <section aria-label="Card" className="flex flex-col items-center gap-4 lg:sticky lg:top-24">
        <div className="relative" style={{ width: 320, height: 448, perspective: 1200 }}>
          <AnimatePresence initial={false} mode="wait">
            {back ? (
              <motion.div
                key="back"
                initial={reduce ? { opacity: 0 } : { rotateY: -90 }}
                animate={reduce ? { opacity: 1 } : { rotateY: 0 }}
                exit={reduce ? { opacity: 0 } : { rotateY: 90 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className="absolute inset-0 flex flex-col gap-4 rounded-[24px] bg-white p-6"
                style={{ boxShadow: `inset 0 0 0 6px ${face.bg}, var(--c-sticker)` }}
              >
                <CardBack p={p} />
              </motion.div>
            ) : (
              <motion.div
                key="front"
                initial={reduce ? { opacity: 0 } : { rotateY: 90 }}
                animate={reduce ? { opacity: 1 } : { rotateY: 0 }}
                exit={reduce ? { opacity: 0 } : { rotateY: -90 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className="absolute inset-0"
              >
                <PlayerCard p={p} width={320} as="div" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button
          type="button"
          aria-pressed={back}
          onClick={() => setBack((b) => !b)}
          className="h-11 rounded-full bg-white px-5 text-[14px] font-semibold shadow-[0_3px_0_rgba(15,20,25,0.1)] hover:bg-[var(--c-chip)]"
        >
          {back ? "Show the front" : "Turn the card over"}
        </button>
        {h && h.tokens > 0 ? (
          <div className="flex w-full items-center justify-between rounded-[20px] bg-[var(--c-ink)] px-5 py-4 text-white">
            <span className="flex flex-col">
              <span className="text-[13px] text-white/70">You own</span>
              <span className="c-num text-[22px]">{formatTokens(h.tokens)}</span>
            </span>
            <span className="flex flex-col items-end">
              <span className="text-[13px] text-white/70">Worth</span>
              <span className="c-num text-[22px]">{formatUsd(h.value)}</span>
            </span>
          </div>
        ) : null}
      </section>

      {/* The market */}
      <section aria-label="Market" className="c-panel flex min-w-0 flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[16px] font-semibold">
            {p.name} <span className="ml-1 font-normal text-[var(--c-mute)]">{p.club}</span>
          </h1>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="c-num text-[44px] leading-none md:text-[56px]">{formatPrice(p.price)}</span>
            <span
              className="c-num rounded-full px-3 py-1 text-[15px]"
              style={{
                background: p.change24h >= 0 ? "var(--c-up-soft)" : "var(--c-down-soft)",
                color: p.change24h >= 0 ? "var(--c-up)" : "var(--c-down)",
              }}
            >
              {p.change24h >= 0 ? "+" : "−"}
              {formatPct(Math.abs(p.change24h), { decimals: 2 })} today
            </span>
          </div>
        </div>
        <PriceArea playerId={p.id} range={range} color={face.bg} height={280} />
        <RangePills value={range} onChange={setRange} />
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Market cap" value={formatUsdCompact(p.marketCap)} />
          <Tile label="24h volume" value={formatUsdCompact(p.volume24h)} />
          <Tile label="Pool depth" value={formatUsdCompact(p.liquidityUsd)} />
          <Tile label="Paid out" value={formatUsdCompact(p.dividendsPaid)} />
        </dl>
      </section>

      <div className="lg:sticky lg:top-24">
        <Ticket player={p} />
      </div>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] bg-[var(--c-chip)] px-4 py-3">
      <dt className="text-[13px] text-[var(--c-mute)]">{label}</dt>
      <dd className="c-num text-[18px]">{value}</dd>
    </div>
  );
}

function CardBack({ p }: { p: PlayerDetail }) {
  const color = FACE[p.position].bg;
  return (
    <>
      <div className="flex items-baseline justify-between">
        <h2 className="c-display text-[18px]">Form</h2>
        <span className="text-[13px] text-[var(--c-mute)]">average {formatScore(p.avgScore)}</span>
      </div>
      <FormChart form={p.form} color={color} />
      <p className="text-[13px] text-[var(--c-mute)]">Coloured bars finished in a board&apos;s top five, which paid holders.</p>
      <dl className="mt-auto grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <dt className="text-[12px] text-[var(--c-mute)]">Last score</dt>
          <dd className="c-num text-[20px]">{formatScore(p.lastScore)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[12px] text-[var(--c-mute)]">Best finish last time</dt>
          <dd className="c-num text-[20px]">{p.lastBoardRank ? `#${p.lastBoardRank}` : "—"}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[12px] text-[var(--c-mute)]">Age</dt>
          <dd className="c-num text-[20px]">{p.age}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[12px] text-[var(--c-mute)]">League</dt>
          <dd className="text-[15px] font-semibold">{p.leagueName}</dd>
        </div>
      </dl>
    </>
  );
}
