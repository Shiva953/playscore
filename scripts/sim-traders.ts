/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from score-node / the oracle, shaped at the point of use */
// Simulated traders for devnet: devnet wallets (no SOL) that deposit test USDC and trade through the
// real API, so the app looks like a live market before mainnet. Everything they do is a real signed
// command in the engine and real deposits on Solana.
//
//   bun scripts/sim-traders.ts            (needs score-node + oracle; see `bun run stack`)
// Env: SIM_BOTS (40), SIM_RATE actions/min (30), SIM_BOND (24: players to bond at the start),
//      SIM_FUND per bot in USDC (25000).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createKeyPairFromPrivateKeyBytes, createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";
import { mintTo } from "../services/oracle/faucet";
import { ApiError, NodeApi, addressBytes, keypairSigner, type ScoreSigner } from "../src/lib/score-api/node";

const NODE = process.env.SCORE_NODE_URL || "http://127.0.0.1:8787";
const ORACLE = process.env.SCORE_ORACLE_URL || "http://127.0.0.1:8788";
const BOTS = Number(process.env.SIM_BOTS || 40);
const RATE = Number(process.env.SIM_RATE || 30);
const BOND = Number(process.env.SIM_BOND || 24);
const FUND = Number(process.env.SIM_FUND || 25_000);
const M = 1_000_000;
const node = new NodeApi(NODE);
const log = (...a: unknown[]) => console.error("sim:", ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

async function wallets(n: number): Promise<{ kp: KeyPairSigner; s: ScoreSigner }[]> {
  const path = ".devnet/bots.json";
  const saved: number[][] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  while (saved.length < n) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const kp = await createKeyPairFromPrivateKeyBytes(seed, true);
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    saved.push([...seed, ...pub]);
  }
  writeFileSync(path, JSON.stringify(saved));
  return Promise.all(saved.slice(0, n).map(async (b) => {
    const kp = await createKeyPairSignerFromBytes(new Uint8Array(b));
    return { kp, s: keypairSigner(kp) };
  }));
}

interface Mkt { player: number; state: "launching" | "bonded"; px: number; raised: number; threshold: number }
interface UserV { free: number; deposits: number; positions: { player: number; amount: number; locked: number }[]; orders: { id: number; player: number }[]; claims: { round: number; player: number }[]; lps: { id: number; player: number; liquidity: string }[] }

let ids: Record<string, number> = {};
let order: string[] = [];
let form = new Map<number, number>();
let markets = new Map<number, Mkt>();
const momentum = new Map<number, number>();

async function refresh() {
  const [o, m] = await Promise.all([
    fetch(`${ORACLE}/v1/players`).then((r) => r.json() as Promise<{ ids: Record<string, number>; players: { id: string; avgScore: number }[] }>),
    node.get<{ markets: Mkt[] }>("/v1/view/markets"),
  ]);
  ids = o.ids;
  order = o.players.map((p) => p.id);
  form = new Map(o.players.map((p) => [o.ids[p.id]!, p.avgScore]));
  markets = new Map(m.markets.filter((x) => Object.values(ids).includes(x.player)).map((x) => [x.player, x]));
}

const user = (s: ScoreSigner) => node.get<UserV>(`/v1/view/users/${s.address}`);

async function fund(b: { s: ScoreSigner }, usdc: number) {
  const info = await node.info();
  await mintTo(info.usdcMint, b.s.address, BigInt(Math.floor(usdc * M)));
  const before = (await user(b.s)).deposits;
  await node.deposit(b.s, BigInt(Math.floor(usdc * M)));
  for (let i = 0; i < 150; i++) {
    await sleep(400);
    if ((await user(b.s)).deposits >= before + usdc * M) return;
  }
  throw new Error(`deposit for ${b.s.address} not credited`);
}

async function ensureFunded(bots: { s: ScoreSigner }[]) {
  const need: { s: ScoreSigner }[] = [];
  for (const b of bots) if ((await user(b.s)).free < (FUND * M) / 5) need.push(b);
  if (!need.length) return;
  log(`funding ${need.length} bots with ${FUND.toLocaleString()} test USDC each (mint → deposit)…`);
  for (let i = 0; i < need.length; i += 6) await Promise.all(need.slice(i, i + 6).map((b) => fund(b, FUND).catch((e) => log(`fund: ${e.message}`))));
}

const key = (s: ScoreSigner) => addressBytes(s.address);
let lastCode: string | null = null;
async function act(s: ScoreSigner, label: string, make: (n: bigint) => any): Promise<any | null> {
  lastCode = null;
  try {
    return (await node.submit(s, make)).outcome;
  } catch (e) {
    if (e instanceof ApiError && e.code) {
      lastCode = e.code; // the engine said no (limit, slippage, balance): fine for a bot
      return null;
    }
    log(`${label}: ${(e as Error).message}`);
    return null;
  }
}

/** Curve buy that shrinks to fit the 240k-token-per-purchase cap. Null with lastCode set when it can't. */
async function curveBuy(s: ScoreSigner, player: number, usdc: number): Promise<any | null> {
  for (let i = 0; i < 7; i++) {
    const out = await act(s, "curve buy", (n) => ({ BuyCurve: { user: key(s), nonce: n, player, usdcIn: BigInt(Math.floor(usdc * M)), minTokens: 0n } }));
    if (out || lastCode !== "PurchaseLimit") return out;
    usdc /= 2;
  }
  return null;
}

/** Push the first SIM_BOND listed players through their launch, many wallets each (240k-token cap per wallet). */
async function bondStart(bots: { s: ScoreSigner }[]) {
  const targets = order.slice(0, BOND).map((id) => ids[id]!).filter((p) => markets.get(p)?.state === "launching");
  if (!targets.length) return;
  log(`bonding ${targets.length} players with curve buys from ${bots.length} wallets…`);
  for (const p of targets) {
    const full = new Set<number>();
    for (let round = 0; round < 400 && markets.get(p)?.state === "launching"; round++) {
      const live = bots.filter((_, i) => !full.has(i));
      if (!live.length) {
        log(`player ${p}: every wallet hit the launch cap; add bots (SIM_BOTS) to bond it`);
        break;
      }
      const i = bots.indexOf(pick(live));
      const out = await curveBuy(bots[i]!.s, p, rand(300, 1_400));
      if (!out && (lastCode === "AccountLimit" || lastCode === "InsufficientFunds")) full.add(i);
      if (out?.Bought?.graduated) {
        log(`player ${p} bonded`);
        break;
      }
      if (round % 20 === 0) await refresh();
    }
    await refresh();
  }
}

function weightedBonded(): number | null {
  const b = [...markets.values()].filter((m) => m.state === "bonded");
  if (!b.length) return null;
  const w = b.map((m) => Math.max(0.2, (form.get(m.player) ?? 6.5) - 5.5 + (momentum.get(m.player) ?? 0) * 3));
  let r = Math.random() * w.reduce((a, x) => a + x, 0);
  for (let i = 0; i < b.length; i++) if ((r -= w[i]!) <= 0) return b[i]!.player;
  return b[0]!.player;
}

async function step(bots: { s: ScoreSigner }[]) {
  const b = pick(bots);
  const u = await user(b.s);
  if (u.claims.length) {
    const c = u.claims[0]!;
    await act(b.s, "claim", (n) => ({ Claim: { user: key(b.s), nonce: n, round: c.round, player: c.player, takeTokens: Math.random() < 0.3 } }));
    return;
  }
  const roll = Math.random();
  const held = u.positions.filter((p) => p.amount > 1_000_000 && markets.get(p.player)?.state === "bonded");
  if (roll < 0.42) {
    const p = weightedBonded();
    if (p == null) return;
    await act(b.s, "buy", (n) => ({ Buy: { user: key(b.s), nonce: n, player: p, usdcIn: BigInt(Math.floor(rand(15, 350) * M)), minTokens: 0n, limitPx: 0n } }));
  } else if (roll < 0.72 && held.length) {
    const h = pick(held);
    await act(b.s, "sell", (n) => ({ Sell: { user: key(b.s), nonce: n, player: h.player, tokensIn: BigInt(Math.floor(h.amount * rand(0.05, 0.4))), minUsdc: 0n, limitPx: 0n } }));
  } else if (roll < 0.8) {
    const launching = [...markets.values()].filter((m) => m.state === "launching");
    if (!launching.length) return;
    const m = pick(launching);
    await curveBuy(b.s, m.player, rand(40, 600));
  } else if (roll < 0.9) {
    const p = weightedBonded();
    const m = p != null ? markets.get(p) : null;
    if (!m) return;
    if (u.orders.length > 4) {
      const o = pick(u.orders);
      await act(b.s, "cancel", (n) => ({ CancelOrder: { user: key(b.s), nonce: n, order: BigInt(o.id) } }));
    } else if (Math.random() < 0.5 || !held.some((h) => h.player === p)) {
      await act(b.s, "bid", (n) => ({ PlaceOrder: { user: key(b.s), nonce: n, player: p!, side: "bid", px: BigInt(Math.floor(m.px * rand(0.94, 0.985))), amount: BigInt(Math.floor(rand(10, 200) * M)), postOnly: true } }));
    } else {
      const h = held.find((x) => x.player === p)!;
      await act(b.s, "ask", (n) => ({ PlaceOrder: { user: key(b.s), nonce: n, player: p!, side: "ask", px: BigInt(Math.floor(m.px * rand(1.015, 1.06))), amount: BigInt(Math.floor(h.amount * rand(0.1, 0.3))), postOnly: true } }));
    }
  } else if (roll < 0.96) {
    const p = weightedBonded();
    if (p == null) return;
    const out = await act(b.s, "zap buy", (n) => ({ Buy: { user: key(b.s), nonce: n, player: p, usdcIn: BigInt(Math.floor(rand(60, 250) * M)), minTokens: 0n, limitPx: 0n } }));
    const t = out?.Traded?.tokens;
    if (t) await act(b.s, "add liquidity", (n) => ({ AddLiquidity: { user: key(b.s), nonce: n, player: p, lowerPx: 0n, upperPx: 0n, maxUsdc: BigInt(Math.floor(300 * M)), maxTokens: BigInt(t), minLiquidity: 0n } }));
  } else if (u.lps.length) {
    const l = pick(u.lps);
    await act(b.s, "remove liquidity", (n) => ({ RemoveLiquidity: { user: key(b.s), nonce: n, position: BigInt(l.id), liquidity: BigInt(l.liquidity), minUsdc: 0n, minTokens: 0n } }));
  }
}

/** Live match events nudge demand: a goal or assist pulls buyers in; a red card or own goal pushes them out. */
function followMatches() {
  const ws = new WebSocket(`${ORACLE.replace(/^http/, "ws")}/v1/stream`);
  ws.onmessage = (m) => {
    const e = JSON.parse(String(m.data));
    if (e.type !== "match") return;
    for (const ev of e.events) {
      const p = ids[ev.playerId];
      if (p == null) continue;
      const d = { goal: 0.6, assist: 0.35, penaltySaved: 0.4, red: -0.5, ownGoal: -0.5, penaltyMissed: -0.3 }[ev.code as string] ?? 0;
      if (d) momentum.set(p, Math.max(-1, Math.min(1, (momentum.get(p) ?? 0) + d)));
    }
  };
  ws.onclose = () => setTimeout(followMatches, 2_000);
}

await refresh();
const bots = (await wallets(BOTS)).map((w) => ({ s: w.s }));
log(`${bots.length} bots · ${RATE} actions/min · node ${NODE} · oracle ${ORACLE}`);
await ensureFunded(bots);
await bondStart(bots);
followMatches();
let n = 0;
for (;;) {
  try {
    if (n % 40 === 0) await refresh();
    if (n % 600 === 0 && n > 0) await ensureFunded(bots);
    for (const [p, v] of momentum) momentum.set(p, v * 0.97);
    await step(bots);
  } catch (e) {
    log(`step: ${(e as Error).message}`);
  }
  n++;
  await sleep((60_000 / RATE) * rand(0.3, 1.7));
}
