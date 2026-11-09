// Devnet faucet: mints test USDC straight to a wallet (creating its token account), paid by the
// faucet key, which holds the test mint's authority (bun run devnet:faucet-setup). The app then
// deposits it like any other USDC.
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { getCreateAssociatedTokenIdempotentInstructionAsync, getMintToInstruction } from "@solana-program/token";
import { readFileSync } from "node:fs";
import { ataOf } from "@/lib/score-api/node";

const RPC_URL = process.env.DEVNET_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC_DEVNET || "https://api.devnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);
let signer: Promise<KeyPairSigner> | null = null;
const faucetKey = () => (signer ??= createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(".devnet/faucet.json", "utf8")))));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mint `amount` base units to `owner`'s USDC account; resolves once confirmed. */
export async function mintTo(mint: string, owner: string, amount: bigint): Promise<string> {
  const payer = await faucetKey();
  const token = await ataOf(owner, mint);
  const ixs = [
    getSetComputeUnitLimitInstruction({ units: 60_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 50_000n }),
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: owner as Address, mint: mint as Address }),
    getMintToInstruction({ mint: mint as Address, token, mintAuthority: payer, amount }),
  ];
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(ixs, m)
  );
  const tx = await signTransactionMessageWithSigners(msg);
  const wire = getBase64EncodedWireTransaction(tx);
  const sig = getSignatureFromTransaction(tx);
  const send = () => rpc.sendTransaction(wire, { encoding: "base64", skipPreflight: true, maxRetries: 0n }).send();
  await send();
  const t0 = Date.now();
  let last = t0;
  while (Date.now() - t0 < 45_000) {
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    const s = value[0];
    if (s?.err) throw new Error(`faucet transaction failed: ${JSON.stringify(s.err, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    if (Date.now() - last > 2_000) {
      await send().catch(() => {});
      last = Date.now();
    }
    await sleep(250);
  }
  throw new Error("faucet transaction not confirmed in 45 s");
}
