import { describe, expect, it } from "vitest";
import { encodeCmd, type Cmd } from "./commands";

// Printed by the engine: `cd engine && cargo run --release --example golden_cmds`.
const GOLDEN: Record<string, string> = {
  "LockWithdraw": "020707070707070707070707070707070707070707070707070707070707070707030000000000000080f0fa02000000000c0000000000000000d2496b00000000",
  "BuyCurve": "03070707070707070707070707070707070707070707070707070707070707070701000000000000000900000000e1f505000000000100000000000000",
  "SellCurve": "04070707070707070707070707070707070707070707070707070707070707070702000000000000000900000088130000000000000000000000000000",
  "Buy": "050707070707070707070707070707070707070707070707070707070707070707040000000000000009000000002d31010000000000000000000000000000000000000000",
  "Sell": "06070707070707070707070707070707070707070707070707070707070707070705000000000000000900000040420f000000000000000000000000007b00000000000000",
  "PlaceOrder": "0707070707070707070707070707070707070707070707070707070707070707070600000000000000090000000100093d00000000004d0000000000000001",
  "CancelOrder": "08070707070707070707070707070707070707070707070707070707070707070707000000000000000500000000000000",
  "AddLiquidity": "090707070707070707070707070707070707070707070707070707070707070707080000000000000009000000000000000000000000000000000000008096980000000000e70300000000000005000000000000004000000000000000",
  "RemoveLiquidity": "0a0707070707070707070707070707070707070707070707070707070707070707090000000000000004000000000000000000000000000000020000000000000000000000000000000000000000000000",
  "Claim": "0b07070707070707070707070707070707070707070707070707070707070707070a00000000000000020000000900000000",
  "ListPlayer": "0d09000000",
  "PublishCalendar": "0e0200000000d2496b00000000",
  "Snapshot": "0f02000000",
  "RoundResult": "100200000002000000090000000065cd1d000000000a0000000100000000000000"
};

const u = new Uint8Array(32).fill(7);
const samples: Record<string, Cmd> = {
  LockWithdraw: { LockWithdraw: { user: u, nonce: 3n, amount: 50_000_000n, id: 12n, expiry: 1_800_000_000n } },
  BuyCurve: { BuyCurve: { user: u, nonce: 1n, player: 9, usdcIn: 100_000_000n, minTokens: 1n } },
  SellCurve: { SellCurve: { user: u, nonce: 2n, player: 9, tokens: 5_000n, minUsdc: 0n } },
  Buy: { Buy: { user: u, nonce: 4n, player: 9, usdcIn: 20_000_000n, minTokens: 0n, limitPx: 0n } },
  Sell: { Sell: { user: u, nonce: 5n, player: 9, tokensIn: 1_000_000n, minUsdc: 0n, limitPx: 123n } },
  PlaceOrder: { PlaceOrder: { user: u, nonce: 6n, player: 9, side: "ask", px: 4_000_000n, amount: 77n, postOnly: true } },
  CancelOrder: { CancelOrder: { user: u, nonce: 7n, order: 5n } },
  AddLiquidity: { AddLiquidity: { user: u, nonce: 8n, player: 9, lowerPx: 0n, upperPx: 0n, maxUsdc: 10_000_000n, maxTokens: 999n, minLiquidity: (1n << 70n) + 5n } },
  RemoveLiquidity: { RemoveLiquidity: { user: u, nonce: 9n, position: 4n, liquidity: 1n << 65n, minUsdc: 0n, minTokens: 0n } },
  Claim: { Claim: { user: u, nonce: 10n, round: 2, player: 9, takeTokens: false } },
  ListPlayer: { ListPlayer: { player: 9 } },
  PublishCalendar: { PublishCalendar: { round: 2, lockTs: 1_800_000_000n } },
  Snapshot: { Snapshot: { round: 2 } },
  RoundResult: { RoundResult: { round: 2, payouts: [[9, 500_000_000n], [10, 1n]] } },
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("engine command encoding", () => {
  for (const [name, cmd] of Object.entries(samples)) {
    it(`${name} matches the engine's bytes`, () => {
      expect(hex(encodeCmd(cmd))).toBe(GOLDEN[name]);
    });
  }
});
