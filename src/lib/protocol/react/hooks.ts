"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { errorMessage, isProtocolError } from "../errors";
import type { ClaimMode, PlayerFilter, PriceRange, RoundState, SignInMethod } from "../types";
import { qk } from "./keys";
import { useProtocolClient } from "./provider";
import { useUi } from "./ui-store";

// ------------------------------------------------------------ reads

export function useConfig() {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.config(), queryFn: () => c.getConfig() });
}

export function useSession() {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.session(), queryFn: () => c.getSession() });
}

export function usePlayers(filter?: PlayerFilter) {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.players(filter ?? {}), queryFn: () => c.listPlayers(filter), placeholderData: (prev) => prev });
}

export function usePlayer(id: string) {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.player(id), queryFn: () => c.getPlayer(id), retry: (n, e) => !(isProtocolError(e) && e.code === "NOT_FOUND") && n < 1 });
}

export function usePriceHistory(id: string, range: PriceRange) {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.history(id, range), queryFn: () => c.getPriceHistory(id, range), placeholderData: (prev) => prev });
}

export function useRecentTrades(id: string | null, limit = 20) {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.trades(id, limit), queryFn: () => c.getRecentTrades(id, limit) });
}

/** Round state. Pass `select` to subscribe to a slice (e.g. the header pill only re-renders on phase changes). */
export function useRound<T = RoundState>(select?: (r: RoundState) => T) {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.round(), queryFn: () => c.getRound(), select });
}

export function useRoundHistory(limit = 10) {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.rounds(limit), queryFn: () => c.getRoundHistory(limit) });
}

export function usePortfolio() {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.portfolio(), queryFn: () => c.getPortfolio() });
}

export function useStats() {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.stats(), queryFn: () => c.getProtocolStats() });
}

// ------------------------------------------------------------ quotes (sync, recomputed when the player's data refreshes)

export function useBuyQuote(id: string, usdc: number) {
  const c = useProtocolClient();
  const { dataUpdatedAt } = usePlayer(id);
  const portfolio = usePortfolio();
  return useMemo(
    () => (usdc > 0 ? c.quoteBuy(id, usdc) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, id, usdc, dataUpdatedAt, portfolio.dataUpdatedAt]
  );
}

export function useSellQuote(id: string, input: { usdc: number } | { tokens: number } | null) {
  const c = useProtocolClient();
  const { dataUpdatedAt } = usePlayer(id);
  const portfolio = usePortfolio();
  const key = input ? ("usdc" in input ? `u${input.usdc}` : `t${input.tokens}`) : "";
  return useMemo(
    () => (input && ("usdc" in input ? input.usdc > 0 : input.tokens > 0) ? c.quoteSell(id, input) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, id, key, dataUpdatedAt, portfolio.dataUpdatedAt]
  );
}

export function useLiquidityQuote(id: string, usdc: number, mode: "pair" | "zap") {
  const c = useProtocolClient();
  const { dataUpdatedAt } = usePlayer(id);
  return useMemo(
    () => (usdc > 0 ? c.quoteLiquidity(id, usdc, mode) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, id, usdc, mode, dataUpdatedAt]
  );
}

// ------------------------------------------------------------ actions

function useAction<V>(fn: (v: V) => Promise<{ summary: string }>, opts: { success?: (r: { summary: string }, v: V) => string | null } = {}) {
  const qc = useQueryClient();
  const openSignIn = useUi((s) => s.openSignIn);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      const msg = opts.success ? opts.success(r, v) : r.summary;
      if (msg) toast.success(msg);
      void qc.invalidateQueries();
    },
    onError: (e) => {
      if (isProtocolError(e) && e.code === "NOT_SIGNED_IN") {
        openSignIn();
        return;
      }
      toast.error(errorMessage(e));
    },
  });
}

export function useBuy() {
  const c = useProtocolClient();
  return useAction((v: { id: string; usdc: number }) => c.buy(v.id, v.usdc));
}

export function useSell() {
  const c = useProtocolClient();
  return useAction((v: { id: string; input: { usdc: number } | { tokens: number } }) => c.sell(v.id, v.input));
}

export function useAddLiquidity() {
  const c = useProtocolClient();
  return useAction((v: { id: string; usdc: number; mode: "pair" | "zap" }) => c.addLiquidity(v.id, v.usdc, v.mode));
}

export function useRemoveLiquidity() {
  const c = useProtocolClient();
  return useAction((v: { id: string; fraction?: number }) => c.removeLiquidity(v.id, v.fraction));
}

export function useClaim() {
  const c = useProtocolClient();
  return useAction((mode: ClaimMode) => c.claim(mode));
}

export function useFaucet() {
  const c = useProtocolClient();
  return useAction((amount: number) => c.faucet(amount));
}

export function useSignIn() {
  const c = useProtocolClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { method: SignInMethod; country: string; acceptedTerms: boolean }) => c.signIn(v),
    onSuccess: () => {
      toast.success("Signed in on devnet", { description: "1,000 test USDC added to your balance." });
      void qc.invalidateQueries();
    },
  });
}

export function useSignOut() {
  const c = useProtocolClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => c.signOut(),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

// ------------------------------------------------------------ clock

const subscribers = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;
let nowValue = 0;

function subscribeNow(cb: () => void) {
  subscribers.add(cb);
  if (!ticker) {
    nowValue = Date.now();
    ticker = setInterval(() => {
      nowValue = Date.now();
      subscribers.forEach((f) => f());
    }, 1_000);
  }
  return () => {
    subscribers.delete(cb);
    if (!subscribers.size && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

/**
 * Shared 1-second clock for countdowns. Only components that call this re-render each second.
 * Returns 0 during server rendering, so callers should render a placeholder until it's non-zero.
 */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    // Stable within a second when the ticker isn't running yet (React requires a cached snapshot).
    () => (ticker ? nowValue : Math.floor(Date.now() / 1000) * 1000),
    () => 0
  );
}
