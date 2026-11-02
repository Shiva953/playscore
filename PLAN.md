# score — Build Plan (for Claude Code)

> You are building **score**, a football player trading protocol + consumer app on Solana. Read `ARCHITECTURE.md` fully before doing anything — it is the product and system spec. This file tells you **what to do, in what order, and when to stop**.
>
> Today is **Mon 2 Nov 2026**. Target: a polished, demo-able devnet app for **Solana Breakpoint, London, 15–17 Nov 2026** (Hacker House runs until 14 Nov). Quality bar: a full-fledged consumer DeFi product, not a hackathon toy.

---

## Ground rules (apply to every step)

1. **DO NOT TOUCH CONTRACTS.** No writing, editing, building, testing or deploying Solana programs. The template's `anchor/` folder stays exactly as generated (`git diff anchor/` must be empty). Do not run `anchor build`, `anchor deploy`, `npm run setup`, or any program codegen. All protocol behaviour runs through the `MockProtocolClient` (see `ARCHITECTURE.md` §7.2).
2. **Steps are gated.** Finish every item in a step's *Definition of done*, report, and **stop for the user's go-ahead** before starting the next step. **Never start Step 1 before Step 0 is complete and approved.**
3. **Don't invent mechanics.** Numbers and rules come from `ARCHITECTURE.md` and `docs/concept/score-terminal-v4.html`. If they disagree, or something is ambiguous, log it in `docs/ANALYSIS.md` → *Open questions*, pick the most conservative interpretation, mark it `// SPEC-QUESTION:` in code, and keep going. Ask only when genuinely blocked.
4. **Product first.** Every screen is for a football fan on a phone *and* a trader on a desktop. Think about the user's next action, empty/loading/error states, and what a first-time visitor understands in five seconds.
5. **Keep a decision log** in `docs/DECISIONS.md` (date, decision, alternatives, why).
6. **Small, reviewable commits** per milestone with clear messages. Keep `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green.
7. **Licensing:** no player photos, club crests or league logos anywhere (including placeholders and generated imagery). Player identity is typographic.
8. **Creative freedom on UI libraries — no single-library lock-in.** shadcn/ui comes with the template, but it is a starting point, not a rule. Pick the best tool for each component and each design direction, and experiment with what the design skills recommend. Mixing is expected, e.g. Radix / React Aria / Base UI primitives for accessible behaviour; shadcn, Origin UI, Magic UI or Aceternity-style components where they fit; Motion, GSAP or react-spring for animation; NumberFlow for animated numbers; Lightweight Charts, visx, Recharts or ECharts for data; Rive/Lottie or React Three Fiber for hero moments; Vaul, Sonner, cmdk for drawers, toasts, command menus; or hand-built components when nothing fits. Guardrails, so freedom doesn't become chaos:
   - **Accessibility first:** complex widgets (dialogs, menus, tabs, comboboxes, sliders) must sit on an accessible primitive or be fully keyboard/screen-reader tested.
   - **Deliberate, not duplicated:** within one screen, don't use two libraries for the same job without a reason (e.g. two toast systems).
   - **Performance:** watch bundle size and lazy-load heavy pieces (3D, Lottie, big chart libraries); interaction must stay smooth on a mid-range phone.
   - **Licences:** open-source licences compatible with a commercial product; ask before using anything paid.
   - **Tokens still rule:** whatever the library, colours, type and spacing come from the direction's tokens, not library defaults.
   - **Record every library choice** and why in `docs/DECISIONS.md`.

---

## Step 0 — Understand deeply, then lay the foundation

Goal: a clean, working codebase with the complete domain logic, a mock protocol, and a **dummy (wireframe-quality) UI layout** for every route, so Step 1 can focus purely on design.

### 0.1 Deep analysis → `docs/ANALYSIS.md`

Before writing code, read `ARCHITECTURE.md` and the whole prototype (`docs/concept/score-terminal-v4.html` — read the JS carefully, it is the reference implementation). Then write `docs/ANALYSIS.md`. Go **unit by unit**; for each unit cover: *what it does · the exact rules/formulas · how it connects to other units · whether it makes sense economically and for users · edge cases · how prior apps handled the same thing · open questions*.

Units:
1. Supply & token model (10M = 8M float + 2M reserve)
2. Launch: bonding curve maths, fees, caps, schedule & curation
3. Bonding: 70/20/10 split, pool seed, price continuity
4. Trading: CPMM, buy fee, hold-age sell tax, fee routing
5. Liquidity providers: zap, LP fees, LP dividends, hold-age preservation, IL
6. Matchday calendar, snapshot, live phase, freeze
7. Scoring: event matrix, minutes, coefficients, display score, data freeze
8. Boards & payout split: board types, weights, 35/25/20/12/8, stacking, tie-breaks, holder share
9. Round pool controller & vault solvency (runway, vault/TVL, smoothing, caps, inflows/outflows)
10. Claims: USDC vs tokens +10%, reserve, effect on runway and dilution
11. Delisting & governance
12. Accounts, custody (protocol-held positions), wallets, geo-restrictions, Terms
13. Points / activity rank / seasons

Then add:
- **Prior-art comparison** (Football Index, Football.fun/Sport.fun, Sorare, Chiliz, Royaltiz, Playr, pump.fun/Meteora, friend.tech): what to borrow, what we must avoid, how score differs. Use `ARCHITECTURE.md` §3 as a starting point; go deeper where useful.
- **Consumer journey walkthroughs**: (a) first-time fan on mobile from landing → sign-in → first buy → first matchday → first claim; (b) trader on desktop sniping a launch and managing LP; (c) a week of rounds for a holder. Note friction points.
- **Prototype review**: what works, what's confusing, UI/IA problems (e.g. two stacked design systems, mono font everywhere, one green for everything, synthetic order book on an AMM, no Portfolio page, full-page `innerHTML` re-renders), and what to keep.
- **Open questions** (start from `ARCHITECTURE.md` §10; add your own).

Keep it rigorous and specific. This document is how the user checks you understood the product.

### 0.2 Scaffold

- Create the app with the official Solana template:
  `pnpm create solana-dapp@latest -t gh:solana-foundation/templates/gill/gill-next-tailwind-basic`
  (Next.js, Tailwind, shadcn/ui, gill / @solana/kit, Wallet UI, Anchor example, Codama). If the template name has changed, pick the closest Next.js + Tailwind + gill + Anchor template and record it in `DECISIONS.md`.
- Leave `anchor/` untouched. Remove nothing from it; don't wire the example program into the new UI.
- Put the prototype at `docs/concept/score-terminal-v4.html` (the user will provide it — ask if it's missing).
- Add `packages/core` as a pnpm workspace package (see `ARCHITECTURE.md` §8; keep the template layout if a full monorepo conversion fights its scripts).
- Tooling: TypeScript strict, ESLint, Prettier, Vitest, path aliases, `pnpm lint | typecheck | test | build | dev` scripts at root.
- Add TanStack Query and Zustand. UI, chart and motion libraries are chosen freely in Step 1 (ground rule 8); add only what the wireframe needs now.
- `README.md`: what score is (3 lines), how to run, demo mode, repo map.

### 0.3 Domain logic → `packages/core` (pure TypeScript, fully tested)

Port the prototype's logic into small, pure, typed modules. No React, no browser APIs.

- `config.ts` — every parameter from `ARCHITECTURE.md` §4 in one typed object.
- `curve.ts` — `raised(S)`, `price(S)`, `tokensForUsdc` (deterministic bisection), `usdcForTokens`, caps.
- `pool.ts` — CPMM quotes (tokens out, price impact), add/remove liquidity, zap, IL.
- `fees.ts` — ICO fee, buy fee, `sellTax(holdAgeDays)`, fee routing (vault/treasury).
- `holdAge.ts` — weighted average acquisition time; preservation through LP.
- `scoring.ts` — full event matrix (`ARCHITECTURE.md` §4.7), minutes, coefficients, display score.
- `boards.ts` — board construction, weights, 35/25/20/12/8 with renormalisation, tie-breaks, multi-board stacking.
- `controller.ts` — round pool sizing (runway, vault/TVL, `MXC`, smoothing, clamps, annual cap).
- `claims.ts` — USDC vs tokens +10%, reserve limits.
- `snapshot.ts` — eligibility rules (incl. LP-attributed tokens).
- `sim/` — the demo match simulator (events per position, compressed clock) and seed data (the prototype's 30 players, schedule, initial vault $60k, 6 bonded at start).
- **Tests:** every invariant and test vector in `ARCHITECTURE.md` §9, plus property tests where cheap (supply ≤ 10M, vault never negative, payouts ≤ round pool).

Where the prototype has a known bug or ambiguity (e.g. dividend denominator, Q1), implement the proposed fix behind a clearly named function and note it in `ANALYSIS.md`.

### 0.4 Mock protocol → `src/lib/protocol`

- `ProtocolClient` interface exactly as in `ARCHITECTURE.md` §7.2 (adjust names if needed, but keep the seam).
- `MockProtocolClient`: uses `packages/core`; state in memory, persisted to `localStorage` (wrapped in try/catch, versioned key, reset action).
- `DemoClock`: compressed rounds (40s OPEN / 50s LIVE, configurable) vs real-calendar mode; emits phase changes; drives the simulator.
- Mock sign-in (Google / email / Phantom choice, country select, Terms checkbox, restricted-country block) + **test USDC faucet** ($1,000).
- Events via `subscribe()`: price ticks, match events, phase changes, bonded, settled.
- React layer: TanStack Query hooks per read; mutations per action; a small Zustand store for session + demo settings. **No full-page re-renders** — live ticks update only the components that need them.

### 0.5 App shell + dummy UI layout (wireframe quality)

Build every route and global element from `ARCHITECTURE.md` §7.3 with **real data from the mock**, using plain shadcn defaults and simple layout. Do **not** design yet: no custom colours, fonts, backgrounds, illustrations or motion. The goal is correct structure, hierarchy and states that Step 1 can style.

The shadcn components here are **scaffolding, not a commitment** — Step 1 may replace any of them. So keep presentation thin: data fetching, state and behaviour live in hooks (`usePlayer`, `useTradeQuote`, `useRound`…), and page components only lay out what the hooks return. Then swapping a UI library later only touches presentation.

- Global: header (logo text, nav, matchday pill with countdown/live, DEVNET badge, balance, account menu + faucet + reset demo), mobile bottom tab bar, toasts, modals (sign-in, bonded, full-time/claim).
- `/` landing · `/markets` · `/player/[id]` (launching + trading states, trade panel, tabs, Pro view toggle) · `/matchday` · `/portfolio` · `/docs/[section]` (port content + calculators) · `/terms` (port draft).
- Every list/table/card has empty, loading and error states.
- Responsive at 375px, 768px, 1280px+ (layout only).
- Replace the prototype's synthetic order book with AMM-native elements (price impact in the ticket, recent trades, pool depth).

### 0.6 Verify & report

- Click through the full loop yourself (use the browser/Playwright if available): sign in → faucet → buy on a curve → push a player to bond → trade with sell tax shown → kickoff snapshot → live board → full time → claim USDC and claim tokens → portfolio reflects everything.
- Screenshot each route at mobile and desktop widths into `docs/screenshots/step-0/`.

### ✅ Step 0 — Definition of done

- [ ] `docs/ANALYSIS.md` complete (all 13 units, prior art, journeys, prototype review, open questions)
- [ ] App scaffolded from the Solana template; `pnpm dev | build | lint | typecheck | test` all pass
- [ ] `packages/core` implemented; all `ARCHITECTURE.md` §9 vectors pass
- [ ] `MockProtocolClient` + `DemoClock` drive the complete loop end to end
- [ ] Every route + global element exists with real mock data and empty/loading/error states
- [ ] `git diff anchor/` is empty; no program code written or run
- [ ] `README.md`, `docs/DECISIONS.md` updated; screenshots saved

**🛑 STOP.** Post a short report: what was built, how to run it, top 5 open questions from `ANALYSIS.md`, anything you'd change in the plan. Wait for the user to approve Step 1.

---

## Step 1 — Design: research, four directions, then build the chosen one

Goal: a **full-fledged consumer DeFi product** with a distinctive, considered design. We get there in two phases with a gate between them:

1. **Explore:** research existing products, then build **four genuinely different design directions** on the three screens that define the product. The user picks one (or a mix).
2. **Build out:** take the chosen direction across every route, state and breakpoint.

**Mandate for everything in Step 1:** every direction and every screen follows design-engineering principles and the installed design skills, each skill used where it fits best (1.4). The four directions are *different designs*, not theme switches of one design.

### 1.1 Inspiration research → `docs/INSPIRATION.md`

Before any design work, study what exists. Use the browser (Playwright or the available browser tools) to visit, screenshot (desktop + mobile width) and analyse:

- **Direct comps:** Football.fun / Sport.fun, Sorare, Playr, Fantasy Premier League, Football Index (archived pages/screenshots if the site is gone)
- **Football data & live:** FotMob, Sofascore, OneFootball
- **Markets & trading:** Polymarket, Kalshi, Hyperliquid, Jupiter, pump.fun, Meteora
- **Consumer finance:** Robinhood, Coinbase, Phantom
- Anything else you find that does a relevant screen especially well

For each product, record: what it is; its visual language (type, colour, density, shape, motion); **patterns worth borrowing per score screen** (player page, trade panel, live matchday, markets list, portfolio, claim moment, onboarding); what to avoid; and what makes it feel premium or cheap. End with a synthesis: the five to ten ideas that should shape score's directions.

Screenshots go in `docs/inspiration/` for internal reference only. **Never copy logos, brand assets, illustrations or proprietary layouts wholesale.** We borrow patterns, not identities.

### 1.2 Inventory the skills already installed

- List every skill available to you. Check **all** of these locations — skills are split across them:
  - `~/.claude/skills/` (global Claude Code skills)
  - `~/.agents/skills/` (global agent skills — **the user has design skills here too**)
  - `.claude/skills/` and `.agents/skills/` in the project
  - plugin skills
- Skills in `~/.agents/skills/` may not be auto-loaded by the Skill tool. Use them anyway: open the folder, read the `SKILL.md` directly and follow it. Don't skip a skill because it isn't in your skill list.
- The user expects at least **anti-slop**, **taste-skill**, **stageshow**, plus other design skills. Find them all, whatever their exact names. If the same skill exists in more than one location, note both paths and use the newer version.
- **Read each relevant `SKILL.md` in full** (and any files it references) before deciding anything. Note: purpose, what it's good at, what it forbids, any stack it assumes (e.g. a specific animation library), and whether it edits code or only audits/plans.
- Record the inventory in `docs/UI_SKILLS.md`, with the path each skill was found at.

### 1.3 Add more skills from ui-skills.com where they fill a gap

- Browse the catalogue (`npx ui-skills` CLI, the MCP, or https://www.ui-skills.com/skills). Shortlist only skills that fill a gap in what's installed. Candidates worth evaluating for this product:
  - `ibelick/ui-skills-root` — router to the right UI skill per task
  - `ibelick/improve-ui` — audit surfaces and write fix plans (read-only)
  - `0xdesign/design-lab` — generating and comparing variants (**directly relevant to 1.5**)
  - `Dammyjay93/interface-design` — dashboards, data-dense app screens
  - `jakubkrehel/better-ui` — detail polish (borders, shadows, radius, hover, optical alignment, micro-interactions)
  - `emilkowalski/improve-animations`, `raphaelsalaja/12-principles-of-animation`, `wshobson/interaction-design` — motion
  - `anthropics/frontend-design`, `pbakaus/impeccable`, `Leonxlnx/gpt-tasteskill` — overall aesthetic direction
  - `benjitaylor/stageshow` — faux product UI for marketing/hero illustrations
- Before installing, check that the skill isn't already in any of the 1.2 locations (including `~/.agents/skills/`). Install new ones to the **project** (`.claude/skills/`) unless the user says otherwise. Read every new skill's files before using it; don't run bundled scripts you haven't reviewed. Log what you installed and why in `docs/UI_SKILLS.md`.

### 1.4 Map skills to areas — before touching any UI

Write a **skill → area mapping table** in `docs/UI_SKILLS.md` and follow it for **all four directions and the final build-out**. Rules:

- **Each direction has one lead aesthetic skill** (taste-skill, impeccable, frontend-design or equivalent) that owns its typography, colour grading, layout rhythm and backgrounds. Different directions may be led by different aesthetic skills; that is a good way to get real variety. Within a direction, other skills must not override the lead.
- The scoped skills below apply to **every** direction, so all four are equally well crafted and the comparison is fair. Starting point (verify against what each skill actually says, then adjust):

| Area | Skill (proposed) | Why |
|---|---|---|
| Overall aesthetic of a direction | taste-skill / impeccable / frontend-design (one per direction) | Single source of aesthetic truth per direction |
| Generating and comparing the directions | design-lab | Built for variant exploration |
| Landing hero + feature cards + "how it works" visuals | stageshow | Faux product UI that shows the real terminal/board in marketing contexts — never used on real app screens |
| Data-dense app screens: Markets table, Pro terminal, Portfolio, Matchday boards | interface-design | Dashboard craft and consistency |
| Component detail polish everywhere | better-ui | Borders, radius, shadows, hover/focus, optical alignment |
| Motion: price flashes, number tickers, bonding progress, live events, full-time/claim moment | improve-animations / 12-principles / interaction-design | Motion that carries meaning, respects reduced motion |
| Copy + visual cliché audit, final gate per screen | anti-slop | Remove generic AI patterns in words and visuals |
| Audit pass at the end | improve-ui | Finds verified problems; you then implement the fixes |

- If two skills conflict *within a direction* (e.g. they assume different animation libraries for the same job), resolve it for that direction and record it in `DECISIONS.md`. Different directions are free to make different library choices; that is part of the exploration (ground rule 8).

### 1.5 Four directions → `/lab`

**Scope.** Each direction designs and builds the same three screens, each at desktop (1440px) and mobile (375px):
1. **Player hub, trading state**, including the trade panel (shows how it handles money, charts and density)
2. **Matchday live centre** (shows energy, motion and the "sports" feel)
3. **Landing hero and first fold** (shows brand, type and personality)

Do not build the other routes for the directions. That comes after the user chooses.

**Briefs.** Use these as starting points so the directions stay far apart. Reshape them after the inspiration research if you have a better idea, but keep four clearly different answers. **The user prefers light, white backgrounds with coloured elements** (buttons, charts, chips), and is also open to something close to Sport.fun's look.

| | Direction | Background | Feel | References to study |
|---|---|---|---|---|
| **A** | **Broadcast** | Light | Bold condensed sports typography, huge numbers, position-coloured chips, scoreboard energy. Fan-first. | FotMob, Sofascore, sports TV graphics |
| **B** | **Clean fintech** | Light | Airy, one saturated brand colour, charts front and centre, calm data surfaces. | Polymarket, Robinhood, Kalshi |
| **C** | **Collectible** | Light or Sport.fun-like (research its actual look first) | Vibrant, card-forward, gamey but disciplined; player cards as the hero object. | Sport.fun, Sorare |
| **D** | **Pro terminal** (wildcard) | Dark | Dense, trader-first; a refined, coherent version of the prototype. | Hyperliquid, Jupiter |

**Must differ on:** layout and information hierarchy, typography, colour palette, density, component shapes, chart style, and motion personality. If two directions could be produced from each other by swapping colour tokens, they are not different enough — redo one.

**Shared non-negotiables for every direction:**
- Green/red reserved for P&L and up/down only. Brand colours are something else.
- Monospace (or tabular figures) only for prices, amounts and addresses; `tabular-nums` wherever numbers align.
- Typographic player identity: no photos, club crests or league logos.
- WCAG AA contrast, visible focus rings, 44px touch targets, `prefers-reduced-motion` honoured.
- The live score is labelled provisional; the current sell tax is visible before any sell.

**Implementation:**
- Each direction lives in its own folder, e.g. `src/directions/<a-broadcast>/`, with its **own tokens and its own components**. Share only data hooks, `packages/core`, formatting utilities and the `ProtocolClient`. No shared styled components between directions.
- **Each direction picks its own UI, chart and motion libraries** (ground rule 8). Don't default all four to shadcn + one chart library; let the direction and its lead skill decide. For example, a broadcast direction might lean on GSAP and bespoke components, a fintech one on Radix primitives and visx. Use each library through the direction's tokens.
- Routes: `/lab` (index with a direction switcher) and `/lab/<direction>/{player,matchday,landing}`.
- All four read from the same mock state. Add a lab control to **pin the demo at a chosen moment** (e.g. a specific player, mid-live matchday) so the user compares the same moment across directions.
- Don't modify the Step 0 production routes during exploration.
- Before presenting, give every direction its better-ui polish, motion pass and anti-slop pass, so none loses because it was less finished.

**Deliverables:**
- `docs/DIRECTIONS.md`: one card per direction (name, one-line idea, inspiration sources, lead skill, **libraries used and why**, palette, type pairing, key components, motion personality, bundle-size impact, strengths, weaknesses, who it suits best).
- Screenshots: `docs/screenshots/lab/<direction>/` (each screen, desktop + mobile), plus one side-by-side comparison image per screen.
- Your recommendation, with reasons tied to the product and the Breakpoint audience.

**🛑 STOP — design choice.** Present the directions (link to `/lab`, the comparison images, the cards and your recommendation). Wait for the user to choose. They may pick one or combine elements ("A's layout with B's colours"). Record the decision in `DECISIONS.md`.

### 1.6 Design system for the chosen direction → `docs/DESIGN.md`

Turn the chosen direction into a full system before applying it everywhere: colour tokens (light, and dark if the direction includes it), typography scale, spacing and radius scales, surface elevations, position colours, chart styling, motion tokens (durations, easings), component inventory. Keep the shared non-negotiables from 1.5. Implement as Tailwind theme tokens / CSS variables, mapped into whichever component libraries the direction uses; no hard-coded colours in components. List the libraries the system relies on (and for what) in `DESIGN.md`.

### 1.7 Apply, area by area (in this order)

Reuse the lab work for the three explored screens; build the rest in the same language.

1. Tokens, typography, base components (buttons, inputs, tabs, tables, cards, badges, toasts, modals)
2. App shell: header, matchday pill, account menu, mobile bottom tab bar
3. **Player hub** (both states) + trade panel + Pro view — the most important screen
4. **Matchday** live centre — the demo moment (clock, round pool, your-players strip, animated event feed, boards, full-time + claim)
5. Markets
6. Portfolio + claim flow
7. Landing (stageshow visuals here)
8. Docs + Terms
9. States pass: empty, loading (skeletons), error, signed-out, restricted country
10. Motion pass (price flash, number tickers, bonding fill, bonded celebration, settlement)
11. Mobile pass at 375px for every route

After each area: run the anti-slop check on that area, screenshot it, and fix before moving on.

### 1.8 Review

- Run the `improve-ui` audit (or equivalent) across all surfaces; implement the verified fixes.
- Final screenshots (mobile + desktop) into `docs/screenshots/step-1/`.
- Re-run the full demo loop; nothing in the mock/logic should have changed except where a UI need required it (log those).
- Keep `/lab` behind a dev-only flag (excluded from the production build) so the unchosen directions remain available for reference.

### ✅ Step 1 — Definition of done

- [ ] `docs/INSPIRATION.md` written with screenshots and a synthesis
- [ ] `docs/UI_SKILLS.md` (inventory with paths, installs, mapping) written and followed
- [ ] Four directions built in `/lab` on the three screens, desktop + mobile; `docs/DIRECTIONS.md` and comparison screenshots delivered; **user's choice recorded**
- [ ] `docs/DESIGN.md` written for the chosen direction and followed
- [ ] Every route built in the chosen direction per 1.7; mobile verified at 375px
- [ ] Motion meaningful and reduced-motion safe; no layout shift on live updates
- [ ] AA contrast, focus states, touch targets verified
- [ ] Anti-slop pass done on every page; audit fixes applied
- [ ] Still no contract changes; all checks green; screenshots saved

**🛑 STOP.** Report with before/after screenshots and wait.

---

## Later steps (outline only — do not start)

- **Step 2 — Season economics simulation:** model vault inflows/outflows over a 38-round season under different launch pace, turnover and claim mix; output charts for the pitch. Resolve open questions Q1, Q2, Q7, Q8, Q9.
- **Step 3 — Contracts:** the custom Anchor program per `ARCHITECTURE.md` §6.1–6.2 (only when the user says so).
- **Step 4 — Scoring + oracle service:** ingestion worker, freeze timing, admin-signed results, replay of a real past gameweek for the demo.
- **Step 5 — Integration:** `OnchainProtocolClient` (Codama client + indexer), embedded wallet (Privy), fee sponsorship, geo-blocking at the edge.
- **Step 6 — Demo & pitch:** scripted 2-minute demo round, pitch narrative (Football Index lesson → our solvency design), backup recording.