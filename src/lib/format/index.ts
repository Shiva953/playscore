/**
 * Number, price and time formatting. Deterministic (en-US, UTC) so server and client render the same text.
 * Rules (ARCHITECTURE §7.4): USDC to 2 decimals, sub-cent prices to 4–5 decimals, tabular numbers in the UI.
 */

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatUsd(n: number | null | undefined, opts: { decimals?: 0 | 2; signed?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const f = opts.decimals === 0 ? usd0 : usd2;
  const s = f.format(Math.abs(n) < 0.005 && opts.decimals !== 0 ? 0 : n);
  return opts.signed && n > 0 ? `+${s}` : s;
}

export function formatUsdCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 10_000) return formatUsd(n, { decimals: Math.abs(n) >= 100 ? 0 : 2 });
  return `$${compact.format(n)}`;
}

/** Player token price: 5 decimals below $0.10, else 4, else 2. */
export function formatPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const d = p < 0.1 ? 5 : p < 1 ? 4 : 2;
  return `$${p.toFixed(d)}`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) > 0 && Math.abs(n) < 1) return n.toFixed(2);
  return int.format(Math.floor(n));
}

export function formatTokensCompact(n: number): string {
  return Math.abs(n) >= 100_000 ? compact.format(n) : formatTokens(n);
}

/** Fraction → percent. 0.0465 → "4.65%". */
export function formatPct(f: number | null | undefined, opts: { decimals?: number; signed?: boolean } = {}): string {
  if (f == null || !Number.isFinite(f)) return "—";
  const d = opts.decimals ?? 2;
  const s = `${(f * 100).toFixed(d)}%`;
  return opts.signed && f > 0 ? `+${s}` : s;
}

export function formatScore(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  return s.toFixed(1);
}

export function formatPoints(p: number): string {
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}`;
}

/** Countdown: "0:42", "12:05", "5h 12m", "2d 4h". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatRelative(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3_600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ago`;
  return formatDate(ts);
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${formatDate(ts)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
}

export function shortAddress(a: string, chars = 4): string {
  return a.length > chars * 2 + 1 ? `${a.slice(0, chars)}…${a.slice(-chars)}` : a;
}

/** Parse a user-typed amount ("1,000.50") → number, or NaN. */
export function parseAmount(v: string): number {
  const n = Number(v.replace(/,/g, "").trim());
  return v.trim() === "" ? NaN : n;
}
