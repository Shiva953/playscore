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

console.log("building score-node (release)…");
const b = spawnSync("cargo", ["build", "--release", "--manifest-path", "backend/Cargo.toml"], { stdio: "inherit" });
if (b.status !== 0) process.exit(b.status ?? 1);

run("node", "./backend/target/release/score-node", []);
await up("http://127.0.0.1:8787/v1/view/head");
run("oracle", "bun", ["services/oracle/main.ts"]);
await up("http://127.0.0.1:8788/v1/health");
if (!noBots) run("bots", "bun", ["scripts/sim-traders.ts"]);
console.log("\nbackend up: node http://127.0.0.1:8787 · oracle http://127.0.0.1:8788 · now run `bun run dev` for the app\n");
