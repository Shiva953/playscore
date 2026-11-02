import { PROTOCOL_CONFIG } from "./config";

const BONUS = PROTOCOL_CONFIG.claims.tokenBonus;

export type ClaimMode = "usdc" | "tokens";

/** One unit of claimable winnings: a holder's share of a player's payout in one round. */
export interface ClaimRow {
  roundId: number;
  playerId: string;
  usd: number;
}

export interface ClaimMarket {
  /** Price used to convert USD into tokens (spot in the mock; SPEC-QUESTION: SQ-17 recommends a TWAP). */
  price: number;
  reserveLeft: number;
}

export interface ClaimLine {
  playerId: string;
  usd: number;
  /** Tokens minted from the reserve (0 for USDC mode). */
  tokens: number;
  /** USD value settled in tokens (stays in the vault). */
  usdInTokens: number;
  /** USD paid in USDC (USDC mode, or the part the reserve couldn't cover). */
  usdc: number;
}

export interface ClaimQuote {
  mode: ClaimMode;
  totalUsd: number;
  lines: ClaimLine[];
  usdcOut: number;
  /** USDC that stays in the vault because holders took tokens. */
  vaultRetained: number;
  /** Extra value from the +10% bonus, at the claim price. */
  bonusUsd: number;
}

export function aggregateByPlayer(rows: readonly ClaimRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.playerId, (m.get(r.playerId) ?? 0) + r.usd);
  return m;
}

/**
 * USDC, or the same player's tokens +10%: tokens = min(usd × 1.1 / price, reserveLeft).
 * If the reserve covers only part, the rest is paid in USDC (SPEC-QUESTION: SQ-18;
 * the prototype silently dropped it).
 */
export function quoteClaim(
  rows: readonly ClaimRow[],
  mode: ClaimMode,
  market: (playerId: string) => ClaimMarket
): ClaimQuote {
  const lines: ClaimLine[] = [];
  let usdcOut = 0;
  let vaultRetained = 0;
  let bonusUsd = 0;
  let totalUsd = 0;
  for (const [playerId, usd] of aggregateByPlayer(rows)) {
    totalUsd += usd;
    if (mode === "usdc") {
      lines.push({ playerId, usd, tokens: 0, usdInTokens: 0, usdc: usd });
      usdcOut += usd;
      continue;
    }
    const { price, reserveLeft } = market(playerId);
    if (!(price > 0) || !(reserveLeft > 0)) {
      lines.push({ playerId, usd, tokens: 0, usdInTokens: 0, usdc: usd });
      usdcOut += usd;
      continue;
    }
    const wanted = (usd * (1 + BONUS)) / price;
    const tokens = Math.min(wanted, reserveLeft);
    const usdInTokens = (tokens * price) / (1 + BONUS);
    const usdc = Math.max(0, usd - usdInTokens);
    lines.push({ playerId, usd, tokens, usdInTokens, usdc });
    usdcOut += usdc;
    vaultRetained += usdInTokens;
    bonusUsd += usdInTokens * BONUS;
  }
  return { mode, totalUsd, lines, usdcOut, vaultRetained, bonusUsd };
}
