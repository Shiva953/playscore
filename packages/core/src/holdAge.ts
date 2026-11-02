/**
 * Hold age = quantity-weighted average acquisition time (ARCHITECTURE §4.4).
 * Acquisitions move the average; disposals never change it. LP deposits carry the age
 * with the tokens and LP withdrawals merge it back, so the tax can't be reset through the pool.
 */

export const DAY_MS = 86_400_000;

export interface AgedBalance {
  /** Token quantity. */
  qty: number;
  /** Weighted acquisition time in ms (meaningless when qty = 0). */
  ts: number;
}

/** t ← (t·h + now·q) / (h + q) */
export function mergeAcquisition(current: AgedBalance, incoming: AgedBalance): AgedBalance {
  const qty = current.qty + incoming.qty;
  if (qty <= 0) return { qty: 0, ts: incoming.ts };
  if (current.qty <= 0) return { qty, ts: incoming.ts };
  return { qty, ts: (current.ts * current.qty + incoming.ts * incoming.qty) / qty };
}

/** Disposal keeps the acquisition time. */
export function dispose(current: AgedBalance, qty: number): AgedBalance {
  return { qty: Math.max(0, current.qty - qty), ts: current.ts };
}

export function holdAgeDays(ts: number, now: number): number {
  return Math.max(0, (now - ts) / DAY_MS);
}
