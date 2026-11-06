// One-time, idempotent devnet setup: operator, relayer and voucher keys plus an admin token in
// .devnet/, funded from your CLI wallet; a test USDC mint; the program initialized with your CLI
// wallet as admin and pauser.
import { writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { address, getAddressEncoder, getProgramDerivedAddress, lamports } from "@solana/kit";
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction } from "@solana-program/token";
import { SCORE_PROGRAM_ADDRESS, fetchMaybeConfig, getInitializeInstructionAsync } from "../src/generated/score";
import { USDC, cliWallet, has, loadSigner, pda, rpc, send } from "./lib/devnet";

mkdirSync(".devnet", { recursive: true });
for (const name of ["operator", "relayer", "voucher", "mint", "pending"]) {
  const path = `.devnet/${name}.json`;
  if (!has(path)) await Bun.$`solana-keygen new --no-bip39-passphrase --silent -o ${path}`.quiet();
}
if (!has(".devnet/admin-token")) writeFileSync(".devnet/admin-token", randomBytes(24).toString("hex"));

const me = await cliWallet();
const [operator, relayer, voucher, mint, pending] = await Promise.all(["operator", "relayer", "voucher", "mint", "pending"].map((n) => loadSigner(`.devnet/${n}.json`)));
console.log(`program ${SCORE_PROGRAM_ADDRESS}\nadmin ${me.address}\noperator ${operator.address}\nrelayer ${relayer.address}\nvoucher signer ${voucher.address}`);

// Keep the operator and relayer funded (fees, voucher pages, ATAs for requests).
for (const who of [operator, relayer]) {
  const { value } = await rpc.getBalance(who.address, { commitment: "finalized" }).send();
  if (value < 500_000_000n) {
    await send(me, [getTransferSolInstruction({ source: me, destination: who.address, amount: lamports(1_000_000_000n - value) })], 10_000);
    console.log(`funded ${who.address} to 1 SOL`);
  }
}

const config = await fetchMaybeConfig(rpc, await pda(["config"]));
if (config.exists) {
  const k = config.data.keys;
  const ok = k.operator === operator.address && k.voucherSigner === voucher.address;
  console.log(ok ? "program already initialized with these keys" : "WARNING: program initialized with different keys than .devnet/");
  writeDeployment();
  process.exit(ok ? 0 : 1);
}

const mintRent = await rpc.getMinimumBalanceForRentExemption(82n).send();
await send(me, [
  getCreateAccountInstruction({ payer: me, newAccount: mint, lamports: mintRent, space: 82, programAddress: TOKEN_PROGRAM_ADDRESS }),
  getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: me.address, freezeAuthority: null }),
], 50_000);
console.log(`test USDC mint ${mint.address}`);

const PENDING_SPACE = 8n + 1024n * 40n + 1024n * 56n;
const pendingRent = await rpc.getMinimumBalanceForRentExemption(PENDING_SPACE).send();
const [programData] = await getProgramDerivedAddress({ programAddress: address("BPFLoaderUpgradeab1e11111111111111111111111"), seeds: [getAddressEncoder().encode(SCORE_PROGRAM_ADDRESS)] });
const { ms } = await send(me, [
  getCreateAccountInstruction({ payer: me, newAccount: pending, lamports: pendingRent, space: PENDING_SPACE, programAddress: SCORE_PROGRAM_ADDRESS }),
  await getInitializeInstructionAsync({
    authority: me,
    programData,
    pending: pending.address,
    usdcMint: mint.address,
    admin: me.address,
    keys: { operator: operator.address, voucherSigner: voucher.address, pauser: me.address },
    limits: { exposureCapMin: 1_000n * USDC, exposureCapBps: 200n, voucherMaxTtl: 300n, forcedDeadline: 86_400n, livenessDeadline: 3n * 86_400n },
  }),
], 400_000);
console.log(`initialized in ${Math.round(ms)} ms`);
writeDeployment();

function writeDeployment() {
  writeFileSync(".devnet/deployment.json", JSON.stringify({ program: SCORE_PROGRAM_ADDRESS, mint: mint.address, pending: pending.address, admin: me.address }, null, 2));
}
