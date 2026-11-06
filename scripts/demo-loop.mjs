#!/usr/bin/env node
/**
 * Step 0 verification: drives the full demo loop in a real browser and saves screenshots.
 *
 *   bun run dev            # in another terminal (or set BASE_URL)
 *   bun run demo:loop
 *
 * Loop: restricted-country block → sign in → faucet → launch buy → simulated demand → bonding buy
 * (bonded modal) → sell with hold-age tax → buy a bonded player → kickoff snapshot → live board →
 * full time → claim tokens → next round → claim USDC → portfolio. Step 1B adds: the trade terminal (↑/↓
 * switching with the URL following, a resting limit order, cancel), the Launch page and a demo account.
 * Then every route at 375px and 1280px.
 *
 * Uses Playwright's Chromium if installed, otherwise the local Google Chrome.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = new URL(`../docs/screenshots/${process.env.SHOTS ?? "step-1"}/`, import.meta.url).pathname;
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 812 };

const log = (...a) => console.log("•", ...a);
const errors = [];
const a11y = [];

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ channel: "chrome" });
  }
}

function watch(page) {
  page.on("pageerror", (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|script tag while rendering/.test(m.text())) errors.push(`console ${page.url()}: ${m.text()}`);
  });
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  // Full-page captures paint fixed elements at the first viewport's bottom; put the mobile tab bar in flow instead.
  await page.addStyleTag({ content: "nav.fixed{position:static!important}" });
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  log("screenshot", name);
}

/** Wait for a toast (not any page text) matching `re`. */
async function toast(page, re) {
  await page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor();
}

async function openDemoPanel(page) {
  const demoBtn = page.getByRole("button", { name: "Demo", exact: true });
  if (await demoBtn.isVisible().catch(() => false)) {
    await demoBtn.click();
  } else {
    await page.getByRole("button", { name: "Your wallet" }).click();
    await page.getByRole("menuitem", { name: /^Demo settings/ }).click();
  }
  await page.getByRole("heading", { name: "Demo settings" }).waitFor();
}

async function closeSheet(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

/** "Skip to next phase" closes the demo panel itself, so a full-time modal stays visible. */
async function skipPhase(page, times = 1) {
  for (let i = 0; i < times; i++) {
    await openDemoPanel(page);
    await page.getByRole("button", { name: "Skip to next phase" }).click();
    await page.getByRole("heading", { name: "Demo settings" }).waitFor({ state: "hidden" });
    await page.waitForTimeout(700);
  }
}

/** Claim via the full-time modal if it's open, else via the claim card on the page. Returns true if claimed. */
async function claim(page, mode, shotName) {
  const modal = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /Full time · round/ }) });
  const button = mode === "tokens" ? "claim-tokens" : "claim-usdc";
  if (await modal.isVisible({ timeout: 4000 }).catch(() => false)) {
    if (shotName) await shot(page, shotName);
    await modal.getByTestId(button).click();
  } else if (await page.getByTestId(button).first().isVisible().catch(() => false)) {
    await page.getByTestId(button).first().click();
  } else {
    return false;
  }
  await toast(page, mode === "tokens" ? /Claimed .* tokens/ : /Claimed .* USDC/);
  return true;
}

async function pickSelect(page, trigger, option) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  watch(page);

  // Fresh demo
  await page.goto(`${BASE}/launch`);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Live launches" }).waitFor();
  await shot(page, "launch-signed-out-desktop");

  // Restricted country is blocked
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await pickSelect(page, page.locator("#country"), "United Kingdom");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("heading", { name: "Not available in United Kingdom" }).waitFor();
  await shot(page, "signin-restricted-desktop");
  log("restricted country blocked");
  await page.getByRole("button", { name: "Back" }).click();

  // Sign in from Germany
  await pickSelect(page, page.locator("#country"), "Germany");
  await page.locator("#terms").click();
  await shot(page, "signin-desktop");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await toast(page, /Signed in on devnet/);
  log("signed in");

  // Faucet
  await page.getByRole("button", { name: "Your wallet" }).click();
  await page.getByRole("menuitem", { name: "Top up" }).click();
  await toast(page, /Topped up \$1,000\.00 test USDC/);
  log("faucet +1,000");

  // Launch buy on a curve
  await page.goto(`${BASE}/player/haaland`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Launch curve" }).waitFor();
  await page.locator("#amt-haaland").fill("400");
  await page.getByTestId("trade-submit").click();
  await toast(page, /Bought .* HAALAND/);
  await shot(page, "player-launching-desktop");
  log("bought on the launch curve");

  // Simulated fan demand to ~96%, then our buy bonds it
  await openDemoPanel(page);
  await pickSelect(page, page.getByRole("combobox", { name: "Launching player" }), /Erling Haaland/);
  await page.getByRole("button", { name: "Fill to 96%" }).click();
  await closeSheet(page);
  await page.waitForTimeout(800);
  await page.locator("#amt-haaland").fill("2000");
  await page.getByRole("button", { name: "Buy and bond $HAALAND" }).waitFor();
  await page.getByTestId("trade-submit").click();
  await page.getByRole("heading", { name: "$HAALAND bonded" }).waitFor();
  await shot(page, "bonded-modal-desktop");
  log("bonded");
  await page.getByRole("link", { name: "Trade Erling Haaland" }).click();
  await page.getByText("Price", { exact: true }).first().waitFor();

  // Sell with the day-0 tax shown
  await page.getByRole("tab", { name: "Sell" }).click();
  await page.getByRole("button", { name: "25%" }).click();
  await page.getByText(/Sell tax \(0-day hold\)/).waitFor();
  await shot(page, "player-trading-sell-desktop");
  await page.getByTestId("trade-submit").click();
  await toast(page, /Sold .* HAALAND/);
  log("sold with 5% sell tax");

  // Buy a seeded bonded player before kickoff
  await page.goto(`${BASE}/player/kane`, { waitUntil: "networkidle" });
  await page.locator("#amt-kane").fill("300");
  await page.getByTestId("trade-submit").click();
  await toast(page, /Bought .* KANE/);
  log("bought KANE in the pool");

  // Pro view
  await page.getByLabel("Pro view").click();
  await page.getByText("Watchlist").waitFor();
  await page.getByRole("button", { name: "RSI 14" }).click();
  await shot(page, "player-pro-desktop");
  await page.getByLabel("Pro view").click();

  // Matchday: kickoff → live
  await page.goto(`${BASE}/matchday`, { waitUntil: "networkidle" });
  await shot(page, "matchday-open-desktop");
  await skipPhase(page);
  await toast(page, /Kickoff: dividend snapshot taken/);
  log("kickoff snapshot");
  await page.waitForTimeout(12_000);
  await page.getByTestId("event-feed").waitFor();
  await shot(page, "matchday-live-desktop");
  log("live board");

  // Full time → freeze → settle → claim tokens
  await skipPhase(page); // live → ended (freezing)
  await shot(page, "matchday-fulltime-desktop");
  await skipPhase(page); // ended → settle → next round open
  if (await claim(page, "tokens", "fulltime-claim-modal-desktop")) log("claimed round 1 dividends as tokens (+10%)");
  else log("no dividends in round 1 (held players didn't place)");
  await page.getByTestId("results").waitFor();
  await shot(page, "matchday-results-desktop");

  // Next round → claim USDC
  await skipPhase(page); // open → live
  await page.waitForTimeout(8_000);
  await skipPhase(page, 2); // live → ended → settled
  if (await claim(page, "usdc")) log("claimed round 2 dividends in USDC");
  else log("no dividends in round 2");

  // Liquidity on a bonded player
  await page.goto(`${BASE}/player/kane`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Liquidity" }).click();
  await page.getByRole("tab", { name: "USDC only" }).click();
  await page.locator("#lp-kane").fill("100");
  await page.getByRole("button", { name: "Add liquidity" }).click();
  await toast(page, /Added liquidity to KANE/);
  await shot(page, "player-liquidity-desktop");
  log("added liquidity (zap)");

  // Trade terminal: ↑/↓ switch players and the URL follows; a limit buy rests on the pool, then cancel.
  await page.goto(`${BASE}/trade/kane`, { waitUntil: "networkidle" });
  await page.getByTestId("price-chart").waitFor();
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ArrowDown");
  await page.waitForURL((u) => !u.pathname.endsWith("/trade/kane"));
  await page.keyboard.press("ArrowUp");
  await page.waitForURL(/\/trade\/kane$/);
  log("terminal ↑/↓ switching");
  await page.getByRole("radio", { name: "Limit" }).click();
  // Half the pool price, so the order rests instead of filling at once.
  const px = await page.locator("#lim-px-kane").inputValue();
  await page.locator("#lim-px-kane").fill((Number(px) * 0.5).toFixed(5));
  await page.locator("#lim-amt-kane").fill("50");
  await page.getByTestId("limit-submit").click();
  await toast(page, /Limit buy placed/);
  await page.getByRole("tab", { name: /Open orders/ }).click();
  await shot(page, "trade-terminal-desktop");
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await toast(page, /cancelled/);
  log("limit order placed and cancelled");

  // Portfolio reflects everything
  await page.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await page.getByTestId("portfolio-summary").waitFor();
  await shot(page, "portfolio-desktop");
  log("portfolio");

  // Every route at desktop and mobile, signed in
  const storage = await ctx.storageState();
  const routes = [
    ["landing", "/"],
    ["launch", "/launch"],
    ["trade", "/trade/kane"],
    ["trade-launching", "/trade/olise"],
    ["player-trading", "/player/kane"],
    ["player-launching", "/player/olise"],
    ["player-scheduled", "/player/quinones"],
    ["matchday", "/matchday"],
    ["portfolio", "/portfolio"],
    ["docs-stats", "/docs/stats"],
    ["docs-scoring", "/docs/scoring"],
    ["docs-boards", "/docs/boards"],
    ["docs-fees", "/docs/fees"],
    ["terms", "/terms"],
  ];
  for (const [label, viewport] of [
    ["desktop", DESKTOP],
    ["mobile", MOBILE],
  ]) {
    const c = await browser.newContext({ viewport, storageState: storage, isMobile: label === "mobile", hasTouch: label === "mobile" });
    const p = await c.newPage();
    watch(p);
    for (const [name, path] of routes) {
      await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await p.waitForTimeout(1200);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) errors.push(`horizontal overflow ${overflow}px on ${path} (${label})`);
      // Scroll once so scroll-triggered reveals run before the full-page capture.
      const h = await p.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += 600) {
        await p.evaluate((yy) => window.scrollTo(0, yy), y);
        await p.waitForTimeout(40);
      }
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(500);
      // Let entrance fades finish so contrast is measured at rest, not mid-animation.
      // Only document-timeline animations can finish (scroll-driven ones never do); cap the wait at 1.5s.
      await p.evaluate(() =>
        Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity)
              .map((a) => a.finished.catch(() => {}))
          ),
          new Promise((r) => setTimeout(r, 1500)),
        ])
      );
      // WCAG 2 A/AA with axe-core (incl. colour contrast).
      const axe = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      for (const v of axe.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
        a11y.push(`${label} ${path}: [${v.id}] ${v.help} (${v.nodes.length}×) e.g. ${v.nodes[0]?.target?.join(" ")}`);
      }
      await shot(p, `${name}-${label}`);
    }
    await c.close();
  }

  // Signed-out and error states
  const c2 = await browser.newContext({ viewport: MOBILE, isMobile: true });
  const p2 = await c2.newPage();
  watch(p2);
  await p2.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await shot(p2, "portfolio-signed-out-mobile");
  // /markets folded into Trade
  await p2.goto(`${BASE}/markets`, { waitUntil: "networkidle" });
  if (!new URL(p2.url()).pathname.startsWith("/trade")) errors.push(`/markets did not redirect to /trade (${p2.url()})`);
  // One-step demo account from the signed-out portfolio
  await p2.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await p2.getByRole("button", { name: "Try a demo account" }).first().click();
  await p2.getByTestId("portfolio-summary").waitFor();
  await shot(p2, "portfolio-demo-mobile");
  log("demo account");
  await c2.close();

  await browser.close();
  console.log("\nAccessibility (axe, serious/critical):", a11y.length ? `\n${[...new Set(a11y)].join("\n")}` : "none");
  console.log("\nErrors:", errors.length ? `\n${[...new Set(errors)].join("\n")}` : "none");
  if (errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
