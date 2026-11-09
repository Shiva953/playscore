/**
 * The Privy app id, if it's usable. Privy ids are 25 characters; a malformed one makes PrivyProvider
 * throw on every page, so we treat it as "not configured" (test wallet in this browser) and say why.
 */
const RAW = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export const PRIVY_APP_ID: string | null = RAW.length === 25 ? RAW : null;

if (RAW && !PRIVY_APP_ID && typeof window !== "undefined") {
  console.warn(`NEXT_PUBLIC_PRIVY_APP_ID is ${RAW.length} characters; Privy app ids are 25. Sign-in uses a test wallet until it's fixed.`);
}
