/**
 * Step 1.1: screenshot reference products at desktop (1440) and mobile (390) width.
 * Internal reference only (docs/inspiration/). Read-only browsing; nothing is submitted.
 * football.fun redirects to sport.fun; playr.gg is a defunct gaming site (acquired 2020), so both are left out.
 *
 *   node scripts/inspiration-shots.mjs [slug ...]
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const OUT = new URL("../docs/inspiration/", import.meta.url).pathname;

const TARGETS = [
  // Direct comps
  ["sportfun", "https://sport.fun"],
  ["sportfun-app", "https://pro.sport.fun/football"],
  ["sorare", "https://sorare.com/football"],
  ["fpl", "https://fantasy.premierleague.com"],
  ["footballindex", "https://web.archive.org/web/20200815000000/https://www.footballindex.co.uk/"],
  // Football data & live
  ["fotmob", "https://www.fotmob.com"],
  ["fotmob-league", "https://www.fotmob.com/leagues/47/overview/premier-league"],
  ["fotmob-match", "https://www.fotmob.com/matches/everton-vs-newcastle-united/2yo9qd#5795503"],
  ["fotmob-player", "https://www.fotmob.com/players/737066/erling-haaland"],
  ["sofascore", "https://www.sofascore.com/football"],
  ["onefootball", "https://onefootball.com/en/home"],
  // Markets & trading
  ["polymarket", "https://polymarket.com"],
  ["polymarket-sports", "https://polymarket.com/sports/live"],
  ["kalshi", "https://kalshi.com"],
  ["hyperliquid", "https://app.hyperliquid.xyz/trade"],
  ["jupiter", "https://jup.ag"],
  ["pumpfun", "https://pump.fun"], // Cloudflare-blocked for headless browsers (Nov 2026)
  ["meteora", "https://app.meteora.ag"],
  // Consumer finance
  ["robinhood", "https://robinhood.com/us/en/"],
  ["robinhood-stock", "https://robinhood.com/us/en/stocks/NVDA/"],
  ["coinbase-price", "https://www.coinbase.com/price/solana"],
  ["phantom", "https://phantom.com"],
];

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
};

const CONSENT = /^(accept( all)?( cookies)?|allow all|i agree|agree|got it|ok|okay|continue|close)$/i;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

const only = process.argv.slice(2);
await mkdir(OUT, { recursive: true });
const browser = await launch();
const report = [];

for (const [slug, url] of TARGETS) {
  if (only.length && !only.includes(slug)) continue;
  for (const [vp, opts] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ ...opts, locale: "en-GB", colorScheme: "light" });
    const page = await ctx.newPage();
    let status = "ok";
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      status = String(res?.status() ?? "?");
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      // Dismiss consent banners so the product is visible (never sign in or submit anything).
      for (const b of await page.getByRole("button").all()) {
        const t = ((await b.textContent().catch(() => "")) ?? "").trim();
        if (CONSENT.test(t) && (await b.isVisible().catch(() => false))) {
          await b.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(400);
          break;
        }
      }
      await page.screenshot({ path: `${OUT}${slug}-${vp}.jpg`, type: "jpeg", quality: 72 });
      // A taller capture (up to three screens) for page structure.
      const h = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
      const vh = opts.viewport.height;
      if (h > vh * 1.3) {
        for (let y = 0; y < Math.min(h, vh * 3); y += vh / 2) {
          await page.evaluate((yy) => window.scrollTo(0, yy), y);
          await page.waitForTimeout(150);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        await page
          .screenshot({ path: `${OUT}${slug}-${vp}-long.jpg`, type: "jpeg", quality: 72, fullPage: true, clip: { x: 0, y: 0, width: opts.viewport.width, height: Math.min(h, vh * 3) } })
          .catch(() => {});
      }
      status += ` · ${(await page.title().catch(() => "")).slice(0, 60)}`;
    } catch (e) {
      status = `failed: ${String(e).split("\n")[0].slice(0, 120)}`;
    }
    report.push(`${slug} ${vp}: ${status}`);
    console.log("•", slug, vp, status);
    await ctx.close();
  }
}
await browser.close();
console.log("\n" + report.join("\n"));
