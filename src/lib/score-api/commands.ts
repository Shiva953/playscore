// Engine commands, encoded exactly as the engine's `borsh(Cmd)` (the bytes a user signs).
// Variant order and field order mirror `engine/score-engine/src/types.rs`; `commands.test.ts`
// checks them against golden vectors printed by the engine itself.

export type Key = Uint8Array; // 32-byte ed25519 public key
export type Side = "bid" | "ask";

export type Cmd =
  | { LockWithdraw: { user: Key; nonce: bigint; amount: bigint; id: bigint; expiry: bigint } }
  | { BuyCurve: { user: Key; nonce: bigint; player: number; usdcIn: bigint; minTokens: bigint } }
  | { SellCurve: { user: Key; nonce: bigint; player: number; tokens: bigint; minUsdc: bigint } }
  | { Buy: { user: Key; nonce: bigint; player: number; usdcIn: bigint; minTokens: bigint; limitPx: bigint } }
  | { Sell: { user: Key; nonce: bigint; player: number; tokensIn: bigint; minUsdc: bigint; limitPx: bigint } }
  | { PlaceOrder: { user: Key; nonce: bigint; player: number; side: Side; px: bigint; amount: bigint; postOnly: boolean } }
  | { CancelOrder: { user: Key; nonce: bigint; order: bigint } }
  | { AddLiquidity: { user: Key; nonce: bigint; player: number; lowerPx: bigint; upperPx: bigint; maxUsdc: bigint; maxTokens: bigint; minLiquidity: bigint } }
  | { RemoveLiquidity: { user: Key; nonce: bigint; position: bigint; liquidity: bigint; minUsdc: bigint; minTokens: bigint } }
  | { Claim: { user: Key; nonce: bigint; round: number; player: number; takeTokens: boolean } }
  | { ClaimAll: { user: Key; nonce: bigint; takeTokens: boolean } }
  | { ListPlayer: { player: number } }
  | { PublishCalendar: { round: number; lockTs: bigint } }
  | { Snapshot: { round: number } }
  | { RoundResult: { round: number; payouts: [number, bigint][] } };

const VARIANT: Record<string, number> = {
  LockWithdraw: 2,
  BuyCurve: 3,
  SellCurve: 4,
  Buy: 5,
  Sell: 6,
  PlaceOrder: 7,
  CancelOrder: 8,
  AddLiquidity: 9,
  RemoveLiquidity: 10,
  Claim: 11,
  ListPlayer: 13,
  PublishCalendar: 14,
  Snapshot: 15,
  RoundResult: 16,
  ClaimAll: 25,
};

class W {
  b: number[] = [];
  u8(x: number) { this.b.push(x & 0xff); }
  bool(x: boolean) { this.u8(x ? 1 : 0); }
  uint(x: bigint, bytes: number) {
    if (x < 0n || x >= 1n << BigInt(bytes * 8)) throw new Error(`value ${x} out of range for ${bytes * 8} bits`);
    for (let i = 0; i < bytes; i++) this.b.push(Number((x >> BigInt(8 * i)) & 0xffn));
  }
  u32(x: number) { this.uint(BigInt(x), 4); }
  u64(x: bigint) { this.uint(x, 8); }
  u128(x: bigint) { this.uint(x, 16); }
  i64(x: bigint) { this.uint(BigInt.asUintN(64, x), 8); }
  key(k: Key) {
    if (k.length !== 32) throw new Error("key must be 32 bytes");
    this.b.push(...k);
  }
}

export function encodeCmd(cmd: Cmd): Uint8Array {
  const name = Object.keys(cmd)[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one variant's fields, checked per case below
  const v = (cmd as Record<string, any>)[name];
  const w = new W();
  w.u8(VARIANT[name] ?? (() => { throw new Error(`unknown command ${name}`); })());
  switch (name) {
    case "LockWithdraw": w.key(v.user); w.u64(v.nonce); w.u64(v.amount); w.u64(v.id); w.i64(v.expiry); break;
    case "BuyCurve": w.key(v.user); w.u64(v.nonce); w.u32(v.player); w.u64(v.usdcIn); w.u64(v.minTokens); break;
    case "SellCurve": w.key(v.user); w.u64(v.nonce); w.u32(v.player); w.u64(v.tokens); w.u64(v.minUsdc); break;
    case "Buy": w.key(v.user); w.u64(v.nonce); w.u32(v.player); w.u64(v.usdcIn); w.u64(v.minTokens); w.u64(v.limitPx); break;
    case "Sell": w.key(v.user); w.u64(v.nonce); w.u32(v.player); w.u64(v.tokensIn); w.u64(v.minUsdc); w.u64(v.limitPx); break;
    case "PlaceOrder": w.key(v.user); w.u64(v.nonce); w.u32(v.player); w.u8(v.side === "bid" ? 0 : 1); w.u64(v.px); w.u64(v.amount); w.bool(v.postOnly); break;
    case "CancelOrder": w.key(v.user); w.u64(v.nonce); w.u64(v.order); break;
    case "AddLiquidity": w.key(v.user); w.u64(v.nonce); w.u32(v.player); w.u64(v.lowerPx); w.u64(v.upperPx); w.u64(v.maxUsdc); w.u64(v.maxTokens); w.u128(v.minLiquidity); break;
    case "RemoveLiquidity": w.key(v.user); w.u64(v.nonce); w.u64(v.position); w.u128(v.liquidity); w.u64(v.minUsdc); w.u64(v.minTokens); break;
    case "Claim": w.key(v.user); w.u64(v.nonce); w.u32(v.round); w.u32(v.player); w.bool(v.takeTokens); break;
    case "ClaimAll": w.key(v.user); w.u64(v.nonce); w.bool(v.takeTokens); break;
    case "ListPlayer": w.u32(v.player); break;
    case "PublishCalendar": w.u32(v.round); w.i64(v.lockTs); break;
    case "Snapshot": w.u32(v.round); break;
    case "RoundResult":
      w.u32(v.round);
      w.u32(v.payouts.length);
      for (const [p, amt] of v.payouts) { w.u32(p); w.u64(amt); }
      break;
  }
  return Uint8Array.from(w.b);
}

export const ORDER_DOMAIN = new TextEncoder().encode("score:order:v1:");

/** The exact bytes a user signs for a command. */
export function orderMessage(cmd: Cmd): Uint8Array {
  const body = encodeCmd(cmd);
  const m = new Uint8Array(ORDER_DOMAIN.length + body.length);
  m.set(ORDER_DOMAIN);
  m.set(body, ORDER_DOMAIN.length);
  return m;
}
