# score▮

Own the players. Earn when they perform.
Real footballers launch as tokens on a bonding curve, graduate into a permanent trading pool at $25k raised, and every matchday the holders of players who finish top 5 on a position leaderboard (top 3 for goalkeepers) share USDC dividends from a funded vault.
This repo holds the app (Next.js, currently on a mock protocol that runs the real economics in TypeScript) and the backend: the Solana program, the trading engine and the server, running end to end on devnet.

> **Status: devnet.** The app still uses the mock; the backend is tested end to end on devnet (`bun run e2e:backend`). Not ready for mainnet: see `docs/BACKEND.md`.

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

## Demo mode

Everything runs in your browser with simulated funds. State persists in `localStorage` (`score:mock:v1`).

- **Sign in** with Google, email or Phantom (all simulated). Pick a country: restricted ones (UK, US, …) are blocked. You get 1,000 test USDC, plus a faucet in the account menu.
- **Demo clock:** each matchday is compressed to 40s before kickoff, 50s live, then 5s "data freeze" before it settles. The header pill shows where you are.
- **Demo settings** (account menu, or "Demo" when signed out): switch to the real fixture calendar, skip to the next phase, turn the simulated market on/off, simulate network errors or latency, fill a launch curve to 96% so your buy can bond it, launch the next scheduled players, fast-forward hold age by 30 days, reset everything.

A 2-minute demo: sign in → buy a launching player → *Fill to 96%* → buy again to bond it → buy a bonded player → wait for kickoff (or skip) → watch the live board → full time → take dividends as USDC or +10% tokens → Portfolio.

## Repo map

```
├─ ARCHITECTURE.md                   product spec
├─ docs/BACKEND.md                   how the backend works, with diagrams
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

The app isn't connected to the backend, and there's no match-data oracle or production key management yet. Dividends are a product mechanic, not a promise: see `/docs` and `/terms` (draft for legal review).
