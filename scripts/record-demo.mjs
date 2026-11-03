/**
 * Record review videos of the two deployed directions (Playwright video → MP4 via ffmpeg).
 *
 *   D_URL=https://score-night-terminal.vercel.app C_URL=https://score-collectible.vercel.app \
 *     node scripts/record-demo.mjs [d] [c]
 *
 * Writes docs/demo/score-d-night-terminal.mp4 and docs/demo/score-c-collectible.mp4.
 * A visible cursor is drawn into the page (Playwright's video has none) and moves are eased.
 */
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const D_URL = process.env.D_URL ?? "https://score-night-terminal.vercel.app";
const C_URL = process.env.C_URL ?? "https://score-collectible.vercel.app";
const OUT = new URL("../docs/demo/", import.meta.url).pathname;
const SIZE = { width: 1440, height: 900 };
const only = process.argv.slice(2);

/** A cursor dot that survives navigations (position kept in sessionStorage). */
const CURSOR = () => {
  const draw = () => {
    let c = document.getElementById("__cursor");
    if (!c) {
      c = document.createElement("div");
      c.id = "__cursor";
      c.style.cssText =
        "position:fixed;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.95);border:2px solid #111;box-shadow:0 0 0 3px rgba(255,255,255,.35);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:transform 90ms ease-out";
      document.documentElement.appendChild(c);
    }
    const [x, y] = (sessionStorage.getItem("__cursor") ?? "720,450").split(",");
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    return c;
  };
  addEventListener("DOMContentLoaded", draw);
  addEventListener(
    "mousemove",
    (e) => {
      sessionStorage.setItem("__cursor", `${e.clientX},${e.clientY}`);
      const c = draw();
      c.style.left = `${e.clientX}px`;
      c.style.top = `${e.clientY}px`;
    },
    true
  );
  addEventListener("mousedown", () => (draw().style.transform = "translate(-50%,-50%) scale(.7)"), true);
  addEventListener("mouseup", () => (draw().style.transform = "translate(-50%,-50%)"), true);
};

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ channel: "chrome" });
  }
}

function helpers(page) {
  const pause = (ms) => page.waitForTimeout(ms);
  const moveTo = async (locator, steps = 22) => {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    if (!b) return null;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y, { steps });
    return { x, y };
  };
  const click = async (locator) => {
    const p = await moveTo(locator);
    await pause(180);
    if (p) await page.mouse.click(p.x, p.y);
    else await locator.click();
  };
  const type = async (locator, text) => {
    await click(locator);
    await page.keyboard.type(text, { delay: 140 });
  };
  const scroll = async (dy, steps = 8) => {
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, dy / steps);
      await pause(60);
    }
  };
  const toast = (re) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor({ timeout: 20_000 });
  return { pause, moveTo, click, type, scroll, toast };
}

async function record(name, url, flow) {
  const browser = await launch();
  const tmp = `${OUT}.tmp-${name}`;
  await mkdir(tmp, { recursive: true });
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: tmp, size: SIZE } });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  // Start from a fresh demo world.
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  try {
    await flow(page, helpers(page), url);
  } finally {
    await ctx.close();
    await browser.close();
  }
  const [webm] = (await readdir(tmp)).filter((f) => f.endsWith(".webm"));
  const mp4 = `${OUT}${name}.mp4`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${tmp}/${webm}`, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  await rename(`${tmp}/${webm}`, `${OUT}${name}.webm`);
  await rm(tmp, { recursive: true, force: true });
  console.log("•", mp4);
}

// ---------------------------------------------------------------- D · Night terminal (the full product)

async function flowD(page, h, base) {
  await h.pause(2500);
  await h.scroll(700);
  await h.pause(1800);
  await h.scroll(-700);
  await h.pause(600);
  await h.click(page.getByRole("link", { name: "Open the markets" }).first());
  await page.waitForURL(/\/markets/);
  await h.pause(2200);
  await h.scroll(500);
  await h.pause(1500);
  await h.scroll(-500);

  // Sign in (Google, Germany)
  await h.click(page.getByRole("button", { name: "Sign in" }).first());
  await h.pause(700);
  await h.click(page.locator("#country"));
  await h.click(page.getByRole("option", { name: "Germany", exact: true }));
  await h.click(page.locator("#terms"));
  await h.pause(500);
  await h.click(page.getByRole("button", { name: "Continue with Google" }));
  await h.toast(/Signed in on devnet/);
  await h.pause(1800);

  // Buy KANE
  await page.goto(`${base}/player/kane`, { waitUntil: "networkidle" });
  await h.pause(2200);
  await h.moveTo(page.locator("canvas").first(), 30);
  await h.pause(1200);
  await h.type(page.locator("#amt-kane"), "50");
  await h.pause(1400);
  await h.click(page.getByTestId("trade-submit"));
  await h.toast(/Bought/);
  await h.pause(1800);

  // The wallet menu
  await h.click(page.getByRole("button", { name: "Your wallet" }));
  await h.pause(2200);
  await page.keyboard.press("Escape");
  await h.pause(500);

  // Matchday: kickoff, live, full time and the claim
  await h.click(page.getByRole("link", { name: "Matchday", exact: true }).first());
  await page.waitForURL(/\/matchday/);
  await h.pause(2200);
  const skip = async () => {
    await h.click(page.getByRole("button", { name: "Your wallet" }));
    await h.click(page.getByRole("menuitem", { name: /^Demo settings/ }));
    await page.getByRole("heading", { name: "Demo settings" }).waitFor();
    await h.pause(600);
    await h.click(page.getByRole("button", { name: "Skip to next phase" }));
    await page.getByRole("heading", { name: "Demo settings" }).waitFor({ state: "hidden" });
  };
  await skip(); // kickoff: snapshot, live
  await h.pause(9000);
  await h.scroll(600);
  await h.pause(2500);
  await h.scroll(-600);
  await skip(); // full time
  await h.pause(2000);
  await skip(); // freeze over: settled, the full-time card
  // Prefer the full-time dialog's button; the page's own claim card sits underneath it.
  const dialog = page.getByRole("dialog");
  const inDialog = await dialog.getByTestId("claim-usdc").waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
  const usdc = inDialog ? dialog.getByTestId("claim-usdc") : page.getByTestId("claim-usdc").first();
  // isVisible() doesn't wait; the full-time card appears a moment after settlement.
  if (await usdc.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) {
    await h.pause(2200);
    await h.click(usdc);
    await h.toast(/Claimed/);
    await h.pause(1800);
  }

  // Portfolio
  await page.goto(`${base}/portfolio`, { waitUntil: "networkidle" });
  await h.pause(2500);
  await h.scroll(700, 12);
  await h.pause(2200);
  await h.scroll(700, 12);
  await h.pause(2200);
  await h.scroll(-1400, 12);
  await h.pause(1500);
}

// ---------------------------------------------------------------- C · Collectible (the three explored screens)

async function flowC(page, h) {
  await h.pause(2500);
  // Hover through the hand of cards
  const cards = page.locator(".c-fan > a");
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    await h.moveTo(cards.nth(i), 14);
    await h.pause(450);
  }
  await h.pause(600);

  // Set the shared moment: mid-match with three players held
  await h.click(page.getByRole("button", { name: "Mid-match", exact: true }));
  await page.getByRole("button", { name: /^Pinned/ }).waitFor({ timeout: 30_000 });
  await h.pause(800);

  // Player
  await h.click(page.getByRole("link", { name: "Players", exact: true }).first());
  await page.waitForURL(/player/);
  await h.pause(2000);
  const card = page.getByRole("button", { name: /Turn the card over/ });
  await h.moveTo(card, 18);
  for (const [dx, dy] of [[-60, -80], [70, -40], [40, 90], [-50, 60], [0, 0]]) {
    const b = await card.boundingBox();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 12 });
    await h.pause(220);
  }
  await h.click(card);
  await h.pause(2400);
  await h.click(page.getByRole("button", { name: /Show the front/ }));
  await h.pause(1200);
  // Read the chart
  const chart = page.locator('section[aria-label="Market"] svg').first();
  const cb = await chart.boundingBox();
  await page.mouse.move(cb.x + 10, cb.y + cb.height / 2, { steps: 16 });
  await page.mouse.move(cb.x + cb.width - 10, cb.y + cb.height / 2, { steps: 50 });
  await h.pause(900);
  // Buy
  await h.type(page.locator('input[id^="c-amt-"]').first(), "10");
  await h.pause(1200);
  await h.click(page.getByRole("button", { name: /^Buy \$/ }));
  await h.toast(/Bought/);
  await h.pause(1600);

  // Matchday: the hand, the prize, the boards
  await h.click(page.getByRole("link", { name: "Matchday", exact: true }).first());
  await page.waitForURL(/matchday/);
  await h.pause(2600);
  await h.scroll(500);
  await h.pause(2400);
  await h.scroll(-500);
  await h.pause(1000);
  await h.click(page.getByRole("link", { name: "How it works", exact: true }).first());
  await h.pause(2200);
}

await mkdir(OUT, { recursive: true });
if (!only.length || only.includes("d")) await record("score-d-night-terminal", D_URL, flowD);
if (!only.length || only.includes("c")) await record("score-c-collectible", C_URL, flowC);
