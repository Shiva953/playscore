"use client";

import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PLAYERS_BY_ID } from "@score/core";
import { MockProtocolClient } from "../mock/client";
import type { ProtocolEvent } from "../types";
import { formatUsd } from "@/lib/format";
import { qk } from "./keys";
import { useUi } from "./ui-store";

const ClientContext = createContext<MockProtocolClient | null>(null);

export function useProtocolClient(): MockProtocolClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("useProtocolClient must be used inside <ProtocolProvider>");
  return c;
}

const FLUSH_MS = 350;

/** Which cached reads each protocol event makes stale. Only those refetch; the page never re-renders wholesale. */
function keysFor(e: ProtocolEvent): QueryKey[] {
  switch (e.type) {
    case "market":
      return [qk.players(), qk.stats(), qk.portfolio(), qk.round(), ...e.playerIds.flatMap((id) => [qk.player(id), qk.historyAll(id), qk.trades(id)])];
    case "trade":
      return [qk.players(), qk.stats(), qk.player(e.trade.playerId), qk.historyAll(e.trade.playerId), qk.trades(e.trade.playerId), qk.trades(null)];
    case "match":
      return [qk.round(), qk.players()];
    case "snapshot":
      return [qk.round(), qk.portfolio(), qk.playersAll()];
    case "bonded":
    case "launched":
      return [qk.players(), qk.stats(), qk.round(), qk.playersAll()];
    case "user":
      return [qk.portfolio(), qk.playersAll(), qk.round(), qk.session()];
    case "phase":
    case "settled":
    case "session":
    case "reset":
      return [[]]; // everything
  }
}

export function ProtocolProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new MockProtocolClient());
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
        if (e.myDividends > 0.005) ui.showFullTime({ round: e.round, amount: e.myDividends });
        else toast(`Full time · round ${e.round} settled`, { description: `Round pool paid ${formatUsd(e.pool)}.` });
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
