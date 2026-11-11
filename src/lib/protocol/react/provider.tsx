"use client";

import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { OrbLink } from "@/components/common/orb-link";
import { PLAYERS_BY_ID } from "@score/core";
import { PRIVY_APP_ID } from "@/lib/auth/privy-config";
import { ApiProtocolClient } from "../api/client";
import { MockProtocolClient } from "../mock/client";
import type { AuthClient, MatchEventView, Portfolio, ProtocolClient, ProtocolEvent } from "../types";
import { momentToast } from "@/components/live/moment-toast";
import { formatUsd } from "@/lib/format";
import { qk } from "./keys";
import { useUi } from "./ui-store";

/** What every screen talks to: the in-browser mock, or the real devnet backend. */
export type AppClient = ProtocolClient &
  AuthClient & {
    readonly mode: "mock" | "devnet";
    start(): void;
    stop(): void;
  };

const ClientContext = createContext<AppClient | null>(null);

export function useProtocolClient(): AppClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("useProtocolClient must be used inside <ProtocolProvider>");
  return c;
}

/** The mock's demo controls, or null on the real backend (demo settings, lab, "+30 days"). */
export function useMockClient(): MockProtocolClient | null {
  const c = useProtocolClient();
  return c instanceof MockProtocolClient ? c : null;
}

/** The real backend client, or null on the mock. */
export function useApiClient(): ApiProtocolClient | null {
  const c = useProtocolClient();
  return c instanceof ApiProtocolClient ? c : null;
}

/** NEXT_PUBLIC_SCORE_NODE + NEXT_PUBLIC_SCORE_ORACLE set: the real devnet backend. Otherwise the mock. */
function createClient(): AppClient {
  const node = process.env.NEXT_PUBLIC_SCORE_NODE;
  const oracle = process.env.NEXT_PUBLIC_SCORE_ORACLE;
  if (node && oracle) {
    const burner = !PRIVY_APP_ID || process.env.NEXT_PUBLIC_DEV_BURNER === "1";
    return new ApiProtocolClient({ node, oracle, burner });
  }
  return new MockProtocolClient();
}

const FLUSH_MS = 350;

/** Match events big enough to interrupt you about, when they happen to a player you hold. */
const MOMENTS: Partial<Record<MatchEventView["code"], { title: string; tone: "up" | "down" }>> = {
  goal: { title: "Goal", tone: "up" },
  assist: { title: "Assist", tone: "up" },
  penaltySaved: { title: "Penalty saved", tone: "up" },
  penaltyMissed: { title: "Penalty missed", tone: "down" },
  ownGoal: { title: "Own goal", tone: "down" },
};

function surname(name: string | null): string {
  return name ? name.split(" ").slice(-1)[0]! : "";
}

/** Which cached reads each protocol event makes stale. Only those refetch; the page never re-renders wholesale. */
function keysFor(e: ProtocolEvent): QueryKey[] {
  switch (e.type) {
    case "market":
      return [qk.players(), qk.stats(), qk.portfolio(), qk.valueAll(), qk.round(), ...e.playerIds.flatMap((id) => [qk.player(id), qk.historyAll(id), qk.trades(id)])];
    case "trade":
      return [qk.players(), qk.stats(), qk.player(e.trade.playerId), qk.historyAll(e.trade.playerId), qk.trades(e.trade.playerId), qk.trades(null), qk.valueAll()];
    case "match":
      return [qk.round(), qk.players()];
    case "clock":
      return [qk.round()];
    case "order-filled":
      return [qk.portfolio(), qk.player(e.order.playerId), qk.players()];
    case "snapshot":
      return [qk.round(), qk.portfolio(), qk.playersAll()];
    case "bonded":
    case "launched":
      return [qk.players(), qk.stats(), qk.round(), qk.playersAll()];
    case "user":
      return [qk.portfolio(), qk.valueAll(), qk.playersAll(), qk.round(), qk.session()];
    case "funds":
      return [qk.portfolio(), qk.funds(), qk.valueAll()];
    case "connection":
      return e.online ? [[]] : [];
    case "phase":
    case "settled":
    case "session":
    case "reset":
      return [[]]; // everything
  }
}

export function ProtocolProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createClient);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 },
          mutations: { retry: false },
        },
      })
  );

  useEffect(() => {
    void useUi.persist.rehydrate();
    client.start();
    const pending: QueryKey[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const keys = pending.splice(0);
      if (keys.some((k) => k.length === 0)) {
        void queryClient.invalidateQueries();
        return;
      }
      const seen = new Set<string>();
      for (const k of keys) {
        const h = JSON.stringify(k);
        if (seen.has(h)) continue;
        seen.add(h);
        void queryClient.invalidateQueries({ queryKey: k });
      }
    };
    const unsub = client.subscribe((e) => {
      pending.push(...keysFor(e));
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
      const ui = useUi.getState();
      if (e.type === "snapshot") {
        toast("Kickoff: dividend snapshot taken", {
          description: e.myTokens > 0 ? "Your holdings are counted for this round. Trading stays open." : "Trading stays open.",
        });
      } else if (e.type === "bonded") {
        const name = PLAYERS_BY_ID[e.playerId]?.name ?? e.playerId;
        if (e.mine) ui.showBonded({ playerId: e.playerId, split: e.split });
        else toast(`${name} bonded`, { description: "The trading pool is open." });
      } else if (e.type === "settled") {
        // Open the full-time moment once the portfolio has the new claim, so it never flashes "nothing to claim".
        if (e.myDividends > 0.005) void queryClient.refetchQueries({ queryKey: qk.portfolio() }).finally(() => ui.showFullTime({ round: e.round, amount: e.myDividends }));
        else toast(`Full time · round ${e.round} settled`, { description: `Round pool paid ${formatUsd(e.pool)}.` });
      } else if (e.type === "match") {
        const held = new Set((queryClient.getQueryData<Portfolio | null>(qk.portfolio())?.positions ?? []).filter((p) => p.tokens > 0).map((p) => p.playerId));
        // Two at most per batch: a flurry of toasts is noise, and the live feed has the rest.
        const mine = e.events.filter((m) => m.ranked && m.playerId && held.has(m.playerId) && MOMENTS[m.code]).slice(0, 2);
        for (const m of mine) {
          const k = MOMENTS[m.code]!;
          momentToast({
            playerId: m.playerId!,
            title: `${k.title} · ${surname(m.name)} ${m.minute}'`,
            body: `Your $${m.ticker} ${m.points >= 0 ? "earns" : "loses"} points on the board`,
            figure: `${m.points >= 0 ? "+" : "−"}${Math.abs(m.points).toFixed(1)}`,
            tone: k.tone,
            href: "/matchday",
          });
        }
      } else if (e.type === "order-filled") {
        momentToast({ playerId: e.order.playerId, title: "Limit order filled", body: e.summary, tone: "ink", href: `/trade/${e.order.playerId}` });
      } else if (e.type === "funds") {
        if (e.stage === "pending") toast.loading(e.message, { id: "funds" });
        else if (e.stage === "done") toast.success(e.message, { id: "funds", ...(e.signature ? { description: <OrbLink signature={e.signature} />, duration: 8_000 } : {}) });
        else toast.error(e.title ?? "Test USDC didn't arrive", { id: "funds", description: e.message });
      } else if (e.type === "launched") {
        const names = e.playerIds.map((id) => PLAYERS_BY_ID[id]?.name ?? id).join(" and ");
        toast(`Now launching: ${names}`);
      }
    });
    const onHide = () => {
      if (document.visibilityState === "hidden") client.stop();
      else client.start();
    };
    const onPageHide = () => client.stop();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      if (timer) clearTimeout(timer);
      client.stop();
    };
  }, [client, queryClient]);

  return (
    <ClientContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ClientContext.Provider>
  );
}
