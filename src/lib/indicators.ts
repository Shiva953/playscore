/** Chart indicators for the trade terminal. Pure functions over a price series; `null` where undefined. */

export function sma(values: readonly number[], n: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n]!;
    return i >= n - 1 ? sum / n : null;
  });
}

export function ema(values: readonly number[], n: number): (number | null)[] {
  const k = 2 / (n + 1);
  let e: number | null = null;
  return values.map((v, i) => {
    e = e === null ? v : v * k + e * (1 - k);
    return i >= n - 1 ? e : null;
  });
}

export function bollinger(values: readonly number[], n = 20, mult = 2): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(values, n);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  values.forEach((_, i) => {
    const m = mid[i];
    if (m == null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (values[j]! - m) ** 2;
    const sd = Math.sqrt(sq / n);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  });
  return { mid, upper, lower };
}

export function rsi(values: readonly number[], n = 14): (number | null)[] {
  return values.map((_, i) => {
    if (i < n) return null;
    let gain = 0;
    let loss = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = values[j]! - values[j - 1]!;
      if (d > 0) gain += d;
      else loss -= d;
    }
    if (loss === 0) return 100;
    return 100 - 100 / (1 + gain / loss);
  });
}
