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
- Add TanStack Query, Zustand, Lightweight Charts, and a motion library (Motion/Framer Motion by default).
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

## Step 1 — UI polish with design skills

Goal: turn the wireframe into a **full-fledged consumer DeFi product** — a distinctive theme, considered colour grading, backgrounds and visual elements where they earn their place, smooth motion, flawless on mobile. Use the installed design skills deliberately: **each skill only where it fits best.**

### 1.1 Inventory the skills already installed

- List every skill available to you. Check **all** of these locations — skills are split across them:
  - `~/.claude/skills/` (global Claude Code skills)
  - `~/.agents/skills/` (global agent skills — **the user has design skills here too**)
  - `.claude/skills/` and `.agents/skills/` in the project
  - plugin skills
- Skills in `~/.agents/skills/` may not be auto-loaded by the Skill tool. Use them anyway: open the folder, read the `SKILL.md` directly and follow it. Don't skip a skill because it isn't in your skill list.
- The user expects at least **anti-slop**, **taste-skill**, **stageshow**, plus other design skills. Find them all, whatever their exact names. If the same skill exists in more than one location, note both paths and use the newer version.
- **Read each relevant `SKILL.md` in full** (and any files it references) before deciding anything. Note: purpose, what it's good at, what it forbids, any stack it assumes (e.g. a specific animation library), and whether it edits code or only audits/plans.
- Record the inventory in `docs/UI_SKILLS.md`, with the path each skill was found at.

### 1.2 Add more skills from ui-skills.com where they fill a gap

- Browse the catalogue (`npx ui-skills` CLI, the MCP, or https://www.ui-skills.com/skills). Shortlist only skills that fill a gap in what's installed. Candidates worth evaluating for this product:
  - `ibelick/ui-skills-root` — router to the right UI skill per task
  - `ibelick/improve-ui` — audit surfaces and write fix plans (read-only)
  - `Dammyjay93/interface-design` — dashboards, data-dense app screens
  - `jakubkrehel/better-ui` — detail polish (borders, shadows, radius, hover, optical alignment, micro-interactions)
  - `emilkowalski/improve-animations`, `raphaelsalaja/12-principles-of-animation`, `wshobson/interaction-design` — motion
  - `anthropics/frontend-design`, `pbakaus/impeccable`, `Leonxlnx/gpt-tasteskill` — overall aesthetic direction (pick **one** primary)
  - `benjitaylor/stageshow` — faux product UI for marketing/hero illustrations
  - `0xdesign/design-lab` — generating and comparing variants
- Before installing, check that the skill isn't already in any of the 1.1 locations (including `~/.agents/skills/`). Install new ones to the **project** (`.claude/skills/`) unless the user says otherwise. Read every new skill's files before using it; don't run bundled scripts you haven't reviewed. Log what you installed and why in `docs/UI_SKILLS.md`.

### 1.3 Map skills to areas — before touching any UI

Write a **skill → area mapping table** in `docs/UI_SKILLS.md` and follow it. Rules:
- **One primary aesthetic-direction skill** (taste-skill or equivalent) owns the design system: typography, colour grading, layout rhythm, backgrounds. Others must not override it.
- Each other skill gets a scoped job. Starting point (verify against what each skill actually says, then adjust):

| Area | Skill (proposed) | Why |
|---|---|---|
| Design system: type, colour, spacing, backgrounds | taste-skill (primary) | Single source of aesthetic truth |
| Landing hero + feature cards + "how it works" visuals | stageshow | Faux product UI that shows the real terminal/board in marketing contexts — never used on real app screens |
| Data-dense app screens: Markets table, Pro terminal, Portfolio, Matchday boards | interface-design | Dashboard craft and consistency |
| Component detail polish everywhere | better-ui | Borders, radius, shadows, hover/focus, optical alignment |
| Motion: price flashes, number tickers, bonding progress, live events, full-time/claim moment | improve-animations / 12-principles / interaction-design | Motion that carries meaning, respects reduced motion |
| Copy + visual cliché audit, final gate per page | anti-slop | Remove generic AI patterns in words and visuals |
| Audit pass at the end | improve-ui | Finds verified problems; you then implement the fixes |

- If two skills conflict (e.g. different animation libraries), resolve it once, record it in `DECISIONS.md`, and stick to it.

### 1.4 Design direction & system → `docs/DESIGN.md`

Define the system first, then apply it. Non-negotiables (the skills decide everything else):
- **Dark-first** product UI with a distinctive brand accent (the prototype logo's lime `#c6ff3d` is a strong candidate). **Green/red are reserved for P&L and up/down only.**
- **Position colours** (FWD / MID / DEF / GK) as a quiet secondary identity system for player badges.
- Clean sans for UI and prose; monospace **only** for prices, amounts, addresses; `tabular-nums` everywhere numbers align. Sentence case; uppercase only for tiny labels.
- One radius scale, one spacing scale, three surface elevations. Backgrounds, gradients, glows and textures are allowed **where they add atmosphere without hurting legibility** (e.g. landing hero, matchday header) — keep data surfaces calm.
- **Typographic player identity** (ticker, position colour, form sparkline, current board rank). Drop "Legendary/Epic" rarity tiers unless the analysis argues for them.
- WCAG AA contrast, visible focus rings, 44px touch targets, `prefers-reduced-motion` honoured.
- Implement as Tailwind theme tokens / CSS variables + shadcn theme; no hard-coded colours in components.

### 1.5 Apply, area by area (in this order)

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

### 1.6 Review

- Run the `improve-ui` audit (or equivalent) across all surfaces; implement the verified fixes.
- Final screenshots (mobile + desktop) into `docs/screenshots/step-1/`.
- Re-run the full demo loop; nothing in the mock/logic should have changed except where a UI need required it (log those).

### ✅ Step 1 — Definition of done

- [ ] `docs/UI_SKILLS.md` (inventory, installs, mapping) and `docs/DESIGN.md` (system) written and followed
- [ ] Every route polished per the order above; mobile verified at 375px
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
