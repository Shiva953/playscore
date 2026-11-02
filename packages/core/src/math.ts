export const EPS = 1e-9;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function mean(values: readonly number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

/**
 * Deterministic bisection: largest x in [lo, hi] with f(x) < target, after a fixed number of halvings.
 * f must be monotonically increasing. Mirrors the prototype's `inv()`.
 */
export function bisectIncreasing(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  iterations: number
): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    if (f(m) < target) a = m;
    else b = m;
  }
  return a;
}

export function isFiniteNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}
