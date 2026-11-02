import { LEAGUE_NAMES, type LeagueCode, type PositionCode } from "../config";

/** The prototype's 30 players, verbatim (`P`). Identity is typographic only: no photos, crests or logos. */
export interface PlayerProfile {
  id: string;
  /** Index in the prototype list: drives seed randomness and launch order. */
  index: number;
  name: string;
  age: number;
  club: string;
  country: string;
  league: LeagueCode;
  position: PositionCode;
  /** Average display score (form rating). */
  avgScore: number;
  ticker: string;
  /** Club is in this season's Champions League. */
  inUcl: boolean;
}

/** Prototype `CLUBS_CL`. */
export const UCL_CLUBS = [
  "Bayern Munich",
  "FC Barcelona",
  "Real Madrid",
  "Manchester City",
  "Paris Saint-Germain",
  "Arsenal",
  "Inter",
] as const;

type Row = [string, string, number, string, string, LeagueCode, PositionCode, number, string];

const ROWS: Row[] = [
  ["kane", "Harry Kane", 33, "Bayern Munich", "England", "BUN", "FWD", 9.1, "KANE"],
  ["yamal", "Lamine Yamal", 19, "FC Barcelona", "Spain", "LAL", "FWD", 8.8, "YAMAL"],
  ["mbappe", "Kylian Mbappé", 27, "Real Madrid", "France", "LAL", "FWD", 8.6, "MBAPPE"],
  ["rodri", "Rodri", 30, "Manchester City", "Spain", "PL", "MID", 8.2, "RODRI"],
  ["messi", "Lionel Messi", 39, "Inter Miami", "Argentina", "MLS", "FWD", 7.9, "MESSI"],
  ["dembele", "Ousmane Dembélé", 29, "Paris Saint-Germain", "France", "L1", "FWD", 8.0, "DEMBELE"],
  ["bellingham", "Jude Bellingham", 23, "Real Madrid", "England", "LAL", "MID", 7.9, "JUDE"],
  ["haaland", "Erling Haaland", 26, "Manchester City", "Norway", "PL", "FWD", 8.4, "HAALAND"],
  ["olise", "Michael Olise", 24, "Bayern Munich", "France", "BUN", "FWD", 7.8, "OLISE"],
  ["cubarsi", "Pau Cubarsí", 19, "FC Barcelona", "Spain", "LAL", "DEF", 7.5, "CUBARSI"],
  ["vinicius", "Vinícius Júnior", 26, "Real Madrid", "Brazil", "LAL", "FWD", 7.9, "VINI"],
  ["kvara", "Khvicha Kvaratskhelia", 25, "Paris Saint-Germain", "Georgia", "L1", "FWD", 7.7, "KVARA"],
  ["vitinha", "Vitinha", 26, "Paris Saint-Germain", "Portugal", "L1", "MID", 7.8, "VITINHA"],
  ["hakimi", "Achraf Hakimi", 28, "Paris Saint-Germain", "Morocco", "L1", "DEF", 7.4, "HAKIMI"],
  ["mendes", "Nuno Mendes", 24, "Paris Saint-Germain", "Portugal", "L1", "DEF", 7.3, "MENDES"],
  ["neves", "João Neves", 22, "Paris Saint-Germain", "Portugal", "L1", "MID", 7.4, "NEVES"],
  ["pacho", "Willian Pacho", 25, "Paris Saint-Germain", "Ecuador", "L1", "DEF", 7.1, "PACHO"],
  ["marquinhos", "Marquinhos", 32, "Paris Saint-Germain", "Brazil", "L1", "DEF", 7.0, "MARQ"],
  ["fabian", "Fabián Ruiz", 30, "Paris Saint-Germain", "Spain", "L1", "MID", 7.5, "FABIAN"],
  ["torres", "Ferran Torres", 26, "Paris Saint-Germain", "Spain", "L1", "FWD", 7.2, "TORRES"],
  ["saliba", "William Saliba", 25, "Arsenal", "France", "PL", "DEF", 7.6, "SALIBA"],
  ["upamecano", "Dayot Upamecano", 27, "Bayern Munich", "France", "BUN", "DEF", 7.0, "UPA"],
  ["gabriel", "Gabriel", 28, "Arsenal", "Brazil", "PL", "DEF", 7.3, "GABRIEL"],
  ["rice", "Declan Rice", 27, "Arsenal", "England", "PL", "MID", 7.6, "RICE"],
  ["bruno", "Bruno Fernandes", 32, "Manchester United", "Portugal", "PL", "MID", 7.5, "BRUNO"],
  ["diaz", "Luis Díaz", 29, "Bayern Munich", "Colombia", "BUN", "FWD", 7.4, "LUISD"],
  ["lautaro", "Lautaro Martínez", 29, "Inter", "Argentina", "SA", "FWD", 7.5, "LAUTARO"],
  ["cucurella", "Marc Cucurella", 28, "Real Madrid", "Spain", "LAL", "DEF", 6.9, "CUCU"],
  ["mane", "Sadio Mané", 34, "Al-Nassr", "Senegal", "SPL", "FWD", 6.8, "MANE"],
  ["quinones", "Julián Quiñones", 29, "Al-Qadsiah", "Mexico", "SPL", "FWD", 6.7, "QUINONES"],
];

export const PLAYERS: readonly PlayerProfile[] = ROWS.map((r, index) => ({
  id: r[0],
  index,
  name: r[1],
  age: r[2],
  club: r[3],
  country: r[4],
  league: r[5],
  position: r[6],
  avgScore: r[7],
  ticker: r[8],
  inUcl: (UCL_CLUBS as readonly string[]).includes(r[3]),
}));

export const PLAYERS_BY_ID: Readonly<Record<string, PlayerProfile>> = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));

/** Competitions a player can score in (prototype `comps`). */
export function competitionsFor(p: PlayerProfile): string[] {
  return [LEAGUE_NAMES[p.league], p.inUcl ? "Champions League" : null, `${p.country} internationals`].filter(
    Boolean
  ) as string[];
}
