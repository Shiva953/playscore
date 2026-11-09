import type { SignInMethod } from "./types";

/** How each sign-in method reads in the account menu and the portfolio profile. */
export const METHOD_LABEL: Record<SignInMethod, string> = { google: "Google", email: "Email", phantom: "Phantom", demo: "Demo account" };

/** On the real devnet backend a "demo" session is a test wallet kept in this browser. */
export function methodLabel(method: SignInMethod, mode: "mock" | "devnet"): string {
  return mode === "devnet" && method === "demo" ? "Test wallet" : METHOD_LABEL[method];
}
