"use client";

import { useState } from "react";
import { parseAmount } from "@/lib/format";
import type { PlayerDetail, Quote } from "@/lib/protocol/types";
import { useBuy, useBuyQuote, usePortfolio, useSell, useSellQuote, useSession, useSignIn } from "@/lib/protocol/react/hooks";

export type Side = "buy" | "sell";

/**
 * Headless trade ticket shared by the lab directions (data only, no styling): the same rules as the
 * production panel, so each direction is compared on presentation, not on behaviour.
 * Signed out, the action signs in a demo account (the lab has no sign-in dialog).
 */
export function useTradeTicket(player: PlayerDetail) {
  const [side, setSideRaw] = useState<Side>("buy");
  const [amount, setAmountRaw] = useState("");
  const [sellTokens, setSellTokens] = useState<number | null>(null);
  const session = useSession();
  const signIn = useSignIn();
  const pf = usePortfolio();
  const buy = useBuy();
  const sell = useSell();

  const usdc = parseAmount(amount);
  const sellInput = side === "sell" ? (sellTokens !== null ? { tokens: sellTokens } : usdc > 0 ? { usdc } : null) : null;
  const buyQuote = useBuyQuote(player.id, side === "buy" && usdc > 0 ? usdc : 0);
  const sellQuote = useSellQuote(player.id, sellInput);
  const quote: Quote | null = side === "buy" ? buyQuote : sellQuote;
  const holding = player.holding;
  const signedIn = !!session.data;
  const pending = buy.isPending || sell.isPending || signIn.isPending;

  const reset = () => {
    setAmountRaw("");
    setSellTokens(null);
  };
  const setSide = (s: Side) => {
    setSideRaw(s);
    reset();
  };
  const setAmount = (v: string) => {
    setAmountRaw(v);
    setSellTokens(null);
  };
  const setPct = (pct: number) => {
    if (!holding) return;
    const tokens = pct >= 1 ? holding.tokens : holding.tokens * pct;
    setSellTokens(tokens);
    setAmountRaw((tokens * holding.price).toFixed(2));
  };

  const submit = () => {
    if (!signedIn) {
      signIn.mutate({ method: "google", country: "Germany", acceptedTerms: true });
      return;
    }
    if (side === "buy") buy.mutate({ id: player.id, usdc }, { onSuccess: reset });
    else if (sellInput) sell.mutate({ id: player.id, input: sellInput }, { onSuccess: reset });
  };

  const canSubmit = !signedIn || (!!quote && quote.ok && !pending);
  const verb = side === "buy" ? (quote?.bonds ? "Buy and bond" : "Buy") : "Sell";
  const cta = !signedIn ? `Sign in to ${side}` : pending ? "Confirming…" : `${verb} $${player.ticker}`;
  /** The sell tax that applies right now, shown before any sell. */
  const sellTaxNow = holding?.sellTaxNow ?? null;

  return {
    side,
    setSide,
    amount,
    setAmount,
    setPct,
    usdc,
    quote,
    holding,
    balance: pf.data?.usdc ?? null,
    signedIn,
    pending,
    canSubmit,
    submit,
    cta,
    sellTaxNow,
  };
}
