# score▮

Own the players. Earn when they perform.
Real footballers launch as tokens on a bonding curve, graduate into a permanent trading pool at $25k raised, and every matchday the holders of players who finish top 5 on a leaderboard share USDC dividends from a funded vault.
This repo is the devnet demo: a Next.js app over a mock protocol that runs the real economics in TypeScript. Solana programs come later (see `PLAN.md`).

> **Status: Step 0 (foundation).** Wireframe UI on shadcn defaults, full domain logic, mock protocol. Design polish is Step 1. Nothing touches a chain yet.

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
| `bun run demo:loop` | Drives the full loop in a real browser and saves screenshots to `docs/screenshots/step-0/` (needs `bun run dev` running; `BASE_URL` to override) |

## Demo mode

Everything runs in your browser with simulated funds. State persists in `localStorage` (`score:mock:v1`).

- **Sign in** with Google, email or Phantom (all simulated). Pick a country: restricted ones (UK, US, …) are blocked. You get 1,000 test USDC, plus a faucet in the account menu.
- **Demo clock:** each matchday is compressed to 40s before kickoff, 50s live, then 5s "data freeze" before it settles. The header pill shows where you are.
- **Demo settings** (account menu, or "Demo" when signed out): switch to the real fixture calendar, skip to the next phase, turn the simulated market on/off, simulate network errors or latency, fill a launch curve to 96% so your buy can bond it, launch the next scheduled players, fast-forward hold age by 30 days, reset everything.

A 2-minute demo: sign in → buy a launching player → *Fill to 96%* → buy again to bond it → buy a bonded player → wait for kickoff (or skip) → watch the live board → full time → take dividends as USDC or +10% tokens → Portfolio.

## Repo map

```
├─ PLAN.md · ARCHITECTURE.md        product spec and build plan
├─ docs/
│  ├─ concept/score-terminal-v4.html   founder prototype (source of numbers)
│  ├─ ANALYSIS.md                      Step 0 analysis + open questions (SQ-n)
│  ├─ DECISIONS.md                     decision log
│  └─ screenshots/step-0/              verification screenshots
├─ anchor/                           template example program, untouched (contracts come in Step 3)
├─ packages/core/                    pure TS domain logic + tests
│  └─ src/  config · curve · bonding · pool · fees · holdAge · scoring · boards
│           controller · claims · snapshot · calendar · points · sim/ (seed, match sim, ambient market)
├─ src/
│  ├─ app/                           routes: / · /markets · /player/[id] · /matchday · /portfolio · /docs/[section] · /terms
│  ├─ components/                    ui/ (shadcn) · shell · modals · markets · player · matchday · portfolio · docs · landing · common
│  ├─ lib/protocol/                  ProtocolClient seam, MockProtocolClient, DemoClock, React hooks
│  ├─ lib/format/                    numbers, prices, time
│  └─ lib/solana/                    template wallet-standard + RPC client (for the later on-chain client)
└─ scripts/demo-loop.mjs             browser verification
```

The UI only talks to `ProtocolClient` (`src/lib/protocol/types.ts`). The mock implements it with `packages/core`. A later `OnchainProtocolClient` (Codama client + indexer) implements the same interface.

## Not in this step

No Solana program, oracle, real match data, indexer or production wallet keys. Dividends are a product mechanic, not a promise: see `/docs` and `/terms` (draft for legal review).
