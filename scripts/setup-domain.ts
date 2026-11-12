#!/usr/bin/env bun
/**
 * Point a domain at the linked Vercel project, then set its production env vars.
 *
 *   bun scripts/setup-domain.ts --dry-run          # show the plan, touch nothing
 *   bun scripts/setup-domain.ts                    # attach apex + www, redirect www -> apex
 *   bun scripts/setup-domain.ts --deploy           # ...and cut a new production deployment
 *
 * Production env: the app points at the Railway backend (score-node / score-oracle, defaults below),
 * devnet Helius RPC, Privy app id and the site URL. Loopback values in .env.local are never shipped.
 * Override with NODE_URL / ORACLE_URL / PROD_RPC.
 *
 * Auth: VERCEL_TOKEN from the environment, else the Vercel CLI's own session
 * (~/Library/Application Support/com.vercel.cli/auth.json and friends).
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APEX = "playscore.fun";
const WWW = `www.${APEX}`;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");
const dryRun = args.includes("--dry-run");
const deploy = args.includes("--deploy");

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

if (help) {
  console.log(`bun scripts/setup-domain.ts [--dry-run] [--deploy]

  Attaches ${APEX} and ${WWW} to the project in .vercel/project.json,
  makes ${WWW} a 301 to ${APEX}, and upserts production env vars.

  --dry-run   print the plan only
  --deploy    run a production redeploy afterwards (needed after env changes)

  Env vars read from the environment or .env.local:
    NODE_URL     (default https://score-node-production.up.railway.app)
    ORACLE_URL   (default https://score-oracle-production.up.railway.app)
    PROD_RPC     (default DEVNET_HELIUS_RPC from .env.local)
    NEXT_PUBLIC_SITE_URL     (defaults to https://${APEX})
    NEXT_PUBLIC_PRIVY_APP_ID`);
  process.exit(0);
}

// ---------------------------------------------------------------- config

const projectFile = join(ROOT, ".vercel", "project.json");
if (!existsSync(projectFile)) {
  console.error(c.red(`No .vercel/project.json in ${ROOT}.`), "Run `bunx vercel link` first.");
  process.exit(1);
}
const project = JSON.parse(readFileSync(projectFile, "utf8")) as {
  projectId: string;
  orgId: string;
  projectName?: string;
};
const projectRef = project.projectId || (project.projectName as string);
const teamId = project.orgId;

/** .env.local values are a fallback only; a real env var always wins. */
function loadDotEnvLocal(): Record<string, string> {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const dotenv = loadDotEnvLocal();
const pick = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n] ?? dotenv[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
};

function findToken(): string | undefined {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim();
  const candidates = [
    join(homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"),
    join(homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
    join(homedir(), ".vercel", "auth.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const token = (JSON.parse(readFileSync(p, "utf8")) as { token?: string }).token;
      if (token) return token;
    } catch {
      /* try the next path */
    }
  }
  return undefined;
}

const LOCAL = /(^|[/:.])(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)([/:]|$)/;

const envPlan: Array<{ key: string; value: string; type: "plain" | "encrypted" }> = [];
const warnings: string[] = [];

/** The live Railway services (project score-devnet, env production). Checked: /v1/info and /v1/health answer. */
const RAILWAY_NODE = "https://score-node-production.up.railway.app";
const RAILWAY_ORACLE = "https://score-oracle-production.up.railway.app";

/** A loopback value in .env.local is the local stack, never production: fall back to the deployed one. */
const prodValue = (key: string, fallback: string | undefined, ...names: string[]) => {
  const v = pick(...names);
  if (v && !LOCAL.test(v)) return v.replace(/\/$/, "");
  if (v) warnings.push(`${key}: local value ${v} ignored, using ${fallback ?? "nothing"}`);
  return fallback;
};

const nodeUrl = prodValue("NEXT_PUBLIC_SCORE_NODE", RAILWAY_NODE, "NODE_URL");
const oracleUrl = prodValue("NEXT_PUBLIC_SCORE_ORACLE", RAILWAY_ORACLE, "ORACLE_URL");
// The local validator (127.0.0.1:8899) is useless in production; the backend runs on devnet.
const rpc = prodValue("NEXT_PUBLIC_SOLANA_RPC_DEVNET", pick("PROD_RPC", "DEVNET_HELIUS_RPC"), "NEXT_PUBLIC_SOLANA_RPC_DEVNET");
const siteUrl = pick("NEXT_PUBLIC_SITE_URL") ?? `https://${APEX}`;
const privyId = pick("NEXT_PUBLIC_PRIVY_APP_ID");

if (nodeUrl) envPlan.push({ key: "NEXT_PUBLIC_SCORE_NODE", value: nodeUrl, type: "plain" });
if (oracleUrl) envPlan.push({ key: "NEXT_PUBLIC_SCORE_ORACLE", value: oracleUrl, type: "plain" });
if (rpc) envPlan.push({ key: "NEXT_PUBLIC_SOLANA_RPC_DEVNET", value: rpc, type: "plain" });
else warnings.push("no devnet RPC: the app falls back to the public api.devnet.solana.com");
envPlan.push({ key: "NEXT_PUBLIC_SITE_URL", value: siteUrl, type: "plain" });
if (privyId) envPlan.push({ key: "NEXT_PUBLIC_PRIVY_APP_ID", value: privyId, type: "plain" });
// PRIVY_APP_SECRET is the oracle's (Railway), not the web app's: it stays off Vercel.

// ---------------------------------------------------------------- plan

console.log(c.bold(`\nProject  ${project.projectName ?? "?"}  ${c.dim(projectRef)}`));
console.log(c.bold(`Team     ${teamId}`));
console.log(c.bold(`Domains  ${APEX}, ${WWW} (301 -> ${APEX})\n`));
console.log(c.bold("Env (production):"));
for (const e of envPlan) {
  const shown = e.type === "encrypted" ? "•".repeat(Math.min(e.value.length, 8)) : e.value;
  console.log(`  ${c.green("set")} ${e.key} = ${shown}`);
}
for (const w of warnings) console.log(`  ${c.yellow("warn")} ${w}`);

if (dryRun) {
  console.log(c.dim("\n--dry-run: nothing changed.\n"));
  process.exit(0);
}

// ---------------------------------------------------------------- api

const token = findToken();
if (!token) {
  console.error(
    c.red("\nNo Vercel token."),
    "Set VERCEL_TOKEN, or run `bunx vercel login` once so the CLI stores a session.",
  );
  process.exit(1);
}

const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

type ApiFailure = { status: number; code?: string; message: string };

/** Some tokens are personal and reject an unknown teamId; drop it once if that is what happened. */
let sendTeam = Boolean(teamId);

async function raw<T>(
  method: string,
  path: string,
  body: unknown,
  withTeam: boolean,
): Promise<{ ok: true; data: T } | { ok: false; error: ApiFailure }> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (withTeam && teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    return {
      ok: false,
      error: { status: res.status, code: json?.error?.code, message: json?.error?.message ?? text.slice(0, 300) },
    };
  }
  return { ok: true, data: json as T };
}

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: ApiFailure }> {
  const first = await raw<T>(method, path, body, sendTeam);
  if (first.ok) return first;
  // 403 "Not authorized" is almost always the team scope, not the endpoint. Retry identity-scoped.
  if (sendTeam && (first.error.status === 403 || first.error.status === 401)) {
    const second = await raw<T>(method, path, body, false);
    if (second.ok) {
      console.log(c.yellow(`  ! token is not scoped to team ${teamId}; using the account scope`));
      sendTeam = false;
      return second;
    }
  }
  return first;
}

// ---------------------------------------------------------------- who am I

type Me = { user?: { username?: string; email?: string }; id?: string };
const me = await raw<Me>("GET", "/v2/user", undefined, false);
const who = me.ok ? (me.data.user?.username ?? me.data.user?.email ?? me.data.id) : undefined;
console.log(c.dim(`\nToken  ${who ? `account ${who}` : "unrecognized (Vercel rejected /v2/user)"}`));

if (me.ok) {
  const teams = await raw<{ teams?: Array<{ id: string; slug: string; name: string }> }>(
    "GET",
    "/v2/teams",
    undefined,
    false,
  );
  const list = teams.ok ? (teams.data.teams ?? []) : [];
  const member = list.some((t) => t.id === teamId);
  console.log(c.dim(`Teams  ${list.length ? list.map((t) => t.slug).join(", ") : "none"}`));
  if (!member) {
    console.log(
      c.yellow(
        `\nThis token cannot act for team ${teamId} — it is not one of its teams.\n` +
          `  Likely: the CLI session belongs to a different account than the one that owns\n` +
          `  "${project.projectName}", or the session predates joining the team.\n\n` +
          `  Fix, any one of:\n` +
          `    a) bunx vercel login          (log in as the team's owner, then re-run)\n` +
          `    b) export VERCEL_TOKEN=...    (create at vercel.com/account/tokens, scope=that team)\n` +
          `    c) re-link the project:  bunx vercel link --yes --project ${project.projectName}`,
      ),
    );
    process.exit(3);
  }
}

// ---------------------------------------------------------------- domains

console.log(c.bold("\nDomains"));

type ProjectDomain = { name: string; verified: boolean; redirect?: string; redirectStatusCode?: number };

const listed = await api<{ domains: ProjectDomain[] }>(`GET`, `/v9/projects/${projectRef}/domains`);
if (!listed.ok) {
  console.error(c.red("Could not list project domains:"), listed.error.message);
  process.exit(1);
}
const existing = new Map(listed.data.domains.map((d) => [d.name, d]));

for (const name of [APEX, WWW]) {
  if (existing.has(name)) {
    console.log(`  ${c.dim("=")} ${name} already attached`);
    continue;
  }
  const added = await api<{ error?: unknown }>("POST", `/v10/projects/${projectRef}/domains`, { name });
  if (!added.ok) {
    console.log(`  ${c.red("✗")} ${name}: ${added.error.code ?? added.error.status} ${added.error.message}`);
    if (/in_use|taken|already/i.test(`${added.error.code ?? ""} ${added.error.message}`)) {
      console.log(
        c.yellow(
          `    Still attached to another Vercel account (the old one). Claim it with a TXT record:\n` +
            `    Vercel -> this project -> Settings -> Domains -> Add ${name} shows a TXT for _vercel.${APEX};\n` +
            `    add it in Hostinger DNS, wait a minute, re-run this script.`,
        ),
      );
    }
    continue;
  }
  console.log(`  ${c.green("+")} ${name} attached`);
}

// www -> apex, so one canonical host.
const redirectRes = await api(
  "PATCH",
  `/v9/projects/${projectRef}/domains/${WWW}`,
  { redirect: APEX, redirectStatusCode: 301 },
);
console.log(
  redirectRes.ok
    ? `  ${c.green("→")} ${WWW} 301 -> ${APEX}`
    : `  ${c.yellow("!")} redirect: ${redirectRes.error.message}`,
);

// Ask Vercel to re-check the DNS it can already see.
for (const name of [APEX, WWW]) {
  const v = await api<{ verified: boolean; verification?: Array<{ type: string; domain: string; value: string }> }>(
    "POST",
    `/v9/projects/${projectRef}/domains/${name}/verify`,
  );
  if (!v.ok) {
    console.log(`  ${c.yellow("!")} verify ${name}: ${v.error.message}`);
    continue;
  }
  if (v.data.verified) {
    console.log(`  ${c.green("✓")} ${name} verified`);
  } else {
    console.log(`  ${c.yellow("…")} ${name} not verified yet. Add these in Hostinger DNS, then re-run:`);
    for (const r of v.data.verification ?? []) console.log(`      ${r.type} ${r.domain} = ${r.value}`);
  }
}

// ---------------------------------------------------------------- env

console.log(c.bold("\nEnv vars (production)"));
const current = await api<{ envs: Array<{ id: string; key: string; target: string[] }> }>(
  "GET",
  `/v9/projects/${projectRef}/env`,
);
if (!current.ok) {
  console.error(c.red("Could not read env vars:"), current.error.message);
  process.exit(1);
}

for (const e of envPlan) {
  const found = current.data.envs.find((x) => x.key === e.key && x.target.includes("production"));
  const res = found
    ? await api("PATCH", `/v9/projects/${projectRef}/env/${found.id}`, {
        value: e.value,
        target: ["production"],
        type: e.type,
      })
    : await api("POST", `/v10/projects/${projectRef}/env`, {
        key: e.key,
        value: e.value,
        target: ["production"],
        type: e.type,
      });
  console.log(res.ok ? `  ${c.green("✓")} ${e.key}` : `  ${c.red("✗")} ${e.key}: ${res.error.message}`);
}

// ---------------------------------------------------------------- deploy

if (!deploy) {
  console.log(
    c.dim(
      "\nEnv changes land on the next build only (NEXT_PUBLIC_* is inlined). " +
        "Run again with --deploy, or: bunx vercel deploy --prod --yes",
    ),
  );
} else {
  console.log(c.bold("\nProduction deploy"));
  const proc = Bun.spawn(["bunx", "vercel@latest", "deploy", "--prod", "--yes", "--cwd", ROOT], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  console.log(code === 0 ? c.green("  ✓ deployed") : c.red(`  ✗ deploy exited ${code}`));
}

// ---------------------------------------------------------------- check

async function probe(host: string) {
  try {
    const res = await fetch(`https://${host}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const vercelErr = res.headers.get("x-vercel-error");
    if (vercelErr) return c.yellow(`${res.status} ${vercelErr}`);
    if (res.status >= 300 && res.status < 400) return c.green(`${res.status} -> ${res.headers.get("location")}`);
    return res.status === 200 ? c.green("200 ok") : c.yellow(String(res.status));
  } catch (err) {
    return c.red((err as Error).message);
  }
}

console.log(c.bold("\nLive check"));
for (const host of [APEX, WWW]) {
  console.log(`  ${host.padEnd(22)} ${await probe(host)}`);
}
console.log(
  c.dim(
    "\nSSL is issued by Vercel after the domain verifies; a fresh host can take a few minutes.\n" +
      "Still manual: add https://" + APEX + " in the Privy dashboard (allowed origins).\n",
  ),
);
