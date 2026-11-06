"use client";

import { PrivyProvider, useLogin, useLogout, type User } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/protocol/errors";
import type { SignInMethod } from "@/lib/protocol/types";
import { useSignIn } from "@/lib/protocol/react/hooks";

/**
 * Sign-in seam (PLAN 1B.6). With `NEXT_PUBLIC_PRIVY_APP_ID` set, the sign-in dialog hands off to Privy
 * (email, Google or Phantom) after our own country and Terms step, and the session takes the Privy
 * user's Solana wallet: the embedded one created on login, or Phantom's. Without it the mock sign-in
 * stays, so local demos and tests keep working.
 */
interface AuthBridge {
  /** True when Privy is configured. */
  privy: boolean;
  /** Opens Privy's login. Country and Terms were already checked by our dialog. */
  login: (gate: { country: string; acceptedTerms: boolean }) => void;
  /** Ends the Privy session too (the mock session is ended by the caller). */
  logout: () => Promise<void>;
}

const MOCK_BRIDGE: AuthBridge = { privy: false, login: () => {}, logout: async () => {} };
const AuthContext = createContext<AuthBridge>(MOCK_BRIDGE);

export function useAuthBridge(): AuthBridge {
  return useContext(AuthContext);
}

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_DEVNET || "https://api.devnet.solana.com";

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!APP_ID) return <AuthContext.Provider value={MOCK_BRIDGE}>{children}</AuthContext.Provider>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: {
          theme: "#000000",
          accentColor: "#ffffff",
          landingHeader: "Sign in to score",
          walletChainType: "solana-only",
          walletList: ["phantom", "detected_solana_wallets"],
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "users-without-wallets" },
        },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc(DEVNET_RPC),
              rpcSubscriptions: createSolanaRpcSubscriptions(DEVNET_RPC.replace(/^http/, "ws")),
              blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
            },
          },
        },
        legal: { termsAndConditionsUrl: "/terms" },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

/** The Solana address the session should use: Phantom's if they signed in with it, else the embedded wallet. */
function solanaAddress(user: User): string | null {
  const wallets = user.linkedAccounts.filter((a) => a.type === "wallet" && a.chainType === "solana") as { address: string; walletClientType?: string }[];
  const external = wallets.find((w) => w.walletClientType && !w.walletClientType.startsWith("privy"));
  return (external ?? wallets[0])?.address ?? null;
}

function methodOf(loginMethod: string | null, user: User): SignInMethod {
  if (loginMethod === "google" || (!loginMethod && user.google)) return "google";
  if (loginMethod === "email" || (!loginMethod && user.email)) return "email";
  return "phantom";
}

function handleOf(user: User, address: string): string {
  return user.google?.email ?? user.email?.address ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const signIn = useSignIn();
  // Our gate runs before Privy opens; keep its answers until Privy completes.
  const gate = useRef<{ country: string; acceptedTerms: boolean } | null>(null);
  const { logout: privyLogout } = useLogout();
  const { login } = useLogin({
    onComplete: ({ user, loginMethod, wasAlreadyAuthenticated }) => {
      const g = gate.current;
      // An already-signed-in Privy user arriving on the page: the mock session persists on its own.
      if (!g && wasAlreadyAuthenticated) return;
      if (!g) return;
      gate.current = null;
      const address = solanaAddress(user);
      if (!address) {
        toast.error("No Solana wallet on this account", { description: "Sign in again to create one." });
        void privyLogout();
        return;
      }
      signIn.mutate(
        { method: methodOf(loginMethod, user), country: g.country, acceptedTerms: g.acceptedTerms, identity: { id: user.id, address, handle: handleOf(user, address) } },
        { onError: (e) => toast.error("Couldn't sign in", { description: errorMessage(e) }) }
      );
    },
    onError: (code) => {
      gate.current = null;
      if (code !== "exited_auth_flow") toast.error("Sign-in didn't finish", { description: String(code) });
    },
  });

  const start = useCallback(
    (g: { country: string; acceptedTerms: boolean }) => {
      gate.current = g;
      login();
    },
    [login]
  );
  const value = useMemo<AuthBridge>(() => ({ privy: true, login: start, logout: privyLogout }), [start, privyLogout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
