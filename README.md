# score▮

Own the players. Earn when they perform.
Real footballers launch as tokens on a bonding curve, graduate into a permanent trading pool at $25k raised, and every matchday the holders of players who finish top 5 on a position leaderboard (top 3 for goalkeepers) share USDC dividends from a funded vault.
This repo holds the app (Next.js, currently on a mock protocol that runs the real economics in TypeScript) and the backend: the Solana program, the trading engine and the server, running end to end on devnet.

> **Status: devnet.** The app runs on the real backend (engine, Solana program, oracle) when the backend URLs are set, and on the in-browser mock when they aren't. Not ready for mainnet: see `docs/BACKEND.md`.

## Run the connected app (devnet)

Needs the one-time devnet setup (`bun run devnet:setup`, then `bun run devnet:faucet-setup`) and `.env.local` with
`NEXT_PUBLIC_SOLANA_RPC_DEVNET`, `NEXT_PUBLIC_SCORE_NODE=http://127.0.0.1:8787`, `NEXT_PUBLIC_SCORE_ORACLE=http://127.0.0.1:8788`,
and optionally `NEXT_PUBLIC_PRIVY_APP_ID` + `PRIVY_APP_SECRET`.

```bash
bun run stack      # score-node + oracle + simulated traders (Ctrl+C stops all)
bun run dev        # the app, http://localhost:3000
bun run e2e:app    # browser test of every flow on the real backend (starts its own app on :3400)
```

| Piece | What it does |
|---|---|
| `backend/score-node` | Engine, log, relayer, chain watcher, batch committer, plus the app's read model (`views.rs`: markets, trades, price history, portfolios, exact quotes on a throwaway copy of the market) and a live event stream |
| `services/oracle` | Lists the client's 288 players on the launch schedule (ICO# order, weekday 14:00/20:00 UTC), runs matchday rounds (kickoff snapshot → live match data → freeze → result), serves the matchday view and the test-USDC faucet |
| `scripts/sim-traders.ts` | 40 devnet wallets that deposit test USDC and trade through the real API (curve buys, pool trades, limit orders, liquidity, claims), reacting to live match events |
| `src/lib/protocol/api/client.ts` | The app's `ProtocolClient` on the real backend. Orders are signed by the user's wallet (Privy embedded wallet, no popup) |

Rounds are simulated on a fast clock for devnet (8 min open, 5 min live, 40 s freeze; `ORACLE_OPEN_S` etc.). A real stats feed replaces the simulator in the oracle before mainnet.
The player list comes from `docs/Scorefun Player ICO.xlsx` via `bun run import:players` (writes `packages/core/src/sim/registry.ts`).

## Run it

Requires Node 20+ and [bun](https://bun.sh) 1.2+.

```bash
bun install
bun run dev          # http://localhost:3000
```

| Command | What it does |
|---|---|
| `bun run dev` | Next.js dev server (Turbopack) |
| `bun run build` | Production build |
| `bun run lint` | ESLint |
| `bun run typecheck` | `tsc` for the app and `packages/core` |
| `bun run test` | Vitest: core maths, §9 test vectors, property tests, mock end-to-end |
| `bun run demo:loop` | Drives the full loop in a real browser and saves screenshots to `docs/screenshots/` (local only; needs `bun run dev` running; `BASE_URL` to override) |
| `bun run program:test` | Builds the Solana program and runs its tests |
| `bun run node` | Builds and starts the backend server (see `backend/README.md`) |
| `bun run e2e:backend` | Full backend test on devnet |

## Test it yourself

For how it all works, read `docs/OVERVIEW.md` (plain words) or `docs/BACKEND.md` (full detail).

### No install: watch the tests run on GitHub

Every push runs all the tests on GitHub's machines. Open the repo's **Actions** tab, then the latest **tests** run:
- **App maths:** the TypeScript maths and property tests.
- **Trading engine:** every engine test, plus 6,000 random trading runs (~600,000 actions) with every rule re-checked after each action. That's a correctness test, so its time is mostly the checks.
- **Engine latency:** the time per order on a production build (about 30 µs on a laptop).
- **Solana contract:** builds the real contract and runs every test against it.

Click a job to read its full log. The run's summary page shows the engine's latency and the contract's compute cost per instruction. To re-run it yourself: **Run workflow** on the same page.

### On your own machine

Steps 1–4 need no Solana wallet, no SOL and no keys.

### What to install

| Tool | Version | Install | Needed for |
|---|---|---|---|
| bun | 1.2+ | `curl -fsSL https://bun.sh/install \| bash` | Everything |
| Node | 20+ | [nodejs.org](https://nodejs.org) | The app |
| Rust | stable (the program pins 1.98 itself) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | Steps 3–4 |
| Solana CLI | 3.1.x | `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` | Step 4 |
| Anchor CLI | 1.2.2 | `cargo install --git https://github.com/solana-foundation/anchor avm --force`, then `avm install 1.2.2 && avm use 1.2.2` | Step 4 |

Then, once, from the repo root:

```bash
bun install
```

### Step 1: click through the app (2 minutes)

```bash
bun run dev        # open http://localhost:3000
```

With no backend URLs set, the app runs on simulated funds in your browser (see [Demo mode](#demo-mode) below for a 2-minute walkthrough). To run it on the real backend, see [Run the connected app](#run-the-connected-app-devnet).

### Step 2: the app's maths tests (seconds)

```bash
bun run test
```

Checks the curve, pool, fees, hold age, scoring and leaderboard rules against the spec's test vectors, plus random property tests.

### Step 3: the trading engine (under a minute)

```bash
bun run engine:test      # every engine test: exact rounding, pool, order book, routing, fuzzing (~2 s)
bun run engine:fuzz      # 6,000 random runs, ~600,000 actions, every rule re-checked after each (~30 s)
bun run engine:latency   # how fast an order is processed and saved to disk
```

What a pass means:
- every price, fee and payout matches exact maths, rounded in the safe direction;
- across thousands of random trades, the books always balance to the cent, the pools always cover every liquidity provider, and nobody can profit from rounding;
- replaying the log always rebuilds the same state and the same fingerprint.

### Step 4: the Solana contract (a few minutes, mostly the first build)

```bash
bun run program:test
```

Builds the real contract and runs every test against it on a local Solana simulator (no validator, no SOL). It prints the compute cost of each instruction (`CU: deposit …, withdraw …`). The tests cover:
- deposits and withdrawals, including permit forgery, reuse, expiry and the withdrawal cap;
- batch checks: a wrong signer, out of order, a forked history, invented or skipped deposits, a shrinking treasury, a skipped forced request, not enough USDC in custody;
- forced withdrawals and exit mode, including paying a user out from a Merkle proof built by the real engine.

### Step 5: see it live on devnet (no install)

The contract is deployed on devnet at `3tP3HKuoPDYKvUuGUYeRXbNQZHQeHU5BabRCwZwcXELo`. Open it on [Solana Explorer](https://explorer.solana.com/address/3tP3HKuoPDYKvUuGUYeRXbNQZHQeHU5BabRCwZwcXELo?cluster=devnet) to see the real transactions from our test runs: deposits, withdrawals and the batch commits that post the fingerprints on-chain.

### Step 6: the full end-to-end run on devnet

`bun run e2e:backend` starts the real server and runs about 45 users through it on devnet: deposits, an ICO up to graduation, pool trades, limit orders, liquidity, a crash and restart mid-run, a dividend round, instant and large withdrawals, and an attempt to abuse the relayer. It ends by reconciling every USDC on-chain against the engine. The output is colour-coded by step, with Explorer links for each transaction.

This run uses the devnet deployment's admin and service keys, which stay with us, so we run it for you: ask, and we'll run it live on a call or send a recording.

## Demo mode

Everything runs in your browser with simulated funds. State persists in `localStorage` (`score:mock:v1`).

- **Sign in** with Google, email or Phantom (all simulated). Pick a country: restricted ones (UK, US, …) are blocked. You get 1,000 test USDC, plus a faucet in the account menu.
- **Demo clock:** each matchday is compressed to 40s before kickoff, 50s live, then 5s "data freeze" before it settles. The header pill shows where you are.
- **Demo settings** (account menu, or "Demo" when signed out): switch to the real fixture calendar, skip to the next phase, turn the simulated market on/off, simulate network errors or latency, fill a launch curve to 96% so your buy can bond it, launch the next scheduled players, fast-forward hold age by 30 days, reset everything.

A 2-minute demo: sign in → buy a launching player → *Fill to 96%* → buy again to bond it → buy a bonded player → wait for kickoff (or skip) → watch the live board → full time → take dividends as USDC or +10% tokens → Portfolio.

## Repo map

```
├─ ARCHITECTURE.md                   product spec
├─ docs/OVERVIEW.md                  the backend in plain words, for non-technical readers
├─ docs/BACKEND.md                   how the backend works, with diagrams
├─ docs/BACKEND_APPROACHES.md        the execution models we compared, and why we chose this one
├─ anchor/                           the score Solana program (custody, batches, escape hatch)
├─ engine/                           the off-chain trading engine (Rust)
├─ backend/                          score-node: API, relayer, chain watcher, batch committer
├─ packages/core/                    pure TS domain logic + tests
│  └─ src/  config · curve · bonding · pool · fees · holdAge · scoring · boards
│           controller · claims · snapshot · calendar · points · sim/ (seed, match sim, ambient market)
├─ src/
│  ├─ app/                           routes: / · /launch · /trade · /player/[id] · /matchday · /portfolio · /docs/[section] · /terms · /lab
│  ├─ components/                    ui/ (shadcn) · shell · modals · launch · trade · player · matchday · portfolio · docs · landing · common
│  ├─ lib/protocol/                  ProtocolClient seam, MockProtocolClient, DemoClock, React hooks
│  ├─ lib/format/                    numbers, prices, time
│  └─ lib/solana/                    template wallet-standard + RPC client (for the later on-chain client)
└─ scripts/                          devnet setup, backend end-to-end test, browser verification
```

Working docs, screenshots and the founder's materials are kept locally and are not in git.

The UI only talks to `ProtocolClient` (`src/lib/protocol/types.ts`). The mock implements it with `packages/core`. A later `OnchainProtocolClient` (Codama client + indexer) implements the same interface.

## Not built yet

The oracle's match data is simulated (no live stats feed yet), and there's no production key management yet. Dividends are a product mechanic, not a promise: see `/docs` and `/terms` (draft for legal review).
