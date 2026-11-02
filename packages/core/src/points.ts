/**
 * Off-chain activity points (ARCHITECTURE §2, §4.11). Components follow the prototype's `S.pts`;
 * `liquidity` counts USDC supplied as LP (the prototype counted limit-order fills, which are dropped).
 */
export interface ActivityPoints {
  /** USDC spent buying on launch curves. */
  launch: number;
  /** Σ value held at each settled round (tokens × price). */
  holding: number;
  /** Dividends earned. */
  dividends: number;
  /** Fees and taxes paid. */
  fees: number;
  /** Trade volume. */
  volume: number;
  /** USDC supplied as liquidity. */
  liquidity: number;
}

export function emptyPoints(): ActivityPoints {
  return { launch: 0, holding: 0, dividends: 0, fees: 0, volume: 0, liquidity: 0 };
}

/**
 * Provisional total: plain sum in USD units.
 * SPEC-QUESTION: SQ-26. Weights aren't specified; volume/fees reward churn and should probably weigh less.
 */
export function totalPoints(p: ActivityPoints): number {
  return p.launch + p.holding + p.dividends + p.fees + p.volume + p.liquidity;
}

export function addPoints(p: ActivityPoints, delta: Partial<ActivityPoints>): ActivityPoints {
  return {
    launch: p.launch + (delta.launch ?? 0),
    holding: p.holding + (delta.holding ?? 0),
    dividends: p.dividends + (delta.dividends ?? 0),
    fees: p.fees + (delta.fees ?? 0),
    volume: p.volume + (delta.volume ?? 0),
    liquidity: p.liquidity + (delta.liquidity ?? 0),
  };
}
