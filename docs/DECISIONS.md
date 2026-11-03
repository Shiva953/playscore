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

### 2026-11-02 · Wireframe UI choices (Step 0)
- **Rarity tiers dropped** ("Legendary/Epic/Rare/Core" from the prototype). Player identity is typographic: ticker, position badge, form rating, sparkline, board rank.
- **Pro view indicators:** MA 7, EMA 14, Bollinger (20, 2σ) and RSI 14 in a second pane. The prototype's "Bollinger" was SMA10 ± 8%, which isn't Bollinger. The prototype's volume bars were derived from price changes, not volume; dropped until the indexer provides real per-bar volume.
- **Chart colours** are a neutral placeholder palette in `charts.tsx`: canvas charts can't read the oklch CSS tokens directly. Step 1 maps them to the theme.
- **Only two colour tokens added** (`--up`, `--down`) so P&L direction is visible in the wireframe. Everything else is shadcn's neutral default.
- **Pro view preference** persists per viewer (Zustand + guarded localStorage). Everything else in the UI store is session-only.
- **Live updates:** protocol events invalidate only the affected TanStack Query keys, batched every 350ms. Countdowns use a shared 1s clock hook, so only the countdown text re-renders each second.
- **Next.js dev indicator off** (`devIndicators: false`) so screenshots match production.

### 2026-11-02 · Browser verification uses Playwright with a system-Chrome fallback
- `scripts/demo-loop.mjs` launches Playwright's Chromium, or the local Google Chrome if that build isn't downloaded. This avoids a 150MB browser download on machines that already have Chrome.

### 2026-11-02 · Step 1 design direction (taste skill as primary)
- **App style:** `true-black-flat`, dealt by `design-taste-frontend` (seed 1063017092) over `data-terminal`. The first user is a fan on a phone following a matchday, an event. `data-terminal`'s "no colour on numbers" also contradicts PLAN's green/red for P&L.
- **Landing direction:** `split-stage` (seed 1760845758). The fixed half is the live matchday board. The proof section was redrawn to `proof-recognition-table` because there are no partner logos, and club or league logos are banned.
- **Accent:** lime `#c6ff3d` kept but only on data (gains, earnings, live state, bonding fill, the mark), never on buttons, tabs or nav. Lime is also the positive colour, so green appears only on gains (taste: a second green beside a yellow-green accent reads as two greens).
- **Type:** Instrument Sans instead of the dealt Inter. Schibsted Grotesk was rejected after measuring: its tabular figures widen punctuation. Monospace (Geist Mono) only for wallet addresses and IDs.
- **Signature element:** the matchday strip (snapshot → live → freeze with every kickoff marked).
- **Skills that could not be installed:** `better-accessibility`, `better-typography`, `better-colors` (permission policy blocked the download into `.claude/skills/`). Accessibility is checked with `@axe-core/playwright` instead.

### 2026-11-03 · Step 1 course correction: the four-direction gate was skipped
- **What happened:** Step 1 went straight from the skill inventory to one dark direction (`true-black-flat`, above) and applied it to every production route. That skipped 1.1 (inspiration research), 1.5 (four directions in `/lab`) and the 🛑 design-choice stop, and it ignored the stated preference for light backgrounds. `docs/UI_SKILLS.md` recorded the reason ("a variant lab would fork the system"), but PLAN.md mandates the exploration and the user never waived it.
- **Correction:** the work is kept, not reverted. The dark build on the production routes (commit `f9d6db0`) becomes **Direction D (dark wildcard)**. Directions A, B and C are built in `/lab` from fresh tokens and components after the research in `docs/INSPIRATION.md`. Then Step 1 stops for the user's choice. If the user picks A, B or C (or a mix), 1.6 and 1.7 rebuild the production routes in that direction.
- **Exception to "don't modify the Step 0 production routes during exploration":** they were already modified before this was caught. They stay as Direction D and are not touched further until the user chooses.

### 2026-11-03 · Design lab (/lab) setup
- **Dev only.** Lab routes are `page.dev.tsx` / `layout.dev.tsx`; `next.config.ts` adds the `dev.tsx` page extension only under `next dev`, so production builds have no `/lab` route and none of `src/directions/` (checked: no lab code in `.next/static`). The build type-checks with `tsconfig.build.json`, which leaves out the dev server's generated route types (they list the lab routes) and the lab code; `bun run typecheck` still checks everything.
- **Product chrome off on /lab.** `ChromeGate` hides the header, footer, tab bar, global modals and the toaster under `/lab`; each direction brings its own header and toaster. No other production code changed.
- **Mock changes for a UI need (logged per 1.8):** `DemoSettings.pinned`, `setPinned()` and `seekPhase()` on the demo controls, and a `clock` protocol event that refreshes only the round query. Pinned, the round's time left and the live match's progress are held while the clock runs; releasing resumes from the same point. Used by the lab's "pin a moment" control so all four directions show the same instant. Covered by a unit test. Reset unpins.
- **Shared between directions:** data hooks, `packages/core`, the formatters, the `ProtocolClient`, and a headless `useTradeTicket` (same rules as the production panel, so directions differ in design, not behaviour). Nothing styled is shared.

### 2026-11-03 · Direction libraries (each direction picks its own, ground rule 8)
- **A · Broadcast:** GSAP (crawl, headline wipe) and d3-shape (stepped SVG chart). 30 KB gzipped.
- **B · Clean fintech:** visx (scrubbable chart) and NumberFlow (digit roll). 21 KB gzipped.
- **C · Collectible:** Motion (tilt, flip, deal, layout reorders) and Recharts (two small charts). 173 KB gzipped, 122 of it Recharts; if C is chosen, redraw those two charts in SVG/visx before the build-out.
- **D · Night terminal:** shadcn/ui on Radix and Lightweight Charts, as built.
- All installed as devDependencies: only the dev-only lab imports them today.
- **B's dealt values redrawn:** raspberry accent → blue `#2148d6` (raspberry sits next to the loss red; the exact Tailwind blue was avoided too); DM Sans → Hanken Grotesk (Google's DM Sans has no tabular figures, measured).

### 2026-11-03 · Directions A and B dropped; C and D refined (user review)
- **User decision:** "ditch A and B". Their code, routes, screenshots and libraries (GSAP, d3-shape, visx, NumberFlow) are removed; they stay in git history (commit `ff6f1a7`).
- **C · Collectible, feedback:** cards looked generated; the display face (Unbounded) read as squashed; card hover and flip weren't smooth; everything was too big. Asked for shorter, more minimal screens in the spirit of football.fun and other .fun products.
- **D · Night terminal, feedback:** the ticker and the price don't stand out; the toast sits too high (desktop used the phone's tab-bar offset) and blends with cards; the stats under the title are too small; the account menu reads like machine text; a better number font; a much shorter landing; smoother and more minimal overall.
- **Research limit:** browser captures of new references (gacha.game, pump.fun and other .fun sites) were refused by the session's permission policy as bot-check circumvention, so round two works from the existing captures (Sport.fun home and app splash, Sorare, FotMob, Polymarket, Robinhood, Jupiter) and the design skills. gacha.game renders client-side only, so a text fetch returned nothing.

### 2026-11-03 · Round-two changes to C and D
- **C:** Sora replaces Unbounded + Figtree; new card (keyline, shirt-back picture, compact plate); flip as one two-faced element with a CSS transform transition; tilt written to `transform` per frame and smoothed by CSS; hover lift in CSS behind `(hover: hover) and (pointer: fine)`; Recharts removed for hand-drawn SVG (173 → 51 KB). Every screen fits about one desktop screen.
- **D figures:** Chivo for figures (`.fig`, `td.num`). Azeret Mono tried and rejected (a monospace gives the decimal point a digit's width, the same flaw that ruled out Schibsted Grotesk).
- **D header:** ticker as a white chip; price 44px in its 24h direction colour; stats at 24px with market cap first.
- **D toasts:** desktop offset 24px, phones 76px; raised surface with a float shadow.
- **D account menu:** rebuilt with human wording and a clear hierarchy; "Add 1,000 test USDC" is the one name for the faucet everywhere.
- **D landing:** two screens; the giant wordmark and scroll choreography are gone, so the landing uses the app header. Remaining taste inspector FAILs on the landing (few pictures, still page) and the WARN (no footage) are overridden by the review ("shorter and more minimal") and the no-photos rule.
- **Lab layouts:** the lab no longer uses `layout.dev.tsx`; each lab page wraps its own shell. A dev-only layout put a second, conflicting `LayoutProps` global into the generated route types after a production build.

### 2026-11-03 · Round three (user review)
- **C fills the screen:** desktop screens take the window's height with content (player: card + this matchday, market with a growing chart, ticket + top holders; landing hero stretches and the fan scales). Top holders replaced "latest trades", which is often empty early in a session.
- **D number font:** Funnel Sans for figures, chosen from an in-context comparison (Instrument Sans, Chivo, Geist, Host Grotesk, Funnel Sans, Rethink Sans, IBM Plex Sans, Hanken Grotesk on the player header). Chivo looked wide and heavy beside the labels.
- **D header and menu:** USDC coin mark instead of the word (CC0 path inlined, the package removed after copying); avatars generated per address with `boring-avatars` (MIT); the menu opens on the address (copy) with Devnet and sign-in chips; "Your devnet wallet" removed.
- **Matchday strip labels** sit in columns sized like the zones (and hide "Trading open" in narrow containers), so they can't overlap; they were absolutely positioned and collided on the landing's board.

### 2026-11-03 · C chart proportions (user review: "too thin/compressed")
- **Cause:** round three let the price chart take the market column's whole height, so on a ~1184px window a 500px-wide column drew a 700px-tall chart, and C's pages were capped at 1120px, so even wide screens gave it only ~510px.
- **Fix, per the dataviz skill:**
  - The chart keeps a landscape shape (height = 0.42 × width, clamped 200–380px, axis band included).
  - Marks: 2px line, ~10% wash, an r 4 end dot with a 2px surface ring, two recessive 1px hairlines at the range's high and low, and a crosshair that snaps to the nearest point.
- **Width:** C's pages go to 1320px, and the side columns to 240px and 290px. The middle column is now ~575px at 1184 and ~700px at 1440.
- **The height freed by the chart** goes to a wide Form panel. Its bars follow the bar spec: ≤24px thick, 4px rounded tops, square at the baseline, 2px gaps. It has a legend for the two categories, only the latest bar labelled, and hover to read any other.
- **Hero price and tile values** use proportional figures (the skill's anti-pattern list); tabular stays for aligned columns.
- **Phones:** blocks reorder to card, market, ticket, then holding, this matchday, form, holders (the column wrappers use `display: contents` below lg).

### 2026-11-03 · D portfolio as a consumer home; smaller fixes (user review)
- **Portfolio**, after Phantom's home, Robinhood's portfolio and the .fun profile and squad pages:
  - Identity: generated avatar, address with copy, Devnet / sign-in / since chips, Top up and Claim actions.
  - One headline figure (portfolio value, 52px, quiet cents) with all-time P&L and board earnings, plus its split as the dataviz **tall segmented bar**: 28px, 4px blocks, 2px gaps, share inside where it fits, a legend of names with amounts. Colours are the reference palette's dark slots 1–3 (blue, orange, aqua), validated on `#111` with `validate_palette.js` (all checks pass). A first attempt (blue, lilac, amber) failed CVD and normal-vision separation.
  - Then the claim card when there's something to claim, otherwise one line on the next chance to earn.
  - "Your players" as cards: position-tinted initials, value, P&L, 7-point trend, counts at kickoff, sell tax.
  - Activity in plain sentences; earnings per matchday as bars (the bar spec, hover to read); points.
  - Liquidity only when there is some.
- **Figures:** large standalone values (headline, stat tiles, balances) use Funnel Sans's proportional digits (`.fig-prop`); tables and aligned rows stay tabular (dataviz anti-pattern list).
- **Faucet action named "Top up" everywhere** (menu, ticket, portfolio), and the confirmation reads "Topped up $1,000.00 test USDC". The old 19-character pill label was too long.
- **USDC in the ticket:** the coin mark alone, with "USDC" as its accessible name.
- **Pointer cursor:** dropdown items, and every enabled button-like control. Tailwind v4 gives buttons the default arrow.
- **Lab "Payout" moment** replaces "Full time". Dividends settle when the freeze ends, so the moment steps into the next matchday; the old one never had anything to claim.

### 2026-11-03 · Review deployments and demo recordings
- **Two Vercel projects** (account shiva953):
  - D: `score-night-terminal` → https://score-night-terminal.vercel.app (the production build).
  - C: `score-collectible` → https://score-collectible.vercel.app.
- **How C is built:** the same repo with `SCORE_DIRECTION=c` and `NEXT_PUBLIC_SCORE_DIRECTION=c`, set as project env vars. That build includes the lab routes and redirects `/` and `/lab` to C's landing. The lab bar becomes a "Demo" bar with C's screens and the moment buttons only.
- **`vercel.json`** pins `framework: nextjs` with bun install/build; a project created by `vercel link` was otherwise treated as a static site.
- **`.vercelignore`** keeps `.env*` (the Helius key, the Vercel OIDC token), screenshots and build output out of uploads. Deployed builds fall back to the public devnet RPC; add `NEXT_PUBLIC_SOLANA_RPC_DEVNET` in the project settings to use Helius there.
- **Redeploy:** `bunx vercel link --yes --project <score-night-terminal|score-collectible>` then `bunx vercel deploy --prod --yes`. The local `.vercel/` link points at whichever project was linked last.
- **Demo videos:** `scripts/record-demo.mjs` records both deployments with Playwright, with a drawn cursor and paced steps, and converts them to MP4 with ffmpeg. They go to `docs/demo/`, which is gitignored.
