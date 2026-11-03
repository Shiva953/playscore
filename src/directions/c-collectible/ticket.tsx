"use client";

import { formatPct, formatPrice, formatTokens, formatUsd } from "@/lib/format";
import type { PlayerDetail } from "@/lib/protocol/types";
import { useTradeTicket } from "@/directions/lab/use-trade-ticket";
import { cn } from "@/lib/utils";

/** Compact ticket: Buy/Sell, one amount, three presets, what you get, one black button. */
export function Ticket({ player }: { player: PlayerDetail }) {
  const t = useTradeTicket(player);
  const q = t.quote;
  return (
    <section aria-label={`Trade ${player.ticker}`} className="c-panel flex flex-col gap-3.5 p-4">
      <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 gap-1 rounded-full bg-[var(--c-chip)] p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={t.side === s}
            onClick={() => t.setSide(s)}
            className={cn(
              "h-8 rounded-full text-[13px] font-semibold transition-colors duration-150",
              t.side === s ? "bg-white text-[var(--c-ink)] ring-1 ring-[var(--c-line)]" : "text-[var(--c-mute)] hover:text-[var(--c-ink)]"
            )}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-[12px]">
          <label htmlFor={`c-amt-${player.id}`} className="font-semibold">
            {t.side === "buy" ? "You pay" : "You sell"}
          </label>
          {t.signedIn ? (
            <span className="c-num text-[var(--c-mute)]">
              {t.side === "buy" ? `${formatUsd(t.balance)} available` : `${formatTokens(t.holding?.tokens ?? 0)} held`}
            </span>
          ) : null}
        </div>
        <div className="flex h-12 items-center gap-1.5 rounded-[12px] bg-[var(--c-chip)] px-3.5 transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1.5px_var(--c-ink)]">
          <span className="c-num text-[18px] text-[var(--c-mute)]">$</span>
          <input
            id={`c-amt-${player.id}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={t.amount}
            onChange={(e) => t.setAmount(e.target.value)}
            className="c-num w-full min-w-0 bg-transparent text-[20px] font-semibold outline-none placeholder:text-[#a1a8b3]"
          />
          <span className="text-[12px] text-[var(--c-mute)]">USDC</span>
        </div>
        <div className="flex gap-1.5">
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

      <dl className="flex flex-col gap-1 text-[12px]">
        <div className="flex items-baseline justify-between">
          <dt className="text-[var(--c-mute)]">{t.side === "buy" ? "You get" : "You receive"}</dt>
          <dd className="c-num text-[14px] font-semibold">{q ? (q.side === "buy" ? `${formatTokens(q.tokens)} ${player.ticker}` : formatUsd(q.receive)) : "—"}</dd>
        </div>
        {q ? (
          <>
            <Row label="Average price" value={formatPrice(q.avgPrice)} />
            {q.fees.map((f) => (
              <Row key={f.label} label={`${f.label} ${formatPct(f.rate)}`} value={formatUsd(f.usd)} />
            ))}
          </>
        ) : null}
      </dl>
      {q?.error ? (
        <p role="alert" className="rounded-[10px] bg-[var(--c-down-soft)] px-3 py-2 text-[12px] text-[#8a1d22]">
          {q.error.message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={t.submit}
        disabled={!t.canSubmit}
        className="c-press h-11 rounded-full bg-[var(--c-ink)] text-[14px] font-semibold text-white hover:bg-[#262c35] disabled:bg-[#c9ced6] disabled:text-[#5d6573]"
      >
        {t.cta}
      </button>
      <p className="text-[12px] leading-[1.45] text-[var(--c-mute)]">
        {t.holding
          ? `Selling now pays ${formatPct(t.sellTaxNow ?? 0, { decimals: 1 })} tax, falling to 0.5% after 90 days.`
          : "0.3% fee on buys. Selling pays a tax that falls from 5% to 0.5% over 90 days."}
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
      className="c-num h-9 flex-1 rounded-full border border-[var(--c-line)] text-[13px] font-semibold transition-colors duration-150 hover:bg-[var(--c-chip)] disabled:opacity-40 max-md:h-11"
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[var(--c-mute)]">{label}</dt>
      <dd className="c-num">{value}</dd>
    </div>
  );
}
