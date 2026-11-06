// Shared devnet helpers for the scripts: RPC from env, keys from .devnet/, send-until-finalized.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { SCORE_PROGRAM_ADDRESS } from "../../src/generated/score";

export const RPC_URL = process.env.DEVNET_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC_DEVNET || "";
if (!RPC_URL) {
  console.error("No devnet RPC URL. Set NEXT_PUBLIC_SOLANA_RPC_DEVNET in .env.local (or DEVNET_RPC) to your Helius devnet URL.");
  process.exit(1);
}
export const rpc = createSolanaRpc(RPC_URL);
export const USDC = 1_000_000n;

export async function loadSigner(path: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, "utf8"))));
}
export const cliWallet = () => loadSigner(`${homedir()}/.config/solana/id.json`);
export const has = (path: string) => existsSync(path);

export async function pda(seeds: (string | Uint8Array)[]): Promise<Address> {
  return (await getProgramDerivedAddress({ programAddress: SCORE_PROGRAM_ADDRESS, seeds }))[0];
}

export function le64(x: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, x, true);
  return b;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sign with every signer in the instructions, send (rebroadcast every 2 s), resolve at finalized. */
export async function send(payer: KeyPairSigner, ixs: Instruction[], cu = 200_000): Promise<{ sig: string; ms: number }> {
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units: cu }), getSetComputeUnitPriceInstruction({ microLamports: 20_000n }), ...ixs], m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  const wire = getBase64EncodedWireTransaction(tx);
  const sig = getSignatureFromTransaction(tx);
  const t0 = performance.now();
  await rpc.sendTransaction(wire, { encoding: "base64", skipPreflight: true, maxRetries: 0n }).send();
  return { sig, ms: await waitFinalized(sig, t0, () => rpc.sendTransaction(wire, { encoding: "base64", skipPreflight: true, maxRetries: 0n }).send()) };
}

export async function waitFinalized(sig: string, t0 = performance.now(), resend?: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  while (performance.now() - t0 < 60_000) {
    const { value } = await rpc.getSignatureStatuses([sig as any]).send();
    const s = value[0];
    if (s?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(s.err, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    if (s?.confirmationStatus === "finalized") return performance.now() - t0;
    if (!s && resend && performance.now() - last > 2000) {
      await resend().catch(() => {});
      last = performance.now();
    }
    await sleep(120);
  }
  throw new Error(`transaction ${sig} not finalized after 60 s`);
}
