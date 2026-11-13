import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage();
const ev = [];
const fails = [];
p.on("console", (m) => { if (m.type() === "error") ev.push(m.text().slice(0, 170)); });
p.on("requestfailed", (r) => fails.push(`${r.url().slice(0, 70)} :: ${r.failure()?.errorText}`));

await p.goto("http://localhost:3000/trade", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(3500);

// What does the dialog offer?
await p.getByRole("button", { name: /sign in/i }).first().click().catch(() => {});
await p.waitForTimeout(2500);
const btns = (await p.getByRole("button").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
console.log("DIALOG BUTTONS:", JSON.stringify(btns.slice(-5)));
console.log("IFRAMES:", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("iframe")].map((f) => f.src.slice(0, 60)))));
console.log("CONSOLE ERRORS:", JSON.stringify(ev.slice(0, 5), null, 1));
console.log("FAILED:", JSON.stringify(fails.slice(0, 4), null, 1));
await b.close();
