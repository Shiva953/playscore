# score: design system (Step 1)

Owner: `design-taste-frontend` (see `docs/UI_SKILLS.md`). App screens follow the dealt **true-black-flat** style (seed 1063017092); the landing page follows the dealt **split-stage** direction (seed 1760845758). Both share one palette and one typeface. Tokens live in `src/app/globals.css`; components never hard-code colours.

## 1. Direction

- **Product.** A place to own real footballers as tokens, back them before kickoff, and get paid when they finish top five.
- **Character.** Matchday-tense, exact, a little loud only when a goal goes in.
- **World.** A stadium at night: floodlit pitch, the scoreboard, the results table in Monday's paper, the steward's hi-vis.
- **Moments (where colour lives).** Your earnings, a live goal landing on the board, a curve filling to $25k. Everything else is black, grey and white.
- **Signature element.** **The matchday strip:** the window as one horizontal line, from the kickoff snapshot through live play to the data freeze, with every club's kickoff on it and a "now" mark moving along. It appears in the header pill (compact), on Markets, on the Matchday page and on the landing board. No competitor has a kickoff snapshot, so no competitor has this strip.
- **Idea (landing, shortened 3 Nov).** Two screens: the line, the button and three real figures beside **this weekend's live board**; then how it works in four short steps. The long scroll (split stage, showcase calculator, squad, comparison table, vault mosaic) was cut after review: "we have to scroll a lot".

## 2. Each screen's one question

| Screen | Question | Biggest thing |
|---|---|---|
| Markets | What can I back before kickoff? | The matchday strip with the countdown, then players launching now |
| Player | Should I buy this player now, and what will it cost me? | Price (or curve) chart beside the trade ticket; the price is the largest figure |
| Matchday | Are my players earning right now? | Your players' provisional earnings, then the boards |
| Portfolio | What do I own, what did I earn, what can I claim? | Total value (32px), then claimable dividends |
| Docs | How does it work, exactly? | The section's text column |

## 3. Colour

Dark only (dark-first is a non-negotiable; there is no light theme in Step 1). Elevation by **lightness alone**: no borders or shadows on cards.

| Token | Value | Use |
|---|---|---|
| `--ground` | `#000000` | Page, top bar, bottom bar |
| `--surface` | `#111111` | Cards, panels |
| `--raised` | `#2a2a2a` | Nested panels inside a card, active segment |
| `--overlay` | `#161616` | Menus, dialogs, sheets, toasts (these may cast a shadow) |
| `--rule` | `#1c1c1c` | Table row rules only |
| `--control` | `#3a3a3a` | Input and outline-button edges |
| `--ink` | `#ffffff` | Primary text, identity, key numbers |
| `--muted` | `#b4b4b4` | Secondary text |
| `--faint` | `#949494` | Meta, axis ticks, captions (≥4.5:1 on `#2a2a2a`) |
| `--accent` / `--up` | `#c6ff3d` | **Data only**: gains, your earnings, live state, bonding fill, the brand mark |
| `--down` | `#ff6b81` | Losses, a negative change, an error mark |
| `--up-tint` / `--down-tint` | `#1f2a0b` / `#2c1419` | Pale pairs behind positive/negative pills |

Rules: colour share stays under ~3% of a screen. The accent never touches buttons, tabs or nav. Colour on a change says good or bad; a zero or undefined change is grey. A missing value is a grey dash.

**Position identity** (quiet, badges only, never in charts): pale tints of hues ≥60° apart that avoid lime, red and violet. FWD amber `oklch(0.83 0.09 75)`, MID teal `oklch(0.82 0.07 190)`, DEF blue `oklch(0.78 0.08 245)`, GK rose `oklch(0.8 0.07 350)`. Text in the hue, fill at 14% of it.

## 4. Type

- **Instrument Sans** for all text. `.num` keeps tabular figures on mixed rows.
- **Chivo** for the figures themselves (`.fig`, and `td.num` cells): prices, stat values, balances, earnings, table numbers. Added 3 Nov after review ("use a different suitable font for numbers"): tabular digits (24.6px) with narrow punctuation (10.2px), so `$0.01016` reads as one number. Azeret Mono was tried first and rejected: in a monospace the point takes a full digit's width ("$0 . 01016").
- **Geist Mono** only for wallet addresses and transaction IDs.
- **Player header (3 Nov):** the ticker is a white chip (`<Ticker chip>`), the price 44px in Chivo coloured by its 24h move (lime up, pink down, white flat) with the change in a tinted pill; the four stats under it at 24px.
- App scale: 12 (meta) · 14 (body, cells, nav) · 16 (card titles) · 20 (screen title, h1) · 24 (key figures) · 32 (the one answer figure: player price, portfolio total). Nothing above 600 weight; no tracking on text under 16px; −0.02em from 24px.
- Landing scale: 16 (body) · 28/48 (the headline, phone/desktop, two lines) · 22 (the three figures).
- Sentence case everywhere. No tracked capitals, no eyebrows, no index numbers.

## 5. Space, radius, surfaces

- 4px grid. Gap 16, card padding 20, screen gutter 24 desktop / 16 phone, section gap 32 (app) and 120–240 (landing).
- Shell: no sidebar. 48px top bar on the ground over a centred **1200px** column; logo on the column's left edge. Sticky; it gains a 1px rule only once content scrolls under it. Phone: logo, matchday pill, account; destinations in a bottom bar of four.
- Radius: soft style, chosen once. Cards 16, nested 8, controls are full pills (36px tall; 44px minimum on touch pointers), chips are pills.
- Tables: 12px grey sentence-case headers, no fill band, 44px rows over 1px `--rule`, numbers right-aligned. Below 640px they become two-line rows.

## 6. Components

- **Button.** Primary: white pill, black label (one per screen). Secondary: `--raised` pill, white label. Outline: transparent with a `--control` edge. Ghost/text for tertiary. Press `scale(0.96)` over 150ms, never when disabled.
- **Segmented control** (Buy/Sell, ranges): `--surface` track, active segment `--raised` with white label, inactive `--muted`.
- **Tabs:** text tabs, inactive `--muted`, active `--ink`; no pill, no accent.
- **Inputs:** `--ground` fill inside cards, 1px `--control` edge, white focus ring.
- **Pills:** 20px, pale pair (up/down/neutral); position badges use the identity tints.
- **Focus:** 2px white ring with 2px offset on every interactive element.

## 7. Charts

One question, one series, one hue. Price line in `--up` when the range is up and `--down` when down; a flat 12% fill under it; 4 faint `#262626` grid lines; ticks 12px `--faint`; no legend for one series. The bonding curve: the curve in `--muted`, the sold part filled with `--up` at 22%, "You are here" in ink, the $25k line dashed. Sparklines only in lists, never on KPIs.

## 8. Motion

One curve, `cubic-bezier(0.23, 1, 0.32, 1)`; durations 150ms (press, hover, tabs), 200ms (menus, popovers), 300ms (dialogs, sheets). Transform and opacity only, properties named. App screens: feedback only, no entrances. Specific moments:

- **Price flash:** a changed price tints `--up`/`--down` for 900ms, then returns to ink (colour only, so it stays under reduced motion).
- **Number tick:** key figures (round pool, earnings, total value) count to the new value over 400ms; instant under reduced motion.
- **Bonding fill:** the progress bar's fill animates its `scale-x` over 600ms.
- **Live event:** a new feed row slides 8px and fades in; under reduced motion it only fades.
- **Bonded / full time:** the dialog rises 12px with a fade; the earned figure ticks up from 0.
- Landing: no scroll choreography any more; the live board is the only moving picture.
- Toasts: bottom-right, 24px from the edge on desktop and 76px on phones (above the tab bar), on `--raised` with a float shadow so they read above the cards.

`prefers-reduced-motion: reduce` drops all travel and keeps opacity and colour.

## 9. Accessibility

WCAG AA contrast on every text tier (checked with axe-core in `scripts/demo-loop.mjs` and the taste inspector), visible focus everywhere, 44px touch targets on coarse pointers, live regions on the event feed and toasts, reduced motion honoured.
