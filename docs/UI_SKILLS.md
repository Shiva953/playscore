# UI skills: inventory, installs and mapping (Step 1)

Every `SKILL.md` below was read in full, plus the references each one routes this work to (listed per skill). Paths are where the skill was found on 2 Nov 2026.

## 1. Inventory

### Design skills used in Step 1

| Skill | Path | Purpose | Good at | Forbids / assumes | Edits code? |
|---|---|---|---|---|---|
| **design-taste-frontend** ("tasteskill v2") | `~/.agents/skills/design-taste-frontend/` | Art direction from a library distilled from 247 gallery sites + 23 real app screens; deals directions, measures pages in a real browser | A dealt direction instead of a default; app-screen rules (`references/app-screens.md`, read whole); `lint.mjs` and `inspect.mjs` gates at 1440/768/390 | Gradients, glows, glass, eyebrows, tracked caps, index numbers, monospace outside IDs/figures, violet/indigo, cream+terracotta, icon tiles, sparklines on KPIs, shadows at rest; ≥4 real pictures on a page (interface fragments count) | Yes (guides building); scripts only read/write `.taste-skill/` and `~/.taste-skill/history.json` (reviewed: no network in `draw.mjs`, `inspect.mjs` serves locally) |
| **unslop** (anti-slop) | `~/.claude/skills/unslop/` | Redline pass over AI-looking UI: spacing → colour → icons → copy → type → layout → details → visuals → motion | `references/signs.md` audit list (read), exact tokens (`references/tokens.md`, read), copy rules, template check | Hue gradients, gradient text, glows, emoji, hype words, exclamation marks, trailing periods on labels, `animate-pulse` on non-live things, `transition-all` | Yes; `story.mjs`/`snapshot.mjs` not needed |
| **interface-design** | `~/.agents/skills/interface-design/` | Craft for dashboards and data-dense app screens | Intent checkpoint per component, hierarchy (one focal point, weight before size), states, hit areas, "use what exists" (Radix/shadcn first) | Marketing pages; harsh borders, mixed depth strategies, multiple accents | Yes |
| **better-ui** | `~/.agents/skills/better-ui/` | Exact polish values: radius, optical alignment, shadows vs borders, press scale, icon states, enter/exit | Concentric radius, `scale(0.96)` press, transitions not keyframes, hover behind `(hover: hover)`, overscroll containment, reduced-motion gating (`animations.md`, `enter-exit.md`, `surfaces.md`, `icons.md` read) | `transition-all`, `bounce` ≠ 0, press below 0.96 | Yes. Delegates type/a11y/layout/colour to sibling `better-*` skills, which are **not installed** (see §2) |
| **stageshow** | `~/.agents/skills/stageshow/` | Faux/marketing product UI, framed and cropped like a launch page | Restraint (3–7 real strings), framing rules (no plate, crop to the story, no dead corners), one focal object, motion with a cause | Gray-bar wireframes, windows floating on plates, sparkles, made-up logos | Yes (React kit under `kit/`; not copied, see mapping) |
| **frontend-design** | `~/.agents/skills/frontend-design/` and plugin `~/.claude/plugins/cache/claude-plugins-official/frontend-design/1.1.1/` (identical; the `~/.agents` copy is newer by date) | Distinct aesthetic direction, writing in design | UX-writing rules (actions keep one name through a flow, errors say what to do), the "AI clusters" list (cream+terracotta, near-black + acid green, SaaS card kit) | Single-word accent in headlines, all-caps labels, `→` on every link | Yes |
| **improve-ui** | `~/.agents/skills/improve-ui/` | Read-only audit with contract/runtime/correction proofs; writes plans under `design-plans/` | Final verified audit (1.6) | Never edits product source | No (plans only) |
| **improve-animations** | `~/.agents/skills/improve-animations/` (+ `AUDIT.md`) | Read-only motion audit (Emil Kowalski's rules) | Easing/duration/frequency rules, missed opportunities | Never edits source | No (plans only) |
| **dataviz** | session skill (Skill tool) | Charts, stat tiles, palettes | Chart form heuristics, one-hue rules, contrast in both themes | — | Guidance |

### Installed but not used in Step 1 (with reason)

| Skill | Path | Why not |
|---|---|---|
| design-lab | `~/.agents/skills/design-lab/` | Generates five variants in a temporary `__design_lab` route and interviews the user. The taste skill already deals and records a direction; a variant lab would fork the system. Kept for a later component exploration if wanted. |
| ui-skills-root | `~/.agents/skills/ui-skills-root/` | Router that loads skills via `npx ui-skills`; running that CLI was blocked (external code). Catalogue read on the website instead. |
| improve | `~/.agents/skills/improve/` | Whole-codebase advisor (bugs, perf, tests), not UI. |
| reanimate | `~/.agents/skills/reanimate/` | Clones an existing reference frame by frame; we have no reference to clone. |
| fun-isometric, anatomy | `~/.agents/skills/fun-isometric/`, `~/.claude/skills/anatomy/` | Isometric illustration. The page direction pictures the product with its own interface fragments, and the taste skill counts drawings below real fragments. |
| build-with-exa, find-skills, lead-signals, make-ugc, treg, reverse-engineer-anything | various | Not UI. |
| artifact-* skills | session skills | For claude.ai artifacts, not this codebase. |

`taste-skill` and `gpt-tasteskill` from PLAN's candidate list: the installed `design-taste-frontend` is "tasteskill v2", the same family. `anti-slop` from PLAN's list is `unslop`.

## 2. Gaps and installs (1.2)

Catalogue read at <https://www.ui-skills.com/skills> (the `npx ui-skills` CLI was blocked by the session's permission policy as external code). Checked against every location above before shortlisting.

| Candidate | Fills a gap? | Status |
|---|---|---|
| `jakubkrehel/better-accessibility` | **Yes.** `better-ui` delegates focus rings, keyboard, ARIA, hit areas and reduced motion to it; nothing installed reviews accessibility. Needed for the AA/focus/44px Definition of Done. | **Not installed: download into `.claude/skills/` was blocked by the permission policy ("untrusted code integration").** Source: `github.com/jakubkrehel/skills` @ `60bf140`, markdown only (7 files). |
| `jakubkrehel/better-typography` | **Yes.** `better-ui` delegates wrapping, tabular numbers and text spacing to it. | Same: blocked, not installed. |
| `jakubkrehel/better-colors` | **Yes.** OKLCH palettes, contrast checks and Tailwind v4 theming (our stack). | Same: blocked, not installed. |
| `jakubkrehel/better-layout`, `better-interface`, `better-writing` | Partly; layout and copy are owned by the taste skill + unslop + frontend-design. | Not shortlisted. |
| `raphaelsalaja/12-principles-of-animation`, `wshobson/interaction-design` | No. `better-ui` (`animations.md`, `enter-exit.md`) + `improve-animations/AUDIT.md` already cover motion values and principles. | Not shortlisted. |
| `pbakaus/impeccable` | No. A second primary aesthetic skill; PLAN wants one. | Not shortlisted. |

**How the three gaps are covered meanwhile:** accessibility is verified mechanically with `@axe-core/playwright` (WCAG 2 AA rules incl. colour contrast) in `scripts/demo-loop.mjs`, plus the taste inspector's contrast checks and `better-ui`'s reduced-motion rules. Typography and colour follow the taste skill's `type.md`/`colour.md`-level rules in `app-screens.md` §9 and unslop's tokens. To install the three skills, approve it or run `npx skills add https://github.com/jakubkrehel/skills --skill better-accessibility` (and `better-typography`, `better-colors`).

## 3. Skill → area mapping (1.3)

**Primary aesthetic owner: design-taste-frontend.** It dealt the app style (`true-black-flat`, seed 1063017092, `.taste-skill/app/direction.json`) and the landing direction (`split-stage`, seed 1760845758, proof section redrawn, `.taste-skill/page/direction.json`). Its decisions win every conflict below unless PLAN.md's non-negotiables say otherwise.

| Area | Skill | Job, and its limits |
|---|---|---|
| Design system: type, colour, spacing, surfaces, radius, backgrounds | **design-taste-frontend** (primary) | Tokens from the dealt sheet; app rules from `app-screens.md`; page rules from `SKILL.md`. Gates: `lint.mjs --app`, `inspect.mjs --app` (screens) and without `--app` (landing). |
| Data-dense screens: Markets table, player hub, Pro view, Matchday boards, Portfolio | **interface-design** | Per-component intent checkpoint, one focal element per view, states for every control and data block, Radix/shadcn primitives first. May not override taste's colour, borders-vs-tones or label casing. |
| Charts, sparklines, stat figures | **dataviz** + taste `app-screens.md` §6 | One hue per chart, colour means good/bad, faint grid, no legend for one series. |
| Landing hero, showcase, how-it-works and stats fragments | **stageshow** (craft rules only) | Restraint, framing and crop rules for the `data-ui` fragments the page direction calls for. The fragments are the **real app components on live mock data**, not stageshow's faux kit, so the kit is not copied. Never used on app screens. |
| Component detail polish everywhere | **better-ui** | Concentric radius, optical alignment, press scale 0.96, hover behind `(hover: hover)`, named transition properties, `overscroll-behavior: contain`, icons in `currentColor`. |
| Motion: price flashes, number ticks, bonding fill, live events, bonded/full-time moments | **better-ui** (values) + **improve-animations** `AUDIT.md` (rules) | Feedback only on app screens (taste: no entrances there); the landing page gets the taste motion layer. Reduced motion always. |
| Copy and visual cliché audit, gate per page | **unslop** (`signs.md`) + taste `lint.mjs` | Run after each area; findings fixed before moving on. |
| UX writing (actions, errors, empty states) | **frontend-design** "More on writing" | One name per action through a flow; errors say what happened and what to do. |
| Final audit (1.6) | **improve-ui** + **improve-animations** | Read-only; their verified findings are implemented by me afterwards. |
| Accessibility gap | axe-core + taste inspector + better-ui | Until `better-accessibility` is approved. |

### Conflicts resolved once (also in DECISIONS.md)

| Conflict | Resolution |
|---|---|
| PLAN suggests lime `#c6ff3d`; taste's tells and frontend-design both name "lime/acid green on black" a kit look | Keep lime (the dealt sheet itself deals lime "only for sport"), but **only on data and the mark**: up/positive, your earnings, live state, bonding progress. Never on buttons, tabs or nav (true-black-flat's budget). The face comes from the type and the signature element, not the accent. |
| Lime accent vs PLAN "green/red reserved for P&L" | Lime **is** the positive colour (taste: a yellow-green accent is `--positive`; a second green beside it reads as two greens). So green appears only on gains, and red only on losses. |
| PLAN allows monospace for prices/amounts; taste bans monospace outside IDs/figures-as-a-decision; frontend-design calls mono data labels a tell | Prices and amounts use **tabular figures in the text face**. Monospace only for wallet addresses and transaction IDs. |
| Taste deals Inter; its own tells list flags "stock Geist or Inter … lime on black" | Type redrawn for a stated reason: **Instrument Sans**. Schibsted Grotesk was tried first (newspaper sports pages) and rejected: its tabular set also widens `.` `:` `,` to digit width, so prices read "$0 . 01051". Instrument Sans has tabular digits with proportional punctuation (measured) and a width axis for the landing's condensed display word. One family. |
| interface-design: tracked uppercase labels, shadows for lift | Taste + unslop: sentence case, elevation by lightness only, shadows only on what floats. |
| Easing: unslop `(0.22,1,0.36,1)`, interface-design `(0.23,1,0.32,1)`, better-ui `(0.2,0,0,1)` | One curve, `cubic-bezier(0.23, 1, 0.32, 1)` (improve-animations' audit rule set), press `scale(0.96)` (better-ui). |
| Taste page rules: "≥4 real pictures"; PLAN: no player photos, crests or logos | Pictures are the product's own interface fragments (`data-ui`), which the taste skill counts. No photography of players, clubs or leagues anywhere. |
| PLAN: "uppercase only for tiny labels" | No tracked uppercase labels at all (taste/unslop). Uppercase only inside tickers (`$HAALAND`) and position codes (`FWD`), which are data. |
