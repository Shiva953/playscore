import type { BoardView, RoundState } from "@/lib/protocol/types";

/**
 * Small derived values the lab directions all need (data only).
 */

/** The match minute shown for the window: 0–90 across the live phase. */
export function matchMinute(r: RoundState): number {
  if (r.phase === "open") return 0;
  if (r.phase === "ended") return 90;
  return Math.min(90, Math.max(1, Math.round(r.liveProgress * 90)));
}

export function phaseLabel(r: RoundState): string {
  return r.phase === "open" ? "Before kickoff" : r.phase === "live" ? "Live" : "Full time";
}

/** Boards in display order: positions first, then leagues, then the Champions League. */
export function sortedBoards(r: RoundState): BoardView[] {
  const order = { position: 0, league: 1, ucl: 2 } as Record<string, number>;
  return [...r.boards].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
}

/** The boards where one of your players is in the paying top five. */
export function myBoards(r: RoundState): BoardView[] {
  return r.boards.filter((b) => b.rows.some((row) => row.mine));
}

export function surname(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

export function firstName(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 ? parts[0] : "";
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
