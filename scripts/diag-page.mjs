// Load a page in a real browser and print every console message, page error, and failed request.
// Usage: node scripts/diag-page.mjs <url>
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:3000/trade";
const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[console.${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}\n${(e.stack || "").split("\n").slice(0, 6).join("\n")}`));
page.on("requestfailed", (r) => errors.push(`[requestfailed] ${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`);
});

let navErr = null;
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
} catch (e) {
  navErr = e.message;
}
await page.waitForTimeout(3000);

const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim();
console.log("URL:", url);
console.log("NAV ERROR:", navErr ?? "none");
console.log("VISIBLE TEXT LEN:", text.length);
console.log("VISIBLE TEXT:", text.slice(0, 400));
console.log("\n--- SIGNALS (" + errors.length + ") ---");
for (const e of errors.slice(0, 40)) console.log(e);

await browser.close();
