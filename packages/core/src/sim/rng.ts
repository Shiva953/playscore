/**
 * The prototype's LCG (`rng(s)`), so seed data matches the prototype exactly.
 * State is a single integer, so the mock can persist and resume it.
 */
export interface Rng {
  next(): number;
  /** Current internal state (persist this to resume the sequence). */
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let s = Math.floor(Math.abs(seed)) % 4294967296;
  return {
    next() {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    },
    get state() {
      return s;
    },
  };
}

export function between(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng.next();
}

export function intBetween(rng: Rng, lo: number, hiInclusive: number): number {
  return Math.floor(between(rng, lo, hiInclusive + 1));
}

/** Knuth Poisson sampler (fine for the small λ used per tick). */
export function poisson(rng: Rng, lambda: number): number {
  if (!(lambda > 0)) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (rng.next() * 2 - 1) * 1.7));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L);
  return k - 1;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))]!;
}

/** Log-uniform sample in [lo, hi]. */
export function logUniform(rng: Rng, lo: number, hi: number): number {
  return Math.exp(between(rng, Math.log(lo), Math.log(hi)));
}

/** Stable 32-bit hash for deriving seeds from strings. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
