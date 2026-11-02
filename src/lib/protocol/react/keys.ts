import type { PlayerFilter, PriceRange } from "../types";

/** Query keys. Prefix keys (e.g. `players()`) invalidate every variant below them. */
export const qk = {
  config: () => ["config"] as const,
  session: () => ["session"] as const,
  players: (filter?: PlayerFilter) => (filter ? (["players", filter] as const) : (["players"] as const)),
  playersAll: () => ["player"] as const,
  player: (id: string) => ["player", id] as const,
  historyAll: (id: string) => ["history", id] as const,
  history: (id: string, range: PriceRange) => ["history", id, range] as const,
  trades: (id: string | null, limit?: number) => (limit ? (["trades", id, limit] as const) : (["trades", id] as const)),
  round: () => ["round"] as const,
  rounds: (limit?: number) => (limit ? (["rounds", limit] as const) : (["rounds"] as const)),
  portfolio: () => ["portfolio"] as const,
  stats: () => ["stats"] as const,
};
