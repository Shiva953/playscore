// API latency A/B: start score-node, send N place-then-cancel cycles (2 logged commands each) from
// one user, time every round trip, print median / p95 / p99. Prints nothing during the timed part.
//
//   bun scripts/api-latency.ts [log: 0|1] [cycles]
import { readFileSync } from "node:fs";
import { createKeyPairSignerFromBytes, getAddressEncoder, signBytes } from "@solana/kit";
import { encodeCmd, orderMessage, type Cmd } from "../src/lib/score-api/commands";

const LOG = process.argv[2] ?? "0";
const N = Number(process.argv[3] ?? 300);
const NODE = "http://127.0.0.1:8787";
const node = Bun.spawn(["./backend/target/release/score-node"], { stderr: "ignore", stdout: "ignore", env: { ...process.env, SCORE_ENGINE_LOG: LOG } });
for (let i = 0; i < 200; i++) {
  try {
    if ((await fetch(`${NODE}/v1/info`)).ok) break;
  } catch {}
  await Bun.sleep(100);
}
await Bun.sleep(3000); // let the watcher's startup catch-up finish

const api = async (path: string, body?: unknown) => {
  const r = await fetch(`${NODE}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j: any = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
};
const saved: number[][] = JSON.parse(readFileSync(".devnet/users.json", "utf8"));
const eng = await api("/v1/engine");
const P = Math.max(...eng.players);
const px = BigInt((await api(`/v1/markets/${P}`)).px) / 2n;
let user = await createKeyPairSignerFromBytes(new Uint8Array(saved[0]));
for (const b of saved) {
  const u = await createKeyPairSignerFromBytes(new Uint8Array(b));
  if (BigInt((await api(`/v1/users/${u.address}`)).free) >= 5_000_000n) { user = u; break; }
}
const key = Uint8Array.from(getAddressEncoder().encode(user.address));
let nonce = BigInt((await api(`/v1/users/${user.address}`)).nonce);
const send = async (cmd: Cmd) => api("/v1/cmd", { cmd: Buffer.from(encodeCmd(cmd)).toString("base64"), sig: Buffer.from(await signBytes(user.keyPair.privateKey, orderMessage(cmd))).toString("base64") });

const t: number[] = [];
for (let i = 0; i < N; i++) {
  const place: Cmd = { PlaceOrder: { user: key, nonce: ++nonce, player: P, side: "bid", px, amount: 2_000_000n, postOnly: true } };
  let t0 = performance.now();
  const r = await send(place);
  t.push(performance.now() - t0);
  const cancel: Cmd = { CancelOrder: { user: key, nonce: ++nonce, order: BigInt(r.outcome.Traded.order) } };
  t0 = performance.now();
  await send(cancel);
  t.push(performance.now() - t0);
}
node.kill("SIGKILL");
t.sort((a, b) => a - b);
const q = (p: number) => t[Math.min(t.length - 1, Math.floor(t.length * p))].toFixed(2);
console.log(`engine log ${LOG === "1" ? "ON " : "OFF"}: ${t.length} commands · median ${q(0.5)} ms · p95 ${q(0.95)} ms · p99 ${q(0.99)} ms`);
process.exit(0);
