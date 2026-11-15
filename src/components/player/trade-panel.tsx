"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { PROTOCOL_CONFIG } from "@score/core";
import { ActionButton, usePhase, type Phase } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckDraw } from "@/components/ui/status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoHeight } from "@/components/common/auto-height";
import { Countdown, KeyValue, LiveFigure, TickUp } from "@/components/common/bits";
import { PlayerAvatar } from "@/components/common/kit";
import { UsdcIcon } from "@/components/common/usdc";
import {
  formatDateTime,
  formatPct,
  formatPrice,
  formatTokens,
  formatUsd,
  parseAmount,
} from "@/lib/format";
import type { PlayerDetail, Quote } from "@/lib/protocol/types";
import {
  useBuy,
  useBuyQuote,
  useFaucet,
  useFunds,
  usePortfolio,
  useRound,
  useSellQuote,
  useSell,
  useSession,
  usePlaceLimit,
  useToTrading,
} from "@/lib/protocol/react/hooks";
import { useMockClient } from "@/lib/protocol/react/provider";
import { useUi } from "@/lib/protocol/react/ui-store";
import { cn } from "@/lib/utils";

type Side = "buy" | "sell";
type SellInput = { usdc: number } | { tokens: number };

/**
 * The ticket's lifecycle, explicit: you edit an order, send it, see it land, and read what it did.
 * Only `edit` accepts input. `sending` turns the button into a working ring; `confirmed` draws the tick
 * on that same button for a beat, so the press is answered where it was made; then `done` opens the
 * receipt until you go again. A failed send shows on the button too (`failed`, with the amount kept and
 * the reason in a toast) and returns to `edit`.
 */
type Fill = { side: Side; tokens: number; usdc: number };
type Ticket =
  | { step: "edit" }
  | { step: "sending" }
  | ({ step: "confirmed" } & Fill)
  | { step: "failed" }
  | ({ step: "done" } & Fill);

/** How long the tick stays on the button before the receipt opens, and the cross before you can retry. */
const CONFIRM_MS = 850;
const FAILED_MS = 1900;

/** Same place, same shape in both states: launching (curve) and trading (pool). */
export function TradePanel({
  player,
  compact = false,
  allowLimit = false,
  shortcuts = false,
}: {
  player: PlayerDetail;
  compact?: boolean;
  /** Offer limit orders (the trade terminal); pool only. */
  allowLimit?: boolean;
  /** Keyboard: b buy, s sell, 1–4 the preset amounts (the terminal, where hands stay on the keys). */
  shortcuts?: boolean;
}) {
  const [side, setSide] = useState<Side>("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const limit =
    allowLimit && player.status === "trading" && orderType === "limit";
  const [amount, setAmount] = useState("");
  const [sellTokens, setSellTokens] = useState<number | null>(null);
  const [ticket, setTicket] = useState<Ticket>({ step: "edit" });
  const session = useSession();
  const openSignIn = useUi((s) => s.openSignIn);
  const buy = useBuy({ silent: true });
  const sell = useSell({ silent: true });
  const faucet = useFaucet();
  const pf = usePortfolio();
  const usdc = parseAmount(amount);
  // Sells are set in the player's tokens (what you hold); the USDC they fetch shows beside them.
  const sellInput: SellInput | null =
    side === "sell"
      ? sellTokens !== null
        ? { tokens: sellTokens }
        : usdc > 0
          ? { tokens: usdc }
          : null
      : null;
  const buyQuote = useBuyQuote(
    player.id,
    side === "buy" && usdc > 0 ? usdc : 0
  );
  const capProbe = useBuyQuote(
    player.id,
    player.status === "launching" ? 1 : 0
  );
  const sellQuote = useSellQuote(player.id, sellInput);
  const quote = side === "buy" ? buyQuote : sellQuote;
  // The USDC a sell fetches: the quote once it's in, the spot value meanwhile.
  const sellTokensNow = sellInput && "tokens" in sellInput ? sellInput.tokens : 0;
  const sellValue = sellQuote?.ok ? sellQuote.receive : sellTokensNow * player.price;
  const holding = player.holding;
  const launching = player.status === "launching";
  const phase: Phase = ticket.step === "sending" ? "pending" : ticket.step === "confirmed" ? "success" : ticket.step === "failed" ? "error" : "idle";
  const faucetPhase = usePhase(faucet);

  const reset = () => {
    setAmount("");
    setSellTokens(null);
  };

  // The beats between states: the tick holds, then the receipt opens; the cross holds, then you can retry.
  useEffect(() => {
    if (ticket.step === "confirmed") {
      const fill: Fill = { side: ticket.side, tokens: ticket.tokens, usdc: ticket.usdc };
      const t = setTimeout(() => {
        setAmount("");
        setSellTokens(null);
        setTicket({ step: "done", ...fill });
      }, CONFIRM_MS);
      return () => clearTimeout(t);
    }
    if (ticket.step === "failed") {
      const t = setTimeout(() => setTicket({ step: "edit" }), FAILED_MS);
      return () => clearTimeout(t);
    }
  }, [ticket]);

  // Latest values for the key handler without re-binding it on every keystroke.
  const keys = useRef({ side, holding: player.holding });
  useEffect(() => {
    keys.current = { side, holding: player.holding };
  });
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && t.closest("input, textarea, select, [contenteditable=true], [role=combobox], [role=menu], [role=dialog], [role=listbox]"))) return;
      const k = e.key.toLowerCase();
      const focusAmount = () => requestAnimationFrame(() => document.getElementById(`amt-${player.id}`)?.focus());
      if (k === "b" || k === "s") {
        e.preventDefault();
        setSide(k === "b" ? "buy" : "sell");
        setAmount("");
        setSellTokens(null);
        setTicket({ step: "edit" });
        focusAmount();
      } else if (k >= "1" && k <= "4") {
        e.preventDefault();
        const i = Number(k) - 1;
        setTicket({ step: "edit" });
        if (keys.current.side === "buy") {
          setSellTokens(null);
          setAmount(String([25, 50, 100, 250][i]));
        } else {
          const h = keys.current.holding;
          if (!h) return;
          const pct = [0.25, 0.5, 0.75, 1][i]!;
          const tokens = pct >= 1 ? h.tokens : h.tokens * pct;
          setSellTokens(tokens);
          setAmount(String(Math.floor(tokens)));
        }
        focusAmount();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, player.id]);

  if (player.status === "scheduled") {
    return (
      <Card size={compact ? "sm" : "default"}>
        <CardContent className="flex flex-col gap-2">
          <h2 className="text-base font-medium text-ink">Launch</h2>
          <p className="text-sm text-soft">
            {player.name} launches{" "}
            {player.launchAt ? formatDateTime(player.launchAt) : "soon"}. The
            first buyers get the lowest price on the curve, from{" "}
            {formatPrice(PROTOCOL_CONFIG.curve.linear)}.
          </p>
          <p className="text-sm text-faint">
            Curated launches: two each weekday, at 14:00 and 20:00 UTC.
          </p>
        </CardContent>
      </Card>
    );
  }

  const submit = () => {
    if (!session.data) {
      openSignIn();
      return;
    }
    const done = (r: { tokens?: number; usdc?: number }) => setTicket({ step: "confirmed", side, tokens: r.tokens ?? quote?.tokens ?? 0, usdc: r.usdc ?? 0 });
    const failed = () => setTicket({ step: "failed" });
    if (side === "buy") {
      setTicket({ step: "sending" });
      buy.mutate({ id: player.id, usdc }, { onSuccess: done, onError: failed });
    } else if (sellInput) {
      setTicket({ step: "sending" });
      sell.mutate({ id: player.id, input: sellInput }, { onSuccess: done, onError: failed });
    }
  };

  const setPct = (pct: number) => {
    if (!holding) return;
    const tokens = pct >= 1 ? holding.tokens : holding.tokens * pct;
    setSellTokens(tokens);
    setAmount(String(Math.floor(tokens)));
  };

  const cta = !session.data
    ? `Sign in to ${side}`
    : side === "buy"
      ? quote?.bonds
        ? `Buy and bond $${player.ticker}`
        : `Buy $${player.ticker}`
      : `Sell $${player.ticker}`;

  // The amount chips wear the side you're on: green to buy, red to sell (15 Nov; they were grey pills).
  const chip = cn(
    "fig h-9 min-w-0 flex-1 rounded-full px-2 text-[0.875rem] font-medium transition-[background-color,box-shadow,transform] duration-150 motion-safe:active:scale-[0.96] disabled:opacity-40",
    side === "buy"
      ? "bg-up-tint/55 text-up hover:bg-up-tint aria-pressed:bg-up-tint aria-pressed:ring-1 aria-pressed:ring-up/45 aria-pressed:ring-inset"
      : "bg-down-tint/55 text-down hover:bg-down-tint aria-pressed:bg-down-tint aria-pressed:ring-1 aria-pressed:ring-down/45 aria-pressed:ring-inset"
  );
  const locked = ticket.step !== "edit";
  const maxUsdc = capProbe?.cap
    ? Math.floor(capProbe.cap.maxUsdcNow * 100) / 100
    : null;

  return (
    <Card size={compact ? "sm" : "default"} data-testid="trade-panel">
      <CardContent>
        <Tabs
          className="gap-4"
          value={side}
          onValueChange={(v) => {
            setSide(v as Side);
            reset();
            setTicket({ step: "edit" });
          }}
        >
          <TabsList variant="segmented" className="relative isolate h-11 w-full">
            {/* One fill that slides between the two sides and changes colour on the way (a transition, so a
                second press mid-move turns it round instead of snapping). */}
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-y-1 left-1 -z-10 w-[calc(50%-0.25rem)] rounded-full transition-[translate,background-color] duration-200 ease-out-strong motion-reduce:transition-none",
                side === "buy" ? "translate-x-0 bg-up-tint" : "translate-x-full bg-down-tint"
              )}
            />
            <TabsTrigger value="buy" className="text-[1rem] font-semibold data-active:!bg-transparent data-active:text-up">
              Buy
            </TabsTrigger>
            <TabsTrigger value="sell" className="text-[1rem] font-semibold data-active:!bg-transparent data-active:text-down">
              Sell
            </TabsTrigger>
          </TabsList>
          {allowLimit && player.status === "trading" ? (
            <div
              role="radiogroup"
              aria-label="Order type"
              className="flex gap-4 text-[0.8125rem]"
            >
              {(["market", "limit"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={orderType === t}
                  onClick={() => setOrderType(t)}
                  className={cn(
                    "h-7 border-b-2 transition-colors duration-150",
                    orderType === t
                      ? "border-ink text-ink"
                      : "border-transparent text-soft hover:text-ink"
                  )}
                >
                  {t === "market" ? "Market" : "Limit"}
                </button>
              ))}
            </div>
          ) : null}
          <TabsContent value={side}>
           <AutoHeight innerClassName="flex flex-col gap-4">
            {limit ? (
              <LimitForm player={player} side={side} />
            ) : ticket.step === "done" ? (
              <Receipt player={player} result={ticket} onAgain={() => setTicket({ step: "edit" })} />
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between text-xs">
                    <label htmlFor={`amt-${player.id}`} className="text-soft">
                      {side === "buy" ? "You pay" : `You sell $${player.ticker}`}
                    </label>
                    {session.data ? (
                      <span className="num text-faint">
                        {side === "buy"
                          ? `Cash ${formatUsd(pf.data?.usdc)}`
                          : `Holding ${formatTokens(holding?.tokens ?? 0)} $${player.ticker}`}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex h-14 items-center gap-2 rounded-2xl bg-ground px-4 ring-1 ring-control transition-[box-shadow] duration-150 focus-within:ring-ink">
                    {side === "buy" ? <span className="text-2xl text-faint">$</span> : null}
                    <input
                      id={`amt-${player.id}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setSellTokens(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && session.data && quote?.ok && !locked) submit();
                      }}
                      className="fig fig-prop w-full min-w-0 bg-transparent text-[2rem] text-ink outline-none placeholder:text-faint"
                      autoComplete="off"
                    />
                    {side === "buy" ? (
                      <UsdcIcon className="size-5" label="USDC" />
                    ) : (
                      <span className="flex shrink-0 flex-col items-end leading-none" aria-live="polite">
                        <span className="text-[0.75rem] font-semibold text-soft">${player.ticker}</span>
                        <span className="fig mt-1 text-[0.9375rem] font-semibold text-ink" title="What these tokens fetch, after the sell tax and price impact">
                          ≈ {formatUsd(sellValue)}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {side === "buy"
                      ? [25, 50, 100, 250].map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={chip}
                            aria-pressed={amount === String(v)}
                            onClick={() => setAmount(String(v))}
                          >
                            ${v}
                          </button>
                        ))
                      : [0.25, 0.5, 0.75, 1].map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={chip}
                            onClick={() => setPct(v)}
                            disabled={!holding}
                          >
                            {v === 1 ? "All" : `${v * 100}%`}
                          </button>
                        ))}
                    {side === "buy" && launching && maxUsdc !== null ? (
                      <button
                        type="button"
                        className={chip}
                        onClick={() => setAmount(String(maxUsdc))}
                        disabled={maxUsdc <= 0}
                        title={`Your launch allowance left: ${formatUsd(maxUsdc)}`}
                      >
                        Max
                      </button>
                    ) : null}
                  </div>
                </div>

                <QuoteBreakdown quote={quote} player={player} />

                {quote?.error && phase !== "success" ? (
                  <p
                    className="flex items-start gap-2 text-sm text-ink"
                    role="alert"
                  >
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-down"
                      aria-hidden="true"
                    />
                    {quote.error.message}
                  </p>
                ) : null}
                {quote?.warnings.map((w) => (
                  <p key={w} className="text-sm text-soft">
                    {w}
                  </p>
                ))}

                <div className="flex flex-col gap-2">
                  <ActionButton
                    size="lg"
                    variant={side === "buy" ? "buy" : "sell"}
                    className="h-12 w-full text-[1rem]"
                    onClick={submit}
                    disabled={phase === "idle" && !!session.data && (!quote || !quote.ok)}
                    phase={phase}
                    pending={side === "buy" ? `Buying $${player.ticker}` : `Selling $${player.ticker}`}
                    success={side === "buy" ? "Bought" : "Sold"}
                    data-testid="trade-submit"
                  >
                    {cta}
                  </ActionButton>
                  {shortcuts ? (
                    <p className="hidden text-center text-[0.75rem] text-faint lg:block">
                      <kbd className="font-sans text-soft">b</kbd> buy · <kbd className="font-sans text-soft">s</kbd> sell · <kbd className="font-sans text-soft">1</kbd>–<kbd className="font-sans text-soft">4</kbd> amounts · <kbd className="font-sans text-soft">enter</kbd> to send
                    </p>
                  ) : null}
                  {quote?.error?.code === "INSUFFICIENT_USDC" && phase !== "success" ? (
                    <ShortOfFunds need={quote.usdc} have={pf.data?.usdc ?? 0} onTopUp={() => faucet.mutate(1_000)} topUpPhase={faucetPhase} />
                  ) : null}
                </div>
              </>
            )}
            {ticket.step === "done" && !limit ? null : <KickoffNote launching={launching} />}
            {launching ? (
              <CapMeter player={player} />
            ) : (
              <HoldAgeMeter player={player} />
            )}
           </AutoHeight>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** What the order did, where it was placed: the moment after you press the button. */
function Receipt({ player, result, onAgain }: { player: PlayerDetail; result: Extract<Ticket, { step: "done" }>; onAgain: () => void }) {
  const r = useRound((x) => ({ phase: x.phase, endsAt: x.phaseEndsAt }));
  const held = player.holding?.tokens ?? 0;
  const bought = result.side === "buy";
  return (
    <div className="receipt-enter flex flex-col gap-4 rounded-2xl bg-ground p-4" role="status" data-testid="trade-receipt">
      <div className="flex items-center gap-3">
        <PlayerAvatar id={player.id} size={52} className="[--kit-ring:var(--ground)]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-soft">{bought ? "You bought" : "You sold"}</span>
          <span className={cn("text-[2.125rem] leading-[1.06]", bought ? "text-up" : "text-ink")}>
            <TickUp value={result.tokens} format={(n) => formatTokens(n)} className="fig-prop" />
          </span>
          <span className="text-sm text-soft">
            ${player.ticker} {bought ? "for" : "and received"} <span className="fig text-ink">{formatUsd(result.usdc)}</span>
          </span>
        </div>
        {/* The order landed: a ring closes and a tick draws in it, once. */}
        <CheckDraw ring className={cn("size-8 self-start", bought ? "text-up" : "text-ink")} />
      </div>
      <KeyValue
        rows={[
          ["You now hold", held > 0 ? <LiveFigure key="held" value={held} format={(n) => `${formatTokens(n)} $${player.ticker}`} /> : "None"],
          ...(held > 0 && player.status === "trading"
            ? ([["Worth now", <LiveFigure key="worth" value={held * player.price} format={(n) => formatUsd(n)} />]] as [string, React.ReactNode][])
            : []),
        ]}
      />
      {bought ? (
        <p className="text-sm text-soft">
          {player.status === "launching" ? (
            <>Counts for dividends once ${player.ticker} bonds before a kickoff.</>
          ) : r.data?.phase === "open" ? (
            <>
              Counts at kickoff in <Countdown to={r.data.endsAt} className="text-ink" />. Hold until then to earn this round.
            </>
          ) : (
            <>Counts from the next kickoff.</>
          )}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onAgain}>
          {bought ? "Buy more" : "Sell more"}
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/portfolio">Portfolio</Link>
        </Button>
      </div>
    </div>
  );
}

function QuoteBreakdown({
  quote,
  player,
}: {
  quote: Quote | null;
  player: PlayerDetail;
}) {
  if (!quote) {
    return (
      <p className="text-sm text-faint">
        {player.status === "launching"
          ? "Flat 1.25% fee on launch buys and sells."
          : "Buys pay 0.05% plus a 0.25% fee to liquidity providers. The sell tax falls from 5% to 0.5% the longer you hold."}
      </p>
    );
  }
  const lead =
    quote.side === "buy"
      ? `${formatTokens(quote.tokens)} $${player.ticker}`
      : formatUsd(quote.receive);
  const rows: [string, string][] = [];
  if (quote.side === "sell")
    rows.push(["You sell", `${formatTokens(quote.tokens)} $${player.ticker}`]);
  if (quote.refund > 0.005)
    rows.push(["Refunded above $25k", formatUsd(quote.refund)]);
  rows.push(["Average price", formatPrice(quote.avgPrice)]);
  rows.push(["Price impact", formatPct(quote.priceImpact)]);
  for (const f of quote.fees)
    rows.push([`${f.label} · ${formatPct(f.rate)}`, formatUsd(f.usd)]);
  return (
    <div
      className="flex flex-col gap-1 rounded-2xl bg-raised/50 px-4 py-3"
      aria-live="polite"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-soft">
          {quote.side === "buy" ? "You get" : "You receive"}
        </span>
        <span
          className={cn(
            "num text-xl font-medium",
            quote.ok ? "text-ink" : "text-faint"
          )}
        >
          {lead}
        </span>
      </div>
      <KeyValue rows={rows} className="[&_dd]:text-soft [&_dt]:text-faint" />
      {quote.fees.length ? (
        <p className="pt-1 text-xs text-faint">
          {quote.side === "sell"
            ? "Sell fees go 90% to the dividend vault, 10% to the treasury."
            : quote.venue === "curve"
              ? "The launch fee goes to the treasury."
              : "The buy fee goes to the treasury; the LP fee stays in the pool."}
        </p>
      ) : null}
    </div>
  );
}

function CapMeter({ player }: { player: PlayerDetail }) {
  const used = player.holding?.curvePurchased ?? 0;
  const limit = PROTOCOL_CONFIG.curve.capTokensPerAccount;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="num flex justify-between">
        <span className="text-soft">Your launch allowance</span>
        <span className="text-ink">
          {formatTokens(used)}{" "}
          <span className="text-faint">of {formatTokens(limit)}</span>
        </span>
      </div>
      <Progress
        value={(used / limit) * 100}
        tone="soft"
        aria-label="Launch allowance used"
      />
      <p className="text-xs text-faint">
        Up to 240,000 tokens (3% of the float) per purchase and per account
        while a player launches.
      </p>
    </div>
  );
}

/**
 * A buy needs more than the cash that's ready to trade. On devnet: when a deposit is still in the wallet
 * (normally added on its own within seconds), add it in one tap; otherwise deposit. On the mock: the
 * test top-up.
 */
function ShortOfFunds({ need, have, onTopUp, topUpPhase }: { need: number; have: number; onTopUp: () => void; topUpPhase: Phase }) {
  const devnet = !useMockClient();
  const funds = useFunds();
  const toTrading = useToTrading();
  const addPhase = usePhase(toTrading);
  const openFunds = useUi((s) => s.openFunds);
  if (!devnet) {
    return (
      <ActionButton variant="secondary" className="w-full" onClick={onTopUp} phase={topUpPhase} pending="Adding test USDC" success="1,000 added">
        Top up
      </ActionButton>
    );
  }
  const short = need - have;
  // Whole cents of what's waiting in the wallet: move all of it, so nothing is left behind.
  const wallet = Math.floor((funds.data?.wallet ?? 0) * 100) / 100;
  if (short > 0 && wallet + 1e-9 >= short) {
    return (
      <ActionButton variant="secondary" className="w-full" onClick={() => toTrading.mutate(wallet)} phase={addPhase} pending={`Adding ${formatUsd(wallet)}`} success="Added to your cash">
        Add your {formatUsd(wallet)} deposit
      </ActionButton>
    );
  }
  return (
    <Button variant="secondary" className="w-full" onClick={() => openFunds("deposit")}>
      Deposit
    </Button>
  );
}

function HoldAgeMeter({ player }: { player: PlayerDetail }) {
  const client = useMockClient();
  const h = player.holding;
  const days = h?.holdAgeDays ?? 0;
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="hold-age">
      <div className="num flex justify-between">
        <span className="text-soft">
          Held{" "}
          <span className="text-ink">
            {h ? `${days === 1 ? "1 day" : `${days.toFixed(0)} days`}` : "—"}
          </span>
        </span>
        <span className="text-soft">
          Sell tax now{" "}
          <span className="text-ink">
            {h ? formatPct(h.sellTaxNow) : "5.00%"}
          </span>
        </span>
      </div>
      <Progress
        value={Math.min(100, (days / 90) * 100)}
        tone="soft"
        aria-label="Hold age toward the 0.5% minimum sell tax"
      />
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-faint">
          5% on day one, falling to 0.5% at 90 days. 90% of it goes to holders.
        </p>
        {h && client ? (
          <button
            type="button"
            className="shrink-0 text-xs text-soft underline decoration-control underline-offset-4 hover:text-ink"
            onClick={() => client.fastForwardDays(30)}
          >
            +30 days (demo)
          </button>
        ) : null}
      </div>
    </div>
  );
}

function KickoffNote({ launching }: { launching: boolean }) {
  const r = useRound((x) => ({ phase: x.phase, endsAt: x.phaseEndsAt }));
  if (!r.data) return null;
  let body;
  let earning = false;
  if (launching)
    body = (
      <>
        Players on the launch curve don&apos;t earn dividends until they bond
        before a kickoff.
      </>
    );
  else if (r.data.phase === "open") {
    earning = true;
    body = (
      <>
        Snapshot at kickoff in{" "}
        <Countdown to={r.data.endsAt} className="text-brand" />. Hold before then
        to earn this round.
      </>
    );
  }
  else
    body = (
      <>
        This round&apos;s snapshot is taken. Tokens bought now count from the
        next kickoff.
      </>
    );
  // Gold is the colour of what pays: the note is tinted with it only while buying now still counts.
  return (
    <p className={cn("rounded-xl px-3 py-2.5 text-sm", earning ? "bg-brand-tint/45 text-ink/85" : "bg-raised/50 text-soft")}>{body}</p>
  );
}

/** Limit order form (terminal): rests on the pool until the price reaches the limit. */
function LimitForm({ player, side }: { player: PlayerDetail; side: Side }) {
  const session = useSession();
  const openSignIn = useUi((s) => s.openSignIn);
  const pf = usePortfolio();
  const place = usePlaceLimit();
  const [price, setPrice] = useState(() => player.price.toFixed(5));
  const [amount, setAmount] = useState("");
  const px = parseAmount(price);
  const amt = parseAmount(amount);
  const holding = player.holding;
  const tokensOut = side === "buy" && px > 0 ? amt / px : 0;
  const usdcIn = side === "sell" ? amt * px : 0;
  const away = px > 0 ? px / player.price - 1 : 0;
  const placePhase = usePhase(place);
  const ok = !!session.data && px > 0 && amt > 0;

  const submit = () => {
    if (!session.data) return openSignIn();
    place.mutate(
      { id: player.id, side, amount: amt, price: px },
      { onSuccess: () => setAmount("") }
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <label htmlFor={`lim-px-${player.id}`} className="text-soft">
            Limit price
          </label>
          <button
            type="button"
            className="text-faint hover:text-ink"
            onClick={() => setPrice(player.price.toFixed(5))}
          >
            Use {formatPrice(player.price)}
          </button>
        </div>
        <div className="flex h-12 items-center gap-2 rounded-2xl bg-ground px-4 ring-1 ring-control focus-within:ring-ink">
          <span className="text-xl text-faint">$</span>
          <input
            id={`lim-px-${player.id}`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="fig w-full min-w-0 bg-transparent text-xl text-ink outline-none"
            autoComplete="off"
          />
        </div>
        {px > 0 ? (
          <span
            className={cn(
              "text-xs",
              Math.abs(away) < 0.0005
                ? "text-faint"
                : (side === "buy" ? away < 0 : away > 0)
                  ? "text-soft"
                  : "text-down"
            )}
          >
            {Math.abs(away) < 0.0005
              ? "At the current price: fills on the next tick."
              : `${formatPct(Math.abs(away), { decimals: 1 })} ${away < 0 ? "below" : "above"} the current price${(side === "buy" ? away > 0 : away < 0) ? ", so it fills right away" : ""}.`}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <label htmlFor={`lim-amt-${player.id}`} className="text-soft">
            {side === "buy" ? "You pay (USDC)" : `You sell ($${player.ticker})`}
          </label>
          {session.data ? (
            <span className="fig text-faint">
              {side === "buy"
                ? `Cash ${formatUsd(pf.data?.usdc)}`
                : `Holding ${formatTokens(holding?.tokens ?? 0)}`}
            </span>
          ) : null}
        </div>
        <div className="flex h-12 items-center gap-2 rounded-2xl bg-ground px-4 ring-1 ring-control focus-within:ring-ink">
          <input
            id={`lim-amt-${player.id}`}
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="fig w-full min-w-0 bg-transparent text-xl text-ink outline-none placeholder:text-faint"
            autoComplete="off"
          />
          {side === "buy" ? (
            <UsdcIcon className="size-5" label="USDC" />
          ) : (
            <span className="text-sm text-faint">${player.ticker}</span>
          )}
        </div>
      </div>
      {amt > 0 && px > 0 ? (
        <p className="text-sm text-soft">
          {side === "buy" ? (
            <>
              About{" "}
              <span className="fig text-ink">{formatTokens(tokensOut)}</span> $
              {player.ticker} at your limit. The USDC is set aside until it
              fills or you cancel.
            </>
          ) : (
            <>
              About <span className="fig text-ink">{formatUsd(usdcIn)}</span>{" "}
              before the sell tax (
              {formatPct(holding?.sellTaxNow ?? 0.05, { decimals: 1 })} now).
            </>
          )}
        </p>
      ) : null}
      <ActionButton
        size="lg"
        variant={side === "buy" ? "buy" : "sell"}
        className="h-12 w-full text-[1rem]"
        onClick={submit}
        disabled={placePhase === "idle" && !!session.data && !ok}
        phase={placePhase}
        pending="Placing order"
        success="Order resting on the pool"
        data-testid="limit-submit"
      >
        {!session.data ? "Sign in to trade" : `Place limit ${side}`}
      </ActionButton>
    </div>
  );
}
