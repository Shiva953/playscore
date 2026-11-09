import { LEAGUE_NAMES, type LeagueCode, type PositionCode } from "../config";

import { REGISTRY } from "./registry";

/** The client's listing (scripts/import-players.py). The UI draws each player as their club kit and number (src/lib/identity); no photos or crests. */
export interface PlayerProfile {
  id: string;
  /** Launch order (0 = first): drives seed randomness and the launch schedule. */
  index: number;
  name: string;
  age: number;
  club: string;
  country: string;
  league: LeagueCode;
  position: PositionCode;
  /** Average display score (form rating). Seeded from listing order until real rounds replace it. */
  avgScore: number;
  ticker: string;
  /** Club is in this season's Champions League. */
  inUcl: boolean;
  /** Position on the client's ICO sheet (null: only on a position sheet). */
  ico: number | null;
}

/**
 * Champions League clubs. SPEC-QUESTION: the 2026/27 field isn't drawn yet; this is the 2025/26 league
 * phase limited to clubs on the list, used as a provisional stand-in.
 */
export const UCL_CLUBS = [
  "Real Madrid",
  "FC Barcelona",
  "Bayern Munich",
  "Manchester City",
  "Paris Saint-Germain",
  "Arsenal",
  "Inter",
  "Liverpool",
  "Chelsea",
  "Borussia Dortmund",
  "Atletico Madrid",
  "Bayer Leverkusen",
  "SSC Napoli",
  "Juventus",
  "Benfica",
  "Sporting CP",
  "PSV Eindhoven",
  "Club Brugge",
  "Newcastle United",
  "Tottenham Hotspur",
  "AS Monaco",
  "Atalanta",
  "Eintracht Frankfurt",
  "Villarreal",
  "Olympique de Marseille",
  "AFC Ajax",
  "Royale Union Saint-Gilloise",
  "Athletic Bilbao",
] as const;

/** Deterministic 0..1 from a string (FNV-1a), so seeded form ratings never change between builds. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Seed form: earlier listings are the stars (8.8 down to ~6.6), with a little per-player spread. */
function seedForm(index: number, total: number, id: string): number {
  const v = 8.8 - 2.1 * (index / Math.max(1, total - 1)) + (hash01(id) - 0.5) * 0.5;
  return Math.round(Math.min(9.1, Math.max(6.3, v)) * 10) / 10;
}

export const PLAYERS: readonly PlayerProfile[] = REGISTRY.map((r, index) => ({
  id: r[0],
  index,
  name: r[1],
  age: r[2],
  club: r[3],
  country: r[4],
  league: r[5],
  position: r[6],
  avgScore: seedForm(index, REGISTRY.length, r[0]),
  ticker: r[7],
  inUcl: (UCL_CLUBS as readonly string[]).includes(r[3]),
  ico: r[8],
}));

export const PLAYERS_BY_ID: Readonly<Record<string, PlayerProfile>> = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));

/** Competitions a player can score in (prototype `comps`). */
export function competitionsFor(p: PlayerProfile): string[] {
  return [LEAGUE_NAMES[p.league], p.inUcl ? "Champions League" : null, `${p.country} internationals`].filter(
    Boolean
  ) as string[];
}
