# Inspiration research (Step 1.1)

Captured on 2–3 Nov 2026 with `scripts/inspiration-shots.mjs` (Playwright, signed out, desktop 1440 × 900 and mobile 390 × 844, plus a taller three-screen capture). Screenshots are in `docs/inspiration/` for internal reference only. We borrow patterns, never logos, artwork or whole layouts.

Fonts and backgrounds below were measured from computed styles, not guessed. Motion is noted only where a screenshot shows it or the behaviour is widely documented; anything else is marked "not observed".

**Could not capture:** pump.fun (Cloudflare challenge for headless browsers) and Coinbase on desktop (same; the mobile price page loaded). Sofascore's mobile site also showed a challenge. Notes on pump.fun come from its public behaviour, not a fresh capture. "Playr" turned out to be a GPS tracker (Catapult) and a defunct gaming site (playr.gg, acquired 2020), so there was nothing to study. Football.fun now redirects to Sport.fun. Sport.fun's trading app (`pro.sport.fun`) needs an account, so only the public home and its sign-in splash were captured.

---

## Direct comps

### Sport.fun (formerly Football.fun): `sportfun-*`
**What:** fantasy football where you buy shares in real players on Base; points from real matches decide tournament prizes and rewards. Nearest product to score.
**Visual language:** navy-black ground (#0b0d14-ish) with panels one step lighter, Inter throughout, a cyan-mint primary button ("Build your first squad for free"), small type (12–14px) and very dense panels. Player identity is a photo cut-out over a shirt silhouette in club colours. Prices are tiny (0.0040) with coloured % changes. The app's sign-in splash is the opposite: white, a black pill, a dotted pattern.
**Borrow:**
- *Markets list:* "Biggest movers · 24h" as a short ranked list with price and % only, and "Live market: $317.75K (7-day volume) · 140 active player markets" as one sentence of proof.
- *Matchday:* "Top performers" as one huge points figure (1027.375 pts) with the five players beneath; "Market call" chart comparing two players' share of votes over time.
- *Claim moment:* "Claim your FUN rewards within 30 days" as a plain panel with one white button, plus the honest "Expected value, not guaranteed" line under the rewards.
**Avoid:** photo cut-outs and club-coloured shirts (banned for us anyway), 12px type for prices, a dashboard with nine equal panels and no lead.
**Premium / cheap:** premium in the restraint of the colour; cheap in the density (everything the same size, nothing leads) and the "New manager offer" strip.

### Sorare: `sorare-*`
**What:** fantasy football with ownable digital player cards; managers build 5-player lineups for weekly rewards.
**Visual language:** black with a starry, gold-flecked background, a custom condensed display face ("pressio", 69px uppercase) over system UI text, lilac pill buttons, and holographic photographic player cards fanned around the hero.
**Borrow:**
- *Player identity:* the card as a collectible object with a fixed ratio, position, season and a big name band; our version is typographic (no photo).
- *Onboarding:* the sign-up inside the hero ("Your name. Your legend." with the manager-name field right there), so the first action is on the first screen.
**Avoid:** casino starfield, gold glitter, "GET $100 FREE" promo banners, uppercase slogans.
**Premium / cheap:** the cards feel premium (heavy, framed, numbered); the page around them feels like a betting ad.

### Fantasy Premier League: `fpl-*`
**What:** the official, free Premier League fantasy game (11M+ players).
**Visual language:** the league's own type (PremierSans), saturated purple → magenta → cyan gradient bands, photographic player cut-outs, rounded white cards on a near-white ground. Very sticker-like tile illustrations (shirts with names).
**Borrow:**
- *Matchday:* "Team of the week" on a pitch (FotMob does the same); and the sub-nav of plain words (Prizes, The Scout, Price changes, Injuries, Statistics).
- *Collectible feel:* shirt tiles with the player's surname and club code ("Lammens HUL (A)").
**Avoid:** brand gradients as backgrounds, three competing CTAs in the hero, photographic cut-outs.
**Premium / cheap:** official and friendly, but busy; the gradients date it.

### Football Index (archived, Aug 2020): `footballindex-*`
**What:** the "football stock market" (2015–2021): buy and sell footballer shares for real money, paid "dividends" on media and match performance. Collapsed in March 2021 after cutting dividends; regulators later criticised how it was marketed.
**Visual language:** navy page, green CTA, a phone mock showing a list of players with *buy* and *sell* prices in green and red boxes, and a scrolling price ticker along the bottom ("NEYMAR £9.76 +£0.13").
**Borrow:**
- *Landing / markets:* the price ticker as a living strip of the market (in our case real pool prices), and the plain question headline ("What's your football knowledge worth?").
**Avoid (the lesson):** dividends promised as if they were guaranteed, paid from new money, with no visible vault. score shows the vault, the round pool as a % of it, and the cap, every time a payout is mentioned.
**Premium / cheap:** cheap, from the gambling-licence banner to the "Welcome offer: not made a profit after 7 days?" refund pitch.

---

## Football data and live

### FotMob: `fotmob-*` (home, league, live match, player)
**What:** live scores, tables, match centres and player stats.
**Visual language:** "walsheim" (GT Walsheim) at 14px with bold weights for numbers, #fafafa ground, white cards with 12px radius and no borders, green only for wins and the live minute. Tables are compact with a coloured bar on the rank to mark qualification zones. Player pages lead with a coloured band, then an attribute grid (height, shirt, foot, value), a traits radar and a transfer-value line chart.
**Borrow:**
- *Matchday live centre:* the score block (team · 0–0 · minute in green) as the clock; the momentum chart (diverging bars per minute, home up and away down); "Top stats" as head-to-head bars with the leader's side filled.
- *Boards:* rank, name, played, points, with a coloured edge on the paying rows (FotMob uses it for Champions League places). For us: the top five on each board get the edge.
- *Player hub:* the attribute grid as the first block under the name; the match rating chip (7.8 in a coloured square) for form.
- *Mobile:* everything in one column, tabs as plain words, sticky score at the top of a match.
**Avoid:** ad slots, the sign-in sheet over content, crests (banned for us).
**Premium / cheap:** premium; quiet surfaces, one strong typeface, colour that means something.

### Sofascore: `sofascore-desktop*`
**What:** live scores and very detailed stats, with odds.
**Visual language:** system-ui, a saturated blue top bar, white cards, red "Live (90)" pills, dense two-column match list with tiny crests and an odds toggle.
**Borrow:**
- *Matchday:* the live count as a pill ("Live (90)"), and "Who will win?" as three equal outcome buttons.
- *Markets:* "Highlighted transfers" as a list with the value right-aligned in bold.
**Avoid:** the blue chrome bar and the crowding of 6+ widgets.
**Premium / cheap:** functional and trusted; not beautiful.

### OneFootball: `onefootball-*`
**What:** football news, scores and streaming.
**Visual language:** system UI, black top bar, magenta-red promotional band, large editorial photos.
**Borrow:** little for score: the "Team of the matchday" editorial framing of a round's best players.
**Avoid:** consent wall and paywall bands before content; photo-led layouts (we have no photos).
**Premium / cheap:** media-site generic.

---

## Markets and trading

### Polymarket: `polymarket-*` (home, sports live)
**What:** prediction markets; prices are probabilities in cents.
**Visual language:** Inter, white ground, one saturated blue (#1652F0-like) for the primary button, green/red only for yes/no, rounded 12px cards with hairline borders. The sports page is a list of live fixtures with big coloured outcome buttons ("NEW 41¢ · DRAW 29¢ · EVE 31¢") and the volume per match.
**Borrow:**
- *Trade panel:* Buy / Sell tabs, a big "$0" amount, preset chips (+$1 +$5 +$10 +$100), one full-width primary button, and the terms line under it. Same place, same shape on every market.
- *Matchday:* "LIVE · 1H 12' · $1.09M Vol" as one quiet line above each fixture.
- *Markets list:* a gauge (51% Up) for a two-sided market; for us, the bonding progress ring.
**Avoid:** the "Build a combo" upsell, ten category tabs.
**Premium / cheap:** premium through restraint: one hue, numbers big, everything else grey.

### Kalshi: `kalshi-*`
**What:** CFTC-regulated prediction market.
**Visual language:** custom "Kalshi Sans" plus a condensed cut for headlines, white, a green brand colour, and photographic market cards with line charts and % pairs.
**Borrow:** *onboarding*: one bottom sheet with "Continue with Google / Apple / email" and a single legal line. Matches our embedded-wallet sign-in.
**Avoid:** a sign-up modal on first load, photos on every card.
**Premium / cheap:** premium type; the modal-first entry is not.

### Hyperliquid: `hyperliquid-*`
**What:** on-chain perpetuals exchange.
**Visual language:** custom face ("OurFont") at 12px, #303030-class dark greys, a mint accent, TradingView chart, order book, positions table; everything visible at once.
**Borrow:** *Pro view*: the market header line (Mark · Oracle · 24h change · 24h volume · open interest) as one strip of figures; the order-book-style ladder for our price-impact ladder.
**Avoid:** it is built for professionals; a fan should never land here first.
**Premium / cheap:** premium for its audience; overwhelming for ours.

### Jupiter: `jupiter-*`
**What:** Solana swap aggregator and super-app.
**Visual language:** Inter, near-black blue-green ground, lime "Connect" button, sell/buy stacked boxes with a swap arrow, a left nav of 20+ items.
**Borrow:** *trade panel*: the "Sell / Buy" stacked boxes with token chips; "Use V1 transactions" style quiet toggles for advanced settings.
**Avoid:** lime-on-near-black is now Jupiter's (and every crypto app's) look; pack-opening promos.
**Premium / cheap:** competent; generic crypto.

### pump.fun (not captured, Cloudflare)
**What:** token launchpad on Solana; every coin starts on a bonding curve and "graduates" to an AMM pool.
**Known patterns:** coin cards with a bonding-curve progress bar and market cap; a "king of the hill" slot for the coin closest to graduating; a live trade feed.
**Borrow:** *markets / launches*: progress to bonding as the main fact on a launch card, and a live feed of buys as proof of activity.
**Avoid:** meme-coin chaos, auto-playing videos, neon on black.

### Meteora: `meteora-*`
**What:** Solana liquidity pools and launch pools.
**Visual language:** Inter on #0d0d13, orange-red accent, table of pools with sparkline, TVL and fees; a terms modal on entry.
**Borrow:** *Pool depth / liquidity tab*: TVL, 24h volume and fees per pool as three right-aligned columns.
**Avoid:** the entry modal, orange-on-black.

---

## Consumer finance

### Robinhood: `robinhood-*` (home, NVDA stock page)
**What:** consumer brokerage.
**Visual language:** "Capsule Sans" (Display for figures, Text for UI), white, the price as the page title (NVIDIA / $203.75 / −$0.89 (−0.43%) Today), one line chart in the direction colour with no axes, range chips (1D 1W 1M 3M YTD 1Y 5Y ALL), a right-rail order ticket in a bordered card, and a key-statistics grid of label/value pairs. Marketing pages use cinematic photography with a chartreuse button.
**Borrow:**
- *Player hub:* price as the title, change line under it, the chart with no grid, range chips under the chart, a "Key statistics" two-column grid.
- *Trade panel:* the order ticket always in the right rail on desktop, docked to the bottom on mobile.
- *Motion (widely documented, not captured):* while you scrub the chart, the headline price follows the finger.
**Avoid:** orange "Sign up to buy" button colour (theirs), the long SEO text block.
**Premium / cheap:** premium: one typeface family with real figures, almost no colour.

### Coinbase: `coinbase-price-mobile*`
**What:** exchange and wallet; the price page.
**Visual language:** blue primary pill, the price huge (₹9,293.06) with a green change line, range tabs, chart in the direction colour, tabs (About · Info · Insights · FAQ).
**Borrow:** *Player hub on mobile*: price first, primary button directly under it ("Buy Solana"), then the chart.
**Avoid:** cookie banner over the chart (theirs).

### Phantom: `phantom-*`
**What:** Solana wallet, now "your home for trading crypto, predictions, and more".
**Visual language:** custom "Phantom" face at 80px, lilac ground and lilac pill buttons, a dark hero panel with floating candles, soft rounded everything.
**Borrow:** *landing*: one huge sentence and one button; friendly radius and type for a non-trader audience.
**Avoid:** lilac/violet (now Phantom's, and an AI cliché), decorative floating candles.

---

## Synthesis: ideas that should shape score's directions

1. **One number leads each screen.** Robinhood titles the page with the price; FotMob centres the score; Sport.fun's "1027.375 pts". Player hub: the price. Matchday: your provisional earnings (or, signed out, the round pool). Portfolio: your total. Everything else is smaller.
2. **The trade ticket never moves.** Right rail on desktop, docked bottom sheet on phones, same shape for curve and pool (Polymarket, Robinhood, Jupiter): Buy/Sell, a big amount, preset chips, one primary button, fees and tax visible before the button.
3. **Live is a minute, not a glow.** FotMob's green minute, Polymarket's "LIVE · 1H 12'", Sofascore's "Live (90)". One small mark plus a running clock is enough; the event feed carries the energy.
4. **Boards should read like league tables.** Rank, name, points, payout, with the paying top five marked by an edge (FotMob's qualification bar) and "you hold this" as the only highlight.
5. **Typographic identity can carry a player.** FotMob's player header (name, club, then an attribute grid), Sorare's card frame, FPL's shirt tiles. With photos, crests and logos banned, the name, ticker, position colour, shirt number and form rating have to be the picture.
6. **Momentum, not just totals.** FotMob's momentum bars and Sport.fun's market-call chart turn a round into a story. A per-minute points chart for your players makes the matchday feel live without decoration.
7. **Show the money's source every time money is promised.** Football Index failed on this; Sport.fun prints "Expected value, not guaranteed". score shows vault → round pool (% of vault, capped) → board share → your share, wherever a payout appears.
8. **A light ground with colour on the objects reads premium and friendly.** Robinhood, Polymarket, FotMob and Kalshi all put a white or #fafafa ground under one strong typeface, with colour only on buttons, chips and data. This matches the stated preference for light backgrounds.
9. **Sign-in belongs inside the first action.** Sorare's in-hero manager name and Kalshi's one-sheet "Continue with Google / Apple / email" beat a modal on page load.
10. **Avoid the crypto default.** Lime or mint on near-black (Jupiter, Hyperliquid, Sport.fun, Meteora) is now the generic look of on-chain apps. The fourth, dark direction must earn its place against that; the light directions start from football media and consumer finance instead.

## Step 1B: .fun homepages (3 Nov 2026)

Fetched as raw HTML on 3 Nov (no browser captures this round). pump.fun (403, Cloudflare), Believe (402) and letsbonk.fun (client-rendered shell, title only) gave nothing usable; their notes below are from the Step 1.1 round and are marked so.

### Sport.fun (formerly Football.fun)
- One line of meta copy carries the product: "Own football players, make five-player Picks and compete for real rewards."
- The homepage is the market, not a brochure: a "Market Call" head-to-head (Olise vs Yamal, prices to four decimals, manager votes, a closing time in UTC), then "Transfer Market · Prices & 24H", "Biggest movers · 24H", "Biggest pack pulls", "Top performers" and "Top managers by division".
- The action is written as the first thing you do: "Build your first squad for free", repeated at the close as "Ready to build your squad?".
- Honest small print sits in the page, not hidden: "Figures can be up to a minute behind", restricted jurisdictions, no league or club affiliation.
- Weak spot: a promotion banner in tracked capitals across the top, and the page is long and modular, so the first screen does not say what it is.

### Zora
- Title: "Post, discover, and trade what's next". Three verbs, the last one is money. The page itself renders client-side.

### fomo
- "where traders become legends." Lower-case, one sentence, then "From memecoins to viral tokens, trade any crypto in seconds." Two actions: "Start trading" and "Download app".
- Features as one short line each (leaderboard, feed, alerts, easy onboarding, gasless, "fund with apple pay"), then one social figure ("join 2,500,000 traders") and the line repeated as the close.
- The marketing page and the app are separate: the page has a Login and a Start trading button and no live data.

### designeer.xyz
- A catalogue that is its own proof: the page is the product (filters by Interface, Motion, 3D, Typography, Dashboard, colour), with one sentence of what it is. No hero image, no features, no claims; the work shown is the argument.
- Small wordmark with the TLD set apart (designeer | .xyz), a plain nav of nouns (Finds, Inspiration, Resources, Tools, Portfolios), sponsor slots that say what they are.

### pump.fun, letsbonk, Believe (from Step 1.1 notes)
- The homepage is the live board: newest launches and those closest to bonding, each with a progress bar and market cap, and one button to start a coin. Liveness comes from the list moving, not from decoration.

### Patterns score's homepage takes
1. The first screen shows the live product: a real launch with its curve progress to $25k and the matchday's real figures, not a picture of them.
2. The headline is one short sentence of what you do and get; one supporting sentence says it plainly (football players, tokens, USDC at matchdays).
3. The primary action is the first thing you do: "Buy player shares". The second is where ICOs happen: "Explore launches".
4. The marketing page and the app are separate (fomo, Zora): own header with "Open the app", no app tab bar.
5. Real movement only: prices, launch progress and the kickoff countdown tick from the mock protocol; no decorative motion.
6. A head-to-head or a ranked list is a stronger picture than any illustration (Sport.fun's Market Call, pump.fun's board).
7. The honest print stays visible: devnet, test USDC, payouts depend on board finishes.
8. The close repeats the action, short (fomo, Sport.fun).

### What it must avoid
- Promotion banners and tracked capitals (Sport.fun's top strip).
- A long modular stack of every board; three screens at most.
- Social-proof numbers we don't have (fomo's 2.5M): only real mock figures.
- Gradients, glows, pill eyebrows, icon cards, emoji, the "trade any crypto in seconds" register.
