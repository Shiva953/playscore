"use client";

import { formatPct, formatPrice, formatTokens, formatUsd } from "@/lib/format";
import type { PlayerDetail } from "@/lib/protocol/types";
import { useTradeTicket } from "@/directions/lab/use-trade-ticket";
import { cn } from "@/lib/utils";

/** Trade ticket: black/white side blocks, one big figure in, one big figure out, a yellow action. */
export function Ticket({ player }: { player: PlayerDetail }) {
  const t = useTradeTicket(player);
  const q = t.quote;
  const out = q ? (q.side === "buy" ? `${formatTokens(q.tokens)}` : formatUsd(q.receive)) : "–";

  return (
    <section aria-label={`Trade ${player.ticker}`} className="flex flex-col border-[3px] border-black bg-white">
      <div role="radiogroup" aria-label="Side" className="grid grid-cols-2">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            role="radio"
            type="button"
            aria-checked={t.side === s}
            onClick={() => t.setSide(s)}
            className={cn(
              "a-num h-12 text-[22px] transition-colors duration-150",
              t.side === s ? "bg-black text-white" : "bg-white text-black hover:bg-[var(--a-panel)]"
            )}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`a-amt-${player.id}`} className="a-label">
            {t.side === "buy" ? "You pay" : "You sell, in USDC"}
          </label>
          {t.signedIn ? (
            <span className="a-num text-[14px] text-[var(--a-mute)]">
              {t.side === "buy" ? `Balance ${formatUsd(t.balance)}` : `Held ${formatTokens(t.holding?.tokens ?? 0)}`}
            </span>
          ) : null}
        </div>
        <div className="flex h-16 items-center gap-2 border-[3px] border-black px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--a-def)]">
          <span className="a-num text-[30px] text-[var(--a-mute)]">$</span>
          <input
            id={`a-amt-${player.id}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={t.amount}
            onChange={(e) => t.setAmount(e.target.value)}
            className="a-num w-full min-w-0 bg-transparent text-[34px] outline-none placeholder:text-[#b5b5b5]"
          />
          <span className="a-num text-[15px] text-[var(--a-mute)]">USDC</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {t.side === "buy"
            ? [10, 50, 100].map((v) => (
                <button key={v} type="button" onClick={() => t.setAmount(String(v))} className="a-num h-10 border-2 border-black text-[17px] hover:bg-[var(--a-panel)]">
                  ${v}
                </button>
              ))
            : [0.25, 0.5, 1].map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={!t.holding}
                  onClick={() => t.setPct(v)}
                  className="a-num h-10 border-2 border-black text-[17px] hover:bg-[var(--a-panel)] disabled:opacity-35"
                >
                  {v === 1 ? "All" : formatPct(v, { decimals: 0 })}
                </button>
              ))}
        </div>

        <div className="flex items-end justify-between border-t-[3px] border-black pt-3">
          <span className="a-label">{t.side === "buy" ? "You get" : "You receive"}</span>
          <span className="a-num text-[34px] leading-none">
            {out}
            {q?.side === "buy" ? <span className="ml-1.5 text-[17px]">${player.ticker}</span> : null}
          </span>
        </div>
        {q ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[14px]">
            <dt className="text-[var(--a-mute)]">Average price</dt>
            <dd className="a-num text-right">{formatPrice(q.avgPrice)}</dd>
            <dt className="text-[var(--a-mute)]">Price impact</dt>
            <dd className="a-num text-right">{formatPct(q.priceImpact)}</dd>
            {q.fees.map((f) => (
              <FeeRow key={f.label} label={`${f.label} ${formatPct(f.rate)}`} value={formatUsd(f.usd)} />
            ))}
          </dl>
        ) : null}
        {q?.error ? (
          <p role="alert" className="border-l-[6px] border-[var(--a-down)] bg-[var(--a-panel)] px-3 py-2 text-[14px]">
            {q.error.message}
          </p>
        ) : null}

        <button
          type="button"
          onClick={t.submit}
          disabled={!t.canSubmit}
          className="a-num h-14 bg-[var(--a-signal)] text-[22px] text-black transition-[transform,opacity] duration-150 ease-[var(--a-ease)] hover:bg-[#ffef4d] disabled:opacity-40 motion-safe:enabled:active:scale-[0.98]"
        >
          {t.cta}
        </button>

        {t.side === "sell" || t.holding ? (
          <p className="text-[14px]">
            <span className="a-num">Sell tax now {formatPct(t.sellTaxNow ?? 0.05, { decimals: 1 })}</span>
            <span className="text-[var(--a-mute)]">, falling to 0.5% after 90 days held.</span>
          </p>
        ) : (
          <p className="text-[14px] text-[var(--a-mute)]">Buys pay 0.3% in fees. Selling pays a tax that falls from 5% to 0.5% over 90 days.</p>
        )}
      </div>
    </section>
  );
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--a-mute)]">{label}</dt>
      <dd className="a-num text-right">{value}</dd>
    </>
  );
}
