import { PLAYERS_BY_ID, SHIRT_NUMBERS } from "@score/core";

/**
 * Club identity drawn in code: each club's kit colours and pattern, never its crest or a photo.
 * Colours are the clubs' public kit colours; the shapes are ours. Swap in licensed crests later by
 * adding a `crest` URL here and reading it in <ClubMark>.
 */
export type KitPattern = "solid" | "stripes" | "band" | "sleeves" | "hoops";

export interface ClubIdentity {
  /** Three-letter code shown where a club needs naming in a tight space. */
  code: string;
  pattern: KitPattern;
  /** Body colour. */
  base: string;
  /** Stripes, band, sleeves or hoops. */
  second: string;
  /** Collar and cuffs. */
  trim: string;
  /** Shirt number colour, chosen for contrast on the body. */
  number: string;
}

const CLUBS: Record<string, ClubIdentity> = {
  "1. FC Union Berlin": { code: "FCU", pattern: "solid", base: "#d4011d", second: "#d4011d", trim: "#ffffff", number: "#ffffff" },
  "AC Milan": { code: "MIL", pattern: "stripes", base: "#111111", second: "#fb090b", trim: "#ffffff", number: "#ffffff" },
  "AFC Ajax": { code: "AJA", pattern: "band", base: "#ffffff", second: "#d2122e", trim: "#d2122e", number: "#111111" },
  "AS Monaco": { code: "ASM", pattern: "sleeves", base: "#e51b22", second: "#ffffff", trim: "#ffffff", number: "#ffffff" },
  "AS Roma": { code: "ROM", pattern: "solid", base: "#8e1f2f", second: "#8e1f2f", trim: "#f0bc42", number: "#f0bc42" },
  "Arsenal": { code: "ARS", pattern: "sleeves", base: "#e5001c", second: "#ffffff", trim: "#ffffff", number: "#ffffff" },
  "Aston Villa": { code: "AVL", pattern: "sleeves", base: "#670e36", second: "#95bfe5", trim: "#95bfe5", number: "#ffffff" },
  "Atalanta": { code: "ATA", pattern: "stripes", base: "#1e71b8", second: "#111111", trim: "#ffffff", number: "#ffffff" },
  "Athletic Bilbao": { code: "ATH", pattern: "stripes", base: "#ee2523", second: "#ffffff", trim: "#111111", number: "#111111" },
  "Atletico Madrid": { code: "ATM", pattern: "stripes", base: "#cb3524", second: "#ffffff", trim: "#272e61", number: "#272e61" },
  "Bayer Leverkusen": { code: "B04", pattern: "solid", base: "#111111", second: "#111111", trim: "#e32221", number: "#ffffff" },
  "Bayern Munich": { code: "BAY", pattern: "solid", base: "#dc052d", second: "#dc052d", trim: "#ffffff", number: "#ffffff" },
  "Benfica": { code: "SLB", pattern: "solid", base: "#e83030", second: "#e83030", trim: "#ffffff", number: "#ffffff" },
  "Borussia Dortmund": { code: "BVB", pattern: "solid", base: "#fde100", second: "#fde100", trim: "#111111", number: "#111111" },
  "Borussia M'gladbach": { code: "BMG", pattern: "band", base: "#ffffff", second: "#111111", trim: "#1a9b4a", number: "#111111" },
  "Bournemouth": { code: "BOU", pattern: "stripes", base: "#da291c", second: "#111111", trim: "#111111", number: "#ffffff" },
  "Brentford": { code: "BRE", pattern: "stripes", base: "#e30613", second: "#ffffff", trim: "#111111", number: "#111111" },
  "Brighton & Hove Albion": { code: "BHA", pattern: "stripes", base: "#0057b8", second: "#ffffff", trim: "#ffffff", number: "#ffffff" },
  "Celta Vigo": { code: "CEL", pattern: "solid", base: "#8ac3ee", second: "#8ac3ee", trim: "#e5254e", number: "#ffffff" },
  "Chelsea": { code: "CHE", pattern: "solid", base: "#034694", second: "#034694", trim: "#ffffff", number: "#ffffff" },
  "Club Brugge": { code: "CLU", pattern: "stripes", base: "#0066b3", second: "#111111", trim: "#ffffff", number: "#ffffff" },
  "Como": { code: "COM", pattern: "solid", base: "#1b3b6f", second: "#1b3b6f", trim: "#ffffff", number: "#ffffff" },
  "Crystal Palace": { code: "CRY", pattern: "stripes", base: "#1b458f", second: "#c4122e", trim: "#ffffff", number: "#ffffff" },
  "Eintracht Frankfurt": { code: "SGE", pattern: "solid", base: "#111111", second: "#111111", trim: "#e1000f", number: "#ffffff" },
  "Everton": { code: "EVE", pattern: "solid", base: "#003399", second: "#003399", trim: "#ffffff", number: "#ffffff" },
  "FC Augsburg": { code: "FCA", pattern: "band", base: "#ffffff", second: "#ba3733", trim: "#46714d", number: "#ba3733" },
  "FC Barcelona": { code: "BAR", pattern: "stripes", base: "#a50044", second: "#1a4fa0", trim: "#edbb00", number: "#ffffff" },
  "FC Koln": { code: "KOE", pattern: "solid", base: "#ffffff", second: "#ffffff", trim: "#ed1c24", number: "#ed1c24" },
  "FC Porto": { code: "POR", pattern: "stripes", base: "#00428c", second: "#ffffff", trim: "#ffffff", number: "#ffffff" },
  "FC Twente": { code: "TWE", pattern: "solid", base: "#e30613", second: "#e30613", trim: "#ffffff", number: "#ffffff" },
  "Feyenoord": { code: "FEY", pattern: "sleeves", base: "#e2001a", second: "#ffffff", trim: "#111111", number: "#111111" },
  "Fulham": { code: "FUL", pattern: "solid", base: "#ffffff", second: "#ffffff", trim: "#111111", number: "#111111" },
  "Inter": { code: "INT", pattern: "stripes", base: "#111111", second: "#0068a8", trim: "#d4a514", number: "#ffffff" },
  "Ipswich Town": { code: "IPS", pattern: "solid", base: "#0044a9", second: "#0044a9", trim: "#ffffff", number: "#ffffff" },
  "Juventus": { code: "JUV", pattern: "stripes", base: "#ffffff", second: "#111111", trim: "#111111", number: "#111111" },
  "LOSC Lille": { code: "LIL", pattern: "solid", base: "#e01e13", second: "#e01e13", trim: "#20325f", number: "#ffffff" },
  "Lazio": { code: "LAZ", pattern: "solid", base: "#87d8f7", second: "#87d8f7", trim: "#ffffff", number: "#13294b" },
  "Lecce": { code: "LEC", pattern: "stripes", base: "#ffd700", second: "#e30613", trim: "#e30613", number: "#111111" },
  "Leeds United": { code: "LEE", pattern: "solid", base: "#ffffff", second: "#ffffff", trim: "#1d428a", number: "#1d428a" },
  "Liverpool": { code: "LIV", pattern: "solid", base: "#c8102e", second: "#c8102e", trim: "#00b2a9", number: "#ffffff" },
  "Manchester City": { code: "MCI", pattern: "solid", base: "#6cabdd", second: "#6cabdd", trim: "#1c2c5b", number: "#ffffff" },
  "Manchester United": { code: "MUN", pattern: "solid", base: "#da291c", second: "#da291c", trim: "#111111", number: "#ffffff" },
  "NEC Nijmegen": { code: "NEC", pattern: "stripes", base: "#d4011d", second: "#1f6b38", trim: "#111111", number: "#ffffff" },
  "Newcastle United": { code: "NEW", pattern: "stripes", base: "#111111", second: "#ffffff", trim: "#ffffff", number: "#ffffff" },
  "Nottingham Forest": { code: "NFO", pattern: "solid", base: "#dd0000", second: "#dd0000", trim: "#ffffff", number: "#ffffff" },
  "Olympique Lyonnais": { code: "OL", pattern: "band", base: "#ffffff", second: "#1a3f8e", trim: "#da0812", number: "#1a3f8e" },
  "Olympique de Marseille": { code: "OM", pattern: "solid", base: "#ffffff", second: "#ffffff", trim: "#2faee0", number: "#2faee0" },
  "PSV Eindhoven": { code: "PSV", pattern: "stripes", base: "#ed1c24", second: "#ffffff", trim: "#111111", number: "#ffffff" },
  "Paris Saint-Germain": { code: "PSG", pattern: "band", base: "#0b2a5b", second: "#d8232a", trim: "#ffffff", number: "#ffffff" },
  "RB Leipzig": { code: "RBL", pattern: "solid", base: "#ffffff", second: "#ffffff", trim: "#dd0741", number: "#0c2043" },
  "RC Lens": { code: "RCL", pattern: "stripes", base: "#fee600", second: "#e2001a", trim: "#e2001a", number: "#111111" },
  "RC Strasbourg": { code: "RCS", pattern: "solid", base: "#009fe3", second: "#009fe3", trim: "#ffffff", number: "#ffffff" },
  "Real Betis": { code: "BET", pattern: "stripes", base: "#0bb363", second: "#ffffff", trim: "#ffffff", number: "#ffffff" },
  "Real Madrid": { code: "RMA", pattern: "solid", base: "#f4f4f4", second: "#f4f4f4", trim: "#d4a514", number: "#1b1f4a" },
  "Real Sociedad": { code: "RSO", pattern: "stripes", base: "#0067b1", second: "#ffffff", trim: "#ffffff", number: "#ffffff" },
  "Royale Union Saint-Gilloise": { code: "USG", pattern: "solid", base: "#f5d415", second: "#f5d415", trim: "#1b3e8d", number: "#1b3e8d" },
  "SC Paderborn 07": { code: "PAD", pattern: "solid", base: "#0b5aa8", second: "#0b5aa8", trim: "#111111", number: "#ffffff" },
  "SSC Napoli": { code: "NAP", pattern: "solid", base: "#12a0d7", second: "#12a0d7", trim: "#ffffff", number: "#ffffff" },
  "Sassuolo": { code: "SAS", pattern: "stripes", base: "#00a752", second: "#111111", trim: "#111111", number: "#ffffff" },
  "Sint-Truidense VV": { code: "STV", pattern: "solid", base: "#fcd116", second: "#fcd116", trim: "#0b3f8f", number: "#0b3f8f" },
  "Sporting CP": { code: "SCP", pattern: "hoops", base: "#008057", second: "#ffffff", trim: "#ffffff", number: "#ffffff" },
  "Stade Rennais": { code: "SRF", pattern: "solid", base: "#e13327", second: "#e13327", trim: "#111111", number: "#ffffff" },
  "Sunderland": { code: "SUN", pattern: "stripes", base: "#eb172b", second: "#ffffff", trim: "#111111", number: "#ffffff" },
  "TSG Hoffenheim": { code: "TSG", pattern: "solid", base: "#1961b5", second: "#1961b5", trim: "#ffffff", number: "#ffffff" },
  "Tottenham Hotspur": { code: "TOT", pattern: "solid", base: "#ffffff", second: "#ffffff", trim: "#132257", number: "#132257" },
  "Udinese": { code: "UDI", pattern: "stripes", base: "#ffffff", second: "#111111", trim: "#111111", number: "#111111" },
  "Venezia": { code: "VEN", pattern: "band", base: "#111111", second: "#f7941d", trim: "#00843d", number: "#ffffff" },
  "VfB Stuttgart": { code: "VFB", pattern: "band", base: "#ffffff", second: "#e32219", trim: "#e32219", number: "#e32219" },
  "Villarreal": { code: "VIL", pattern: "solid", base: "#ffe667", second: "#ffe667", trim: "#005187", number: "#005187" },
};

const FALLBACK: ClubIdentity = { code: "—", pattern: "solid", base: "#3a3a3a", second: "#3a3a3a", trim: "#949494", number: "#ffffff" };

export function clubIdentity(club: string): ClubIdentity {
  return CLUBS[club] ?? FALLBACK;
}

export interface PlayerIdentity {
  id: string;
  name: string;
  ticker: string;
  club: string;
  number: number | null;
  kit: ClubIdentity;
}

export function playerIdentity(id: string): PlayerIdentity | null {
  const p = PLAYERS_BY_ID[id];
  if (!p) return null;
  return { id, name: p.name, ticker: p.ticker, club: p.club, number: SHIRT_NUMBERS[id] ?? null, kit: clubIdentity(p.club) };
}
