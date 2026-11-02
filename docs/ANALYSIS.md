# score: Step 0 analysis

> Written before any app code. Sources: `ARCHITECTURE.md` (spec), `docs/concept/score-terminal-v4.html` (prototype, read line by line), `PLAN.md`. All numbers below were recomputed by running the prototype's own functions in Node, not estimated.
>
> Notation: `S` = tokens sold on the curve, `R` = USDC raised, `P` = spot price, `x`/`y` = pool USDC/token reserves, `d` = hold age in days. "Proto" = the prototype. Items marked **SQ-n** are open questions (full list at the end); code that depends on one carries a `// SPEC-QUESTION: SQ-n` comment.

---

## Contents

1. [Supply & token model](#1-supply--token-model)
2. [Launch: bonding curve, fees, caps, schedule](#2-launch-bonding-curve-fees-caps-schedule)
3. [Bonding: 70/20/10 split, pool seed, price continuity](#3-bonding-702010-split-pool-seed-price-continuity)
4. [Trading: CPMM, buy fee, hold-age sell tax, fee routing](#4-trading-cpmm-buy-fee-hold-age-sell-tax-fee-routing)
5. [Liquidity providers](#5-liquidity-providers)
6. [Matchday calendar, snapshot, live phase, freeze](#6-matchday-calendar-snapshot-live-phase-freeze)
7. [Scoring](#7-scoring)
8. [Boards & payout split](#8-boards--payout-split)
9. [Round pool controller & vault solvency](#9-round-pool-controller--vault-solvency)
10. [Claims](#10-claims)
11. [Delisting & governance](#11-delisting--governance)
12. [Accounts, custody, wallets, geo-restrictions, Terms](#12-accounts-custody-wallets-geo-restrictions-terms)
13. [Points / activity rank / seasons](#13-points--activity-rank--seasons)
14. [Prior-art comparison](#14-prior-art-comparison)
15. [Consumer journeys](#15-consumer-journeys)
16. [Prototype review](#16-prototype-review)
17. [Open questions](#17-open-questions)

---

## 1. Supply & token model

**What it does.** Each player has one fungible token, max supply 10,000,000: an 8M float (6.4M sold on the curve + 1.6M paired into the pool at bonding) and a 2M dividend reserve minted only when holders take dividends as tokens (or for capped prizes/airdrops, ≤25% of the reserve).

**Rules.**
| Bucket | Tokens | Enters circulation when |
|---|---|---|
| Curve | ≤ 6,400,040 (`S_max`) | Bought on the curve |
| Pool seed | 1,600,000 | Bonding (paired with 70% of the raise) |
| Reserve | 2,000,000 | Token-dividend claims; ≤500,000 for prizes |
| **Max** | **10,000,000** | never exceeded |

**Connections.** Supply bounds the dividend denominator (§8, SQ-1), the claim limit (§10) and the overshoot problem (§3, SQ-12).

**Does it make sense?** Yes. Fixed supply with a capped, demand-driven reserve is far safer than Football Index's open-ended share issuance. The 2M reserve (20% of max) is the only dilution source, and it only grows when holders choose tokens over USDC. That's a self-limiting choice: dilution rises when holders are bullish on the player.

**Edge cases.**
- **The curve constants overshoot by 40 tokens (SQ-35).** `R⁻¹(25,000) = 6,400,040`, so float = 8,000,040 and max supply would be 10,000,040 with a full reserve. Implemented: the reserve is trimmed to 1,999,960 at bonding.
- **Overshoot breaks the 8M float.** Proto lets the bonding buy push `S` past `S_max` (up to +240k tokens) and still seeds a fixed 1.6M, so float can reach 8.24M and max supply 10.24M. Fix: cap the bonding buy at exactly `S_max` and refund the excess (SQ-12).
- Proto's `p.sold` also absorbs reserve mints (`p.sold += q` in `claimDiv`), so `sold` stops meaning "sold on the curve". The core keeps `curveSold`, `minted` and pool reserves separate.
- Reserve exhaustion: at ~$0.011 the whole 2M reserve is ≈ $22k of token dividends per player. After that, claims are USDC only.

**Prior art.** pump.fun: 1B supply, ~80% on the curve, the rest paired at migration, no reserve. Football Index: unlimited share issuance by the operator (the root of its growing liabilities). Sorare: fixed card editions per season, new seasons add supply.

---

## 2. Launch: bonding curve, fees, caps, schedule

**What it does.** A curated player launches on a cubic bonding curve priced in USDC. Anyone can buy or sell against the curve until $25,000 has been raised.

**Formulas (verified numerically).**
- `R(S) = 0.00039·S + S³ / 1.1649e16`, `P(S) = dR/dS = 0.00039 + S² / 3.883e15` (3/1.1649e16 = 1/3.883e15 ✓).
- `S_max = R⁻¹(25,000) = 6,400,040` tokens. `P(0) = $0.00039`, `P(S_max) = $0.0109387`, average price `25,000 / 6,400,040 = $0.0039062`.
- Inverse: deterministic bisection on `[0, 8e6]`, 60 iterations (proto `inv`). The core keeps it deterministic with the same bounds and adds a tolerance test.
- Fee: flat **1.25%** each way. Buy: fee taken from USDC in, `tokens = R⁻¹(R(S) + usdc·0.9875) − S`, `raised += usdc·0.9875`. Sell: gross `g = R(S) − R(S − q)`, fee `g·1.25%`, user gets `g·0.9875`, `raised −= g`.
- Cap: **240,000 tokens** (3% of float) per purchase and cumulative per account.

**How the curve feels (cost of the max 240k-token allocation):**

| Tokens already sold | Spot price | Cost of 240k tokens | Value at pool open ($0.0109375) |
|---|---|---|---|
| 0 | $0.00039 | **$95** | $2,625 (27.7×) |
| 1M | $0.00065 | $171 | 15.3× |
| 3M | $0.00271 | $696 | 3.8× |
| 5M | $0.00683 | $1,714 | 1.5× |
| 6.16M | $0.01016 | $2,532 | 1.04× |

**Connections.** Feeds bonding (§3); curve buys start the hold-age clock (§4); `launch buys` earn activity points (§13); the cap interacts with sybil resistance (§12).

**Does it make sense?**
- Economically, early buyers are paid for risk: the average curve buyer is up 2.8× on paper at bonding. That's the "launch" hook, and it's real.
- **The token-denominated cap plus a $0.00039 starting price makes extra accounts very profitable.** The first 240k tokens cost $95 and are "worth" $2,625 at open. Bonding needs at least 27 accounts (6.4M / 240k), so fixed launch times (14:00/20:00 UTC) invite bots running many accounts. Possible mitigations, for the user to decide (SQ-25): a USDC cap per account as well as the token cap, a short allow-list or lottery window at launch, attested sign-in (embedded wallet + device), or a minimum launch price.
- Paper vs realisable value: selling all 6.4M curve tokens into the fresh $17.5k/1.6M pool returns only **$14,000** (vs $70,000 at open price). A single 240k-token exit gets $2,283 vs $2,625 on paper (−13% impact before the 5% tax). The UI must show price impact and realisable value, not just `tokens × price`.

**Edge cases.**
- **Cap: gross or net?** Spec says "cumulative per account"; proto decrements the counter on curve sells (net holding), so buy 240k → sell → buy again works. Implemented: **gross cumulative purchases** (stricter, matches spec text). SQ-19.
- A buy whose token output would exceed the remaining cap: proto rejects the whole buy. Implemented the same (reject), and the quote tells the user the max they can spend.
- Selling back down the curve right before bonding: allowed. Someone could hold the raise just under $25k, but anyone can buy it over, so this is grief-resistant.
- Tiny amounts: `tokens` for $0.01 can be <1 token. Fine numerically; UI shows 2 decimals for tokens under 1.
- Scheduled players: proto seeds `raised` for all 30 players, but only `i < 10` are tradable and `i ≥ 10` are a static schedule starting 28 Oct (so by "today" several should already be live). Implemented: 6 bonded, 4 launching, 20 scheduled with real `launchAt` slots (14:00/20:00 UTC weekdays) from the demo start. In demo-clock mode the next scheduled pair goes live at each new round. That's demo-only and logged in DECISIONS.

**Launch schedule.** 2 per weekday (10/week) until 200 players (~week 20), then 1/week by holder vote (from Season 1). Curated, never permissionless. That reads well against pump.fun's spam: scarcity makes each launch an event. The risk is a very front-loaded vault inflow (§9).

**Prior art.** pump.fun: permissionless, ~1% fee, sniping bots dominate the first blocks, graduation at a market-cap threshold. Meteora DBC: configurable multi-segment curves with anti-sniper fee schedules (a decaying launch fee). That's worth borrowing as an alternative to the hard cap. friend.tech: `S²/16000` ETH curve, no graduation. Everything traded on the curve forever with 10% fees, which killed liquidity.

---

## 3. Bonding: 70/20/10 split, pool seed, price continuity

**What it does.** At `raised ≥ $25,000` the curve closes. The raise is split into a locked pool seed (70%), the dividend vault (20%) and the treasury (10%). The seed is paired with the 1.6M reserved float tokens.

**Formulas.** On $25,000: 17,500 / 5,000 / 2,500. Pool opens at `17,500 / 1,600,000 = $0.0109375` vs curve end `$0.0109387`. That's continuous to 0.01%, by design. Split uses actual net raised (buy fees already went to the treasury).

**Connections.** Creates the pool (§4); the 20% is the vault's main early inflow (§9); the locked seed's LP shares earn no dividends (§5, §8).

**Does it make sense?** Yes. Price continuity removes the "graduation gap" that pump.fun-style launches are known for. A permanently locked 70% seed is the anti-Football-Index promise: there is always an exit. With constant product the exit price falls with size, though (see §2), so the promise is "an exit", not "an exit at the current price".

**Edge cases.**
- **Overshoot (SQ-12).** If the final buy overshoots, the seed is `0.7 × raised` but tokens stay 1.6M, so the pool opens *above* the curve price and float exceeds 8M. **Implemented:** the bonding buy is partially filled to exactly `S_max` and the excess USDC is refunded (pump.fun-style). Split then always applies to ≈$25,000. Spec line "last buy may overshoot" is noted as superseded, pending confirmation.
- Bonding during a live round. The player wasn't bonded at kickoff, so their holders weren't snapshotted as pool-era holders. **Implemented:** only players bonded *at kickoff* rank that round (SQ-30). Proto would rank them at settlement and pay curve-era holders.
- Simultaneous bonding buys (on-chain race): the program must serialise on the `Player` account. Second buyer gets a refund or a pool trade. Out of scope for the mock.

**Prior art.** pump.fun migrates ~$12k of SOL + 20% of supply to Raydium/PumpSwap and burns the LP. Similar "locked forever" idea, but there the full raise goes to the pool (minus a migration fee). score's 20% vault cut is the novel part: launch proceeds pre-fund dividends.

---

## 4. Trading: CPMM, buy fee, hold-age sell tax, fee routing

**What it does.** After bonding, the token trades against a USDC/token constant-product pool. Buys pay a small fee. Sells pay a tax that falls with how long you have held.

**Formulas.**
- CPMM: `x·y = k`. Buy `u` USDC: buy fee `u·0.0005` → treasury, LP fee `0.25%` of the swapped amount stays in pool (SQ-22), `tokensOut = y − k / (x + u'·(1 − 0.0025))`.
- Sell `q` tokens: `gross = x − k / (y + q·(1 − 0.0025))`, `tax = gross · tax(d)`, user gets `gross − tax`.
- `tax(d) = max(0.005, 0.05 − 0.045·min(1, d/90))`: 5.00% (d=0), 4.65% (d=7), 2.75% (d=45), 0.50% (d≥90).
- Routing: buy-side fees 100% treasury. Sell-side (curve 1.25% sell fee and pool sell tax) **90% vault / 10% treasury**. Test vector: sell $1,000 at d=7 → $46.50 tax → $41.85 vault, $4.65 treasury ✓.
- Hold age: `t ← (t·h + now·q)/(h + q)` on every acquisition. Sells leave `t` unchanged. `d = (now − t)/86400s`. Vector: 10k @ −60d + 10k @ today → 30 days ✓.

**Connections.** Sell tax is the vault's long-run inflow (§9). Hold age must survive LP round-trips (§5). The tax is also the economic deterrent to snapshot sniping (§6).

**Does it make sense?** The sell tax is the core idea behind "early sellers fund the holders": it turns churn into dividends. Checks:
- **Snapshot sniping** (buy before kickoff, dump after): round-trip cost ≈ 0.05% + 2×0.25% + 5% + 2× impact ≈ **5.6%+**. Profitable only if one round's dividend exceeds ~5.6% of the position's value. In the spec's worked example ($10k pool), Haaland's $672 on ~8M eligible tokens (~$87k) is 0.77% per round. The deterrent holds unless a player's price collapses while they keep ranking, and then buyers re-rate the price anyway.
- **Hold-age carry:** a 90-day holder can sell at 0.5% after kickoff (already snapshotted) and rebuy before the next kickoff, but new tokens dilute the age average, so there's little to gain.
- The 0.5% floor keeps a permanent vault inflow even from long-term holders.

**Edge cases.**
- **Hold age laundering through LP (SQ-23):** tokens received from a pool withdrawal inherit the LP position's age. If the price fell while LPing, the LP gets *more* tokens than it deposited, and the extra tokens carry the old age. That's a cheap way to acquire "aged" tokens. It's small, but worth knowing for the program design (option: age extra tokens as `now`).
- Selling exactly the whole position: the quote must use token amount, not USDC, to avoid dust. The `quoteSell` seam accepts either (`{usdc}` or `{tokens}`).
- Price impact on thin pools is large (§2). Quotes always show `spotBefore`, `avgPrice`, `spotAfter` and impact %.
- **Limit orders (SQ-6):** proto's limit orders are filled at the limit price with no pool interaction (`fill(p, side, a, px, true)`). That's free money in a sim and impossible on an AMM without a keeper. **Dropped** in Step 0 (DECISIONS).
- **Synthetic order book (SQ-6):** proto's `book()` draws random levels around the spot price with a fixed "spread 0.4%". There is no book on a CPMM. Replaced with AMM-native views: price-impact ladder ($100 / $500 / $1k / $5k), pool depth, and a recent-trades tape.

**Prior art.** Football Index: 2% commission on sales and the platform acted as market maker ("instant sell"). When it suspended instant sell, there was no exit. Uniswap v2: 0.3% LP fee, no per-user fees. Per-user taxes are impossible there, which is exactly why ARCHITECTURE §6.1 chose a custom program with protocol-held positions. Some "reflection"/tax tokens on EVM had flat transfer taxes; score's hold-age decay is gentler and more targeted.

---

## 5. Liquidity providers

**What it does.** Anyone can add USDC + player token to the pool (or USDC only, "zap": swap half, deposit both) and earn the 0.25% swap fee. LPs also earn dividends on their share of the pool's tokens at kickoff. The protocol's locked seed earns nothing.

**Formulas.**
- Pair deposit at price `P = x/y`: deposit `u` USDC + `u/P` tokens, mint `shares = totalShares · u / x`.
- Zap `u`: swap `u/2` (pays buy fee + LP fee), then pair-deposit the rest.
- Withdraw `s` shares: `x·s/T` USDC + `y·s/T` tokens. Tokens rejoin the position with the LP's weighted hold age.
- IL vs holding for price ratio `r`: `IL = 1 − 2√r/(1 + r)` (proto) → +50%: 2.0%; +100%: 5.7%; −50%: 5.7%.
- LP-attributed tokens at kickoff = `y · userShares / totalShares` (proto approximates with `L.t / √(P/P₀)`; same thing for one position).

**Connections.** LP tokens count toward the snapshot (§6) and the eligible denominator (§8). LP fees accrue into the pool, including the protocol seed's share, which deepens locked liquidity over time.

**Does it make sense?** The concept's own note is honest: at 5% weekly turnover a 0.25% fee yields ~1.3%/yr. LPing beats holding only because of dividend pass-through on the token half, so LP economics are "holder economics with half the dividend exposure, some IL, and a small fee kicker". That works for fans who want to support a player's market. It won't attract mercenary LPs without points (SQ-8). Locked depth already guarantees a floor of liquidity.

**Edge cases.**
- Proto's LP fees are synthetic (`v24 × 0.25%/24` accrued per second) and separately claimable. With a real CPMM, fees compound into the pool share. **Implemented:** auto-compounding Uniswap-v2 style. "Fees earned" is tracked for display via a per-share fee-growth counter. There's no separate "claim fees" button (DECISIONS).
- Proto's zap hold age uses an unweighted `(ts + now)/2`. Implemented: token-weighted merge.
- Adding liquidity with insufficient tokens: proto rejects and suggests zap; same here.
- LP changes allowed during matchdays (proto `locked()` is hard-coded `false`). Matches spec.
- First LP into a pool is always the protocol seed, so the share math never hits `totalShares = 0` after bonding.

**Prior art.** Uniswap v2 (fee compounding, IL), Meteora DLMM (concentrated bins: tighter spreads, active management). ARCHITECTURE flags concentrated liquidity as a later roadmap item. Football Index had no LPs (the operator was the only market maker), which is exactly why its liquidity could vanish.

---

## 6. Matchday calendar, snapshot, live phase, freeze

**What it does.** Real football is grouped into windows: League weekend (Fri→Mon) and Champions League midweek (Tue→Thu). At the window's first kickoff the protocol snapshots every holder's balance plus LP-attributed tokens. Live scores stream as provisional. 12h after the last whistle data freezes, then the round settles and becomes claimable.

**State machine.** `OPEN → (first kickoff, snapshot) → LIVE → (last whistle) → ENDED → (+12h) → FROZEN → SETTLED → CLAIMABLE`. Trading never pauses. Exactly one snapshot per round.

**Proto behaviour.** 4 windows cycle (`MDS`): Fri 30 Oct–Mon 2 Nov (league), Tue 3–Thu 5 Nov (UCL), Fri 6–Mon 9 (league), Tue 10–Thu 12 (UCL). Demo: 40s OPEN → 50 one-second LIVE ticks → settle immediately (no ENDED/FROZEN). Snapshot = `S.hold` + LP tokens at the OPEN→LIVE flip.

**Implemented.**
- `DemoClock` with OPEN 40s / LIVE 50s / ENDED (freeze) 5s, all configurable. Settlement runs on the ENDED→FROZEN transition. Phases are timestamp-driven (`phaseEndsAt`), so tab sleep or a reload catches up instead of drifting. If more than one full round has elapsed, the clock restarts the current phase rather than replaying dozens of rounds.
- Real-calendar mode: windows generated from the spec's pattern. League: first kickoff Fri 19:00 UTC, last whistle Mon 21:30 UTC. UCL: Tue 17:45 → Thu 21:00 UTC (Europa/Conference ignored). Freeze = last whistle + 12h.
- Eligibility vectors: buy after kickoff → 0 eligible this round. Sell after kickoff → still eligible ✓ (tests).

**Does it make sense?**
- One kickoff snapshot plus an always-open market is clean and enforceable on-chain with the lazy `balanceAtRoundStart` pattern (ARCHITECTURE §6.2). The core implements the eager snapshot for the mock *and* the lazy helper, and tests that they agree.
- **League weekend → UCL gap is short (SQ-3).** Freeze is ~Tue 09:30 UTC and the UCL kickoff Tue 17:45, about 8h to claim tokens if you want them counted next round. Real users miss that. Options: auto-compound election ("always take tokens"), or snapshot claims at settlement rather than at claim time.
- **Weeks without matches (SQ-4):** international breaks have no windows and pay nothing. Domestic cups are excluded by default (no coefficient defined).
- Midweek windows only score UCL clubs. Seed bonded players at UCL clubs: 5 of 6 (Messi/Inter Miami excluded). For the user, "my player doesn't play midweek" must be obvious before kickoff.

**Prior art.** FPL: gameweek deadline 90 min before first kickoff, lineups locked. score's trading-open snapshot is friendlier. Sorare: lineups lock per game week, rewards after final scores. Football Index: in-play dividends during matches, no snapshot. That made front-running possible on fast data.

---

## 7. Scoring

**What it does.** Every real player is scored on their own contribution with a position-specific event matrix, plus per-minute points. Then a competition coefficient is applied. Rankings use raw points `P`; the UI shows a 0–10 display score.

**Rules.** Full matrix: ARCHITECTURE §4.7 (30 rows, ported verbatim into `config.ts` and cross-checked against proto `MX`). Coefficients: UCL 1.05, PL 1.00, LAL 0.97, BUN 0.93, SA 0.93, L1 0.88, MLS 0.85*, SPL 0.85* (*provisional). `P = coef × Σ(events × matrix[pos]) + coef × minutes × 0.012` (proto applies coef to minutes too: `.036*cf`). Clean sheet is `× minutes/90`. Display `= 10·P/(P + 6)` (P=6 → 5.0 ✓).

**Sanity check (realistic per-90 rates I used for the simulator):** elite FWD ≈ 9.0 raw points/90 → display 6.0; elite MID ≈ 7.4; DEF ≈ 7.2 (clean sheets carry defenders). The matrix is well balanced across positions, which matters because position boards each get equal weight.

**Connections.** Feeds boards (§8). The same `packages/core` code computes live provisional scores and (later) oracle results, so they can't disagree on the formula.

**Does it make sense?** Yes, and it's richer than FPL's. Rewarding the per-position rarity of goals (GK 12, DEF 9) mirrors FPL (GK/DEF 6, MID 5, FWD 4). Penalties for failed passes/fouls keep volume players honest.

**Edge cases.**
- **Negative points (SQ-20).** `10·P/(P+6)` is negative for −6<P<0, undefined at −6 and *positive* for P<−6 (e.g. P=−12 → 20). Implemented: display clamps to 0 for P≤0. Rankings still use raw P.
- **"Played" (SQ-20).** Proto ranks `score > 0`. Spec says "bonded players who actually played". Implemented: `minutes > 0`. A player who plays and scores −1 is ranked (last), which changes board weight (`min(n, 5)`).
- **GK (SQ-5).** No goalkeepers in the 30 seed players, and proto's live table gives GKs zero events. The core simulator models GK events (saves, clean sheets, conceded), but with the current seed the GK board is always empty, so it's excluded from weights. Recommend adding 2–3 GKs before the demo.
- Proto's live sim uses a 5-event table (`T`). Implemented the full matrix in the simulator and calculator, with notable events surfacing in the feed (goals, assists, shots on target, saves, cards, penalties).
- Mid-window corrections after freeze are ignored by design. Post-freeze data changes never alter payouts.
- Coefficient applies twice in effect: to points (fairness on position boards) and as the league board's weight multiplier (share of the pool). Intentional, but worth stating in Docs.

**Prior art.** Sorare SO5 (decisive + all-around score, Opta). FPL (position-weighted goals, bonus points, and from 2025/26 defensive-contribution points). Playr (live points per play). score's matrix is closest to Sorare's all-around component.

---

## 8. Boards & payout split

**What it does.** After freeze, ranked players compete on several boards. The round pool is split across boards by weight, and within each board the top 5 take 35/25/20/12/8%. A player's payout is the sum across boards, then split pro rata among holders at kickoff.

**Rules.**
- Boards: FWD, MID, DEF, GK (×1.00), 7 league boards (× league coef), Champions League (×1.05, midweek only).
- Weight `= min(ranked, 5) × multiplier`. Board share `= pool × weight / Σweights`. Top-5 shares renormalised if fewer than 5 ranked (3 players → 35/25/20 → 43.75/31.25/25).
- Tie-break: goals + assists (desc) → fewer minutes → player ID. **Implemented** ID as ascending string order (SQ-21).
- Holder payout `= playerPayout × holderEligible / eligibleSupply`.

**Worked example ✓.** League weekend, every board ≥5, pool $10,000: Σ = 20 + 32.05 = 52.05; PL board $960.61; #1 $336.22; Haaland #1 FWD + #1 PL = $672.43; 1% holder → $6.72.

**Seed state (6 bonded, league weekend, pool $521):** FWD 5 (Kane, Yamal, Mbappé, Messi, Dembélé) + MID 1 (Rodri) + PL 1.00 (Rodri) + LAL 1.94 + BUN 0.93 + L1 0.88 + MLS 0.85 = **Σ 11.60** → $44.92 per weight unit. Rodri wins MID and PL alone: **$89.84 regardless of performance**. Kane: #1 FWD ($78.62 if he tops it) + sole BUN ($41.78).

**Connections.** Pool size from the controller (§9). Eligibility from the snapshot (§6). Claims (§10).

**Does it make sense?**
- Rank-only payouts (no market-cap weighting) keep small-cap players competitive, so there's real alpha in picking cheap performers.
- **Thin boards pay for showing up.** With few bonded players, a one-player league board pays 100% to that player, so early on payouts favour players alone in their league or position. It fades as the roster grows (200 players), but it shapes launch order: launching MLS/SPL players early makes their boards "free". Worth a decision on whether boards activate only at ≥3 ranked players (SQ-29).
- Per-weight value is equalised. Sole winner gets 1.0 unit; on a full board #1 gets 1.75, #2 1.25, #3 1.0, #4 0.6, #5 0.4. Reasonable.
- Midweek windows: proto keeps position and league boards active and ranks only UCL players on them. "Premier League board" in midweek means PL clubs' UCL players; MLS/SPL boards are empty (weight 0). The spec is silent and proto behaviour is kept (SQ-31). The same performance can win up to three boards (position + league + UCL).

**Edge cases.**
- **Dividend denominator (SQ-1) — the prototype bug.** Proto pays `d × held / p.sold`. After bonding `p.sold` is frozen at ≈6.4M (+ reserve mints). Pool buys move tokens from the pool to holders, so total holder tokens = `curveSold + 1.6M + minted − y`, which exceeds 6.4M whenever the price is above open. Σ payouts > 100% means overpay; below open it underpays. **Fix implemented** (`eligibleSupplyAtSnapshot`): `holderTokens + y × nonProtocolShares / totalShares`, i.e. every token except the protocol seed's share of the pool. Σ holder payouts ≤ player payout by construction (property-tested). The proto formula is kept as `prototypeHolderPayout()` for comparison and documented as wrong.
- **No ranked players** (international break, or no bonded player played): proto still debits the full round pool from the vault (`S.vault -= r.R` after an empty `live` list). Implemented: debit only what was allocated.
- A ranked player with zero eligible supply can't happen post-bond (curve buyers hold 6.4M), but the code guards division by zero and returns the share to the vault.

**Prior art.** Football Index: "Performance Buzz" paid the top player per position per day, so few winners and huge variance. Sorare: rank-tiered prize pools per competition. score's multi-board, top-5, renormalised split sits between them in variance.

---

## 9. Round pool controller & vault solvency

**What it does.** Each round pays a percentage of the vault, chosen from a matrix by runway (vault ÷ average payout) and vault/TVL. Smoothed ±10% per round, clamped to 0.20–2.50%, and capped at `TVL × 12% / 38` per round.

**Formula.** As ARCHITECTURE §4.9; `bucket(v; edges) = #edges ≤ v`. Ported 1:1 from proto `releasePool`.

**Seed run (vault $60k, 6 bonded, no other inflows):**

| Round | TVL | bps (after smoothing) | uncapped | cap | **paid** | effective % of vault |
|---|---|---|---|---|---|---|
| 1 | 165,000 | 100.0 | 600.0 | 521.1 | **521.1** | 0.87% |
| 2 | 164,479 | 110.0 | 654.3 | 519.4 | **519.4** | 0.87% |
| 3 | 163,960 | 121.0 | 713.4 | 517.8 | **517.8** | 0.88% |
| 6 | 162,411 | 161.1 | 924.6 | 512.9 | **512.9** | 0.89% |

Findings:
1. **The annual cap binds from round 1** while vault/TVL > ~28%. The matrix and smoothing only matter once the vault is small relative to TVL.
2. **Smoothing is applied to the pre-cap bps, so it ratchets up while capped** (100 → 110 → 121 → … → 200) without paying more. When the cap stops binding (TVL jumps after bonds), the payout can jump far more than +10% in one round. That breaks the "±10%/round" promise (SQ-15). Recommend smoothing the *effective* rate. Not changed in code (it's a spec formula), but flagged with a test that shows it.
3. **Proto displays `bps/100` as "% of the vault"**, which is wrong whenever the cap binds (shows 1.10%, actually 0.87%). **Implemented:** the UI shows the effective `roundPool / vault`.
4. **"Annual" cap assumes 38 rounds/year (SQ-16)**, but with weekend + midweek windows there are ~50–55 rounds a season, so the real ceiling is ~16–17% of TVL a year, not 12%. Worst case: 0.975^38 = 38% left (spec), but 0.975^55 = 25% left.
5. **TVL definition (SQ-2)** `bonded × 17,500 + vault` ignores pool growth, LP deposits and open curve funds. The controller keeps the spec formula; Docs/Stats also show actual pool USDC.

**Solvency.** `roundPool ≤ vault × 2.5%` means the vault can never go negative (property test). Inflows: 20% of every raise ($5k/bond), 90% of sell-side fees, USDC retained from token claims. Outflows: round pools only.

**Does it make sense?** Paying a % of a funded vault is the right answer to Football Index, because liabilities can't outgrow assets. The open economic question is the steady state after the launch phase: ~$1M of bonding inflow arrives in the first 20 weeks, then $5k/week. Long-run dividends depend on sell-tax turnover. That's for Step 2's season simulation (SQ-7, SQ-9).

**Prior art.** Football Index paid fixed per-share dividends from operating cash. Liabilities scaled with shares sold, and the cut triggered the collapse. Protocol-owned treasuries with a % emission (e.g. Olympus-style runway metrics) are the closer analogue, and the runway×ratio matrix is a sensible, more conservative version.

---

## 10. Claims

**What it does.** After settlement, a holder with winnings picks **USDC** or **the same player's tokens +10%** minted from that player's reserve. With tokens, the USDC stays in the vault. Pull-based.

**Formulas.** `tokens = min(usd × 1.1 / price, reserveLeft)`. Proto: `vault += usd`, `reserve −= q`, hold age merges `q` at `now`.

**Connections.** Extends runway (§9), dilutes future dividends per token (§8), adds circulating supply (§1), resets hold age a little (§4).

**Does it make sense?**
- The +10% is paid by other holders through dilution of future dividends, not by the vault. Cheap for the protocol, and a vote of confidence from claimants.
- Compared with "claim USDC then buy", the token route is ~10.3%+ better (no buy fee, LP fee or impact). Expect high token-claim uptake on top performers, so their reserves drain first.

**Edge cases.**
- **Partial reserve (SQ-18).** Proto mints `min(…, reserve)` and keeps the full USD in the vault, so the user silently loses the uncovered part. **Implemented:** tokens for the covered part, the remainder paid in USDC.
- **Claim-price manipulation (SQ-17).** Proto uses the spot price. A large claimant could push the price down (sell), claim tokens cheaply ×1.1, then buy back. Bounded by the 0.5–5% sell tax, but on-chain should use a TWAP. Mock uses spot (documented).
- **Hold age of minted tokens (SQ-24):** `now` (proto). Claiming tokens slightly *raises* your sell tax, a mild disincentive worth surfacing in the claim UI.
- **Unclaimed dividends (SQ-14):** no expiry defined. Implemented: claimable forever.
- Claims must cover all rounds and players at once (proto `claimDiv` is all-or-nothing per mode). Implemented the same, plus a per-player breakdown preview.

**Prior art.** Dividend reinvestment plans (DRIPs) in equities, often at a small discount. Football Index had no reinvestment option.

---

## 11. Delisting & governance

**What it does.** A player is delisted only if they leave the seven covered leagues or retire, never for form. Announced ≥2 rounds ahead, trading locks, and holders redeem pro rata from the pool with no sell tax. From Season 1, holders vote on new launches weighted by activity rank. Parameter changes go through a published, time-locked process.

**Does it make sense?** "Never for form" protects holders from a Football Index-style discretionary rug. Edge cases:
- **What happens to the protocol seed on delisting? (SQ-32)** The spec says it's "released", but to whom? If holders redeem pro rata *from the pool*, the seed's USDC presumably joins the payout. Needs a decision before Step 3.
- Transfers between covered leagues (e.g. PL → LAL) change board and coefficient, not listing status (SQ-10).
- Static copy only in Step 0 (non-goal).

**Prior art.** Football Index removed/expired players and later changed product terms unilaterally, which badly damaged trust. Chiliz fan-token polls: binding only on trivial decisions. score's vote is about which players launch, which is meaningful and low-risk.

---

## 12. Accounts, custody, wallets, geo-restrictions, Terms

**What it does.** Positions live inside the protocol (not free-floating SPL balances), so snapshots, hold age and sell tax can be enforced. Sign-in is an embedded wallet (Google/email, Privy-style) or Phantom, with fees sponsored. Geo-blocked list of 14 jurisdictions, 18+, Terms draft "for legal review".

**Does it make sense?** Protocol custody is the only way to enforce a per-user hold-age tax (ARCHITECTURE §6.1). The cost is no aggregator composability, which is deliberate. For a consumer product it's a plus: no tokens leaking into unrelated wallets or dumping via Jupiter.

**Edge cases.**
- **Restricted list includes the United Kingdom (SQ-11)** while the demo happens in London. The demo itself must use a non-restricted country selection. Spell this out in the demo script.
- Proto's sign-in auto-credits 1,000 test USDC on first sign-in. Implemented: credit on first sign-in **and** a faucet button (+$1,000) in the account menu.
- Sybil resistance is soft (see §2). Google sign-in isn't identity.
- Phantom users: same custody model. Phantom signs, positions are still protocol-held.

**Prior art.** Football Index: UK-licensed betting product (UKGC), which is why its collapse drew regulatory scrutiny (Gillen Review). Polymarket: geo-blocks the US with edge + wallet screening, the same three-layer approach as here.

---

## 13. Points / activity rank / seasons

**What it does.** Off-chain activity score from launch buys, holding, dividends, fees, volume and liquidity. Basis for Season 1 voting weight. Visibility hidden until Season 1.

**Proto.** `S.pts = {ico, hold, div, fee, vol, liq}`: `ico += usdc spent on curve`, `hold += tokens × price` per settled round, `div += dividends`, `fee += fees paid`, `vol += trade size`, `liq += limit fills`. No formula to combine them.

**Implemented.** The same components (liq = USDC supplied as LP instead of limit fills), shown as a breakdown, plus a provisional total = plain sum in USD units, marked `SPEC-QUESTION: SQ-26`.

**Does it make sense?** "Fees paid" and "volume" reward churn, and the protocol earns from churn, but it invites wash trading. With a 5% young-token tax wash trading is expensive, but `vol` points should be capped or weighted below `hold`. friend.tech's points farming is the cautionary tale: activity vanished when points ended.

---

## 14. Prior-art comparison

| | What happened | Borrow | Avoid | How score differs |
|---|---|---|---|---|
| **Football Index** (2015–21) | Player "shares" with media and performance dividends paid by the operator. The operator was the market maker. Dividend cut in Mar 2021, crash, administration. | Emotional pull of owning a player; matchday dividends; simple "back the player" framing. | Fixed dividend promises; liabilities that grow with every share sold; single market maker; unilateral rule changes. | Dividends are a bounded % of a funded vault; locked pool liquidity; fixed supply; time-locked parameter changes. Expect the London audience to raise FI. Pitch the controller table and the solvency property. |
| **Football.fun / Sport.fun** (Base, 2025) | Fractional player shares, packs, squad tournaments; fast TVL; criticised as reliant on new users. | Onboarding speed (USDC, embedded wallet), live market feel. | Packs/lineups complexity; expiring contracts; growth-dependent yields. | Passive "hold = entered", real-yield vault funded by sell tax + launches, curated launches. |
| **Sorare** | Licensed NFT cards; fantasy lineups; Opta-based SO5 scores. | Scoring transparency; player identity as collectible. | Lineup homework every week; illiquid card markets. | Fungible tokens with continuous pricing; no lineup. Users pick *which players to hold*. |
| **FPL** (free fantasy) | Massive habit loop around gameweek deadlines. | Gameweek rhythm, position-weighted scoring, live points. | — | Real money and ownership, so it needs a stronger trust story. |
| **Chiliz / Socios** | Club fan tokens, polls. | Proof that sports orgs engage with tokens. | Utility limited to trivial votes. | Player-level and performance-linked. |
| **Royaltiz** | Athlete tokens tied to athletes' income. | — | Popularity- and contract-based value. | Match performance, not popularity. |
| **Playr** | Live US-sports player prices. | Live UX: points landing per play, social feed. | — | Football, on-chain, dividends. |
| **pump.fun / Meteora DBC** | Bonding curve → AMM migration. | The launch → graduation moment; price continuity; locked LP. | Permissionless spam; bot sniping. | Curated schedule, USDC quote, 70/20/10 split, per-user sell tax. DBC's decaying anti-sniper fee is worth considering (SQ-25). |
| **friend.tech** | Person-keys on a curve, 10% fees, points. | — | Curve-only liquidity; points-driven activity that collapsed. | Graduates to a pool with low trading fees; retention from real-world fixtures. |

---

## 15. Consumer journeys

### (a) First-time fan on a phone
1. **Landing.** Five-second test: "Own the players. Earn when they perform." plus a live matchday card ("Kickoff in 0:32"). *Friction:* "bonding curve", "snapshot" and "hold age" are jargon. Landing must use "launch", "kickoff", "hold".
2. **Browse → player.** Tickers like `$HAALAND` at `$0.01087` look like penny stocks. *Friction:* sub-cent prices mean little to fans. Lead with $ amounts ("$10 buys 912 tokens"), price secondary.
3. **Buy → sign-in modal.** Google, country, Terms tick. *Friction:* if the country is restricted, the modal must say why and stop. Never fail later.
4. **Fund.** Faucet $1,000 (devnet). Real product: on-ramp. *Friction:* zero balance is the #1 drop-off. The faucet must be one tap and offered right where the buy fails.
5. **First buy.** On a launching player: fee 1.25%, cap usage, "you are here" on the curve. *Friction:* "why can't I buy $500?" (cap). The quote must state the max.
6. **First matchday.** Countdown to kickoff, "you'll be counted with 912 HAALAND". At kickoff: toast "Snapshot taken". Live: your-players strip with provisional earnings. *Friction:* if the player was on the curve at kickoff they don't count. Say so.
7. **First claim.** Full-time modal: "You earned $1.42. Take USDC, or 140 HAALAND (+10%)". *Friction:* the token option's sell-tax side effect (fresh tokens) should be one line, not a surprise.

### (b) Trader on desktop: launch sniping + LP
1. Launch schedule shows 14:00/20:00 UTC slots. Trader opens the player 1 min before.
2. At launch: Pro view, max-buy 240k tokens. The cap stops them at ~$95. *Friction:* no way to buy more legitimately, which pushes them toward extra accounts (SQ-25).
3. After bonding: 5% sell tax on day 0, so flipping is −5% + impact. They hold, or LP.
4. LP: zap $2,000. Sees pool share %, fee APR (demo volume, flagged), IL slider, LP-attributed tokens counted at kickoff. *Friction:* fee APR at demo volume is misleading. Show it with the "modelled turnover" caveat.
5. Withdraws later; tokens rejoin with their hold age. *Friction:* "why did I get more tokens than I put in?" (IL). Explain on the withdraw preview.

### (c) A week of rounds for a holder
- **Fri 19:00 UTC** League kickoff → snapshot #N. **Fri–Mon** live (provisional). **Mon ~21:30** last whistle.
- **Tue ~09:30** freeze → settle → claimable. **Tue 17:45** UCL kickoff → snapshot #N+1: only UCL-club players can rank.
- **Fri ~09:00** UCL freeze → claim. **Fri 19:00** next weekend.
- *Friction:* two claim moments a week, and token claims count for the next round only if claimed before the next kickoff (SQ-3). An "auto-claim as tokens" setting would remove the chore. Midweek, holders of non-UCL players earn nothing. The matchday page must show "not playing this window" per position.

---

## 16. Prototype review

**What works (keep):**
- The core loop is fully playable in one file. Demo clock compression (40s/50s) is the right demo device.
- Honest copy: LP fee realism note, "Dividends are not guaranteed", "Draft for legal review".
- Bonding curve chart with "you are here" and the $25k marker. Hold-age meter next to the sell button. Sell-tax slider in Docs.
- Geo-restriction modal flow and Terms content (ported verbatim).
- The Docs content (stats, scoring calculator, boards, controller matrix) is accurate to the spec.

**Logic bugs found:** dividend denominator (SQ-1); round pool % shown pre-cap (SQ-15); smoothing ratchets behind the cap (SQ-15); full round pool debited when nothing is allocated (§8); ICO cap counter decremented on sells (SQ-19); overshoot breaks the 8M float (SQ-12); partial-reserve token claims lose value (SQ-18); rank requires `score > 0` instead of `minutes > 0` (SQ-20); display score breaks for negative P (SQ-20); limit orders fill at the limit price with no counterparty (SQ-6); no tie-breaks applied (`sort` by score only). **Persistence bug:** only `S` is saved to localStorage, not `P` (players). After a reload, curve progress, prices, reserves and dividends reset while the user's holdings persist, so state goes inconsistent. The mock persists the full state with a versioned key.

**UI/IA problems:**
- **Two stacked design systems:** a first `:root` (indigo/violet gradients, 18–22px radii) fully overridden by a second `:root` (mono terminal, 3–4px radii, uppercase buttons). Dead CSS and inconsistent leftovers (the `.pc` player cards keep gradient/rotate hovers).
- **Monospace everywhere** (`body{font:13px ui-monospace}`), uppercase nav and headers. Hard to read on a phone; numbers don't stand out from prose.
- **One green for everything:** `--g` is brand accent, CTA background, "up" colour, chart line, chips and progress fill. Up/down can't be read at a glance. Spec: green/red only for P&L.
- **Synthetic order book** on an AMM (random levels, fixed "spread 0.4%"). It misleads traders.
- **No Portfolio page.** Positions hide in a tab under the trade terminal; claimable dividends only appear on the Board page or in a modal.
- **Full-page `innerHTML` re-renders** every second on `/board`, on every input event in calculators, and on every action. That wipes input focus, scroll position and text selection, and costs performance.
- **Two player pages**: `/player/:id` and `/trade?p=` / `/ico?p=` show overlapping data with different tabs. Spec merges them into one hub with two states.
- Rarity tiers ("Legendary/Epic/Rare/Core") derive from `avg` and add noise. **Dropped** (recommendation for Step 1: rely on board rank + form sparkline).
- Charts: SVG with duplicated gradient ids (`gg`), fake 24h history for curve players (`ser` rescales the random walk), indicators on 48 points.
- Accessibility: clickable `<tr>` and `<div>` without keyboard support; no focus styles; emoji-only meaning in the feed (⚽ 🅰️ 🎯).

---

## 17. Open questions

From ARCHITECTURE §10 (with Step 0 resolution) plus new ones. **Conservative pick** = what the code does now.

| # | Question | Conservative pick (implemented) |
|---|---|---|
| SQ-1 | Dividend denominator (`p.sold` overpays). | `eligibleSupplyAtSnapshot` = holder tokens + non-protocol LP-attributed tokens. Proto formula kept as `prototypeHolderPayout` for reference. |
| SQ-2 | TVL definition ignores pool growth / open curve funds. | Controller uses spec formula; Stats also shows actual pool USDC. |
| SQ-3 | Freeze → next kickoff gap (~8h Tue). Token claims vs next snapshot. | Token claims count only if made before the next kickoff (proto). |
| SQ-4 | No-match weeks, international breaks, domestic cups. | No window means no round, nothing paid. Cups excluded. |
| SQ-5 | No GKs in seed; GK board never forms. | Simulator supports GKs; seed unchanged; GK board excluded when empty. **Recommend adding 2–3 GKs.** |
| SQ-6 | Limit orders need a keeper; synthetic order book. | Limit orders dropped; impact ladder, pool depth and recent trades instead. |
| SQ-7 | Vault sustainability after the launch phase. | Step 2 simulation. |
| SQ-8 | LP economics: 0.25% alone is thin. | LP dividends on pool-token share (spec). Points for liquidity provided. |
| SQ-9 | Treasury backstop for the vault. | None in Step 0. |
| SQ-10 | Postponed/abandoned matches, double fixtures, transfers, position classification. | Positions fixed per season (seed). One match per window per player in the sim. |
| SQ-11 | UK on the restricted list while pitching in London; "dividends" wording. | Kept as spec; demo script picks a non-restricted country. |
| SQ-12 | Curve overshoot on the bonding buy. | Partial fill to `S_max`, refund the excess. |
| SQ-13 | Data provider (Opta vs API-Football/Sportmonks). | Simulator only in Step 0. |
| SQ-14 | Unclaimed dividends: expiry? | No expiry. |
| SQ-15 | Controller smoothing applies to pre-cap bps (ratchets while capped); UI showed pre-cap %. | Formula kept as spec; UI shows effective % (`pool / vault`). Recommend smoothing the effective rate. |
| SQ-16 | "Annual" cap uses 38 rounds, but ~50–55 windows/yr. | Kept 38 (spec). |
| SQ-17 | Token-claim price manipulation (spot). | Spot in mock; recommend TWAP on-chain. |
| SQ-18 | Partial reserve on token claim. | Tokens for the covered part, remainder in USDC. |
| SQ-19 | Launch cap: gross cumulative (spec) vs net (proto). | Gross cumulative purchases. |
| SQ-20 | "Played" = minutes > 0 vs score > 0; display score for P ≤ 0. | `minutes > 0`; display clamps to 0. |
| SQ-21 | Tie-break direction for player ID. | Ascending ID string. |
| SQ-22 | 0.25% LP fee on every swap isn't in the Terms or the ticket copy. | Charged on pool swaps (spec §4.5, "proposed") and shown in every quote. Terms need an update. |
| SQ-23 | Hold age laundering via LP rebalancing. | Proto behaviour (LP age carries over). Flag for the program. |
| SQ-24 | Hold age of minted dividend tokens. | `now` (proto). Shown in claim UI. |
| SQ-25 | Launch fairness: low start price + token cap = sybil magnet at fixed launch times. | Unchanged; needs a product decision. |
| SQ-26 | Activity points formula / weights. | Components shown; provisional total = sum. |
| SQ-27 | Seed prices for bonded players in the demo. | Pool reserves derived as if the seed pool traded from $0.0109375 to the proto's last price (`x = √(kP)`, `y = √(k/P)`), plus the proto's third-party LP depth. |
| SQ-28 | Demo realism: ambient market activity moves prices and routes real fees into the vault. | Synthetic traders run through the real pool maths (demo only, can be toggled). |
| SQ-29 | Thin boards pay regardless of performance. Minimum ranked count to activate a board? | Spec (any ≥1). |
| SQ-30 | Player bonding mid-window: ranked this round? | Only players bonded at kickoff rank. |
| SQ-31 | Midweek windows: position/league boards active (proto) or UCL board only? | Proto: all boards, only UCL players rank. |
| SQ-32 | Delisting: who receives the protocol seed's USDC? | Not implemented (static copy). |
| SQ-33 | Rounds per season vs demo calendar: proto cycles 4 fixed windows. | Both modes use one generated calendar (round 1 = Fri 30 Oct, alternating league weekend / UCL midweek), so the first 4 rounds match the prototype and it continues past them. |
| SQ-34 | Clean sheet "× minutes/90" with extra time (>90 min). | Factor capped at 1. |
| SQ-35 | The curve constants give `S_max = 6,400,040`, not 6,400,000. Float = 8,000,040, so a full 2M reserve would allow 10,000,040 tokens. | Reserve after bonding = `min(2M, 10M − curveSold − 1.6M)` = 1,999,960. Prices unchanged. Alternative: tweak `1.1649e16` so S_max is exactly 6.4M. |
