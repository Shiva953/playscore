"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { OrbLink } from "@/components/common/orb-link";
import { errorMessage, isProtocolError } from "../errors";
import type { ClaimMode, PlayerFilter, PriceRange, RoundState, SignInInput, ValueRange } from "../types";
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

export function usePlayer(id: string, opts: { keepPrevious?: boolean } = {}) {
  const c = useProtocolClient();
  return useQuery({
    queryKey: qk.player(id),
    queryFn: () => c.getPlayer(id),
    retry: (n, e) => !(isProtocolError(e) && e.code === "NOT_FOUND") && n < 1,
    // The terminal switches players in place: keep the last one on screen until the next has loaded.
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  });
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

/** Your portfolio's value and P&L over a window (the portfolio chart). */
export function useValueHistory(range: ValueRange) {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.value(range), queryFn: () => c.getValueHistory(range), placeholderData: (prev) => prev });
}

export function useStats() {
  const c = useProtocolClient();
  return useQuery({ queryKey: qk.stats(), queryFn: () => c.getProtocolStats() });
}

// ------------------------------------------------------------ quotes
// The mock answers synchronously (recomputed when the player's data refreshes). The backend asks
// the engine, so the quote is async: the last quote stays on screen while the next one loads.

function useQuote<T>(key: readonly unknown[], enabled: boolean, run: () => T | Promise<T>, inputs: string): T | null {
  const c = useProtocolClient();
  const sync = c.mode === "mock";
  // `inputs` names everything `run` reads (player, amount, data versions); `run` itself is a fresh closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => (sync && enabled ? (run() as T) : null), [sync, enabled, inputs]);
  const q = useQuery({
    queryKey: ["quote", ...key, inputs],
    queryFn: () => Promise.resolve(run()),
    enabled: !sync && enabled,
    placeholderData: keepPreviousData,
    staleTime: 2_000,
    gcTime: 15_000,
    retry: 0,
  });
  if (!enabled) return null;
  return sync ? now : (q.data ?? null);
}

export function useBuyQuote(id: string, usdc: number) {
  const c = useProtocolClient();
  const { dataUpdatedAt } = usePlayer(id);
  const portfolio = usePortfolio();
  return useQuote(["buy", id], usdc > 0, () => c.quoteBuy(id, usdc), `${id}:${usdc}:${dataUpdatedAt}:${portfolio.dataUpdatedAt}`);
}

export function useSellQuote(id: string, input: { usdc: number } | { tokens: number } | null) {
  const c = useProtocolClient();
  const { dataUpdatedAt } = usePlayer(id);
  const portfolio = usePortfolio();
  const key = input ? ("usdc" in input ? `u${input.usdc}` : `t${input.tokens}`) : "";
  const enabled = !!input && ("usdc" in input ? input.usdc > 0 : input.tokens > 0);
  return useQuote(["sell", id], enabled, () => c.quoteSell(id, input!), `${id}:${key}:${dataUpdatedAt}:${portfolio.dataUpdatedAt}`);
}

export function useLiquidityQuote(id: string, usdc: number, mode: "pair" | "zap") {
  const c = useProtocolClient();
  const { dataUpdatedAt } = usePlayer(id);
  return useQuote(["lp", id], usdc > 0, () => c.quoteLiquidity(id, usdc, mode), `${id}:${usdc}:${mode}:${dataUpdatedAt}`);
}

/** Wallet and trading balances (devnet backend only). */
export function useFunds() {
  const c = useProtocolClient();
  const session = useSession();
  return useQuery({ queryKey: qk.funds(), queryFn: () => c.funds!.getFunds(), enabled: !!c.funds && !!session.data, refetchInterval: 15_000 });
}

/**
 * Cash, the one balance the user sees: what's ready to trade. USDC that lands in their wallet (the
 * deposit address) is moved in automatically (see AutoAddDeposits); until it lands it's `arriving`,
 * shown beside the figure, never added to it. The two numbers come from different queries that
 * refresh at different moments, so summing them would count a deposit twice for a second.
 * `available` (for withdrawals, which draw on both) comes from one snapshot, so it's consistent.
 */
export function useCash() {
  const pf = usePortfolio();
  const funds = useFunds();
  const c = useProtocolClient();
  const total = pf.data?.usdc ?? 0;
  const arriving = c.funds ? (funds.data?.wallet ?? 0) : 0;
  const available = funds.data ? funds.data.app + funds.data.wallet : total;
  return { total, trading: total, arriving, available, inOrders: funds.data?.inOrders ?? 0, loading: pf.isPending || (!!c.funds && funds.isPending), ready: !!pf.data };
}

/** Withdraw from cash to another Solana address (wallet first, then trading). */
export function useWithdraw() {
  const c = useProtocolClient();
  return useAction((v: { to: string; amount: number }) => c.funds!.withdraw(v.to, v.amount));
}

/** Transfer: wallet → trading balance. */
export function useToTrading({ silent = false }: { silent?: boolean } = {}) {
  const c = useProtocolClient();
  return useAction((amount: number) => c.funds!.toTrading(amount), { success: (r) => (silent ? null : r.summary) });
}

/** Transfer: trading balance → wallet. */
export function useToWallet() {
  const c = useProtocolClient();
  return useAction((amount: number) => c.funds!.toWallet(amount), {
    success: (r) => (r.mode === "request" ? `${r.summary.replace("moved to", "on its way to")}: large transfers are paid after the next batch, a few seconds` : r.summary),
  });
}

/** Withdraw: wallet → another Solana address. */
export function useSend() {
  const c = useProtocolClient();
  return useAction((v: { to: string; amount: number }) => c.funds!.send(v.to, v.amount));
}

// ------------------------------------------------------------ actions

function useAction<V, R extends { summary: string; signature?: string } = { summary: string; signature?: string }>(fn: (v: V) => Promise<R>, opts: { success?: (r: R, v: V) => string | null } = {}) {
  const qc = useQueryClient();
  const openSignIn = useUi((s) => s.openSignIn);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      const msg = opts.success ? opts.success(r, v) : r.summary;
      // On-chain actions carry their signature: the toast links to it on Orb.
      if (msg) toast.success(msg, r.signature ? { description: createElement(OrbLink, { signature: r.signature }), duration: 8_000 } : undefined);
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

/** `silent`: the caller shows its own result (the ticket's receipt), so no success toast. Errors still toast. */
export function useBuy({ silent = false }: { silent?: boolean } = {}) {
  const c = useProtocolClient();
  return useAction((v: { id: string; usdc: number }) => c.buy(v.id, v.usdc), silent ? { success: () => null } : {});
}

export function useSell({ silent = false }: { silent?: boolean } = {}) {
  const c = useProtocolClient();
  return useAction((v: { id: string; input: { usdc: number } | { tokens: number } }) => c.sell(v.id, v.input), silent ? { success: () => null } : {});
}

export function usePlaceLimit() {
  const c = useProtocolClient();
  return useAction((v: { id: string; side: "buy" | "sell"; amount: number; price: number }) => c.placeLimit(v.id, v.side, v.amount, v.price));
}

export function useCancelOrder() {
  const c = useProtocolClient();
  return useAction((orderId: string) => c.cancelOrder(orderId));
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
  // The backend client shows its own progress toasts (mint → deposit → ready).
  return useAction((amount: number) => c.faucet(amount), c.mode === "devnet" ? { success: () => null } : {});
}

export function useSignIn() {
  const c = useProtocolClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SignInInput) => c.signIn(v),
    onSuccess: (_s, v) => {
      if (c.mode === "devnet") toast.success("Signed in on devnet");
      else
        toast.success(v.method === "demo" ? "Demo account ready" : "Signed in on devnet", {
          description: v.method === "demo" ? "A few players bought from 1,000 test USDC." : "1,000 test USDC added to your balance.",
        });
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
