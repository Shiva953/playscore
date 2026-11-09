/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from score-node / the oracle, shaped at the point of use */
// Client for score-node, shared by the app (browser), the bot traders and the oracle (Bun).
// Commands are signed by the user's wallet key over the exact engine bytes; deposits and
// withdrawals are Solana transactions the user signs and our relayer co-signs as fee payer, so
// users never need SOL.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getAddressEncoder,
  getBase64Decoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  type Address,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
  type SignatureBytes,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getDepositInstruction, getRequestWithdrawalInstruction, getWithdrawInstruction, SCORE_PROGRAM_ADDRESS } from "@/generated/score";
import { getProgramDerivedAddress } from "@solana/kit";
import { encodeCmd, orderMessage, type Cmd } from "./commands";

/** The user's wallet, as the API needs it. Privy, Phantom and plain keypairs all fit. */
export interface ScoreSigner {
  address: string;
  /** ed25519 signature over `bytes` (a command's order message). */
  signMessage(bytes: Uint8Array): Promise<Uint8Array>;
  /** Add the user's signature to a wire transaction whose fee payer is the relayer. */
  signTransaction(wire: Uint8Array): Promise<Uint8Array>;
}

export interface NodeInfo {
  program: string;
  relayer: string;
  operator: string;
  voucherSigner: string;
  usdcMint: string;
  custody: string;
  vault: string;
  treasury: string;
  pending: string;
  voucherMaxTtl: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Engine error name when the engine refused the command (e.g. "Slippage"). */
    readonly code: string | null
  ) {
    super(message);
  }
}

const enc = getAddressEncoder();
export const addressBytes = (a: string): Uint8Array => Uint8Array.from(enc.encode(a as Address));
const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const le64 = (x: bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, x, true);
  return b;
};
export async function ataOf(owner: string, mint: string): Promise<Address> {
  const [a] = await findAssociatedTokenPda({ owner: owner as Address, mint: mint as Address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return a;
}

/** A plain keypair as a ScoreSigner (bots, scripts, the dev burner wallet). */
export function keypairSigner(kp: KeyPairSigner): ScoreSigner {
  return {
    address: kp.address,
    signMessage: async (bytes) => new Uint8Array(await signBytes(kp.keyPair.privateKey, bytes)),
    signTransaction: async (wire) => {
      const tx = getTransactionDecoder().decode(wire);
      const sig = await signBytes(kp.keyPair.privateKey, tx.messageBytes as unknown as Uint8Array);
      const signed = { ...tx, signatures: { ...tx.signatures, [kp.address]: sig as SignatureBytes } };
      return new Uint8Array(getTransactionEncoder().encode(signed));
    },
  };
}

/** Engine error name from the API's "{error}" text, e.g. "Slippage" or "AccountLimit". */
function engineCode(msg: string): string | null {
  const m = msg.match(/^([A-Z][A-Za-z]+)$/);
  return m ? m[1]! : null;
}

export class NodeApi {
  private infoP: Promise<NodeInfo> | null = null;
  /** Last nonce used per user, so quick successive orders don't reuse one. */
  private nonces = new Map<string, bigint>();
  /** One command at a time per user: nonces must reach the engine in order. */
  private queues = new Map<string, Promise<unknown>>();

  constructor(readonly base: string) {}

  async get<T = any>(path: string): Promise<T> {
    return this.req<T>(path);
  }
  async post<T = any>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    return this.req<T>(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) });
  }
  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${this.base}${path}`, init);
    } catch {
      throw new ApiError("Can't reach the score server. Check your connection and try again.", 0, "NETWORK");
    }
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) {
      const msg = String(j.error ?? `HTTP ${r.status}`);
      throw new ApiError(msg, r.status, engineCode(msg));
    }
    return j as T;
  }

  info(): Promise<NodeInfo> {
    this.infoP ??= this.get<NodeInfo>("/v1/info").catch((e) => {
      this.infoP = null;
      throw e;
    });
    return this.infoP;
  }

  /** Warms the info and blockhash caches, so two transactions can be built without a round trip each. */
  async ready(): Promise<void> {
    await Promise.all([this.info(), this.blockhash()]);
  }

  /** The nonce the next command will use (after `ready()` it is known without a request). */
  nonceFor(user: string): bigint {
    return this.nonces.get(user) ?? 0n;
  }

  private serial<T>(user: string, f: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(user) ?? Promise.resolve();
    const next = prev.then(f, f);
    this.queues.set(
      user,
      next.catch(() => {})
    );
    return next;
  }

  private async nextNonce(user: string): Promise<bigint> {
    const acct = await this.get<{ nonce: number }>(`/v1/users/${user}`);
    const server = BigInt(acct.nonce);
    const local = this.nonces.get(user) ?? 0n;
    const n = (server > local ? server : local) + 1n;
    this.nonces.set(user, n);
    return n;
  }

  /**
   * Sign and submit one command. `make` receives the nonce. Retries once with a fresh nonce if
   * another tab or device used ours. Returns the log sequence number and the engine's outcome.
   */
  /**
   * Sign a command now and send it later: `send()` takes no new round trip once warm. Used where the
   * result can be shown optimistically (a claim the engine can't refuse), so the UI answers instantly.
   */
  prepare(signer: ScoreSigner, make: (nonce: bigint) => Cmd): Promise<() => Promise<{ seq: number; outcome: any }>> {
    return this.serial(signer.address, async () => {
      const cmd = make(await this.nextNonce(signer.address));
      const sig = await signer.signMessage(orderMessage(cmd));
      return () => this.post<{ seq: number; outcome: any }>("/v1/cmd", { cmd: b64(encodeCmd(cmd)), sig: b64(sig) });
    });
  }

  submit(signer: ScoreSigner, make: (nonce: bigint) => Cmd): Promise<{ seq: number; outcome: any }> {
    return this.serial(signer.address, async () => {
      for (let attempt = 0; ; attempt++) {
        const cmd = make(await this.nextNonce(signer.address));
        const sig = await signer.signMessage(orderMessage(cmd));
        try {
          return await this.post<{ seq: number; outcome: any }>("/v1/cmd", { cmd: b64(encodeCmd(cmd)), sig: b64(sig) });
        } catch (e) {
          if (attempt === 0 && e instanceof ApiError && e.code === "BadNonce") {
            this.nonces.delete(signer.address);
            continue;
          }
          throw e;
        }
      }
    });
  }

  /** A blockhash lasts ~150 slots; reuse one for 20s so back-to-back transactions skip a round trip. */
  private bh: { blockhash: string; lastValidBlockHeight: number; at: number } | null = null;
  private blockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    if (this.bh && Date.now() - this.bh.at < 20_000) return Promise.resolve(this.bh);
    return this.get<{ blockhash: string; lastValidBlockHeight: number }>("/v1/blockhash").then((b) => {
      this.bh = { ...b, at: Date.now() };
      return b;
    });
  }

  private async userTx(user: string, ixs: Instruction[], cu: number, reserved?: bigint): Promise<Uint8Array> {
    const info = await this.info();
    const bh = await this.blockhash();
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(info.relayer as Address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as Blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
      (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units: cu }), getSetComputeUnitPriceInstruction({ microLamports: 20_000n }), ...ixs], m)
    );
    return new Uint8Array(getTransactionEncoder().encode(compileTransaction(msg)));
  }

  private async relay(wire: Uint8Array): Promise<string> {
    const { signature } = await this.post<{ signature: string }>("/v1/relay", { tx: b64(wire) });
    return signature;
  }

  /**
   * Send `amount` (base units) of test USDC from the user's wallet to another address. The relayer pays
   * the fee and, when `createAccount`, the recipient's token account rent (rate-limited). Returns the
   * transaction signature.
   */
  async send(signer: ScoreSigner, to: string, amount: bigint, createAccount: boolean, nonce?: bigint): Promise<string> {
    const info = await this.info();
    const user = createNoopSigner(signer.address as Address);
    const mint = info.usdcMint as Address;
    const dest = await ataOf(to, mint);
    const ixs: Instruction[] = [];
    if (createAccount) ixs.push(getCreateAssociatedTokenIdempotentInstruction({ payer: createNoopSigner(info.relayer as Address), ata: dest, owner: to as Address, mint }));
    ixs.push(getTransferCheckedInstruction({ source: await ataOf(signer.address, mint), mint, destination: dest, authority: user, amount, decimals: 6 }));
    const wire = await signer.signTransaction(await this.userTx(signer.address, ixs, 40_000, nonce));
    return this.relay(wire);
  }

  /** Move `amount` (base units) of USDC from the wallet into the app. Returns the transaction signature. */
  async deposit(signer: ScoreSigner, amount: bigint): Promise<string> {
    const info = await this.info();
    const user = createNoopSigner(signer.address as Address);
    const ix = getDepositInstruction({ user, pending: info.pending as Address, userUsdc: await ataOf(signer.address, info.usdcMint), custody: info.custody as Address, usdcMint: info.usdcMint as Address, amount });
    const wire = await signer.signTransaction(await this.userTx(signer.address, [ix], 20_000));
    return this.relay(wire);
  }

  /**
   * Withdraw `amount` to the wallet: the engine puts it on hold, our voucher key signs a permit,
   * and the user's transaction redeems it. Over the instant cap it becomes a request, paid after
   * the next batch. Returns the mode and the transaction signature.
   *
   * `to` pays it straight on to another address in the same transaction (instant mode only): the
   * program pays custody → the user's own token account, then one `TransferChecked` moves it on. The
   * whole transaction reverts if either step fails, so it's all or nothing like a single send.
   */
  withdraw(signer: ScoreSigner, amount: bigint, opts: { to?: string; createAccount?: boolean; nonce?: bigint } = {}): Promise<{ mode: "instant" | "request"; signature: string }> {
    return this.serial(signer.address, async () => {
      const info = await this.info();
      const prep = await this.post<{ id: number; expiry: number; page: string; mode: string }>("/v1/withdraw/prepare", { amount: Number(amount) });
      const lock: Cmd = { LockWithdraw: { user: addressBytes(signer.address), nonce: opts.nonce ?? (await this.nextNonce(signer.address)), amount, id: BigInt(prep.id), expiry: BigInt(prep.expiry) } };
      const sig = await signer.signMessage(orderMessage(lock));
      const permit = await this.post<{ mode: "instant" | "request"; voucherSig: string }>("/v1/withdraw", { cmd: b64(encodeCmd(lock)), sig: b64(sig) });
      const msg = new Uint8Array([...new TextEncoder().encode("score:voucher:v1:"), ...addressBytes(info.program), ...addressBytes(signer.address), ...le64(amount), ...le64(BigInt(prep.id)), ...le64(BigInt(prep.expiry))]);
      const ed = ed25519Ix(addressBytes(info.voucherSigner), fromB64(permit.voucherSig), msg);
      const user = createNoopSigner(signer.address as Address);
      const common = { user, pending: info.pending as Address, page: prep.page as Address, amount, id: BigInt(prep.id), expiry: BigInt(prep.expiry) };
      const ix =
        permit.mode === "instant"
          ? getWithdrawInstruction({ ...common, userUsdc: await ataOf(signer.address, info.usdcMint), custody: info.custody as Address, usdcMint: info.usdcMint as Address })
          : getRequestWithdrawalInstruction({ ...common, payer: createNoopSigner(info.relayer as Address), withdrawRequest: (await getProgramDerivedAddress({ programAddress: SCORE_PROGRAM_ADDRESS, seeds: ["withdraw_request", le64(BigInt(prep.id))] }))[0] });
      const ixs: Instruction[] = [ed, ix];
      // Pay it straight on: the recipient's account first (the relayer funds its rent, as for a send),
      // then the transfer out of the account the withdraw just filled.
      if (opts.to && permit.mode === "instant") {
        const dest = await ataOf(opts.to, info.usdcMint);
        if (opts.createAccount) ixs.push(getCreateAssociatedTokenIdempotentInstruction({ payer: createNoopSigner(info.relayer as Address), ata: dest, owner: opts.to as Address, mint: info.usdcMint as Address }));
        ixs.push(getTransferCheckedInstruction({ source: await ataOf(signer.address, info.usdcMint), mint: info.usdcMint as Address, destination: dest, authority: user, amount, decimals: 6 }));
      }
      const wire = await signer.signTransaction(await this.userTx(signer.address, ixs, opts.to ? 70_000 : 40_000));
      return { mode: permit.mode, signature: await this.relay(wire) };
    });
  }

  /** Oracle / admin channel (devnet tools and the oracle service only). */
  admin(token: string, cmd: Cmd): Promise<{ seq: number; outcome: any }> {
    return this.post("/v1/admin/cmd", { cmd: b64(encodeCmd(cmd)) }, { "x-admin-token": token });
  }
}

function ed25519Ix(pk: Uint8Array, sig: Uint8Array, msg: Uint8Array): Instruction {
  const head = new Uint8Array(16);
  const v = new DataView(head.buffer);
  head[0] = 1;
  [48, 0xffff, 16, 0xffff, 112, msg.length, 0xffff].forEach((x, i) => v.setUint16(2 + i * 2, x, true));
  return { programAddress: "Ed25519SigVerify111111111111111111111111111" as Address, accounts: [], data: new Uint8Array([...head, ...pk, ...sig, ...msg]) };
}

export const toBase64 = b64;
export const fromBase64 = fromB64;
export { getBase64Decoder };
