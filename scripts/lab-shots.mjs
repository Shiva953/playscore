/**
 * Step 1.5: screenshot the four directions on the same pinned moment, desktop (1440) and mobile (375),
 * and run axe (WCAG 2 AA, serious/critical) on each screen.
 *
 *   BASE_URL=http://localhost:3123 node scripts/lab-shots.mjs [a-broadcast b-fintech …] [--moment live|open|fulltime]
 *
 * Writes docs/screenshots/lab/<direction>/<screen>-<desktop|mobile>.jpg.
 * Direction D is the production routes (/player/kane, /matchday, /).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = new URL("../docs/screenshots/lab/", import.meta.url).pathname;
const args = process.argv.slice(2);
const mi = args.indexOf("--moment");
const MOMENT = mi >= 0 ? args[mi + 1] : "live";
const ONLY = args.filter((a, i) => !a.startsWith("--") && (mi < 0 || i !== mi + 1));
const DIRS = ["c-collectible", "d-terminal"].filter((d) => !ONLY.length || ONLY.includes(d));
const SCREENS = ["player", "matchday", "landing"];
const MOMENT_LABEL = { live: "Mid-match", open: "Before kickoff", fulltime: "Full time" }[MOMENT];

const url = (d, s) =>
  d === "d-terminal" ? (s === "player" ? "/player/kane" : s === "matchday" ? "/matchday" : "/") : `/lab/${d}/${s}${s === "player" ? "?player=kane" : ""}`;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
};

const browser = await launch();
const a11y = [];
const errors = [];

for (const [vp, opts] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ ...opts, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${vp}: ${String(e).slice(0, 200)}`));
  // Pin the moment once per context (state persists in localStorage across navigations).
  await page.goto(`${BASE}/lab`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: MOMENT_LABEL, exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^Pinned`) }).waitFor({ timeout: 20_000 });

  for (const d of DIRS) {
    await mkdir(`${OUT}${d}`, { recursive: true });
    for (const s of SCREENS) {
      await page.goto(`${BASE}${url(d, s)}`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: "[data-lab-bar]{display:none!important} nextjs-portal{display:none!important}" });
      await page.waitForTimeout(1200);
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += 600) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(60);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      const file = `${OUT}${d}/${s}-${vp}.jpg`;
      await page.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 82 });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      for (const v of axe.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
        a11y.push(`${vp} ${d}/${s}: [${v.id}] ${v.help} (${v.nodes.length}×) e.g. ${v.nodes[0]?.target?.join(" ")}`);
      }
      console.log("•", d, s, vp);
    }
  }
  await ctx.close();
}
await browser.close();
console.log("\nAccessibility (axe, serious/critical):", a11y.length ? "\n" + a11y.join("\n") : "none");
console.log("Page errors:", errors.length ? "\n" + errors.join("\n") : "none");
