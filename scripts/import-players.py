#!/usr/bin/env python3
"""Import the client's player list (docs/Scorefun Player ICO.xlsx) into packages/core/src/sim/registry.ts.

The ICO sheet is the launch order (ICO#). The position sheets (Goalkeeper, Defender, Midfielder,
Forward) hold more players; those not on the ICO sheet are appended after it, in sheet order.
Duplicates (same first + last name) are dropped. Needs openpyxl:

    python3 -m venv .venv-import && .venv-import/bin/pip install openpyxl
    .venv-import/bin/python scripts/import-players.py
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "Scorefun Player ICO.xlsx"
OUT = ROOT / "packages" / "core" / "src" / "sim" / "registry.ts"

POSITIONS = {"Goalkeeper": "GK", "Defender": "DEF", "Midfielder": "MID", "Forward": "FWD"}
LEAGUES = {
    "Premier League": "PL",
    "La Liga": "LAL",
    "Bundesliga": "BUN",
    "Serie A": "SA",
    "Ligue 1": "L1",
    "Eredivisie": "ERE",
    "Pro League": "BPL",
    "Liga Portugal": "LPO",
}
# One spelling per club (the sheet mixes "Chelsea" / "Chelsea FC" and similar).
CLUBS = {
    "Chelsea FC": "Chelsea",
    "Barcelona": "FC Barcelona",
    "FC Bayern Munchen": "Bayern Munich",
    "Liverpool FC": "Liverpool",
    "Inter Milan": "Inter",
    "Sporting Club Lisbon": "Sporting CP",
    "Club Brugge KV": "Club Brugge",
    "Bayer 04 Leverkusen": "Bayer Leverkusen",
}
# Sheet rows whose league doesn't match the club. Fixed here and reported to the client.
LEAGUE_FIXES = {"AS Roma": "SA", "Stade Rennais": "L1"}
# Clubs whose league the sheet leaves blank.
CLUB_LEAGUES = {"Paris Saint-Germain": "L1", "Olympique de Marseille": "L1", "Marseille": "L1"}
# Rows with blank club / league / age / country on the sheet: (age, club, country). Reported to the client.
FILL = {"Khvicha Kvaratskhelia": (25, "Paris Saint-Germain", "Georgia"), "Mason Greenwood": (25, "Olympique de Marseille", "England")}
# Tickers kept from the prototype (and a few clearer short forms).
TICKERS = {"bellingham": "JUDE", "vinicius": "VINI", "junior": "VINI", "kvaratskhelia": "KVARA", "marquinhos": "MARQ", "upamecano": "UPA", "cucurella": "CUCU", "fernandes": "BRUNO", "diaz": "LUISD", "ruiz": "FABIAN"}


def clean(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def ascii_upper(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-")


def rows(ws, first_col):
    out = []
    for r in list(ws.iter_rows(values_only=True))[3:]:
        r = r[first_col : first_col + 11]
        if r[1] is None and r[2] is None:
            continue
        out.append(r)
    return out


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    seen = set()
    players = []
    warnings = []

    def add(first, last, age, pos, club, league, country, ico):
        first, last = clean(first), clean(last)
        name = f"{first} {last}".strip()
        if not name or name.lower() in seen:
            if name and ico is not None:
                warnings.append(f"duplicate on the ICO sheet: {name} (ICO# {ico})")
            return
        seen.add(name.lower())
        if name in FILL and not clean(club):
            age, club, country = FILL[name]
            warnings.append(f"blank row filled in by hand: {name} ({club})")
        club = CLUBS.get(clean(club), clean(club))
        lg = clean(league)
        code = LEAGUE_FIXES.get(club) or LEAGUES.get(lg) or CLUB_LEAGUES.get(club)
        if not lg and code:
            warnings.append(f"league filled in from the club: {name} ({club})")
        if club in LEAGUE_FIXES and LEAGUES.get(lg) != LEAGUE_FIXES[club]:
            warnings.append(f"league fixed: {name} ({club}) listed as {lg}")
        if not code:
            warnings.append(f"unknown league {lg!r} for {name}; skipped")
            return
        players.append({"name": name, "first": first, "last": last or first, "age": int(age or 0), "position": POSITIONS[clean(pos)], "club": club, "league": code, "country": clean(country), "ico": ico})

    # ICO sheet: columns C.. (ICO#, First, Last, Age, Position, Club, League, Nationality, ...).
    for r in rows(wb["ICO"], 2):
        if r[0] is None:
            continue
        add(r[1], r[2], r[3], r[4], r[5], r[6], r[7], int(r[0]))
    ico_count = len(players)
    for sheet in ["Goalkeeper", "Defender", "Midfielder", "Forward"]:
        for r in rows(wb[sheet], 3):
            add(r[0], r[1], r[2], r[3], r[4], r[5], r[6], None)

    # Ids and tickers: surname first, then first name + surname when taken.
    ids, tickers = set(), set()
    for p in players:
        base = slug(p["last"])
        pid = base if base not in ids else slug(p["name"])
        n = 2
        while pid in ids:
            pid, n = f"{slug(p['name'])}-{n}", n + 1
        ids.add(pid)
        p["id"] = pid
        t = TICKERS.get(pid) or re.sub(r"[^A-Z]", "", ascii_upper(p["last"]))[:8] or "P"
        if t in tickers:
            t = (re.sub(r"[^A-Z]", "", ascii_upper(p["first"]))[:1] + t)[:8]
        n = 2
        while t in tickers:
            t, n = f"{t[:7]}{n}", n + 1
        tickers.add(t)
        p["ticker"] = t

    lines = [
        "// GENERATED by scripts/import-players.py from docs/Scorefun Player ICO.xlsx. Do not edit by hand.",
        "// Launch order: the ICO sheet's ICO#, then players only on the position sheets.",
        'import type { LeagueCode, PositionCode } from "../config";',
        "",
        "/** [id, name, age, club, country, league, position, ticker, ICO# or null] */",
        "export type RegistryRow = [string, string, number, string, string, LeagueCode, PositionCode, string, number | null];",
        "",
        f"/** {len(players)} players ({ico_count} from the ICO sheet). */",
        "export const REGISTRY: readonly RegistryRow[] = [",
    ]
    for p in players:
        lines.append("  " + json.dumps([p["id"], p["name"], p["age"], p["club"], p["country"], p["league"], p["position"], p["ticker"], p["ico"]], ensure_ascii=False) + ",")
    lines += ["];", ""]
    OUT.write_text("\n".join(lines))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(players)} players ({ico_count} on the ICO sheet)")
    for w in warnings:
        print("  note:", w, file=sys.stderr)


if __name__ == "__main__":
    main()
