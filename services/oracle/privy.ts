// Privy on the server: verify a user's access token (ES256 JWT, Privy's public keys) and read the
// user's linked wallets with the app secret, so the faucet only pays a wallet the signed-in user owns.
import { createRemoteJWKSet, jwtVerify } from "jose";

const RAW_ID = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
// Privy app ids are 25 characters; the app falls back to test wallets for anything else, so we do too.
const APP_ID = RAW_ID.length === 25 ? RAW_ID : "";
const SECRET = process.env.PRIVY_APP_SECRET || "";
if (RAW_ID && !APP_ID) console.error(`oracle: Privy app id is ${RAW_ID.length} characters (should be 25): faucet runs without the Privy check`);

export const privyConfigured = (): boolean => !!APP_ID && !!SECRET;

const jwks = APP_ID ? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${APP_ID}/jwks.json`)) : null;

/** The Privy user id (did:privy:…) for a valid access token, or throws. */
export async function verifyAccessToken(token: string): Promise<string> {
  if (!jwks) throw new Error("Privy is not configured on the server");
  const { payload } = await jwtVerify(token, jwks, { issuer: "privy.io", audience: APP_ID });
  if (!payload.sub) throw new Error("token has no subject");
  return payload.sub;
}

const walletCache = new Map<string, { at: number; wallets: string[] }>();

/** Solana addresses linked to a Privy user (embedded and external), cached for a minute. */
export async function solanaWallets(userId: string): Promise<string[]> {
  const hit = walletCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.wallets;
  const r = await fetch(`https://api.privy.io/v1/users/${encodeURIComponent(userId)}`, {
    headers: { authorization: `Basic ${btoa(`${APP_ID}:${SECRET}`)}`, "privy-app-id": APP_ID },
  });
  if (!r.ok) throw new Error(`Privy user lookup failed (${r.status})`);
  const u = (await r.json()) as { linked_accounts?: { type: string; chain_type?: string; address?: string }[] };
  const wallets = (u.linked_accounts ?? []).filter((a) => a.type === "wallet" && a.chain_type === "solana" && a.address).map((a) => a.address!);
  walletCache.set(userId, { at: Date.now(), wallets });
  return wallets;
}
