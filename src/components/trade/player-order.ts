"use client";

import { useMemo } from "react";
import type { LeagueCode, PositionCode } from "@score/core";
import type { PlayerSummary } from "@/lib/protocol/types";
import { usePlayers } from "@/lib/protocol/react/hooks";

export type PositionFilter = "ALL" | PositionCode;
export type LeagueFilter = "ALL" | LeagueCode;
/** "default" is the shared order (volume, then launch progress), which ↑/↓ and previous/next follow. */
export type PlayerSort = "default" | "change" | "price" | "mcap" | "form";

export const SORT_LABEL: Record<PlayerSort, string> = { default: "Volume", change: "24h change", price: "Price", mcap: "Market cap", form: "Form" };

/**
 * The one player order the terminal list, its ↑/↓ keys and the player page's previous/next all share:
 * trading players by 24h volume, then launches by progress to bonding. Scheduled players aren't tradable.
 */
export function orderPlayers(list: PlayerSummary[]): PlayerSummary[] {
  const trading = list.filter((p) => p.status === "trading").sort((a, b) => b.volume24h - a.volume24h);
  const launching = list.filter((p) => p.status === "launching").sort((a, b) => b.bondProgress - a.bondProgress);
  return [...trading, ...launching];
}

export function filterPlayers(list: PlayerSummary[], query: string, position: PositionFilter, league: LeagueFilter = "ALL"): PlayerSummary[] {
  const q = query.trim().toLowerCase();
  return list.filter(
    (p) =>
      (position === "ALL" || p.position === position) &&
      (league === "ALL" || p.league === league) &&
      (!q || p.name.toLowerCase().includes(q) || p.ticker.toLowerCase().includes(q) || p.club.toLowerCase().includes(q))
  );
}

/** Re-sorts an already ordered list, highest first; ties keep the shared order (the sort is stable). */
export function sortPlayers(list: PlayerSummary[], sort: PlayerSort): PlayerSummary[] {
  if (sort === "default") return list;
  const key: Record<Exclude<PlayerSort, "default">, (p: PlayerSummary) => number> = {
    change: (p) => (p.status === "trading" ? p.change24h : -Infinity),
    price: (p) => p.price,
    mcap: (p) => p.marketCap,
    form: (p) => p.avgScore,
  };
  const k = key[sort];
  return [...list].sort((a, b) => k(b) - k(a));
}

/** Previous and next player ids around `id` in a list (wrapping at the ends). */
export function neighbours(list: { id: string }[], id: string): { prev: string | null; next: string | null } {
  const i = list.findIndex((p) => p.id === id);
  if (list.length < 2) return { prev: null, next: null };
  if (i < 0) return { prev: list[list.length - 1]!.id, next: list[0]!.id };
  return { prev: list[(i - 1 + list.length) % list.length]!.id, next: list[(i + 1) % list.length]!.id };
}

/** The shared order, ready to use (for the player page's previous/next). */
export function usePlayerOrder() {
  const q = usePlayers();
  return useMemo(() => orderPlayers(q.data ?? []), [q.data]);
}
