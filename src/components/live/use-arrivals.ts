"use client";

import { useRef } from "react";

/** When each row id was first rendered anywhere in this session. */
const firstSeen = new Map<string, number>();
const ENTRANCE_MS = 1_500;

/**
 * Rows that show up after a list first rendered are arrivals and get an entrance; the first batch
 * doesn't (a page load is not news). An arrival keeps its class for the length of the entrance, so a
 * re-render mid-animation doesn't cut it short.
 */
export function useArrivals(ids: readonly string[] | undefined): (id: string) => boolean {
  const baseline = useRef<number | null>(null);
  // eslint-disable-next-line react-hooks/purity -- arrival time is the point; the map write is idempotent
  const now = Date.now();
  if (ids?.length) {
    for (const id of ids) if (!firstSeen.has(id)) firstSeen.set(id, now);
    if (baseline.current === null) baseline.current = now;
  }
  const base = baseline.current;
  return (id: string) => {
    const t = firstSeen.get(id);
    return base !== null && t !== undefined && t > base && now - t < ENTRANCE_MS;
  };
}
