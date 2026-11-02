"use client";

import { useState } from "react";
import { PROTOCOL_CONFIG } from "@score/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Countdown, KeyValue } from "@/components/common/bits";
import { formatDateTime, formatPct, formatPrice, formatTokens, formatUsd, parseAmount } from "@/lib/format";
import type { PlayerDetail, Quote } from "@/lib/protocol/types";
import { useBuy, useBuyQuote, useFaucet, usePortfolio, useRound, useSellQuote, useSell, useSession } from "@/lib/protocol/react/hooks";
import { useProtocolClient } from "@/lib/protocol/react/provider";
import { useUi } from "@/lib/protocol/react/ui-store";

type Side = "buy" | "sell";
type SellInput = { usdc: number } | { tokens: number };

/** Same place, same shape in both states: launching (curve) and trading (pool). */
export function TradePanel({ player, compact = false }: { player: PlayerDetail; compact?: boolean }) {
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
  const sellInput: SellInput | null = side === "sell" ? (sellTokens !== null ? { tokens: sellTokens } : usdc > 0 ? { usdc } : null) : null;
  const buyQuote = useBuyQuote(player.id, side === "buy" && usdc > 0 ? usdc : 0);
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
        <CardHeader>
          <CardTitle>Launch</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            {player.name} launches {player.launchAt ? formatDateTime(player.launchAt) : "soon"}. Early buyers get the lowest price on the curve,
            starting at {formatPrice(PROTOCOL_CONFIG.curve.linear)}.
          </p>
          <p className="text-muted-foreground">Curated launches: two a weekday at 14:00 and 20:00 UTC.</p>
        </CardContent>
      </Card>
    );
  }

  const submit = () => {
    if (!session.data) {
      openSignIn();
      return;
    }
    if (side === "buy") buy.mutate({ id: player.id, usdc }, { onSuccess: reset });
    else if (sellInput) sell.mutate({ id: player.id, input: sellInput }, { onSuccess: reset });
  };

  const setPct = (pct: number) => {
    if (!holding) return;
    const tokens = pct >= 1 ? holding.tokens : holding.tokens * pct;
    setSellTokens(tokens);
    setAmount((tokens * holding.price).toFixed(2));
  };

  const ctaLabel = !session.data
    ? `Sign in to ${side}`
    : side === "buy"
      ? quote?.bonds
        ? `Buy and bond $${player.ticker}`
        : `Buy $${player.ticker}`
      : `Sell $${player.ticker}`;

  return (
    <Card size={compact ? "sm" : "default"} data-testid="trade-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{launching ? "Launch" : "Trade"}</span>
          <span className="text-xs font-normal text-muted-foreground">{launching ? "Bonding curve" : "Pool"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs
          value={side}
          onValueChange={(v) => {
            setSide(v as Side);
            reset();
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="sell">Sell</TabsTrigger>
          </TabsList>
        </Tabs>

        {session.data ? (
          <p className="num text-xs text-muted-foreground">
            Balance {formatUsd(pf.data?.usdc)} · holding {formatTokens(holding?.tokens ?? 0)} ${player.ticker}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`amt-${player.id}`}>{side === "buy" ? "Amount (USDC)" : "Amount (USDC value)"}</Label>
          <div className="flex gap-2">
            <Input
              id={`amt-${player.id}`}
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setSellTokens(null);
              }}
              className="num"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {side === "buy"
              ? [10, 50, 100].map((v) => (
                  <Button key={v} type="button" size="xs" variant="outline" onClick={() => setAmount(String(v))}>
                    ${v}
                  </Button>
                ))
              : [0.25, 0.5, 1].map((v) => (
                  <Button key={v} type="button" size="xs" variant="outline" onClick={() => setPct(v)} disabled={!holding}>
                    {v === 1 ? "All" : `${v * 100}%`}
                  </Button>
                ))}
            {side === "buy" && launching && quote?.cap ? (
              <Button type="button" size="xs" variant="outline" onClick={() => setAmount(Math.floor(quote.cap!.maxUsdcNow * 100) / 100 + "")}>
                Max {formatUsd(quote.cap.maxUsdcNow)}
              </Button>
            ) : null}
            {side === "buy" && launching && !quote ? <CapMaxButton player={player} onPick={setAmount} /> : null}
          </div>
        </div>

        <QuoteBreakdown quote={quote} player={player} />

        {quote?.error ? (
          <Alert variant="destructive">
            <AlertDescription>{quote.error.message}</AlertDescription>
          </Alert>
        ) : null}
        {quote?.warnings.map((w) => (
          <p key={w} className="text-xs text-muted-foreground">
            {w}
          </p>
        ))}

        <Button onClick={submit} disabled={!!session.data && (!quote || !quote.ok || pending)} variant={side === "sell" ? "secondary" : "default"} data-testid="trade-submit">
          {pending ? "Confirming…" : ctaLabel}
        </Button>
        {quote?.error?.code === "INSUFFICIENT_USDC" ? (
          <Button variant="outline" size="sm" onClick={() => faucet.mutate(1_000)} disabled={faucet.isPending}>
            Get 1,000 test USDC
          </Button>
        ) : null}

        <KickoffNote launching={launching} />
        {launching ? <CapMeter player={player} /> : <HoldAgeMeter player={player} />}
      </CardContent>
    </Card>
  );
}

function CapMaxButton({ player, onPick }: { player: PlayerDetail; onPick: (v: string) => void }) {
  const q = useBuyQuote(player.id, 1);
  if (!q?.cap) return null;
  return (
    <Button type="button" size="xs" variant="outline" onClick={() => onPick(String(Math.floor(q.cap!.maxUsdcNow * 100) / 100))}>
      Max {formatUsd(q.cap.maxUsdcNow)}
    </Button>
  );
}

function QuoteBreakdown({ quote, player }: { quote: Quote | null; player: PlayerDetail }) {
  if (!quote) {
    return (
      <p className="text-xs text-muted-foreground">
        {player.status === "launching"
          ? "Flat 1.25% fee on launch buys and sells."
          : "Buy fee 0.05% + 0.25% LP fee. Sell tax falls from 5% to 0.5% the longer you hold."}
      </p>
    );
  }
  const rows: [string, string][] = [];
  if (quote.side === "buy") {
    rows.push(["You get", `${formatTokens(quote.tokens)} $${player.ticker}`]);
    if (quote.refund > 0.005) rows.push(["Refunded (above $25k)", formatUsd(quote.refund)]);
  } else {
    rows.push(["You sell", `${formatTokens(quote.tokens)} $${player.ticker}`]);
  }
  rows.push(["Avg price", formatPrice(quote.avgPrice)]);
  rows.push(["Price impact", formatPct(quote.priceImpact)]);
  for (const f of quote.fees) rows.push([`${f.label} ${formatPct(f.rate)}`, `${formatUsd(f.usd)} → ${f.to}`]);
  if (quote.side === "sell") rows.push(["You receive", formatUsd(quote.receive)]);
  return <KeyValue rows={rows} className="rounded-md border p-2 text-xs" />;
}

function CapMeter({ player }: { player: PlayerDetail }) {
  const used = player.holding?.curvePurchased ?? 0;
  const limit = PROTOCOL_CONFIG.curve.capTokensPerAccount;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex justify-between">
        <span>Launch limit used</span>
        <span className="num">
          {formatTokens(used)} / {formatTokens(limit)}
        </span>
      </div>
      <Progress value={(used / limit) * 100} aria-label="Launch limit used" />
      <p className="text-muted-foreground">Max 240,000 tokens (3% of the float) per purchase and per account during launch.</p>
    </div>
  );
}

function HoldAgeMeter({ player }: { player: PlayerDetail }) {
  const client = useProtocolClient();
  const h = player.holding;
  const days = h?.holdAgeDays ?? 0;
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="hold-age">
      <div className="flex justify-between">
        <span>
          Hold age <span className="num font-medium">{h ? `${days.toFixed(0)}d` : "—"}</span>
        </span>
        <span>
          Sell tax now <span className="num font-medium">{h ? formatPct(h.sellTaxNow) : "5.00%"}</span>
        </span>
      </div>
      <Progress value={Math.min(100, (days / 90) * 100)} aria-label="Hold age toward the 0.5% minimum tax" />
      <p className="text-muted-foreground">5% at day 0, falling to 0.5% at 90 days. 90% of it funds the dividend vault.</p>
      {h ? (
        <button type="button" className="self-start text-muted-foreground underline" onClick={() => client.fastForwardDays(30)}>
          Fast-forward 30 days (demo)
        </button>
      ) : null}
    </div>
  );
}

function KickoffNote({ launching }: { launching: boolean }) {
  const r = useRound((x) => ({ phase: x.phase, endsAt: x.phaseEndsAt }));
  if (!r.data) return null;
  if (launching) {
    return <p className="text-xs text-muted-foreground">Launching players don&apos;t earn dividends until they bond before a kickoff.</p>;
  }
  if (r.data.phase === "open") {
    return (
      <p className="text-xs">
        Kickoff snapshot in <Countdown to={r.data.endsAt} className="font-medium" />. Hold before then to earn this round.
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">Matchday under way. Tokens bought now count from the next kickoff.</p>;
}
