// End-to-end test of the whole backend on devnet: score-node (engine + log, API, permit signer,
// relayer, chain watcher, batch committer, Postgres writer) + the program.
//
// Test users hold USDC but no SOL, and act only through the API and the relayer, as the app will.
// The driver runs score-node as a child process, kills it mid-run and restarts it.
//
//   bun run devnet:setup     (once)
//   bun run e2e:backend [users]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  appendTransactionMessageInstructions,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstructionAsync, getMintToInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { fetchState, getDepositInstruction, getEnterExitModeInstruction, getForceRequestInstruction, getRequestWithdrawalInstruction, getSetPauseInstruction, getWithdrawInstruction } from "../src/generated/score";
import { encodeCmd, orderMessage, type Cmd } from "../src/lib/score-api/commands";
import { USDC, cliWallet, le64, pda, rpc, send, sleep } from "./lib/devnet";

const N_USERS = Number(process.argv[2] ?? 45);
const NODE = "http://127.0.0.1:8787";
const ADMIN = readFileSync(".devnet/admin-token", "utf8").trim();
const enc = getAddressEncoder();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const key = (a: Address) => Uint8Array.from(enc.encode(a));

// ---------------- timings ----------------
const T: Record<string, number[]> = {};
const rec = (k: string, ms: number) => (T[k] ??= []).push(ms);
const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fetch(`${NODE}/v1/status`).then((r) => r.json()).then((s) => console.log("      node status:", JSON.stringify({ batches: s.batches, watcher: s.watcher, relay: s.relay }))).catch(() => {});
};

// ---------------- the node, as a child process ----------------
let node: ReturnType<typeof Bun.spawn> | null = null;
let nodeLog = "";
let fullLog = "";
const proof: Record<string, string> = {};
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
async function startNode(): Promise<string> {
  nodeLog = "";
  // SCORE_ENGINE_LOG=1: one line per engine command, from a separate copy of the engine (no cost to
  // the trading path). Set SCORE_ENGINE_LOG=0 to hide them.
  node = Bun.spawn(["./backend/target/release/score-node"], { stderr: "pipe", stdout: "pipe", env: { ...process.env, SCORE_ENGINE_LOG: process.env.SCORE_ENGINE_LOG ?? "1" } });
  (async () => {
    const r = (node!.stderr as ReadableStream<Uint8Array>).getReader();
    const d = new TextDecoder();
    let partial = "";
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      const text = d.decode(value);
      nodeLog += text;
      fullLog += text;
      partial += text;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) console.log(l.startsWith("engine │") ? `   ${l}` : `   node   │ ${l}`);
    }
  })();
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${NODE}/v1/info`)).ok) break;
    } catch {}
    await sleep(100);
  }
  const m = nodeLog.match(/log: (\d+) records replayed in ([\d.]+\S+), head (\w+)/);
  return m ? `${m[1]}|${m[2]}|${m[3]}` : "";
}
function killNode() {
  node?.kill("SIGKILL");
  node = null;
}
process.on("exit", () => node?.kill("SIGKILL"));

// ---------------- API ----------------
async function api(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${NODE}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
async function signed(u: KeyPairSigner, cmd: Cmd) {
  return { cmd: b64(encodeCmd(cmd)), sig: b64(await signBytes(u.keyPair.privateKey, orderMessage(cmd))) };
}
const nonce = async (u: KeyPairSigner) => BigInt((await api(`/v1/users/${u.address}`)).nonce) + 1n;
const userState = (u: KeyPairSigner) => api(`/v1/users/${u.address}`);
async function order(label: string, u: KeyPairSigner, make: (n: bigint) => Cmd) {
  const t0 = performance.now();
  const cmd = make(await nonce(u));
  const out = await api("/v1/cmd", await signed(u, cmd));
  rec(label, performance.now() - t0);
  return out;
}
const admin = (cmd: Cmd) => api("/v1/admin/cmd", { cmd: b64(encodeCmd(cmd)) }, { "x-admin-token": ADMIN });

// Live updates: resolve when a logged record matches.
type Rec = { seq: number; kind: string; user?: string; cmd: any };
const waiters: { pred: (r: Rec) => boolean; done: (r: Rec) => void }[] = [];
function openStream() {
  const ws = new WebSocket(`${NODE.replace("http", "ws")}/v1/stream`);
  ws.onmessage = (m) => {
    const r: Rec = JSON.parse(String(m.data));
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(r)) waiters.splice(i, 1)[0].done(r);
  };
  return new Promise<WebSocket>((ok) => (ws.onopen = () => ok(ws)));
}
const awaitRecord = (pred: (r: Rec) => boolean, ms = 30_000) =>
  Promise.race([new Promise<Rec>((done) => waiters.push({ pred, done })), sleep(ms).then(() => { throw new Error("timed out waiting for the engine"); })]);

// ---------------- users ----------------
async function users(n: number): Promise<KeyPairSigner[]> {
  const path = ".devnet/users.json";
  const saved: number[][] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  while (saved.length < n) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const kp = await createKeyPairFromPrivateKeyBytes(seed, true);
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    saved.push([...seed, ...pub]);
  }
  writeFileSync(path, JSON.stringify(saved));
  return Promise.all(saved.slice(0, n).map((b) => createKeyPairSignerFromBytes(new Uint8Array(b))));
}

// ---------------- transactions the user signs; the relayer pays ----------------
let INFO: any;
async function userTx(u: KeyPairSigner, ixs: Instruction[], cu: number) {
  const relayer = createNoopSigner(INFO.relayer as Address);
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(relayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units: cu }), getSetComputeUnitPriceInstruction({ microLamports: 20_000n }), ...ixs], m),
  );
  const tx = await partiallySignTransactionMessageWithSigners(msg);
  return getBase64EncodedWireTransaction(tx);
}
const ata = async (owner: Address) => (await findAssociatedTokenPda({ owner, mint: INFO.usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
async function walletBalance(owner: Address): Promise<bigint> {
  const r = await rpc.getTokenAccountBalance(await ata(owner), { commitment: "finalized" }).send().catch(() => null);
  return r ? BigInt(r.value.amount) : 0n;
}

async function deposit(u: KeyPairSigner, amount: bigint) {
  const t0 = performance.now();
  const ix = getDepositInstruction({ user: u, pending: INFO.pending, userUsdc: await ata(u.address), custody: INFO.custody, usdcMint: INFO.usdcMint, amount });
  const seen = awaitRecord((r) => r.kind === "Deposit" && r.user === u.address && BigInt(r.cmd.Deposit.amount) === amount);
  const { signature } = await api("/v1/relay", { tx: await userTx(u, [ix], 20_000) });
  proof["a deposit (user-signed, relayer paid the fee)"] ??= explorer(signature);
  await Promise.race([seen, failsOnChain(signature)]);
  rec("deposit: click → spendable", performance.now() - t0);
}

/** Throws if the transaction fails on-chain (so a test doesn't just time out). */
async function failsOnChain(sig: string): Promise<never> {
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([sig as any]).send();
    if (value[0]?.err) throw new Error(`transaction ${sig} failed on-chain: ${JSON.stringify(value[0].err, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    await sleep(300);
  }
}

/** Simulate a transaction (no fee, nothing changes); returns its error and logs as text. */
async function simulate(payer: KeyPairSigner, ixs: Instruction[]): Promise<string> {
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  const r = await rpc.simulateTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", commitment: "finalized" }).send();
  return JSON.stringify(r.value.err, (_, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n" + (r.value.logs ?? []).join("\n");
}

function ed25519Ix(pk: Uint8Array, sig: Uint8Array, msg: Uint8Array): Instruction {
  const head = new Uint8Array(16);
  const v = new DataView(head.buffer);
  head[0] = 1;
  [48, 0xffff, 16, 0xffff, 112, msg.length, 0xffff].forEach((x, i) => v.setUint16(2 + i * 2, x, true));
  return { programAddress: "Ed25519SigVerify111111111111111111111111111" as Address, accounts: [], data: new Uint8Array([...head, ...pk, ...sig, ...msg]) };
}

async function withdraw(u: KeyPairSigner, amount: bigint, label: string) {
  const t0 = performance.now();
  const before = await walletBalance(u.address);
  const tStart = performance.now(); // exclude the balance read above from the timing
  const prep = await api("/v1/withdraw/prepare", { amount: Number(amount) });
  const lock: Cmd = { LockWithdraw: { user: key(u.address), nonce: await nonce(u), amount, id: BigInt(prep.id), expiry: BigInt(prep.expiry) } };
  const permit = await api("/v1/withdraw", await signed(u, lock));
  // The mode decided when the hold was placed (prepare's is only a hint).
  const mode: string = permit.mode ?? prep.mode;
  const msg = new Uint8Array([...new TextEncoder().encode("score:voucher:v1:"), ...key(INFO.program), ...key(u.address), ...le64(amount), ...le64(BigInt(prep.id)), ...le64(BigInt(prep.expiry))]);
  const ed = ed25519Ix(key(INFO.voucherSigner), Uint8Array.from(Buffer.from(permit.voucherSig, "base64")), msg);
  const common = { user: u, pending: INFO.pending, page: prep.page, amount, id: BigInt(prep.id), expiry: BigInt(prep.expiry) };
  const ix =
    mode === "instant"
      ? getWithdrawInstruction({ ...common, userUsdc: await ata(u.address), custody: INFO.custody, usdcMint: INFO.usdcMint })
      : getRequestWithdrawalInstruction({ ...common, payer: createNoopSigner(INFO.relayer as Address), withdrawRequest: await pda(["withdraw_request", le64(BigInt(prep.id))]) });
  const { signature } = await api("/v1/relay", { tx: await userTx(u, [ed, ix], 40_000) });
  proof[mode === "instant" ? "an instant withdrawal (permit checked on-chain)" : "a large withdrawal, recorded as a request"] ??= explorer(signature);
  const failed = failsOnChain(signature);
  failed.catch(() => {});
  for (;;) {
    await Promise.race([sleep(0), failed]);
    if ((await walletBalance(u.address)) >= before + amount) break;
    if (performance.now() - t0 > 90_000) throw new Error(`${label}: USDC never arrived`);
    await sleep(100);
  }
  rec(label, performance.now() - tStart);
  return mode;
}

// =====================================================================================
const me = await cliWallet();
const ALL = await users(N_USERS + 3);
const [U, late, whale] = [ALL.slice(0, N_USERS), ALL.slice(N_USERS, N_USERS + 2), ALL[N_USERS + 2]];

console.log("== start score-node");
const boot = await startNode();
INFO = await api("/v1/info");
await openStream();
console.log(`node up: ${boot}`);

// The instant-withdrawal cap right now: max(cap_min, 2% of custody). The whale deposits enough to
// withdraw above it, which must take the request path.
const custodyNow = async () => BigInt((await rpc.getTokenAccountBalance(INFO.custody, { commitment: "finalized" }).send()).value.amount);
const capNow = async () => {
  const c = (await api("/v1/status")).chain;
  const bps = BigInt(c.cap_bps);
  return [BigInt(c.cap_min), ((await custodyNow()) * bps) / 10_000n].reduce((a, b) => (a > b ? a : b));
};
// 3% of what custody will hold after this run's deposits: comfortably above the 2% cap then.
const WHALE_IN = (((await custodyNow()) + 60_000n * USDC) * 3n) / 100n + 1_000n * USDC;
console.log(`instant-withdrawal cap now ${Number(await capNow()) / 1e6} USDC; whale deposits ${Number(WHALE_IN) / 1e6}`);

console.log("== fund test wallets with USDC (setup, not timed)");
for (let i = 0; i < ALL.length; i += 4) {
  const chunk = ALL.slice(i, i + 4);
  const ixs: Instruction[] = [];
  for (const u of chunk) {
    const need = u === whale ? WHALE_IN + 100n * USDC : 1_100n * USDC; // this run's deposit plus margin
    const have = await walletBalance(u.address);
    if (have >= need) continue;
    ixs.push(await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: me, owner: u.address, mint: INFO.usdcMint }));
    ixs.push(getMintToInstruction({ mint: INFO.usdcMint, token: await ata(u.address), mintAuthority: me, amount: need - have }));
  }
  if (ixs.length) await send(me, ixs, 200_000);
}

console.log("== deposits (through the relayer; users hold no SOL)");
for (let i = 0; i < U.length; i += 8) await Promise.all(U.slice(i, i + 8).map((u) => deposit(u, 1_000n * USDC)));
await deposit(whale, WHALE_IN);

console.log("== ICO: curve buys until the player graduates");
const eng0 = await api("/v1/engine");
const P = Math.max(0, ...eng0.players) + 1;
await admin({ ListPlayer: { player: P } });
let graduated = false;
const mkt = async () => api(`/v1/markets/${P}`);
// Size each buy at just under the 240k-token cap, or the user's balance (curve: price = $0.00039 +
// S²/3.883e9 µUSDC per token, so cost(S → S+T) = 0.00039·T + ((S+T)³ − S³)/1.1649e16 USDC).
const curveCost = (S: number, T: number) => 0.00039 * T + ((S + T) ** 3 - S ** 3) / 1.1649e16;
for (const u of U) {
  const sold = Number((await mkt()).sold) / 1e6;
  const free = Number((await userState(u)).free) / 1e6;
  const usdc = Math.min(curveCost(sold, 225_000) * 1.0125, free - 1);
  const r = await order("ICO buy (curve)", u, (n) => ({ BuyCurve: { user: key(u.address), nonce: n, player: P, usdcIn: BigInt(Math.floor(usdc * 1e6)), minTokens: 1n } }));
  if (r.outcome?.Bought?.graduated) {
    graduated = true;
    break;
  }
}
check("player graduates on the curve", graduated);

console.log("== pool trading, limit orders, liquidity");
const holders: KeyPairSigner[] = [];
for (const u of U) if ((await userState(u)).holdings.some((h: any) => h.player === P && BigInt(h.amount) > 0n)) holders.push(u);
const pick = <X>(xs: X[], i: number) => xs[i % xs.length];
// A user with at least `usdc` free (and, if asked, some tokens of P), rotating through the list.
let rot = 0;
async function someone(usdc: bigint, needTokens = false): Promise<KeyPairSigner> {
  for (let k = 0; k < U.length; k++) {
    const u = U[(rot++ * 7 + 3) % U.length];
    const s = await userState(u);
    const tok = s.holdings.find((h: any) => h.player === P);
    if (BigInt(s.free) >= usdc && (!needTokens || (tok && BigInt(tok.amount) > 1_000_000n))) return u;
  }
  throw new Error(`no test user has ${usdc} free${needTokens ? " and tokens" : ""}`);
}
const tokensOf = async (u: KeyPairSigner) => BigInt((await userState(u)).holdings.find((x: any) => x.player === P)?.amount ?? 0);
for (let i = 0; i < 15; i++) {
  const u = await someone(120n * USDC);
  await order("pool buy", u, (n) => ({ Buy: { user: key(u.address), nonce: n, player: P, usdcIn: BigInt(20 + (i % 5) * 20) * USDC, minTokens: 0n, limitPx: 0n } }));
}
for (let i = 0; i < 10; i++) {
  const u = pick(holders, i);
  const t = await tokensOf(u);
  await order("pool sell", u, (n) => ({ Sell: { user: key(u.address), nonce: n, player: P, tokensIn: t / 10n, minUsdc: 0n, limitPx: 0n } }));
}
const px = BigInt((await mkt()).px);
const bidders: KeyPairSigner[] = [];
for (let i = 0; i < 6; i++) {
  const u = await someone(40n * USDC);
  bidders.push(u);
  await order("limit order (bid)", u, (n) => ({ PlaceOrder: { user: key(u.address), nonce: n, player: P, side: "bid", px: (px * 90n) / 100n, amount: 30n * USDC, postOnly: true } }));
  const s = pick(holders, i + 3);
  const t = await tokensOf(s);
  await order("limit order (ask)", s, (n) => ({ PlaceOrder: { user: key(s.address), nonce: n, player: P, side: "ask", px: (px * 112n) / 100n, amount: t / 20n, postOnly: true } }));
}
for (let i = 0; i < 3; i++) {
  const u = bidders[i];
  const o = (await userState(u)).orders[0];
  if (o) await order("cancel order", u, (n) => ({ CancelOrder: { user: key(u.address), nonce: n, order: BigInt(o.id) } }));
}
const lpers: KeyPairSigner[] = [];
for (let i = 0; i < 4; i++) {
  const u = await someone(60n * USDC, true);
  lpers.push(u);
  const t = await tokensOf(u);
  await order("add liquidity", u, (n) => ({ AddLiquidity: { user: key(u.address), nonce: n, player: P, lowerPx: 0n, upperPx: 0n, maxUsdc: 50n * USDC, maxTokens: t / 2n, minLiquidity: 0n } }));
}
for (let i = 0; i < 2; i++) {
  const u = lpers[i];
  const lp = (await userState(u)).lps[0];
  if (lp) await order("remove liquidity", u, (n) => ({ RemoveLiquidity: { user: key(u.address), nonce: n, position: BigInt(lp.id), liquidity: BigInt(lp.liquidity), minUsdc: 0n, minTokens: 0n } }));
}

console.log("== crash: kill -9 the node, deposit on-chain while it's down, restart");
await sleep(500);
const pre = await api("/v1/engine");
killNode();
for (const u of late) {
  await send(me, [getDepositInstruction({ user: u, pending: INFO.pending, userUsdc: await ata(u.address), custody: INFO.custody, usdcMint: INFO.usdcMint, amount: 250n * USDC })], 30_000);
}
const tRestart = performance.now();
const boot2 = await startNode();
rec("restart: process start → serving", performance.now() - tRestart);
await openStream();
const [n2, replay, head2] = boot2.split("|");
// (A batch-finalized note may land between the read and the kill; then the count is one higher.)
check("restart replays the log to the exact same state", (Number(n2) === pre.applied && head2 === pre.head) || Number(n2) === pre.applied + 1, `${n2} records in ${replay}`);
const st0 = (await fetchState(rpc, await pda(["state"]), { commitment: "finalized" })).data;
for (;;) {
  const e = await api("/v1/engine");
  if (BigInt(e.deposits) >= st0.depositCount) break;
  if (performance.now() - tRestart > 60_000) break;
  await sleep(200);
}
rec("restart: catch up deposits made while down", performance.now() - tRestart);
const lateFree = await Promise.all(late.map(async (u) => BigInt((await userState(u)).free)));
check("deposits made while the node was down are credited", lateFree.every((f) => f >= 250n * USDC));

console.log("== round: snapshot → result → dividends credited once the batch is final → claim");
const e1 = await api("/v1/engine");
const round = e1.lastSnapshot + 1;
await admin({ PublishCalendar: { round, lockTs: BigInt(Math.floor(Date.now() / 1000) + 3) } });
await sleep(4500);
await admin({ Snapshot: { round } });
const holder = holders[0];
const tRes = performance.now();
await admin({ RoundResult: { round, payouts: [[P, 300n * USDC]] } });
let credited = false;
while (performance.now() - tRes < 60_000) {
  if ((await userState(holder)).claims.some((c: any) => c.round === round)) {
    credited = true;
    break;
  }
  await sleep(100);
}
rec("dividend: result → claimable", performance.now() - tRes);
check("dividends credited only after their batch is final", credited);
if (credited) await order("claim dividend (USDC)", holder, (n) => ({ Claim: { user: key(holder.address), nonce: n, round, player: P, takeTokens: false } }));

console.log("== on-chain pause: the API refuses withdrawals up front (no hold, no failing transaction)");
{
  const flags = async () => Number((await api("/v1/status")).programPaused);
  const u = await someone(30n * USDC);
  const lockedBefore = BigInt((await userState(u)).locked);
  let refused = false;
  await send(me, [getSetPauseInstruction({ signer: me, flags: 2 })], 30_000); // withdrawals only
  try {
    for (let i = 0; i < 50 && ((await flags()) & 2) === 0; i++) await sleep(100);
    try {
      await api("/v1/withdraw/prepare", { amount: Number(10n * USDC) });
    } catch (e: any) {
      refused = /paused/.test(e.message);
    }
  } finally {
    await send(me, [getSetPauseInstruction({ signer: me, flags: 0 })], 30_000);
  }
  for (let i = 0; i < 50 && (await flags()) !== 0; i++) await sleep(100);
  check("withdrawals refused while paused on-chain, nothing put on hold", refused && BigInt((await userState(u)).locked) === lockedBefore && (await flags()) === 0);
}

console.log("== withdrawals: permit + relayer, USDC back in the user's wallet");
const modes: string[] = [];
for (let i = 0; i < 8; i++) modes.push(await withdraw(await someone(30n * USDC), 25n * USDC, "withdraw: click → USDC in wallet"));
check("small withdrawals stay instant", modes.every((m) => m === "instant"), modes.join(", "));
const WHALE_OUT = (await capNow()) + 300n * USDC;
const bigMode = await withdraw(whale, WHALE_OUT, "large withdrawal (over the cap): click → wallet");
check("large withdrawal goes through the request path and is paid", bigMode === "request");

console.log("== escape hatch: a user posts forced requests straight on Solana (no API, no relayer)");
{
  const { getTransferSolInstruction } = await import("@solana-program/system");
  const fu = await someone(60n * USDC);
  // The user pays for a forced request (it's the path for when we won't help): give them a little SOL.
  await send(me, [getTransferSolInstruction({ source: me, destination: fu.address, amount: 10_000_000n })], 30_000);
  const stateAt = async () => (await fetchState(rpc, await pda(["state"]), { commitment: "finalized" })).data;
  const idx = (await stateAt()).forcedCount + 1n;
  const forced = async (index: bigint, kind: number, arg: bigint) => {
    const data = new Uint8Array(32);
    data.set(le64(arg));
    return getForceRequestInstruction({ user: fu, forcedRequest: await pda(["forced_request", le64(index)]), index, kind, data });
  };
  const before = await walletBalance(fu.address);
  const t0 = performance.now();
  const { sig } = await send(fu, [await forced(idx, 0, 40n * USDC)], 30_000);
  proof["a forced withdrawal, posted by the user"] ??= explorer(sig);
  let paid = false;
  while (performance.now() - t0 < 90_000) {
    if ((await walletBalance(fu.address)) >= before + 40n * USDC) {
      paid = true;
      break;
    }
    await sleep(100);
  }
  rec("forced withdrawal: posted on-chain → USDC in wallet", performance.now() - t0);
  // A request that asks for nothing sensible is still answered: it can't be used to stall us.
  await send(fu, [await forced(idx + 1n, 9, 0n)], 30_000);
  let st2 = await stateAt();
  for (let i = 0; i < 60 && st2.forcedServed < idx + 1n; i++) {
    await sleep(500);
    st2 = await stateAt();
  }
  const closed = (await rpc.getAccountInfo(await pda(["forced_request", le64(idx)]), { commitment: "finalized" }).send()).value === null;
  check("forced withdrawal is answered on-chain and paid to the user", paid && closed, `40 USDC in ${((performance.now() - t0) / 1000).toFixed(1)} s incl. a second request; request account closed, rent back`);
  check("every forced request is answered (served = posted)", st2.forcedServed === st2.forcedCount, `${st2.forcedServed} of ${st2.forcedCount}`);
  const sim = await simulate(fu, [getEnterExitModeInstruction({})]);
  check("nobody can switch on exit mode", /ExitNotAllowed/.test(sim), "simulated enter_exit_mode → ExitNotAllowed");
}

console.log("== the relayer refuses a transaction that would spend its own SOL");
{
  const { getTransferSolInstruction } = await import("@solana-program/system");
  const evil = getTransferSolInstruction({ source: createNoopSigner(INFO.relayer as Address), destination: U[0].address, amount: 1_000_000n });
  const dep = getDepositInstruction({ user: U[0], pending: INFO.pending, userUsdc: await ata(U[0].address), custody: INFO.custody, usdcMint: INFO.usdcMint, amount: USDC });
  let refused = false;
  try {
    await api("/v1/relay", { tx: await userTx(U[0], [dep, evil], 40_000) });
  } catch (e: any) {
    refused = /not allowed|relayer/.test(e.message);
  }
  check("relayer refuses a transaction that touches its own account", refused);
}

console.log("== final reconciliation");
// Wait until a batch covers everything the engine has logged (except that batch's own
// "finalized" note), then compare.
let status: any, eng: any, st: any;
for (let i = 0; i < 60; i++) {
  [status, eng] = [await api("/v1/status"), await api("/v1/engine")];
  st = (await fetchState(rpc, await pda(["state"]), { commitment: "finalized" })).data;
  if (status.batches.last_cut + 1 >= eng.applied && Buffer.from(Uint8Array.from(st.stateRoot)).toString("hex") === status.batches.last_state_root) break;
  await sleep(1000);
}
const hex = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("hex");
// The committer posts the engine's fingerprint at the batch's cut; after it, only the engine's own
// "batch finalized" note was logged.
check("on-chain fingerprint = the engine's at the batch cut", hex(st.stateRoot) === status.batches.last_state_root && eng.applied <= status.batches.last_cut + 1, `batch ${st.batchSeq}, cut ${status.batches.last_cut}, engine at ${eng.applied}`);
check("on-chain deposit and payout counts = the engine's", BigInt(eng.deposits) === st.depositCount && BigInt(eng.payouts) === st.payoutCount, `${eng.deposits} deposits, ${eng.payouts} payouts`);
const bal = async (a: Address) => BigInt((await rpc.getTokenAccountBalance(a, { commitment: "finalized" }).send()).value.amount);
const onchain = (await bal(INFO.custody)) + (await bal(INFO.vault)) + (await bal(INFO.treasury));
check("custody + vault + treasury USDC = the engine's total", onchain === BigInt(eng.custody), `${Number(onchain) / 1e6} USDC`);
check("vault and treasury accounts = the engine's figures", (await bal(INFO.vault)) === BigInt(eng.vault) && (await bal(INFO.treasury)) === BigInt(eng.treasury));
check("no relayed transaction failed", status.relay.failed === 0, `${status.relay.landed} landed, ${status.relay.rejected} refused`);
check("watcher applied every deposit and payout", !/deposit|payout/.test(status.watcher.last_error ?? ""), status.watcher.last_error ?? "");
if (status.watcher.last_error) console.log(`      watcher's last transient error: ${status.watcher.last_error}`);
let pgRows: any[] = [];
if (status.db.enabled) {
  // Read Neon directly (not the node's own status).
  let count = -1, max = -1;
  for (let i = 0; i < 30; i++) {
    try {
      const db = new Bun.SQL(process.env.DATABASE_URL!);
      const [r] = await db`select count(*)::bigint as n, coalesce(max(seq), 0)::bigint as m from log`;
      [count, max] = [Number(r.n), Number(r.m)];
      pgRows = await db`select seq, kind, signer, to_timestamp(ts) as at from log order by seq desc limit 6`;
      await db.close();
    } catch (e: any) {
      console.log(`      (reading Neon: ${e.message})`);
    }
    if (count >= eng.applied) break;
    await sleep(1000);
  }
  check("Postgres (Neon) holds every log record, read directly from Neon", count === max && count >= eng.applied, `${count} rows, max seq ${max}, engine at ${eng.applied}`);
} else console.log("SKIP  Postgres (DATABASE_URL not set)");

console.log("\n== timings (ms)");
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
console.log("action".padEnd(52), "n".padStart(4), "median".padStart(8), "p95".padStart(8), "max".padStart(8));
for (const [k, xs] of Object.entries(T)) console.log(k.padEnd(52), String(xs.length).padStart(4), q(xs, 0.5).toFixed(0).padStart(8), q(xs, 0.95).toFixed(0).padStart(8), Math.max(...xs).toFixed(0).padStart(8));
console.log(`batches: ${status.batches.batches}, last commit ${status.batches.last_ms} ms (send → finalized)`);

console.log("\n== proof you can open");
console.log(`the program              https://explorer.solana.com/address/${INFO.program}?cluster=devnet`);
console.log(`custody (users' USDC)    https://explorer.solana.com/address/${INFO.custody}?cluster=devnet`);
for (const [k, v] of Object.entries(proof)) console.log(`${k.padEnd(24).slice(0, 24)} ${v}`, k.length > 24 ? `  (${k})` : "");
if (status.batches.last_signature) console.log(`latest batch (fingerprint ${status.batches.last_state_root.slice(0, 12)}…)  ${explorer(status.batches.last_signature)}`);
if (pgRows.length) {
  console.log("\nlatest rows in Neon (table log):");
  for (const r of pgRows) console.log(`  #${r.seq}  ${String(r.kind).padEnd(16)} ${r.signer ? String(r.signer).slice(0, 8) + "…" : "(system)".padEnd(9)}  ${new Date(r.at).toISOString()}`);
}
writeFileSync(".devnet/node/last-run.log", fullLog);
console.log("\nfull server log: .devnet/node/last-run.log");
const failed = checks.filter((c) => !c[1]);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
killNode();
process.exit(failed.length ? 1 : 0);
