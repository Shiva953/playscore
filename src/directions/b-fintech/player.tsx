"use client";

import { useState } from "react";
import NumberFlow from "@number-flow/react";
import { formatPct, formatPrice, formatScore, formatTokens, formatUsd, formatUsdCompact } from "@/lib/format";
import type { PlayerDetail, PricePoint, PriceRange } from "@/lib/protocol/types";
import { usePlayer } from "@/lib/protocol/react/hooks";
import { Card, Change, KV, Pill } from "./bits";
import { RangeChips, ScrubChart } from "./chart";
import { Ticket } from "./ticket";

const RANGE_WORDS: Record<PriceRange, string> = { "24H": "today", "3D": "past 3 days", "6D": "past week", ALL: "since bonding" };

/**
 * Player hub, trading state. Screen question: "What is KANE worth, and should I buy?"
 * The price is the title and follows the pointer over the chart; the ticket never moves.
 */
export function BPlayer({ id }: { id: string }) {
  const q = usePlayer(id);
  if (q.isPending) return <div className="h-[70vh] rounded-[var(--b-radius-card)] bg-[var(--b-raised)]" aria-busy="true" />;
  if (!q.data) return <p>There&apos;s no player with that ID.</p>;
  return <Hub p={q.data} />;
}

function Hub({ p }: { p: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  const [scrub, setScrub] = useState<{ p: PricePoint | null; first: PricePoint | null }>({ p: null, first: null });
  const shown = scrub.p?.p ?? p.price;
  const base = scrub.first?.p ?? null;
  const delta = base ? shown / base - 1 : p.change24h;
  const deltaWords = base ? (scrub.p ? "at that point" : RANGE_WORDS[range]) : "past 24 hours";
  const decimals = shown < 0.1 ? 5 : shown < 1 ? 4 : 2;

  return (
    // One grid: phones read header, chart, ticket, then the rest; desktop keeps the ticket in the right rail.
    <div className="mx-auto grid max-w-[1180px] gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0 lg:[&>*:not(aside)]:col-start-1">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill>{p.ticker}</Pill>
          <Pill>{p.position}</Pill>
          <span className="text-[13px] text-[var(--b-muted)]">
            {p.club}, {p.leagueName}
          </span>
        </div>
        <h1 className="text-[32px] leading-tight font-bold tracking-[-0.015em]">{p.name}</h1>
        <div className="flex flex-col gap-1">
          <span className="b-num text-[40px] leading-none font-semibold tracking-[-0.02em]" aria-label={`Price ${formatPrice(shown)}`}>
            <NumberFlow
              value={shown}
              format={{ style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }}
              willChange
            />
          </span>
          <span className="text-[14px]">
            <Change value={delta} /> <span className="text-[var(--b-muted)]">{deltaWords}</span>
          </span>
        </div>
      </header>

      <section aria-label="Price chart" className="flex flex-col gap-3">
        <ScrubChart playerId={p.id} range={range} height={320} onScrub={(pt, first) => setScrub({ p: pt, first })} />
        <RangeChips
          value={range}
          onChange={(r) => {
            setRange(r);
            setScrub({ p: null, first: null });
          }}
        />
      </section>

      <aside className="lg:col-start-2 lg:row-span-5 lg:row-start-1">
        <div className="lg:sticky lg:top-9">
          <Ticket player={p} />
        </div>
      </aside>

      <Card title="Key statistics">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
          <KV label="Market cap" value={formatUsdCompact(p.marketCap)} />
          <KV label="24h volume" value={formatUsdCompact(p.volume24h)} />
          <KV label="Pool depth" value={formatUsdCompact(p.liquidityUsd)} />
          <KV label="Holders" value={formatTokens(p.supply.holderTokens)} note="tokens outside the pool" />
          <KV label="Form" value={formatScore(p.avgScore)} note="average match score" />
          <KV label="Last score" value={formatScore(p.lastScore)} note={p.lastBoardRank ? `#${p.lastBoardRank} on a board` : "not in a top five"} />
          <KV label="Paid to holders" value={formatUsd(p.dividendsPaid, { decimals: 0 })} note="all rounds" />
          <KV label="Pool fee APR" value={p.pool ? formatPct(p.pool.feeAprDemo, { decimals: 0 }) : "—"} note="demo volume, overstated" />
        </dl>
      </Card>

      <Position p={p} />
      <Dividends p={p} />
    </div>
  );
}

/** The one tinted card on the screen: your stake and whether it counts at the next kickoff. */
function Position({ p }: { p: PlayerDetail }) {
  const h = p.holding;
  if (!h || h.tokens <= 0) {
    return (
      <Card title="Your position">
        <p className="text-[14px] text-[var(--b-muted)]">
          You don&apos;t hold {p.ticker}. Holders at each kickoff share the payout when {p.name.split(" ").slice(-1)[0]} finishes in a board&apos;s top five.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Your position" tint aside={h.countsNextKickoff ? <span className="text-[var(--b-accent-ink)]">Counts at the next kickoff</span> : null}>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <dt className="text-[13px] text-[var(--b-accent-ink)]">Tokens</dt>
          <dd className="b-num text-[24px] font-semibold">{formatTokens(h.tokens)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[13px] text-[var(--b-accent-ink)]">Value</dt>
          <dd className="b-num text-[24px] font-semibold">{formatUsd(h.value)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[13px] text-[var(--b-accent-ink)]">Return</dt>
          <dd className="text-[24px] font-semibold">
            <Change value={h.pnlPct} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[13px] text-[var(--b-accent-ink)]">Sell tax now</dt>
          <dd className="b-num text-[24px] font-semibold">{formatPct(h.sellTaxNow, { decimals: 1 })}</dd>
        </div>
      </dl>
    </Card>
  );
}

function Dividends({ p }: { p: PlayerDetail }) {
  const rows = p.form.slice(-8);
  return (
    <Card title="Match scores" aside={<span>Top five on a board pays holders</span>}>
      <ol className="flex flex-col">
        {rows
          .slice()
          .reverse()
          .map((f, i) => (
            <li key={i} className="grid h-[var(--b-row)] grid-cols-[72px_1fr_48px_88px] items-center gap-4 border-b border-[var(--b-rule)] last:border-0">
              <span className="text-[13px] text-[var(--b-muted)]">{f.label}</span>
              <span className="h-1.5 rounded-full bg-[var(--b-accent-track)]">
                <span className="block h-full rounded-full bg-[var(--b-accent)]" style={{ width: `${(f.score / 10) * 100}%` }} />
              </span>
              <span className="b-num text-right font-medium">{formatScore(f.score)}</span>
              <span className="text-right">
                {f.rank <= 5 ? <Pill tone="accent">#{f.rank}, paid</Pill> : <span className="text-[13px] text-[var(--b-muted)]">#{f.rank}</span>}
              </span>
            </li>
          ))}
      </ol>
    </Card>
  );
}
