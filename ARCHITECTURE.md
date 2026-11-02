# score — Architecture & Product Spec

> Football player trading protocol on Solana. Players launch on a bonding curve, graduate into a protocol-owned trading pool, and every matchday the holders of real footballers who finish top 5 on a leaderboard earn USDC dividends from a shared vault.
>
> **Audience for this doc:** Claude Code (and humans) building the app. Read it end to end before writing code. `PLAN.md` says *what to do in which order*; this file says *what the product is and how it works*.

---

## 0. Sources of truth

| Source | What it is | Use it for |
|---|---|---|
| `docs/concept/score-terminal-v4.html` | The founder's working prototype (single HTML file, simulated, devnet copy). | Exact numbers, formulas, tables (`MX`, `MXC`, `COEF`, `T`, curve functions), seed player list, copy for Docs/Terms. **If this doc and the prototype disagree on a number, flag it in `docs/ANALYSIS.md` and ask — do not silently pick one.** |
| This file | Distilled spec + architecture decisions. | Mechanics, competition logic, system design, stack, repo layout. |
| `PLAN.md` | Ordered steps with gates. | What to build now. |

Brand name is lowercase **score** (logo `score▮`). Event target: Solana Breakpoint, London, 15–17 Nov 2026 (Hacker House 1–14 Nov). Everything runs on **devnet with simulated funds** for now.

---

## 1. The product in one paragraph

Every real footballer (Haaland, Yamal, Saliba…) gets their own fixed-supply token priced in USDC. A player **launches** on a bonding curve; early buyers get the lowest price. At **$25k raised** the player **bonds**: most of the money seeds a permanent trading pool, some goes to a shared **dividend vault**, some to the **treasury**. After that the token trades freely in the pool, with a **sell tax that falls the longer you hold**. Every **matchday window** (league weekend or Champions League midweek), the protocol records who holds what at the **first kickoff**, scores every real player from licensed match data, ranks them on **leaderboards** (by position, by league, by Champions League), and pays the **top 5 on each board**. Each player's prize is split pro rata among the people who held that player at kickoff. Holders claim in **USDC**, or in **more of the same player's tokens with a 10% bonus**.

**The one-line pitch:** *Own the players. Earn when they perform. Early sellers fund the holders.*

### Core user loop

```
discover player → buy (on curve or in pool) → hold through kickoff
→ watch the live board → full time → claim USDC or +10% tokens → repeat
```

There is **no lineup and no head-to-head between users**. The *footballers* compete on the pitch; users compete indirectly by picking which players to hold (fixed prize pool per round; dilution among holders of the same player; price speculation).

---

## 2. Glossary (use these words consistently in code and UI)

| Term | Meaning |
|---|---|
| **Player** | A real footballer. Has one token (`ticker`, e.g. `HAALAND`). Never a user. |
| **Holder / user** | A person on the app holding player tokens. |
| **Launch / ICO** | Pre-bonding phase. Price set by the bonding curve. |
| **Bond / bonding** | Moment the curve hits $25k raised; player graduates to trading. |
| **Pool** | The player's post-bond constant-product trading pool (USDC ↔ player token). |
| **Locked seed** | The protocol's permanent pool liquidity from bonding (70% of raise + 1.6M tokens). |
| **Dividend vault** | One shared USDC pot that funds all matchday payouts. |
| **Treasury** | Protocol/team revenue. |
| **Reserve** | Each player's 2M-token reserve, minted only when holders take dividends as tokens (or for capped prizes). |
| **Window / matchday / round** | A fixture window: League weekend (Fri→Mon) or Champions League midweek (Tue→Thu). One round of payouts per window. |
| **Snapshot** | Record of every holder's balance (incl. LP share) at the **first kickoff** of a window. The only thing that decides eligibility. |
| **Live** | Between first kickoff and last whistle. Provisional scores update in real time (display only). |
| **Freeze** | 12h after the last whistle of the window. Match data becomes final. |
| **Settlement** | After freeze: rank boards, size the round pool, credit winners. |
| **Board** | A leaderboard: 4 position boards, 7 league boards, + Champions League board in midweek windows. |
| **Round pool** | The slice of the vault released for one round (0.20–2.50%). |
| **Hold age** | Quantity-weighted average age of a user's tokens in a player. Drives the sell tax. |
| **Points / activity rank** | Off-chain user activity score (launch buys, holding, dividends, fees, volume, liquidity). Basis for Season 1 voting weight. |

---

## 3. Prior art — what we borrow, what we do differently

| Product | What it does | Borrow | Do differently |
|---|---|---|---|
| **Football Index** (UK, 2015–2021, collapsed) | "Stock market" for player shares paying performance + media dividends. Collapsed after cutting max dividend 14p→3p; liabilities grew with every share sold. | Dividends tied to real performance; the emotional pull of "owning" a player. | **Dividends are never promised.** Paid only as a bounded % of a funded vault (controller with ±10%/round smoothing). Locked pool liquidity, so there's always an exit. No minting new supply to raise cash. Expect the London audience to remember this — it is our main objection to pre-empt. |
| **Football.fun / Sport.fun** (Base, Aug 2025) | Fractional player shares, random packs, bi-weekly squad tournaments, contracts that deplete; FUN token (Jan 2026). $100M TVL in 2 weeks; criticised as dependent on new users. | Speed of onboarding (USDC, embedded wallet), "own players from top leagues", live market feel. | No packs, no lineups, no contract renewals. **Real yield path**: sell tax + launch proceeds fund a vault that pays holders of top performers. Proper AMM liquidity anyone can LP. Solana-native. |
| **Sorare** | Licensed NFT player cards for fantasy; cards on Solana as cNFTs. | Player identity as a collectible; scoring from match stats. | Fungible tokens with continuous price; passive "hold = entered". |
| **Chiliz Fan Tokens** (on Solana since Apr 2026) | Licensed club-level tokens. | Proof Solana courts sports. | Player-level, performance-linked. |
| **Royaltiz** | Athlete tokens tied to popularity (Camavinga on Solana). | — | Payouts tied to match performance, not popularity. |
| **Playr** | Mobile app, US sports, player prices move live with plays. | **Live UX**: points landing as plays happen, social feed. | Football; on-chain; dividends. |
| **pump.fun / Meteora DBC** | Bonding-curve launch → migrate to AMM. | The launch mechanic and graduation moment. | Curated schedule (no spam players), USDC quote, custom split (70/20/10), custom per-user sell tax. |
| **friend.tech** | One bonding-curve asset per person; faded after incentives. | — | Retention via weekly matchday rhythm and real-world events, not points farming. |

UI references (style, not copy): **Polymarket** (consumer clarity), **Hyperliquid / Jupiter** (pro trading view), **Robinhood** (portfolio, claim moments), **FotMob** (live match centre).

---

## 4. Mechanics spec

All money in **USDC**. All parameters below should live in a single typed config (`packages/core/src/config.ts`) — never hard-code in UI.

### 4.1 Supply per player

| Bucket | Tokens | Notes |
|---|---|---|
| Float | 8,000,000 | 6.4M sold on curve + 1.6M seeded into pool at bonding |
| Dividend reserve | 2,000,000 | Minted only on token-dividend elections; up to 25% may fund airdrops/prizes |
| **Max supply** | **10,000,000** | Never exceeded |

### 4.2 Launch (bonding curve)

- Curve (USDC raised `R` as a function of tokens sold `S`):
  `R(S) = 0.00039·S + S³ / 1.1649e16`
  Spot price: `P(S) = dR/dS = 0.00039 + S² / 3.883e15`
- Starts at **$0.00039**. Bonds at **$25,000 raised** → `S_max ≈ 6.4M` tokens sold, average price ≈ **$0.0039**, end price ≈ **$0.01094**.
- Buys and sells allowed on the curve. **Flat 1.25% fee** each way (buy fee deducted from the USDC going in; sell fee from USDC coming out).
- **Anti-whale cap:** 240,000 tokens (3% of float) **per purchase and cumulative per account** during launch.
- Inverse (`tokens for USDC`) is solved numerically (bisection) in the prototype — keep it deterministic and tested.
- **Launch schedule:** 2 per weekday at 14:00 and 20:00 UTC (10/week) until 200 players (~week 20), then 1/week chosen by holder vote (weighted by activity rank, from Season 1). Launches are **curated**, never permissionless.

### 4.3 Bonding (graduation)

When `raised ≥ $25,000`:

| Destination | Share | On a $25k raise |
|---|---|---|
| Locked pool seed (paired with 1.6M tokens) | 70% | $17,500 |
| Dividend vault | 20% | $5,000 |
| Treasury | 10% | $2,500 |

Pool opens at `17,500 / 1,600,000 = $0.0109375` — continuous with the curve's end price (that's by design). The seed is **permanent**; released only on delisting. Split applies to the actual amount raised (last buy may overshoot).

### 4.4 Trading after bonding

- Pool: constant product (`x·y = k`) USDC/player token.
- **Buy fee: 0.05% (5 bps)** → 100% treasury.
- **Sell tax:** `tax(d) = max(0.005, 0.05 − 0.045·min(1, d/90))` where `d` = hold age in days → 5% at day 0, 2.75% at day 45, 0.5% from day 90.
- **Sell-side fee routing (curve and pool): 90% dividend vault / 10% treasury.** Buy-side fees always → treasury.
- **Hold age** = quantity-weighted average acquisition time: on buy, `t = (t·h + now·q)/(h + q)`. Sells don't change `t`. Preserved through LP deposits/withdrawals (cannot be reset).
- Prototype also has **limit orders** that rest as maker liquidity (0 fee) — see open questions; on an AMM this needs a keeper or should be dropped.

### 4.5 Liquidity providers

- Anyone can add USDC + player token (or USDC-only "zap": swap half, then deposit) and earn a **proposed 0.25%** swap fee kept in the pool.
- LPs **earn dividends** on their share of the pool's tokens at the kickoff snapshot. The protocol's locked seed earns nothing.
- Add/remove allowed during matchdays.
- Honest note already in the concept: at realistic turnover a 0.25% fee yields ~1.3%/yr, so LPs likely need dividend pass-through and/or points to be worth it.

### 4.6 Matchday windows & snapshot

| Window | Days | Who plays |
|---|---|---|
| League weekend | Fri → Mon | All covered leagues |
| Champions League midweek | Tue → Thu | Only players at clubs in the competition |

- **Snapshot at first kickoff** of the window: balances + LP-attributed tokens, per user per player. **Trading stays open** throughout.
- Buying after the snapshot earns nothing this round; selling after it still earns in full.
- Snapshot gaming (buy just before kickoff, dump after) is deterred economically by the 5% early sell tax, not by locks.

### 4.7 Scoring

Each player is scored on **their own contribution**, by **position** (positions fixed per season), using the event matrix, plus per-minute points, then multiplied by a **competition coefficient**.

**Event matrix (points per event):**

| Event | FWD | MID | DEF | GK |
|---|---|---|---|---|
| Goal | 6 | 7 | 9 | 12 |
| Assist | 4 | 4.5 | 5.5 | 6 |
| xG created (per 1.0) | 1.5 | 1.5 | 1.5 | 1.5 |
| Shot on target | 0.5 | 0.7 | 1 | 1.5 |
| Key pass | 0.5 | 0.7 | 1 | 1.2 |
| Successful dribble | 0.4 | 0.4 | 0.6 | 0.6 |
| Progressive pass or carry | 0.08 | 0.1 | 0.12 | 0.12 |
| Pass completed | 0.02 | 0.02 | 0.02 | 0.02 |
| Pass failed | −0.03 | −0.03 | −0.03 | −0.03 |
| Tackle won | 0.8 | 0.5 | 0.35 | 0.5 |
| Interception | 0.3 | 0.4 | 0.4 | 0.3 |
| Clearance | 0.1 | 0.15 | 0.2 | 0.2 |
| Ball recovery | 0.1 | 0.1 | 0.1 | 0.1 |
| Aerial duel won | 0.2 | 0.2 | 0.3 | 0.2 |
| Save | 0 | 0 | 0 | 0.8 |
| Penalty saved | 0 | 0 | 0 | 4 |
| Clean sheet (× minutes/90) | 0 | 1 | 3 | 4 |
| Goal conceded on pitch | 0 | −0.1 | −0.6 | −0.9 |
| Penalty won | 1 | 1 | 1 | 1 |
| Penalty conceded | −1 | −1.5 | −1.8 | −2 |
| Penalty missed | −3 | −3 | −3 | −3 |
| Own goal | −4 | −4 | −4 | −4 |
| Error leading to goal | −2 | −2.5 | −3.5 | −4 |
| Error leading to shot | −1 | −1 | −1 | −1 |
| Yellow card | −0.8 | −0.8 | −0.8 | −0.8 |
| Red card | −3 | −3 | −3 | −3 |
| Foul committed | −0.2 | −0.15 | −0.1 | −0.2 |
| Dispossessed | −0.2 | −0.2 | −0.2 | −0.2 |
| Offside | −0.1 | −0.1 | −0.1 | −0.1 |
| Minutes (per minute) | 0.012 | 0.012 | 0.012 | 0.012 |

**Coefficients:** Champions League 1.05 · Premier League 1.00 · La Liga 0.97 · Bundesliga 0.93 · Serie A 0.93 · Ligue 1 0.88 · MLS 0.85* · Saudi Pro League 0.85* (*provisional).

- **Display score** (UI only, 0–10): `10·P / (P + 6)`. Rankings always use raw points `P`.
- Data: licensed provider (concept names Opta; hackathon uses API-Football or Sportmonks). **Frozen 12h after the last whistle of the window; frozen results are final; later corrections are never applied.**
- The prototype's live simulator uses a reduced 5-event table (`T`: goal, assist, shot on target, key pass, tackle won) — that is a demo shortcut; the full matrix above is the spec.

### 4.8 Boards & payout split

- Ranked: **bonded players who actually played** in the window.
- Boards: **FWD, MID, DEF, GK** (multiplier 1.00 each) · **7 league boards** (multiplier = league coefficient) · **Champions League board** (×1.05, midweek windows only).
- A player can win on **several boards** in the same round (e.g. #1 FWD and #1 Premier League).
- **Board weight** = `min(rankedPlayers, 5) × multiplier`. **Board share** = `roundPool × weight / Σ weights`.
- **Within a board:** top 5 get **35 / 25 / 20 / 12 / 8%** (renormalised if fewer than 5 ranked).
- **Tie-breaks:** goals + assists → fewer minutes → player ID.
- **Player payout** = sum of their board winnings.
- **Holder payout** = `playerPayout × holderSnapshotTokens / eligibleTokens` (see open question Q1 on the denominator).

**Worked example (use as a test vector):** league weekend, every board has ≥5 ranked players, round pool $10,000.
Weights: 4 position boards × 5.00 = 20.00; leagues 5.00 + 4.85 + 4.65 + 4.65 + 4.40 + 4.25 + 4.25 = 32.05; **Σ = 52.05**.
Premier League board = 10,000 × 5/52.05 = **$960.61**; #1 = 35% = **$336.22**. Haaland #1 FWD and #1 PL → **$672.43**. A holder with 1% of eligible Haaland tokens → **$6.72**.

### 4.9 Round pool controller (vault solvency)

The vault pays a **percentage of itself**, never a fixed amount — so it can shrink but never hit zero (worst case 2.5%/round for 38 rounds with zero inflow leaves ~38%).

```
TVL      = bondedPlayers × 17,500 + vault          (prototype approximation — see Q2)
avgPay   = mean(last 8 round payouts)
runway   = vault / avgPay                           (in rounds)
ratioBps = vault / TVL × 10,000
bps      = no history ? 100 : MXC[bucket(runway; 20,40,80,160)][bucket(ratioBps; 500,1500,3000)]
bps      = clamp(bps, prevBps × 0.9, prevBps × 1.1)  (if prev exists)
bps      = clamp(bps, 20, 250)
roundPool = min(vault × bps / 10,000,  TVL × 0.12 / 38)
```

`MXC` (bps), rows = runway, columns = vault/TVL:

| Runway \ Vault/TVL | <5% | 5–15% | 15–30% | >30% |
|---|---|---|---|---|
| <20 rounds | 25 | 40 | 50 | 60 |
| 20–40 | 50 | 75 | 90 | 110 |
| 40–80 | 75 | 110 | 135 | 160 |
| 80–160 | 100 | 140 | 170 | 200 |
| >160 | 120 | 160 | 190 | 220 |

**Vault inflows:** 20% of every bonding raise; 90% of all sell-side fees; USDC retained when holders elect token dividends. **Outflows:** round pools only. Weeks without matches pay nothing.

### 4.10 Claiming dividends

After settlement, a holder with eligible winnings chooses:
- **USDC**, or
- **Tokens of the same player with a +10% bonus**: `tokens = min(usd × 1.1 / price, reserveLeft)`, minted from that player's reserve; the USDC **stays in the vault** (extends runway). Reserve empty → USDC only.

Claims are **pull-based** (holder claims; nothing is pushed).

### 4.11 Delisting & governance

- Delist **only** if a player leaves the seven covered leagues or retires — never for form.
- Announced ≥2 rounds ahead → trading locks → holders redeem pro rata from the pool with no sell tax.
- From Season 1: holders vote on new launches, weighted by activity rank (voting power hidden until Season 1).
- Parameter changes via a published, time-locked process.

### 4.12 Accounts, custody, compliance

- **Positions are held inside the protocol**, not as free-floating wallet tokens — this is what makes the snapshot, hold age and sell tax enforceable. Trade-off: no Jupiter/aggregator composability (deliberate for v1).
- Sign-in: embedded wallet (Privy-style: Google / email) or Phantom. No SOL needed (fees sponsored).
- **Geo-restrictions** (draft list): United States, United Kingdom, Netherlands, France, Belgium, Australia, Singapore, Canada (Ontario), China, Russia, Iran, North Korea, Syria, Cuba. Enforced at edge (IP), at sign-in (location + attestation), and by wallet screening.
- 18+. Terms draft lives in the prototype (`terms()`), "for legal review".
- **Never use player photos, club crests or league logos** (licensing). Player identity is typographic (ticker, position colour, form).

---

## 5. Competition logic (end-to-end)

### 5.1 Round state machine

```
OPEN ──first kickoff──▶ LIVE ──last whistle──▶ ENDED ──+12h──▶ FROZEN ──▶ SETTLED ──▶ CLAIMABLE
  ▲   (snapshot taken)   (provisional scores,   (data still    (data final)  (boards ranked,  (holders pull
  │                       trading open)          correcting)                  pool sized,      USDC or tokens)
  └────────────────────────────── next window's first kickoff ───────────────────────────────┘
```

- **Exactly one snapshot per round, at the start.** No end snapshot.
- **Freeze happens before ranking.** Live scores are display-only; payouts use frozen data only.
- Only match data freezes — trading never pauses.

### 5.2 A real week (example)

| When (UK) | Event |
|---|---|
| Fri 30 Oct, first league kickoff | Snapshot #N. Round N live. |
| Fri–Mon | Matches; provisional points on the Board; trading open. |
| Mon 2 Nov, last whistle | Round N ends. |
| Tue 3 Nov, ~12h later | Freeze → settle → claimable. |
| Tue 3 Nov, first Champions League kickoff | Snapshot #N+1. |

The gap between freeze and the next kickoff is short — token dividends claimed before kickoff count in the next round (see Q3).

### 5.3 Demo mode

The prototype compresses a window into **40s OPEN + 50s LIVE** and generates simulated events. Keep this as an explicit **Demo clock** (toggle in a dev/demo menu) — it is how judges see a whole round in ~2 minutes. Real-calendar mode uses actual fixture times.

---

## 6. System architecture

```mermaid
flowchart TB
  subgraph Client
    WEB[Next.js web app\nMarkets · Player · Matchday · Portfolio · Docs]
    WAL[Wallet\nembedded (Privy) or Phantom]
  end
  subgraph OnChain[Solana programs — FUTURE, do not build yet]
    LP[Launch: curve + bonding]
    POOL[Pool: CPMM + sell tax + hold age]
    VAULT[Vault + Treasury]
    MD[Matchday: snapshot, results, payouts, claims]
  end
  subgraph OffChain[Off-chain services]
    DATA[Match data provider]
    SCORE[Scoring engine\n= packages/core]
    ORA[Oracle signer]
    IDX[Indexer + API + realtime]
  end
  WEB --> WAL --> OnChain
  DATA --> SCORE --> ORA --> MD
  OnChain --> IDX --> WEB
  SCORE -. provisional live scores .-> IDX
```

**Trust split — "off-chain decides who, on-chain decides how much":** the oracle only posts rankings (+ hashes of raw data and formula). Pool sizing, board split, holder shares and claims are computed on-chain from the vault's own state. A compromised oracle can misrank but cannot drain the vault.

### 6.1 Why a custom Anchor program (decision record)

| Option | Verdict | Reason |
|---|---|---|
| pump.fun + PumpSwap | ❌ | Their platform, supply model, fees, migration; no custom split/tax/curation. |
| Meteora DBC → DAMM v2 | ⚠️ | Excellent launch primitive (custom multi-segment curves, USDC quote, auto-migration), but fees are per pool (no per-user hold-age tax), tokens trade freely via aggregators (breaks snapshot/tax), exact 70/20/10 needs workarounds. |
| Meteora DLMM | ⚠️ later | Tightest spreads, but no auto-migration from DBC, active LP management, same per-user tax issue. |
| **Custom Anchor program** | ✅ | Every mechanic works as designed; curve + CPMM maths is small; the real work (positions, hold age, snapshots, claims) is needed regardless. Roadmap for tighter spreads: concentrated liquidity in our own pool. |

### 6.2 On-chain design — FUTURE (documented so the frontend interfaces match; **do not implement now**)

Single Anchor program, modules: `launch`, `pool`, `vault`, `matchday`, `claims`, `admin`.

Accounts (sketch):
- `Config` — params, authorities (admin, oracle), treasury/vault addresses, USDC mint.
- `Player` — mint, status (Launching/Trading/Delisted), curve sold/raised, pool reserves, reserve tokens left, per-round reward accumulator.
- `Position` (user × player) — balance, weighted hold-age timestamp, LP shares, `balanceAtRoundStart` + `lastRound` (lazy snapshot: when a position changes during a live round, it first records its pre-change balance for that round — no iteration over holders).
- `Round` — window id, phase, snapshot slot/time, results (top 5 per board), data hash, formula hash, pool size, totals.
- `Claim` receipts (or a claimed-round bitmap on `Position`).

Instructions (sketch): `init_config`, `create_player`, `curve_buy`, `curve_sell`, `bond`, `pool_buy`, `pool_sell`, `add_liquidity`, `remove_liquidity`, `open_round`, `start_round` (snapshot), `post_results` (oracle), `settle_round`, `claim_usdc`, `claim_tokens`, `delist_player`, `redeem_delisted`.

Tokens: one SPL mint per player, program PDA as mint authority; user balances tracked in `Position` (protocol-held custody). Metadata via Metaplex.

### 6.3 Off-chain services — FUTURE except the shared core

- **Scoring engine** = `packages/core` (pure TypeScript). The same code computes live provisional scores for the UI and final results for the oracle, so they can never disagree on the formula.
- **Oracle signer:** single admin key (hackathon) → Squads multisig with independent recomputation + challenge window → Switchboard / TxLINE later.
- **Ingestion worker:** pulls fixtures + events, computes scores, handles freeze timing (from the window's last whistle; delay freeze if the feed is incomplete).
- **Indexer + API + realtime:** Helius RPC/webhooks → Postgres (Supabase) → realtime channel to the app.

---

## 7. Frontend architecture — NOW

### 7.1 Stack

- **Scaffold:** `create-solana-dapp` template `gill-next-tailwind-basic` (Next.js, Tailwind, shadcn/ui, gill on @solana/kit, Wallet UI, Anchor example, Codama). The template's Anchor example **stays untouched**.
- TypeScript strict, pnpm, ESLint, Prettier, Vitest.
- Data/state: TanStack Query (wrapping the `ProtocolClient`), Zustand for session/demo state.
- Charts: TradingView **Lightweight Charts** (price) + custom SVG (bonding curve).
- Motion: one library (Framer Motion/Motion by default; Step 1 may justify otherwise — record it in `docs/DECISIONS.md`).
- Wallet: Wallet UI for Phantom now; embedded wallet (Privy) mocked by a sign-in modal until we have an app ID.

### 7.2 The `ProtocolClient` seam (most important frontend decision)

The UI **never** talks to mock state or chain directly. It talks to an interface:

```ts
interface ProtocolClient {
  // reads
  getConfig(): Promise<ProtocolConfig>
  listPlayers(filter?: PlayerFilter): Promise<PlayerSummary[]>
  getPlayer(id: PlayerId): Promise<PlayerDetail>
  getPriceHistory(id: PlayerId, range: Range): Promise<PricePoint[]>
  getRound(): Promise<RoundState>              // phase, window, countdown, provisional scores, boards
  getRoundHistory(limit: number): Promise<RoundResult[]>
  getPortfolio(user: UserId): Promise<Portfolio> // positions, hold age, sell tax now, LP, claimable
  getProtocolStats(): Promise<ProtocolStats>   // TVL, vault, runway, round pool bps, treasury…
  // quotes (pure, no side effects)
  quoteBuy(id: PlayerId, usdc: number): Quote  // tokens out, fee, price impact, cap usage
  quoteSell(id: PlayerId, usdc: number): Quote // tokens in, tax %, fee, USDC out
  // actions
  buy(id: PlayerId, usdc: number): Promise<TxResult>
  sell(id: PlayerId, usdc: number): Promise<TxResult>
  addLiquidity(id: PlayerId, usdc: number, mode: 'pair' | 'zap'): Promise<TxResult>
  removeLiquidity(id: PlayerId): Promise<TxResult>
  claim(mode: 'usdc' | 'tokens'): Promise<TxResult>
  faucet(amount: number): Promise<TxResult>    // devnet test USDC
  // live
  subscribe(handler: (e: ProtocolEvent) => void): Unsubscribe // price ticks, match events, phase changes, bonded, settled
}
```

Implementations:
- `MockProtocolClient` (now) — wraps `packages/core` maths + in-memory state persisted to `localStorage`, driven by a `DemoClock`. Ports the prototype's behaviour faithfully.
- `OnchainProtocolClient` (later) — Codama-generated client + indexer API. Same interface; the UI does not change.

### 7.3 Information architecture

| Route | Purpose | Must show |
|---|---|---|
| `/` | Landing (marketing, pitch) | Hero with the core promise; live matchday card; how it works (Launch → Bond → Hold → Earn); featured players; social proof stats (vault, paid out, players live). |
| `/markets` | App home | Matchday card (countdown / live); launches in progress (bond %); top movers; all players table with filters (league, position, status) + search. |
| `/player/[id]` | **The hub** — one page, two states | Header strip (name, ticker, position, club, league, price, 24h, volume, score). **Launching:** bonding-curve chart ("you are here"), progress to $25k, cap usage. **Trading:** price chart. **Trade panel** in the same place in both states: buy/sell, amount, fee/sell-tax preview, price impact, hold-age meter. Tabs: Overview · Form (matchday scores + board ranks) · Dividends · Liquidity (trading only) · Holders. **Pro view** toggle → terminal layout (watchlist, chart + indicators, recent trades/depth, ticket, positions). |
| `/matchday` | Live match centre | Window + phase + countdown/clock; round pool ($ and % of vault); **your players** strip with provisional earnings; live event feed; boards (top 3 collapsed, expand to 5 / all boards); top performers; results & payouts history. Full-time moment → claim. |
| `/portfolio` | "My stuff" | USDC, positions value, P&L, dividends earned; **claimable dividends** (USDC vs tokens +10%); positions (tokens, value, hold age, sell tax now, counted at next kickoff?); LP positions + fees; history (trades, claims); points/activity. |
| `/docs/[section]` | Protocol docs | Stats · Scoring (+ calculator) · Boards & payouts · Fees & curve (+ sell-tax slider) · Dividends & supply · Liquidity (+ IL slider) · Governance. Port content from the prototype. |
| `/terms` | Terms draft | Port from prototype. |

Global: header (logo, nav, **matchday pill** with countdown/live dot, DEVNET badge, balance, account menu with faucet), **mobile bottom tab bar**, toasts, modals (sign-in with country + terms, bonded celebration, full-time/claim).

### 7.4 Product & copy rules

- Live scores are always labelled **provisional**.
- Always show the **current sell tax** before a sell is confirmed.
- Never imply guaranteed returns. Don't call tokens "shares" or users "investors". "Dividends" is the product term — always paired with "not guaranteed" in Docs/Terms.
- Players vs holders: never confuse them in copy.
- Numbers: `tabular-nums`; sub-cent prices to 4–5 decimals; USDC to 2.

---

## 8. Repository layout (target)

```
score/
├─ PLAN.md · ARCHITECTURE.md · README.md
├─ docs/
│  ├─ concept/score-terminal-v4.html   # prototype (source of numbers)
│  ├─ ANALYSIS.md                      # Step 0.1 output
│  ├─ DECISIONS.md                     # running decision log
│  ├─ UI_SKILLS.md                     # Step 1 skill inventory + mapping
│  └─ DESIGN.md                        # Step 1 design system
├─ anchor/                             # template example program — DO NOT TOUCH (contracts come later)
├─ packages/
│  └─ core/                            # pure TS: config, curve, fees, sell tax, pool math, scoring,
│                                      # boards, controller, claims, demo simulator + tests
└─ src/ (or apps/web/)                 # Next.js app from the template
   ├─ app/ (routes above)
   ├─ components/ (ui/ = shadcn, feature folders per page)
   ├─ lib/protocol/ (ProtocolClient, MockProtocolClient, DemoClock)
   └─ lib/format/ (numbers, prices, time)
```

If converting the template into a pnpm workspace fights its Anchor scripts, keep the template layout and add `packages/core` as a workspace package — record the choice in `DECISIONS.md`.

---

## 9. Invariants & test vectors (for `packages/core` tests)

- `R(0) = 0`; `R(S_max) ≈ 25,000` (±1); `S_max ≈ 6.4M` (±5k); `P(0) = 0.00039`; `P(S_max) ≈ 0.01094`.
- Pool open price `= 17,500 / 1,600,000 = 0.0109375`.
- Bond split of 25,000 → 17,500 / 5,000 / 2,500.
- `tax(0)=0.05`, `tax(45)=0.0275`, `tax(90)=0.005`, `tax(120)=0.005`.
- Buy $1,000 post-bond → $0.50 to treasury. Sell $1,000 at 7 days → tax 4.65% = $46.50 → $41.85 vault / $4.65 treasury.
- Curve cap: a single buy > 240,000 tokens is rejected; cumulative per account > 240,000 rejected.
- Board example in §4.8 → Σweights 52.05, PL board $960.61, #1 $336.22.
- Shares renormalise when a board has <5 ranked players (e.g. 3 players → 35/25/20 scaled to sum 100%).
- Controller: no history → 100 bps; step clamp ±10%; global clamp 20–250 bps; annual cap `TVL×0.12/38`.
- Display score: `P=6 → 5.0`.
- Supply never exceeds 10M; token-claim mint ≤ reserve left.
- Hold age weighted average example: 10k tokens @ day −60 + 10k @ today → age 30 days.
- Snapshot: buy after kickoff → 0 eligible this round; sell after kickoff → still eligible.

---

## 10. Open questions & known inconsistencies (flag, don't silently resolve)

1. **Dividend denominator.** Prototype pays `playerPayout × heldTokens / p.sold`, but post-bond pool buys don't change `p.sold`, so the sum of holder balances can exceed it → overpay. Proposal: denominator = total eligible tokens at snapshot (all user balances + LP-attributed tokens, excluding the protocol seed's share).
2. **TVL definition** is approximated as `bonded × 17,500 + vault`; ignores pool growth and open curve funds.
3. **Freeze → next kickoff gap** is a few hours on Tuesdays; token-claim timing vs next snapshot.
4. **Weeks without Champions League / international breaks** — skip windows? Domestic cups?
5. **GK board** — seed data has no goalkeepers; prototype's live simulator gives GKs zero events.
6. **Limit orders on an AMM** need a keeper (or remove them). The prototype's **order book is synthetic** — replace with AMM-native views (price impact, depth, recent trades).
7. **Vault sustainability** depends on launches (front-loaded) and selling. Needs a season simulation (Step 2).
8. **LP economics** — 0.25% fee alone is thin; decide on dividend pass-through/points.
9. **Treasury backstop policy** for the vault — undefined.
10. **Postponed/abandoned matches, double fixtures, mid-season transfers between leagues, position classification.**
11. **Legal/compliance:** real player names (no likeness), UK on the restricted list while pitching in London, "dividends" wording.
12. **Curve overshoot** on the bonding buy and selling during the curve right before bond.
13. **Data provider** — Opta (concept) vs API-Football/Sportmonks (hackathon); redistribution of raw stats on-chain.

---

## 11. Non-goals right now

- Writing, modifying, building or deploying any Solana program (including the template example).
- Real oracle, real data feed, indexer, Privy production keys, mainnet anything.
- Governance/voting, delisting flows beyond static copy.
