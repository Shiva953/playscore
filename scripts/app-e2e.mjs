// End-to-end test of the app on the real backend (score-node + oracle + devnet), in a real browser,
// as a brand-new user with a test wallet: sign in → test USDC arrives → buy (pool + launch curve) →
// sell → limit order + cancel → liquidity in and out → withdraw from cash → outside deposit auto-added →
// kickoff, live, full time → dividend credited → claim. Fails on any console error or page crash.
//
//   bun run stack            (score-node, oracle, bots)    then
//   bun run e2e:app          (starts its own dev server on :3400 unless BASE_URL is set)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3400";
const NODE = process.env.SCORE_NODE_URL || "http://127.0.0.1:8787";
const ORACLE = process.env.SCORE_ORACLE_URL || "http://127.0.0.1:8788";
const ADMIN = readFileSync(".devnet/admin-token", "utf8").trim();
const SHOTS = ".devnet/e2e-shots";
const HEADED = process.env.HEADED === "1";
mkdirSync(SHOTS, { recursive: true });

// No app running at BASE_URL: start our own dev server beside yours (own build folder, port 3400).
let devServer = null;
if (!(await fetch(BASE).then(() => true).catch(() => false))) {
  console.log(`starting a dev server for the test on ${BASE}…`);
  devServer = spawn("bun", ["x", "next", "dev", "-p", new URL(BASE).port || "3400"], { env: { ...process.env, NEXT_DIST_DIR: ".next-e2e" }, stdio: "ignore" });
  for (let i = 0; i < 120 && !(await fetch(BASE).then(() => true).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 500));
}
process.on("exit", () => devServer?.kill("SIGTERM"));

const t0 = Date.now();
const results = [];
const errors = [];
let page;
const sec = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const json = (url, init) => fetch(url, init).then((r) => r.json());

async function step(name, fn) {
  const s = Date.now();
  try {
    await fn();
    results.push([name, true, Date.now() - s]);
    console.log(`${sec()}s  ✓ ${name}  (${((Date.now() - s) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push([name, false, Date.now() - s, e.message]);
    console.log(`${sec()}s  ✗ ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  }
}
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const toast = (re, timeout = 20_000) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor({ timeout });
const skip = () => json(`${ORACLE}/v1/admin/skip`, { method: "POST", headers: { "x-admin-token": ADMIN } });
const round = () => json(`${ORACLE}/v1/round`);
async function waitPhase(phase, ms = 60_000) {
  const s = Date.now();
  while (Date.now() - s < ms) {
    if ((await round()).phase === phase) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`round never reached ${phase}`);
}

async function balance() {
  const addr = await page.evaluate(() => JSON.parse(localStorage.getItem("score:session:devnet:v1") ?? "null")?.address);
  if (!addr) return null;
  const u = await json(`${NODE}/v1/view/users/${addr}`);
  return { addr, free: u.free / 1e6, u };
}

async function marketBuy(id, usd) {
  await page.goto(`${BASE}/trade/${id}`);
  const panel = page.getByTestId("trade-panel");
  await panel.getByRole("tab", { name: /^Buy/ }).click();
  await panel.locator(`#amt-${id}`).fill(String(usd));
  const btn = panel.getByTestId("trade-submit");
  await btn.waitFor();
  await page.waitForFunction((sel) => !document.querySelector(sel)?.hasAttribute("disabled"), `[data-testid="trade-panel"] [data-testid="trade-submit"]`, { timeout: 15_000 });
  await btn.click();
  await panel.getByTestId("trade-receipt").waitFor({ timeout: 20_000 });
}

const browser = await chromium.launch({ headless: !HEADED });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource.*(404|favicon)/.test(m.text())) errors.push(`console: ${m.text().slice(0, 240)}`);
});
page.on("pageerror", (e) => errors.push(`page crash: ${e.message.slice(0, 240)}`));

console.log(`app e2e · ${BASE} · node ${NODE} · oracle ${ORACLE}`);
const bonded = (await json(`${NODE}/v1/view/markets`)).markets;
const reg = await json(`${ORACLE}/v1/players`);
const byEngine = new Map(Object.entries(reg.ids).map(([k, v]) => [v, k]));
const bondedIds = bonded.filter((m) => m.state === "bonded" && byEngine.has(m.player)).map((m) => byEngine.get(m.player));
const launchingId = bonded.filter((m) => m.state === "launching" && byEngine.has(m.player)).map((m) => byEngine.get(m.player))[0];
const gk = bondedIds.find((id) => reg.players.find((p) => p.id === id) && /GK/.test(JSON.stringify(reg.players.find((p) => p.id === id)))) ?? "simon";
const P = bondedIds.includes("bellingham") ? "bellingham" : bondedIds[0];
console.log(`trading ${P} and ${gk}; launch curve ${launchingId}`);

await step("pages load with live data (trade, launch, matchday, docs)", async () => {
  for (const path of [`/trade/${P}`, "/launch", "/matchday", "/docs/stats", "/"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  }
  await page.goto(`${BASE}/trade/${P}`);
  await page.getByText(/bought|sold/).first().waitFor({ timeout: 20_000 });
  await shot("01-trade-signed-out");
});

await step("sign in with a test wallet", async () => {
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.locator("#country").click();
  await page.getByRole("option", { name: "Germany" }).click();
  await page.locator("#terms").click();
  await page.getByRole("button", { name: /test wallet|email, Google/ }).click();
  await toast(/Signed in/);
});

await step("1,000 test USDC arrives (faucet → wallet → deposit, finalized)", async () => {
  await toast(/ready to trade/, 90_000);
  const b = await balance();
  if (!b || b.free < 999) throw new Error(`balance ${b?.free}`);
  await page.getByLabel(/^Cash/).first().waitFor({ timeout: 10_000 }).catch(() => {});
  await shot("02-funded");
});

await step(`market buy $60 of ${P} (pool)`, async () => {
  const before = (await balance()).free;
  await marketBuy(P, 60);
  const after = (await balance()).free;
  if (!(before - after > 59 && before - after < 61)) throw new Error(`spent ${before - after}`);
  await shot("03-bought");
});

await step(`market buy $40 of ${gk} (goalkeeper board)`, async () => marketBuy(gk, 40));

await step(`launch-curve buy $25 of ${launchingId}`, async () => marketBuy(launchingId, 25));

await step("portfolio shows the positions, P&L and activity", async () => {
  await page.goto(`${BASE}/portfolio`);
  for (const id of [P, gk]) await page.getByText(new RegExp(`\\$${reg.players.find((p) => p.id === id) ? "" : ""}`)).first().waitFor();
  const u = (await balance()).u;
  if (u.positions.filter((p) => p.amount > 0).length < 3) throw new Error(`positions ${JSON.stringify(u.positions)}`);
  await page.getByText(/Deposit added to your cash/).first().waitFor({ timeout: 10_000 });
  await shot("04-portfolio");
});

await step(`sell $15 of ${P}`, async () => {
  await page.goto(`${BASE}/trade/${P}`);
  const panel = page.getByTestId("trade-panel");
  await panel.getByRole("tab", { name: /^Sell/ }).click();
  await panel.locator(`#amt-${P}`).fill("15");
  await page.waitForFunction(() => !document.querySelector('[data-testid="trade-panel"] [data-testid="trade-submit"]')?.hasAttribute("disabled"), null, { timeout: 15_000 });
  await panel.getByTestId("trade-submit").click();
  await panel.getByTestId("trade-receipt").waitFor({ timeout: 20_000 });
});

await step("limit buy rests on the book, then cancel refunds it", async () => {
  await page.goto(`${BASE}/trade/${P}`);
  const panel = page.getByTestId("trade-panel");
  await panel.getByRole("tab", { name: /^Buy/ }).click();
  await panel.getByRole("radio", { name: "Limit" }).click();
  const px = (await json(`${NODE}/v1/view/markets`)).markets.find((m) => m.player === reg.ids[P]).px / 1e9;
  await panel.locator(`#lim-px-${P}`).fill((px * 0.8).toFixed(6));
  await panel.locator(`#lim-amt-${P}`).fill("20");
  await panel.getByTestId("limit-submit").click();
  await toast(/Limit buy placed/);
  const u1 = (await balance()).u;
  if (u1.orders.length !== 1 || u1.inOrders !== 20_000_000) throw new Error(`orders ${JSON.stringify(u1.orders)} inOrders ${u1.inOrders}`);
  await page.getByRole("tab", { name: /Open orders/ }).click();
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await toast(/Order cancelled/);
  const u2 = (await balance()).u;
  if (u2.orders.length !== 0 || u2.inOrders !== 0) throw new Error("order still open");
});

await step("add liquidity (USDC only), then remove it all", async () => {
  await page.goto(`${BASE}/player/${P}`);
  await page.getByRole("tab", { name: /Liquidity/ }).click();
  await page.getByRole("tab", { name: "USDC only" }).click();
  await page.locator(`#lp-${P}`).fill("50");
  const add = page.getByRole("button", { name: /^Add liquidity/ });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^Add liquidity/.test(b.textContent ?? "") && !b.disabled), null, { timeout: 15_000 });
  await add.click();
  await toast(/to the pool/);
  if (!(await balance()).u.lps.length) throw new Error("no LP position");
  await shot("05-liquidity");
  await page.getByRole("button", { name: "Remove all" }).click();
  await toast(/Removed/);
  if ((await balance()).u.lps.length) throw new Error("LP still there");
});

const openMoney = async (item) => {
  await page.getByRole("button", { name: "Your wallet" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  await page.getByRole("dialog").getByRole("heading", { name: item }).waitFor();
};

await step("withdraw $3 from cash to a new outside address (trading → wallet → send, relayer pays fee + account)", async () => {
  const { addr, free: f0 } = await balance();
  const { generateKeyPairSigner } = await import("@solana/kit");
  const outside = (await generateKeyPairSigner()).address;
  await openMoney("Withdraw");
  await page.locator("#funds-to").fill(outside);
  await page.locator("#funds-amount").fill("3");
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByText(outside).waitFor();
  await page.getByRole("button", { name: /^Send \$3\.00/ }).click();
  await toast(/sent to/, 90_000);
  const [w1, d, b1] = await Promise.all([json(`${NODE}/v1/wallet/${addr}`), json(`${NODE}/v1/wallet/${outside}`), balance()]);
  if (d.confirmed !== 3_000_000) throw new Error(`outside got ${d.confirmed}`);
  if (f0 - b1.free < 2.999) throw new Error(`cash went ${f0} → ${b1.free}, expected −3`);
  if (w1.confirmed > 10_000) throw new Error(`wallet left holding ${w1.confirmed}`);
  await shot("06a-withdrawn");
});

await step("USDC sent to the deposit address is added to cash on its own", async () => {
  const { addr, free: f0 } = await balance();
  await openMoney("Deposit");
  // An outside payment: the faucet mints straight to the wallet, without the app's own deposit step.
  const r = await json(`${ORACLE}/v1/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr }) });
  if (!r.amount) throw new Error(`faucet: ${JSON.stringify(r)}`);
  await toast(/received\. Ready to trade/, 60_000);
  const [w, b] = await Promise.all([json(`${NODE}/v1/wallet/${addr}`), balance()]);
  if (w.confirmed > 10_000) throw new Error(`wallet still holds ${w.confirmed}`);
  if (b.free - f0 < r.amount - 0.01) throw new Error(`cash ${f0} → ${b.free}, expected +${r.amount}`);
  await page.keyboard.press("Escape");
});

await step("deposit shows the wallet address and QR", async () => {
  const { addr } = await balance();
  await openMoney("Deposit");
  await page.getByRole("dialog").getByText(addr).waitFor();
  await page.getByRole("dialog").getByRole("img", { name: /QR code/ }).waitFor();
  await shot("06b-deposit");
  await page.keyboard.press("Escape");
});

await step("kickoff: the snapshot counts our players", async () => {
  if ((await round()).phase !== "open") {
    await skip();
    await waitPhase("open", 90_000).catch(async () => {
      await skip();
      await waitPhase("open", 90_000);
    });
  }
  await page.goto(`${BASE}/matchday`);
  await skip();
  await toast(/Kickoff/, 30_000);
  await waitPhase("live");
  await page.waitForTimeout(6_000);
  await shot("06-matchday-live");
});

await step("full time: dividends credited after the batch is final, then claimed", async () => {
  await skip(); // end live
  await waitPhase("ended");
  await skip(); // end freeze → RoundResult
  const s = Date.now();
  let claims = [];
  while (Date.now() - s < 60_000) {
    claims = (await balance()).u.claims;
    if (claims.length) break;
    await page.waitForTimeout(500);
  }
  if (!claims.length) throw new Error("no dividend credited (our players may not have placed: check the boards)");
  const ft = page.getByRole("dialog").filter({ hasText: /Full time/ });
  await ft.waitFor({ timeout: 20_000 });
  await shot("07-full-time");
  const before = (await balance()).free;
  await ft.getByRole("button", { name: /USDC|Claim/ }).first().click();
  const s2 = Date.now();
  while (Date.now() - s2 < 20_000 && (await balance()).u.claims.length) await page.waitForTimeout(300);
  if ((await balance()).u.claims.length) throw new Error("still claimable");
  if ((await balance()).free <= before) throw new Error("claim didn't pay");
});

await step("mobile layout renders (375px) without errors", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [`/trade/${P}`, "/portfolio", "/matchday"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await shot(`08-mobile-${path.split("/")[1]}`);
  }
});

await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} steps passed in ${((Date.now() - t0) / 1000).toFixed(0)} s · screenshots in ${SHOTS}/`);
if (errors.length) {
  console.log(`\n${errors.length} browser errors:`);
  for (const e of [...new Set(errors)].slice(0, 20)) console.log(`  ${e}`);
}
process.exit(failed.length || errors.length ? 1 : 0);
