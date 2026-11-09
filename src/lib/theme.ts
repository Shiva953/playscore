/**
 * Canvas charts can't read CSS variables, so they read the tokens from the page at runtime instead of
 * keeping a second copy of the palette (better-colors: components reference tokens, never literals).
 */
export interface ChartTheme {
  text: string;
  grid: string;
  ink: string;
  soft: string;
  control: string;
  up: string;
  down: string;
  brand: string;
  surface: string;
  raised: string;
  /** The same colour at an alpha, for fills and volume bars. */
  alpha: (hex: string, a: number) => string;
}

const FALLBACK: Record<string, string> = {
  "--faint": "#929292",
  "--grid": "#232323",
  "--ink": "#f3f3f3",
  "--soft": "#b7b7b7",
  "--control": "#3e3e3e",
  "--up": "#46ec86",
  "--down": "#ff6362",
  "--brand": "#ffcc5f",
  "--surface": "#0a0a0a",
  "--raised": "#2a2a2a",
};

function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function chartTheme(): ChartTheme {
  const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const v = (name: string) => css?.getPropertyValue(name).trim() || FALLBACK[name]!;
  return {
    text: v("--faint"),
    grid: v("--grid"),
    ink: v("--ink"),
    soft: v("--soft"),
    control: v("--control"),
    up: v("--up"),
    down: v("--down"),
    brand: v("--brand"),
    surface: v("--surface"),
    raised: v("--raised"),
    alpha,
  };
}
