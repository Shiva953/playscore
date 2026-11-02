"use client";

import { formatPct, formatPrice, formatTokens, formatUsd } from "@/lib/format";
import type { PlayerDetail } from "@/lib/protocol/types";
import { useTradeTicket } from "@/directions/lab/use-trade-ticket";
import { cn } from "@/lib/utils";

/** Ticket as a white panel: round chips, one fat black button that sinks when pressed. */
export function Ticket({ player }: { player: PlayerDetail }) {
  const t = useTradeTicket(player);
  const q = t.quote;
  return (
    <section aria-label={`Trade ${player.ticker}`} className="c-panel flex flex-col gap-5 p-6">
      <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 gap-1 rounded-full bg-[var(--c-chip)] p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={t.side === s}
            onClick={() => t.setSide(s)}
            className={cn(
              "h-10 rounded-full text-[15px] font-semibold transition-colors duration-150",
              t.side === s ? "bg-white text-[var(--c-ink)] shadow-[0_2px_0_rgba(15,20,25,0.12)]" : "text-[var(--c-mute)] hover:text-[var(--c-ink)]"
            )}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-[13px]">
          <label htmlFor={`c-amt-${player.id}`} className="font-semibold">
            {t.side === "buy" ? "You pay" : "You sell"}
          </label>
          {t.signedIn ? (
            <span className="text-[var(--c-mute)]">
              {t.side === "buy" ? `${formatUsd(t.balance)} to spend` : `${formatTokens(t.holding?.tokens ?? 0)} held`}
            </span>
          ) : null}
        </div>
        <div className="flex h-16 items-center gap-2 rounded-[18px] bg-[var(--c-chip)] px-4 transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_2px_var(--c-ink)]">
          <span className="c-num text-[24px] text-[var(--c-mute)]">$</span>
          <input
            id={`c-amt-${player.id}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={t.amount}
            onChange={(e) => t.setAmount(e.target.value)}
            className="c-num w-full min-w-0 bg-transparent text-[26px] outline-none placeholder:text-[#9aa3af]"
          />
        </div>
        <div className="flex gap-2">
          {t.side === "buy"
            ? [10, 50, 100].map((v) => (
                <Chip key={v} onClick={() => t.setAmount(String(v))}>
                  ${v}
                </Chip>
              ))
            : [0.25, 0.5, 1].map((v) => (
                <Chip key={v} onClick={() => t.setPct(v)} disabled={!t.holding}>
                  {v === 1 ? "All" : formatPct(v, { decimals: 0 })}
                </Chip>
              ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-[18px] border-2 border-dashed border-[var(--c-line)] px-4 py-3">
        <span className="text-[14px] text-[var(--c-mute)]">{t.side === "buy" ? "You get" : "You receive"}</span>
        <span className="c-num text-[20px]">{q ? (q.side === "buy" ? `${formatTokens(q.tokens)} ${player.ticker}` : formatUsd(q.receive)) : "—"}</span>
      </div>
      {q ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-[var(--c-mute)]">Average price</dt>
          <dd className="c-num text-right">{formatPrice(q.avgPrice)}</dd>
          <dt className="text-[var(--c-mute)]">Price impact</dt>
          <dd className="c-num text-right">{formatPct(q.priceImpact)}</dd>
          {q.fees.map((f) => (
            <FeeRow key={f.label} label={`${f.label} (${formatPct(f.rate)})`} value={formatUsd(f.usd)} />
          ))}
        </dl>
      ) : null}
      {q?.error ? (
        <p role="alert" className="rounded-[14px] bg-[var(--c-down-soft)] px-4 py-2.5 text-[14px] text-[#8a1d22]">
          {q.error.message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={t.submit}
        disabled={!t.canSubmit}
        className="c-press h-14 rounded-full bg-[var(--c-ink)] text-[17px] font-semibold text-white hover:bg-[#262d36] disabled:bg-[#8b939e] disabled:shadow-none"
      >
        {t.cta}
      </button>
      <p className="text-[13px] text-[var(--c-mute)]">
        {t.holding
          ? `Selling now pays ${formatPct(t.sellTaxNow ?? 0, { decimals: 1 })} tax, falling to 0.5% after 90 days held.`
          : "Buys cost 0.3% in fees. Selling pays a tax that falls from 5% to 0.5% the longer you hold."}
      </p>
    </section>
  );
}

function Chip({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="c-num h-11 flex-1 rounded-full border-2 border-[var(--c-ink)] text-[15px] transition-colors duration-150 hover:bg-[var(--c-chip)] disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--c-mute)]">{label}</dt>
      <dd className="c-num text-right">{value}</dd>
    </>
  );
}
