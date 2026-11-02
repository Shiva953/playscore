"use client";

import { useState } from "react";
import { formatPct, formatPrice, formatScore, formatTokens, formatUsd, formatUsdCompact } from "@/lib/format";
import type { PlayerDetail, PriceRange } from "@/lib/protocol/types";
import { usePlayer } from "@/lib/protocol/react/hooks";
import { firstName, surname } from "@/directions/lab/derive";
import { BarHeading, ChangeBlock, PosBlock } from "./bits";
import { RangeBlocks, StepChart } from "./chart";
import { Ticket } from "./ticket";

/**
 * Player hub, trading state. Composition: a lower third (name huge, price huge), a stat-bar strip,
 * then the chart beside the ticket. Everything else on the page is quieter than those two figures.
 */
export function APlayer({ id }: { id: string }) {
  const q = usePlayer(id);
  if (q.isPending) return <div className="h-[60vh] animate-none bg-[var(--a-panel)]" aria-busy="true" />;
  if (!q.data) return <p className="p-8">No player with that ID.</p>;
  return <Hub p={q.data} />;
}

function Hub({ p }: { p: PlayerDetail }) {
  const [range, setRange] = useState<PriceRange>("6D");
  const trading = p.status === "trading";
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col">
      {/* Lower third */}
      <section className="grid gap-6 px-4 pt-6 pb-5 md:grid-cols-[1fr_auto] md:items-end md:px-8 md:pt-10">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-stretch gap-0">
            <PosBlock position={p.position} size="md" />
            <span className="a-num flex items-center bg-black px-2.5 text-[15px] text-white">{p.club}</span>
            <span className="a-num flex items-center bg-[var(--a-panel)] px-2.5 text-[15px]">{p.leagueName}</span>
            <span className="flex items-center px-2.5 text-[14px] text-[var(--a-mute)]">
              {p.country}, {p.age}
            </span>
          </div>
          <h1 className="flex flex-col">
            <span className="a-num text-[22px] leading-none md:text-[28px]">{firstName(p.name)}</span>
            <span className="a-display text-[88px] md:text-[168px]">{surname(p.name)}</span>
          </h1>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span className="a-label">${p.ticker} price</span>
          <span className="a-num text-[64px] leading-[0.9] md:text-[112px]">{formatPrice(p.price)}</span>
          {trading ? <ChangeBlock value={p.change24h} suffix="24h" className="h-8 text-[18px]" /> : null}
        </div>
      </section>

      {/* Stat bars */}
      <dl className="grid grid-cols-2 border-y-[3px] border-black md:grid-cols-4">
        <Stat i={0} label="24h volume" value={formatUsdCompact(p.volume24h)} />
        <Stat i={1} label={trading ? "Pool depth" : "Raised"} value={trading ? formatUsdCompact(p.liquidityUsd) : formatUsd(p.raised, { decimals: 0 })} />
        <Stat i={2} label="Market cap" value={formatUsdCompact(p.marketCap)} />
        <Stat
          i={3}
          label="Last score"
          value={formatScore(p.lastScore)}
          note={p.lastBoardRank ? `#${p.lastBoardRank} on a board, paid` : "Outside the top five"}
        />
      </dl>

      {/* Phones: chart, ticket, form, payouts. Desktop: the ticket rides beside all three. */}
      <div className="grid gap-8 px-4 py-8 md:px-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-w-0 flex-col gap-4 lg:col-start-1" aria-label="Price chart">
          <BarHeading aside={<RangeBlocksDark value={range} onChange={setRange} />}>Price</BarHeading>
          <StepChart playerId={p.id} range={range} height={340} />
        </section>
        <div className="lg:sticky lg:top-[112px] lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
          <Ticket player={p} />
        </div>
        <div className="min-w-0 lg:col-start-1">
          <FormBars p={p} />
        </div>
        <div className="min-w-0 lg:col-start-1">
          <PaidSection p={p} />
        </div>
      </div>
    </main>
  );
}

/** The range control lives inside the black heading bar, so it is drawn white-on-black. */
function RangeBlocksDark(props: { value: PriceRange; onChange: (r: PriceRange) => void }) {
  return (
    <div className="[&_button]:border-white [&_button]:bg-black [&_button]:text-white [&_button[aria-checked=true]]:bg-white [&_button[aria-checked=true]]:text-black [&_button:hover]:bg-white/15">
      <RangeBlocks {...props} />
    </div>
  );
}

/** Four cells: a 2 × 2 grid on phones, one row from md. Rules sit between cells only. */
function Stat({ i, label, value, note }: { i: number; label: string; value: string; note?: string }) {
  const rule = [
    "border-r border-b md:border-b-0",
    "border-b md:border-r md:border-b-0",
    "border-r",
    "",
  ][i];
  return (
    <div className={`flex flex-col gap-1 border-black px-4 py-4 md:px-8 ${rule}`}>
      <dt className="a-label">{label}</dt>
      <dd className="a-num text-[34px] leading-none md:text-[44px]">{value}</dd>
      {note ? <dd className="text-[13px] text-[var(--a-mute)]">{note}</dd> : null}
    </div>
  );
}

/** Last eight matchdays as broadcast bars: score on top, board rank under. */
function FormBars({ p }: { p: PlayerDetail }) {
  const form = p.form.slice(-8);
  const max = 10;
  return (
    <section className="flex flex-col gap-4" aria-label="Form">
      <BarHeading aside={<span>Average {formatScore(p.avgScore)}</span>}>Form, last {form.length} matchdays</BarHeading>
      <ol className="grid h-[180px] items-end gap-2" style={{ gridTemplateColumns: `repeat(${form.length}, minmax(0,1fr))` }}>
        {form.map((f, i) => (
          <li key={i} className="flex h-full flex-col justify-end gap-1">
            <span className="a-num text-center text-[18px] leading-none">{formatScore(f.score)}</span>
            <span
              className="mx-auto block w-3/5 max-w-14"
              style={{ height: `${(f.score / max) * 110}px`, background: f.rank <= 5 ? "var(--a-ink)" : "var(--a-panel-2)" }}
              aria-hidden="true"
            />
            <span className="text-center text-[12px] text-[var(--a-mute)]">{f.rank <= 5 ? `#${f.rank}` : f.label.replace("MD ", "")}</span>
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-[var(--a-mute)]">Black bars finished in a board&apos;s top five, which pays holders.</p>
    </section>
  );
}

/** Where a holder's money comes from: last rounds' payouts per 10,000 tokens, and the holding. */
function PaidSection({ p }: { p: PlayerDetail }) {
  const h = p.holding;
  const rows = p.dividendHistory.slice(-4).reverse();
  return (
    <section className="flex flex-col gap-4" aria-label="Dividends">
      <BarHeading aside={<span>{formatUsd(p.dividendsPaid)} paid in total</span>}>Paid to holders</BarHeading>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="a-label">Your holding</span>
          {h ? (
            <>
              <span className="a-num text-[40px] leading-none">{formatTokens(h.tokens)}</span>
              <span className="text-[14px]">
                Worth <span className="a-num">{formatUsd(h.value)}</span>.{" "}
                <span className="text-[var(--a-mute)]">
                  Held {h.holdAgeDays.toFixed(0)} days, so selling now pays {formatPct(h.sellTaxNow, { decimals: 1 })} tax.
                </span>
              </span>
            </>
          ) : (
            <span className="text-[15px] text-[var(--a-mute)]">You don&apos;t hold {p.ticker}. Holders at kickoff share the payout when he finishes top five.</span>
          )}
        </div>
        <table className="w-full text-[14px]">
          <caption className="sr-only">Payouts by round</caption>
          <thead>
            <tr className="text-left text-[var(--a-mute)]">
              <th className="pb-1 font-medium">Round</th>
              <th className="pb-1 text-right font-medium">Paid</th>
              <th className="pb-1 text-right font-medium">Per 10k tokens</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr key={r.round} className="border-t border-black">
                  <td className="py-1.5">{r.label}</td>
                  <td className="a-num py-1.5 text-right">{formatUsd(r.playerPayout)}</td>
                  <td className="a-num py-1.5 text-right">{formatUsd(r.per10kTokens)}</td>
                </tr>
              ))
            ) : (
              <tr className="border-t border-black">
                <td colSpan={3} className="py-2 text-[var(--a-mute)]">
                  No rounds settled in this demo yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
