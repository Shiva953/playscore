"use client";

import { formatPct, formatPrice, formatTokens, formatUsd } from "@/lib/format";
import type { PlayerDetail } from "@/lib/protocol/types";
import { useTradeTicket } from "@/directions/lab/use-trade-ticket";
import { cn } from "@/lib/utils";

/** Order ticket: white sheet in the right rail, quiet until there's an amount, one blue button. */
export function Ticket({ player }: { player: PlayerDetail }) {
  const t = useTradeTicket(player);
  const q = t.quote;
  return (
    <section aria-label={`Trade ${player.name}`} className="b-card flex flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] font-semibold">
          {t.side === "buy" ? "Buy" : "Sell"} {player.ticker}
        </h2>
        <div role="radiogroup" aria-label="Side" className="flex rounded-[var(--b-radius-control)] bg-[var(--b-raised)] p-0.5">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={t.side === s}
              onClick={() => t.setSide(s)}
              className={cn(
                "b-control rounded-[5px] px-3 text-[13px] font-semibold transition-colors duration-150",
                t.side === s ? "bg-white text-[var(--b-text)] ring-1 ring-[var(--b-border)]" : "text-[var(--b-muted)] hover:text-[var(--b-text)]"
              )}
            >
              {s === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-[13px]">
          <label htmlFor={`b-amt-${player.id}`} className="font-medium">
            Amount
          </label>
          {t.signedIn ? (
            <span className="b-num text-[var(--b-muted)]">
              {t.side === "buy" ? `${formatUsd(t.balance)} available` : `${formatTokens(t.holding?.tokens ?? 0)} ${player.ticker} held`}
            </span>
          ) : null}
        </div>
        <div className="flex h-12 items-center gap-1 rounded-[var(--b-radius-control)] border border-[var(--b-control)] bg-white px-3 transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--b-accent)] focus-within:shadow-[0_0_0_3px_var(--b-accent-track)]">
          <span className="text-[20px] text-[var(--b-muted)]">$</span>
          <input
            id={`b-amt-${player.id}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={t.amount}
            onChange={(e) => t.setAmount(e.target.value)}
            className="b-num w-full min-w-0 bg-transparent text-[20px] font-medium outline-none placeholder:text-[#9aa1ad]"
          />
        </div>
        <div className="flex gap-2">
          {t.side === "buy"
            ? [10, 50, 100].map((v) => (
                <Chip key={v} onClick={() => t.setAmount(String(v))}>
                  +${v}
                </Chip>
              ))
            : [0.25, 0.5, 1].map((v) => (
                <Chip key={v} onClick={() => t.setPct(v)} disabled={!t.holding}>
                  {v === 1 ? "Max" : formatPct(v, { decimals: 0 })}
                </Chip>
              ))}
        </div>
      </div>

      <dl className="flex flex-col text-[13px]">
        <Row label={t.side === "buy" ? "Estimated tokens" : "You receive"} strong>
          {q ? (q.side === "buy" ? `${formatTokens(q.tokens)} ${player.ticker}` : formatUsd(q.receive)) : "—"}
        </Row>
        <Row label="Average price">{q ? formatPrice(q.avgPrice) : formatPrice(player.price)}</Row>
        <Row label="Price impact">{q ? formatPct(q.priceImpact) : "—"}</Row>
        {(q?.fees ?? []).map((f) => (
          <Row key={f.label} label={`${f.label} (${formatPct(f.rate)})`}>
            {formatUsd(f.usd)}
          </Row>
        ))}
      </dl>

      {q?.error ? (
        <p role="alert" className="rounded-[var(--b-radius-control)] bg-[var(--b-pill-neg-bg)] px-3 py-2 text-[13px] text-[var(--b-pill-neg-ink)]">
          {q.error.message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={t.submit}
        disabled={!t.canSubmit}
        className="h-11 rounded-[var(--b-radius-control)] bg-[var(--b-accent)] text-[14px] font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-[var(--b-accent-hover)] disabled:bg-[var(--b-accent-track)] disabled:text-[var(--b-accent-ink)] motion-safe:enabled:active:scale-[0.98]"
      >
        {t.cta.replace("$", "")}
      </button>
      <p className="text-[12px] leading-[1.5] text-[var(--b-muted)]">
        {t.holding ? (
          <>
            Selling now pays <span className="b-num font-medium text-[var(--b-text)]">{formatPct(t.sellTaxNow ?? 0, { decimals: 1 })}</span> tax. It falls to 0.5% after 90 days held.
          </>
        ) : (
          "Buys pay 0.05% plus 0.25% to liquidity providers. Selling pays a tax that falls from 5% to 0.5% over 90 days of holding."
        )}
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
      className="b-control b-num flex-1 rounded-[var(--b-radius-control)] border border-[var(--b-border)] text-[13px] font-medium transition-colors duration-150 hover:border-[var(--b-control)] hover:bg-[var(--b-raised)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--b-rule)] py-2 last:border-0">
      <dt className="text-[var(--b-muted)]">{label}</dt>
      <dd className={cn("b-num", strong ? "text-[15px] font-semibold" : "font-medium")}>{children}</dd>
    </div>
  );
}
