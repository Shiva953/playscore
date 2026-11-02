# Decision log

Format: **date · decision** · alternatives · why. Newest at the bottom. Spec questions (SQ-n) live in `docs/ANALYSIS.md` §17.

---

### 2026-11-02 · Template: `kit/nextjs-anchor` instead of `gill/gill-next-tailwind-basic`
- **Alternatives:** the gill template named in PLAN.md (no longer listed by `create-solana-dapp` 4.8.5); `kit/nextjs` (no Anchor example); `web3js-nextjs` (legacy web3.js).
- **Why:** The Solana Foundation renamed the gill templates to `kit/*`. `kit/nextjs-anchor` is the closest match: Next.js 16.4, React 19.2, Tailwind 4, @solana/kit, wallet-standard connector, Anchor example program, Codama. It doesn't ship shadcn/ui or Wallet UI, so shadcn/ui was added with its CLI.
- The template's post-install `setup` script (`anchor build --ignore-keys` + Codama) failed on the local Anchor 0.32.1 CLI. That's harmless and intended: PLAN.md forbids building the program. `anchor/` is committed exactly as generated in the baseline commit on `main`.

### 2026-11-02 · Repo layout: bun workspace, Next.js app at the root under `src/`
- **Alternatives:** full monorepo (`apps/web` + `packages/*`); keep the template's `app/` at the root.
- **Why:** Moving the app to `apps/web` would break the template's root-level Anchor/Codama scripts. Keeping the app at the root and adding `packages/core` as a workspace package (`"workspaces": ["packages/*"]`) is what ARCHITECTURE §8 allows. The template's `app/` (with `app/components`, `app/lib`) moved to `src/app`, `src/components`, `src/lib` to match ARCHITECTURE §8 and PLAN (`src/lib/protocol`). Codama's output path moved to `src/generated/vault` accordingly.
- Template example UI (`vault-card`, `grid-background`, starter page) was removed. Per PLAN, the example program isn't wired into the new UI. The wallet-standard, cluster and RPC client code is kept under `src/lib/solana/` for the later Phantom/embedded wallet integration.

### 2026-11-02 · Core package consumed as TypeScript source
- **Alternatives:** build `packages/core` with tsup and consume `dist/`.
- **Why:** No build step to forget. Next.js compiles it via `transpilePackages`, and Vitest runs it directly. Later (oracle worker) it can add a build without changing imports.

### 2026-11-02 · Backend suggestion (not built in Step 0)
- **Proposal:** Next.js Route Handlers (`src/app/api/*`) as a thin BFF for the web app (session, geo check, quotes cache). **Supabase** (Postgres + Realtime) as indexer storage and live channel, fed by **Helius** webhooks. A separate long-running **Node worker** (Fly.io/Railway) for match-data ingestion, scoring (`packages/core`), freeze timing and oracle signing. Serverless functions are a poor fit for long-lived feed consumers and cron-precise freezes.
- **Why:** Matches ARCHITECTURE §6.3, reuses `packages/core` server-side, keeps the `ProtocolClient` seam unchanged (`OnchainProtocolClient` reads from the indexer API + Realtime).

### 2026-11-02 · Mock pool is a real CPMM (prototype's is not)
- **Alternatives:** port the prototype's fixed-price fills (`q = usdc / price`, price nudged `±a/20000`).
- **Why:** The prototype has no pool reserves: prices are a random walk, buys have no slippage, the "order book" is random. ARCHITECTURE specifies a constant-product pool, and the UI must show price impact. `packages/core/pool.ts` implements x·y=k with LP shares. Seeded bonded players get reserves derived from the prototype's last price (SQ-27).

### 2026-11-02 · Limit orders dropped; synthetic order book replaced
- **Why:** SQ-6. They only "work" in the prototype because fills ignore the pool. AMM-native replacements: price-impact ladder, pool depth, recent trades tape.

### 2026-11-02 · LP fees auto-compound (no "claim fees" button)
- **Why:** Real CPMM fee accounting. "Fees earned" is tracked for display with a per-share fee-growth counter.

### 2026-11-02 · Bonding buy partially fills to the threshold and refunds the excess
- **Why:** SQ-12. Keeps the float at 8M, max supply ≤ 10M, and pool-open price continuous with the curve.

### 2026-11-02 · Demo-only simulation layers
- **Ambient market:** synthetic traders buy and sell bonded players through the real pool maths, biased by live performance, with fees routed normally. Synthetic fans also buy launching players. Can be toggled in the demo menu.
- **Launch demo action:** "Simulate launch demand" fills a curve to ~96% so a single user can complete the bond. The 240k-token cap otherwise makes one account unable to bond a player.
- **Scheduled launches:** in demo-clock mode the next 2 scheduled players go live when each new round opens. In calendar mode they go live at their `launchAt` slot (14:00/20:00 UTC weekdays).
- **Why:** The prototype's static world can't show bonding, price movement or vault growth in a 2-minute demo. All of these run through the same `packages/core` maths as user actions.

### 2026-11-02 · Demo clock: OPEN 40s → LIVE 50s → ENDED/freeze 5s → settle
- **Why:** Proto has no ENDED/FROZEN phase. The spec's state machine does, and "data freezes" is a trust point worth showing. Phases are timestamp-driven so a reload or tab sleep catches up. If more than a full round has elapsed, the current phase restarts instead of replaying a backlog.

### 2026-11-02 · Motion library installed, not used yet
- `motion` (Motion, formerly Framer Motion) is installed per PLAN 0.2. Step 0 is wireframe-only, so it isn't imported anywhere. Step 1 may revisit the choice.

### 2026-11-02 · Package manager: bun instead of pnpm
- **Decision (user request):** bun 1.2 for installs, workspaces and scripts (`bun run lint | typecheck | test | build | dev`). PLAN.md's `pnpm …` commands map 1:1 to `bun run …`.
- The template's `pnpm-lock.yaml` was removed; `bun.lock` is committed. Vitest and Next.js still run on Node through their own binaries, and bun only drives them.

### 2026-11-02 · shadcn/ui: Radix base, "Nova" preset, neutral palette
- **Why:** shadcn's CLI now asks for a component base (Base UI, Radix, React Aria). Radix has the widest component coverage and the most examples. Defaults kept on purpose for the Step 0 wireframe; Step 1 owns the theme.

### 2026-11-02 · Reserve trimmed by 40 tokens at bonding (SQ-35)
- **Why:** the spec's curve constants give S_max = 6,400,040, so float + full reserve = 10,000,040. `reserveAfterBond()` caps the reserve at `10M − sold − 1.6M`, which keeps the 10M invariant without touching any price.
