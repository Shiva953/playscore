// One-time devnet setup for the app: a faucet key in .devnet/faucet.json becomes the test USDC mint
// authority (signed by your CLI wallet, the current authority) and gets a little SOL for the token
// accounts it creates. Safe to re-run.   bun run devnet:faucet-setup
import { writeFileSync } from "node:fs";
import { createKeyPairFromPrivateKeyBytes, createKeyPairSignerFromBytes, lamports, type Address } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { AuthorityType, fetchMint, getSetAuthorityInstruction } from "@solana-program/token";
import { cliWallet, has, loadSigner, rpc, send } from "./lib/devnet";

const PATH = ".devnet/faucet.json";
if (!has(PATH)) {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const kp = await createKeyPairFromPrivateKeyBytes(seed, true);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  writeFileSync(PATH, JSON.stringify([...seed, ...pub]));
  await createKeyPairSignerFromBytes(new Uint8Array([...seed, ...pub]));
}
const faucet = await loadSigner(PATH);
const me = await cliWallet();
const dep = JSON.parse(await Bun.file(".devnet/deployment.json").text());
const mint = await fetchMint(rpc, dep.mint as Address);
const authority = mint.data.mintAuthority.__option === "Some" ? mint.data.mintAuthority.value : null;
console.log(`faucet ${faucet.address}`);
if (authority === faucet.address) {
  console.log("mint authority already the faucet");
} else if (authority === me.address) {
  const { sig } = await send(me, [getSetAuthorityInstruction({ owned: dep.mint as Address, owner: me, authorityType: AuthorityType.MintTokens, newAuthority: faucet.address })], 20_000);
  console.log(`mint authority moved to the faucet: ${sig}`);
} else {
  throw new Error(`mint authority is ${authority}, not your CLI wallet or the faucet`);
}
const bal = (await rpc.getBalance(faucet.address).send()).value;
if (bal < 500_000_000n) {
  const { sig } = await send(me, [getTransferSolInstruction({ source: me, destination: faucet.address, amount: lamports(1_000_000_000n - bal) })], 10_000);
  console.log(`funded the faucet with SOL: ${sig}`);
}
console.log("done");
