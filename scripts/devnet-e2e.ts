// End-to-end test of the score program on devnet, through the generated client the app uses.
//
// Setup (once, reused on later runs): a USDC-like test mint, `initialize`, a test user who holds no
// SOL (the relayer, here your CLI wallet, pays every fee), a voucher page.
// Then N real deposits and N real voucher withdrawals, each timed from the moment the transaction
// is sent until (a) Solana reports it finalized and (b) our program's event reaches a log
// subscription at `finalized`, which is what the chain watcher will use. Finally one batch.
//
//   bun run e2e:devnet [N]
// The RPC URL comes from DEVNET_RPC, or else NEXT_PUBLIC_SOLANA_RPC_DEVNET in .env / .env.local
// (Bun loads those automatically). Use a Helius devnet URL: the public endpoint refuses WebSockets
// as soon as it rate-limits.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintToInstruction,
} from "@solana-program/token";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import {
  SCORE_PROGRAM_ADDRESS,
  fetchMaybeConfig,
  fetchState,
  getCommitBatchInstruction,
  getDepositInstruction,
  getInitVoucherPageInstructionAsync,
  getInitializeInstructionAsync,
  getWithdrawInstruction,
} from "../src/generated/score";

const N = Number(process.argv[2] ?? 5);
const RPC = process.env.DEVNET_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC_DEVNET;
if (!RPC) {
  console.error("No devnet RPC URL. Set NEXT_PUBLIC_SOLANA_RPC_DEVNET in .env.local (or DEVNET_RPC) to your Helius devnet URL.");
  process.exit(1);
}
console.log(`RPC: ${new URL(RPC).host}`);
const rpc = createSolanaRpc(RPC);
const subs = createSolanaRpcSubscriptions(RPC.replace(/^http/, "ws"));
const USDC = 1_000_000n;
const PENDING_SPACE = 8n + 1024n * 40n + 1024n * 56n;
const ED25519 = address("Ed25519SigVerify111111111111111111111111111");
const STATE_FILE = ".devnet/e2e.json";

const relayer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));

// ---- persisted test keys (devnet only) ----
type Saved = { mint: number[]; user: number[]; voucherSeed: number[]; pending: number[]; nextId: number };
mkdirSync(".devnet", { recursive: true });
const saved: Saved = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : await (async () => {
      const fresh = async () => Array.from(crypto.getRandomValues(new Uint8Array(32)));
      const kp = async () => {
        const seed = new Uint8Array(await fresh());
        const k = await createKeyPairFromPrivateKeyBytes(seed, true);
        const pub = new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey));
        return [...seed, ...pub];
      };
      const s = { mint: await kp(), user: await kp(), voucherSeed: await fresh(), pending: await kp(), nextId: 1 };
      writeFileSync(STATE_FILE, JSON.stringify(s));
      return s;
    })();
const mint = await createKeyPairSignerFromBytes(new Uint8Array(saved.mint));
const user = await createKeyPairSignerFromBytes(new Uint8Array(saved.user));
const pending = await createKeyPairSignerFromBytes(new Uint8Array(saved.pending));
const voucherKey = await createKeyPairFromPrivateKeyBytes(new Uint8Array(saved.voucherSeed));
const voucherSigner = await getAddressFromPublicKey(voucherKey.publicKey);

const pda = async (seed: string) => (await getProgramDerivedAddress({ programAddress: SCORE_PROGRAM_ADDRESS, seeds: [seed] }))[0];
const [custody, vault, treasury] = [await pda("custody"), await pda("vault"), await pda("treasury")];
const [userUsdc] = await findAssociatedTokenPda({ owner: user.address, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });

// ---- sending, as the relayer will: tight CU limit, a priority fee, fresh confirmed blockhash ----
async function build(ixs: Instruction[], cu: number) {
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(relayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units: cu }), getSetComputeUnitPriceInstruction({ microLamports: 10_000n }), ...ixs], m),
  );
  return signTransactionMessageWithSigners(msg);
}

// One long-lived subscription to our program's logs at `finalized`, as the chain watcher keeps.
const seen = new Map<string, number>();
const waiters = new Map<string, () => void>();
const logsAbort = new AbortController();
const logs = await subs.logsNotifications({ mentions: [SCORE_PROGRAM_ADDRESS] }, { commitment: "finalized" }).subscribe({ abortSignal: logsAbort.signal });
(async () => {
  for await (const n of logs) {
    seen.set(n.value.signature, performance.now());
    waiters.get(n.value.signature)?.();
  }
})().catch(() => {});

/** Send and resolve when the signature is finalized; also time when our program's log for it arrives. */
async function sendTimed(ixs: Instruction[], cu: number, label: string) {
  const tx = await build(ixs, cu);
  const sig = getSignatureFromTransaction(tx) as Signature;
  const abort = new AbortController();
  const fin = await subs.signatureNotifications(sig, { commitment: "finalized" }).subscribe({ abortSignal: abort.signal });
  const conf = await subs.signatureNotifications(sig, { commitment: "confirmed" }).subscribe({ abortSignal: abort.signal });
  const t0 = performance.now();
  await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", skipPreflight: true, maxRetries: 0n }).send();
  const row: Record<string, number | string> = { label };
  // Our own rebroadcast every 2 s until finalized (maxRetries 0, as the landing guide recommends).
  const rebroadcast = setInterval(() => rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", skipPreflight: true, maxRetries: 0n }).send().catch(() => {}), 2000);
  const until = (p: Promise<void>) => Promise.race([p, new Promise<void>((r) => setTimeout(r, 20_000))]);
  await until(
    Promise.all([
      (async () => { for await (const n of conf) { row.confirmed = Math.round(performance.now() - t0); if (n.value.err) row.err = JSON.stringify(n.value.err); break; } })(),
      (async () => { for await (const n of fin) { row.finalized = Math.round(performance.now() - t0); if (n.value.err) row.err = JSON.stringify(n.value.err); break; } })(),
      new Promise<void>((r) => {
        const done = () => { row.event = Math.round(seen.get(sig)! - t0); r(); };
        if (seen.has(sig)) done(); else waiters.set(sig, done);
      }),
    ]).then(() => {}),
  );
  clearInterval(rebroadcast);
  abort.abort();
  waiters.delete(sig);
  console.log(JSON.stringify({ ...row, sig: sig.slice(0, 10) }));
  return row;
}

async function sendPlain(ixs: Instruction[], cu: number) {
  const r = await sendTimed(ixs, cu, "setup");
  if (r.err || r.finalized === undefined) throw new Error(`setup tx failed: ${JSON.stringify(r)}`);
}

// ---- one-time setup ----
// This test talks to the program directly, bypassing the engine. On a deployment the backend
// (score-node) runs, that would leave the engine out of step, so refuse.
if (existsSync(".devnet/deployment.json")) {
  console.error("This deployment is run by the backend (score-node). Use `bun run e2e:backend` instead.");
  process.exit(1);
}
if (!(await fetchMaybeConfig(rpc, await pda("config"))).exists) {
  console.log("setup: mint, initialize, user token account, voucher page");
  const mintRent = await rpc.getMinimumBalanceForRentExemption(82n).send();
  await sendPlain(
    [
      getCreateAccountInstruction({ payer: relayer, newAccount: mint, lamports: mintRent, space: 82, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: relayer.address, freezeAuthority: null }),
    ],
    50_000,
  );
  const pendingRent = await rpc.getMinimumBalanceForRentExemption(PENDING_SPACE).send();
  const [programData] = await getProgramDerivedAddress({ programAddress: address("BPFLoaderUpgradeab1e11111111111111111111111"), seeds: [Uint8Array.from((await import("@solana/kit")).getAddressEncoder().encode(SCORE_PROGRAM_ADDRESS))] });
  await sendPlain(
    [
      getCreateAccountInstruction({ payer: relayer, newAccount: pending, lamports: pendingRent, space: PENDING_SPACE, programAddress: SCORE_PROGRAM_ADDRESS }),
      await getInitializeInstructionAsync({
        authority: relayer,
        programData,
        pending: pending.address,
        usdcMint: mint.address,
        admin: relayer.address,
        keys: { operator: relayer.address, voucherSigner, pauser: relayer.address },
        limits: { exposureCapMin: 1_000n * USDC, exposureCapBps: 200n, voucherMaxTtl: 300n, forcedDeadline: 86_400n, livenessDeadline: 3n * 86_400n },
      }),
    ],
    400_000,
  );
  await sendPlain(
    [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: relayer, owner: user.address, mint: mint.address }),
      getMintToInstruction({ mint: mint.address, token: userUsdc, mintAuthority: relayer, amount: 1_000n * USDC }),
      await getInitVoucherPageInstructionAsync({ payer: relayer, index: 0n }),
    ],
    100_000,
  );
}

// ---- timed: deposits ----
const results: Record<string, Record<string, number | string>[]> = { deposit: [], withdraw: [] };
for (let i = 0; i < N; i++) {
  const ix = getDepositInstruction({ user, pending: pending.address, userUsdc, custody, usdcMint: mint.address, amount: 10n * USDC });
  results.deposit.push(await sendTimed([ix], 15_000, "deposit"));
}

// ---- timed: voucher withdrawals (the engine's lock is in-process and takes microseconds) ----
let id = BigInt(saved.nextId); // fresh voucher ids every run (page 0 holds ids 0..8191)
saved.nextId += N;
writeFileSync(STATE_FILE, JSON.stringify(saved));
for (let i = 0; i < N; i++, id++) {
  const amount = 5n * USDC;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 120);
  const msg = new Uint8Array([
    ...new TextEncoder().encode("score:voucher:v1:"),
    ...(await import("@solana/kit")).getAddressEncoder().encode(SCORE_PROGRAM_ADDRESS),
    ...(await import("@solana/kit")).getAddressEncoder().encode(user.address),
    ...le64(amount), ...le64(id), ...le64(expiry),
  ]);
  const t = performance.now();
  const sigBytes = await signBytes(voucherKey.privateKey, msg);
  const signMs = performance.now() - t;
  const ed = ed25519Ix((await import("@solana/kit")).getAddressEncoder().encode(voucherSigner) as Uint8Array, sigBytes, msg);
  const w = getWithdrawInstruction({ user, pending: pending.address, page: await pda2("voucher_page", 0n), userUsdc, custody, usdcMint: mint.address, amount, id, expiry });
  const row = await sendTimed([ed, w], 30_000, "withdraw");
  row.permit_sign_ms = Math.round(signMs * 100) / 100;
  results.withdraw.push(row);
}

// ---- timed: one batch (operator = relayer here) ----
const st = (await fetchState(rpc, await pda("state"))).data;
const custodyBal = (await fetchToken(rpc, custody)).data.amount;
const batch = await sendTimed(
  [
    getCommitBatchInstruction({
      operator: relayer, custody, vault, treasury, usdcMint: mint.address,
      seq: BigInt(st.batchSeq) + 1n, prevStateRoot: st.stateRoot, stateRoot: new Uint8Array(32).fill(1), exitRoot: new Uint8Array(32), logHead: new Uint8Array(32),
      deposits: st.depositCount, depositHash: st.depositHash, payouts: st.payoutCount, payoutHash: st.payoutHash, forcedServed: st.forcedCount,
      liabilities: custodyBal, vaultArg: 0n, treasuryArg: 0n,
    }),
  ],
  20_000,
  "commit_batch",
);

const userBal = (await fetchToken(rpc, userUsdc)).data.amount;
console.log(`\nuser USDC now ${Number(userBal) / 1e6}, custody ${Number(custodyBal) / 1e6}, batch ${batch.err ? "FAILED " + batch.err : "ok"}`);
for (const [k, rows] of Object.entries(results)) {
  const ok = rows.filter((r) => !r.err && typeof r.finalized === "number");
  const med = (f: string) => {
    const xs = ok.map((r) => Number(r[f])).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    return xs.length ? `${xs[Math.floor(xs.length / 2)]} ms (min ${xs[0]}, max ${xs[xs.length - 1]})` : "n/a";
  };
  const missed = ok.filter((r) => r.event === undefined).length;
  console.log(`${k}: ${ok.length}/${rows.length} landed, ${missed} events missed by the log subscription | sent → confirmed ${med("confirmed")} | → finalized ${med("finalized")} | → event at watcher ${med("event")}`);
}
process.exit(0);

function le64(x: bigint) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, x, true);
  return b;
}
async function pda2(seed: string, index: bigint) {
  return (await getProgramDerivedAddress({ programAddress: SCORE_PROGRAM_ADDRESS, seeds: [seed, le64(index)] }))[0];
}
function ed25519Ix(pk: Uint8Array, sig: Uint8Array, msg: Uint8Array): Instruction {
  // One signature, all data inline (instruction indexes = u16::MAX), same layout as the program tests.
  const head = new Uint8Array(16);
  const v = new DataView(head.buffer);
  head[0] = 1;
  const off = [48, 0xffff, 16, 0xffff, 112, msg.length, 0xffff];
  off.forEach((x, i) => v.setUint16(2 + i * 2, x, true));
  return { programAddress: ED25519, accounts: [], data: new Uint8Array([...head, ...pk, ...sig, ...msg]) };
}
