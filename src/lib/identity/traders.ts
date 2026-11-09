import type { TradeRecord } from "@/lib/protocol/types";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The devnet mock has no other accounts, so each market trade gets a stable wallet-style handle from a
 * small pool of traders (the same trader shows up again, as they would on a real market). Once trades
 * come from the chain, `trader` will be the signer's address and this only shortens it.
 */
const POOL = 48;

function pseudoAddress(n: number): string {
  let x = hash(`trader-${n}`);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += B58[x % 58];
    x = hash(out + n);
  }
  return out;
}

export interface TraderFace {
  /** Seed for the generated avatar. */
  seed: string;
  /** "You", or a shortened address like "7xKp…V46A". */
  label: string;
  mine: boolean;
}

export function traderFor(t: Pick<TradeRecord, "id" | "mine">, myAddress?: string | null): TraderFace {
  if (t.mine) return { seed: myAddress ?? "you", label: "You", mine: true };
  const addr = pseudoAddress(hash(t.id) % POOL);
  return { seed: addr, label: `${addr.slice(0, 4)}…${addr.slice(4)}`, mine: false };
}

/** Trade size, for weight in feeds: a bigger trade reads louder. */
export function tradeWeight(usdc: number): "small" | "mid" | "big" {
  return usdc >= 250 ? "big" : usdc >= 60 ? "mid" : "small";
}
