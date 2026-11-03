"use client";

import { useState } from "react";
import { PROTOCOL_CONFIG } from "@score/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Countdown, KeyValue } from "@/components/common/bits";
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
  usePortfolio,
  useRound,
  useSellQuote,
  useSell,
  useSession,
} from "@/lib/protocol/react/hooks";
import { useProtocolClient } from "@/lib/protocol/react/provider";
import { useUi } from "@/lib/protocol/react/ui-store";
import { cn } from "@/lib/utils";

type Side = "buy" | "sell";
type SellInput = { usdc: number } | { tokens: number };

/** Same place, same shape in both states: launching (curve) and trading (pool). */
export function TradePanel({
  player,
  compact = false,
}: {
  player: PlayerDetail;
  compact?: boolean;
}) {
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [sellTokens, setSellTokens] = useState<number | null>(null);
  const session = useSession();
  const openSignIn = useUi((s) => s.openSignIn);
  const buy = useBuy();
  const sell = useSell();
  const faucet = useFaucet();
  const pf = usePortfolio();
  const usdc = parseAmount(amount);
  const sellInput: SellInput | null =
    side === "sell"
      ? sellTokens !== null
        ? { tokens: sellTokens }
        : usdc > 0
          ? { usdc }
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
  const holding = player.holding;
  const launching = player.status === "launching";
  const pending = buy.isPending || sell.isPending;

  const reset = () => {
    setAmount("");
    setSellTokens(null);
  };

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
    if (side === "buy")
      buy.mutate({ id: player.id, usdc }, { onSuccess: reset });
    else if (sellInput)
      sell.mutate({ id: player.id, input: sellInput }, { onSuccess: reset });
  };

  const setPct = (pct: number) => {
    if (!holding) return;
    const tokens = pct >= 1 ? holding.tokens : holding.tokens * pct;
    setSellTokens(tokens);
    setAmount((tokens * holding.price).toFixed(2));
  };

  const cta = !session.data
    ? `Sign in to ${side}`
    : side === "buy"
      ? quote?.bonds
        ? `Buy and bond $${player.ticker}`
        : `Buy $${player.ticker}`
      : `Sell $${player.ticker}`;

  const chip =
    "h-8 rounded-full bg-raised px-3 text-[13px] text-ink transition-colors duration-150 hover:bg-[#333] disabled:opacity-40";
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
          }}
        >
          <TabsList variant="segmented" className="w-full">
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="sell">Sell</TabsTrigger>
          </TabsList>
          <TabsContent value={side} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between text-xs">
                <label htmlFor={`amt-${player.id}`} className="text-soft">
                  {side === "buy" ? "You pay" : "You sell (USDC value)"}
                </label>
                {session.data ? (
                  <span className="num text-faint">
                    {side === "buy"
                      ? `Balance ${formatUsd(pf.data?.usdc)}`
                      : `Holding ${formatTokens(holding?.tokens ?? 0)} $${player.ticker}`}
                  </span>
                ) : null}
              </div>
              <div className="flex h-14 items-center gap-2 rounded-2xl bg-ground px-4 ring-1 ring-control transition-[box-shadow] duration-150 focus-within:ring-ink">
                <span className="text-2xl text-faint">$</span>
                <input
                  id={`amt-${player.id}`}
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setSellTokens(null);
                  }}
                  className="num w-full min-w-0 bg-transparent text-2xl font-medium text-ink outline-none placeholder:text-faint"
                  autoComplete="off"
                />
                <span className="text-sm text-faint">USDC</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {side === "buy"
                  ? [10, 50, 100].map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={chip}
                        onClick={() => setAmount(String(v))}
                      >
                        ${v}
                      </button>
                    ))
                  : [0.25, 0.5, 1].map((v) => (
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
                  >
                    Max {formatUsd(maxUsdc)}
                  </button>
                ) : null}
              </div>
            </div>

            <QuoteBreakdown quote={quote} player={player} />

            {quote?.error ? (
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
              <Button
                size="lg"
                className="w-full"
                onClick={submit}
                disabled={!!session.data && (!quote || !quote.ok || pending)}
                data-testid="trade-submit"
              >
                {pending ? "Confirming…" : cta}
              </Button>
              {quote?.error?.code === "INSUFFICIENT_USDC" ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => faucet.mutate(1_000)}
                  disabled={faucet.isPending}
                >
                  Add 1,000 test USDC
                </Button>
              ) : null}
            </div>

            <KickoffNote launching={launching} />
            {launching ? (
              <CapMeter player={player} />
            ) : (
              <HoldAgeMeter player={player} />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
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
            "num text-xl font-medium tracking-[-0.01em]",
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

function HoldAgeMeter({ player }: { player: PlayerDetail }) {
  const client = useProtocolClient();
  const h = player.holding;
  const days = h?.holdAgeDays ?? 0;
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="hold-age">
      <div className="num flex justify-between">
        <span className="text-soft">
          Held{" "}
          <span className="text-ink">
            {h ? `${days.toFixed(0)} days` : "—"}
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
        {h ? (
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
  if (launching)
    body = (
      <>
        Players on the launch curve don&apos;t earn dividends until they bond
        before a kickoff.
      </>
    );
  else if (r.data.phase === "open")
    body = (
      <>
        Snapshot at kickoff in{" "}
        <Countdown to={r.data.endsAt} className="text-ink" />. Hold before then
        to earn this round.
      </>
    );
  else
    body = (
      <>
        This round&apos;s snapshot is taken. Tokens bought now count from the
        next kickoff.
      </>
    );
  return (
    <p className="rounded-xl bg-ground px-3 py-2.5 text-sm text-soft">{body}</p>
  );
}
