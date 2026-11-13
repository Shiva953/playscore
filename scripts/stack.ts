// The devnet backend in one command: score-node (engine, read model, relayer, chain watcher, batch
// committer), the oracle (listings, rounds, faucet) and the simulated traders. Ctrl+C stops all three.
//   bun run stack            (then `bun run dev` for the app)
//   bun run stack --no-bots
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const noBots = process.argv.includes("--no-bots");
const COLORS = { node: "36", oracle: "35", bots: "33" } as const;
const kids: ChildProcess[] = [];

function run(name: keyof typeof COLORS, cmd: string, args: string[], env: Record<string, string> = {}) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `\x1b[${COLORS[name]}m${name.padEnd(6)}\x1b[0m │ `;
  const out = (d: Buffer) => process.stdout.write(d.toString().split("\n").filter(Boolean).map((l) => tag + l).join("\n") + "\n");
  p.stdout!.on("data", out);
  p.stderr!.on("data", out);
  p.on("exit", (code) => {
    console.log(`${tag}exited (${code})`);
    if (!stopping) stop(1);
  });
  kids.push(p);
}

async function up(url: string, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} didn't come up`);
}

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const k of kids) k.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

// A local score-node must never run against a shared cluster. `program::program_id()` is compiled in
// (score::ID), and Anchor.toml gives localnet and devnet the same program ID, so the config/state/
// custody/vault PDAs are the *same accounts* prod uses on devnet. A local committer also signs with the
// same operator key, so it would append batches to prod's chain instead of a throwaway ledger.
// Local dev on devnet talks to the deployed backend instead (NEXT_PUBLIC_SCORE_NODE) — see README.
const RPC = process.env.DEVNET_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC_DEVNET || "";
if (RPC && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(RPC)) {
  console.error(
    `\x1b[31mrefusing to start a local backend\x1b[0m\n` +
      `NEXT_PUBLIC_SOLANA_RPC_DEVNET points at ${new URL(RPC).host}, not a local validator.\n` +
      `This node would commit to the shared cluster with prod's operator key and PDAs.\n\n` +
      `For local dev on devnet, skip this script and point the app at the deployed backend:\n` +
      `  NEXT_PUBLIC_SCORE_NODE=https://score-node-production.up.railway.app\n` +
      `  NEXT_PUBLIC_SCORE_ORACLE=https://score-oracle-production.up.railway.app\n` +
      `For a throwaway chain, run a local validator and set the RPC to http://127.0.0.1:8899.`,
  );
  process.exit(1);
}

console.log("building score-node (release)…");
const b = spawnSync("cargo", ["build", "--release", "--manifest-path", "backend/Cargo.toml"], { stdio: "inherit" });
if (b.status !== 0) process.exit(b.status ?? 1);

run("node", "./backend/target/release/score-node", []);
await up("http://127.0.0.1:8787/v1/view/head");
run("oracle", "bun", ["services/oracle/main.ts"]);
await up("http://127.0.0.1:8788/v1/health");
if (!noBots) run("bots", "bun", ["scripts/sim-traders.ts"]);
console.log("\nbackend up: node http://127.0.0.1:8787 · oracle http://127.0.0.1:8788 · now run `bun run dev` for the app\n");
