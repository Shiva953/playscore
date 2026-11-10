"use client";

import { toWs } from "@/lib/solana/solana-client";
import { PrivyProvider, useLogin, useLogout, usePrivy, type User } from "@privy-io/react-auth";
import { toSolanaWalletConnectors, useCreateWallet, useExportWallet, useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/protocol/errors";
import type { SignInMethod } from "@/lib/protocol/types";
import { useSession, useSignIn, useSignOut } from "@/lib/protocol/react/hooks";
import { useApiClient } from "@/lib/protocol/react/provider";
import { useUi } from "@/lib/protocol/react/ui-store";
import { PRIVY_APP_ID } from "./privy-config";

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
  /**
   * The session's Solana wallet as Privy knows it: "embedded" (Privy holds it for the user; the key can be
   * exported) or "external" (Phantom and co. hold the key). Null without Privy or before it's loaded.
   */
  walletKind: (address: string) => "embedded" | "external" | null;
  /** Opens Privy's own export window for the embedded wallet. The key is shown on Privy's domain only. */
  exportKey: (address: string) => Promise<void>;
}

const MOCK_BRIDGE: AuthBridge = { privy: false, login: () => {}, logout: async () => {}, walletKind: () => null, exportKey: async () => {} };
const AuthContext = createContext<AuthBridge>(MOCK_BRIDGE);

export function useAuthBridge(): AuthBridge {
  return useContext(AuthContext);
}

const APP_ID = PRIVY_APP_ID;
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
          // Orders are signed silently by the embedded wallet: no confirmation popup per trade.
          showWalletUIs: false,
        },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc(DEVNET_RPC),
              rpcSubscriptions: createSolanaRpcSubscriptions(toWs(DEVNET_RPC)),
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

type SolanaAccount = { address: string; walletClientType?: string; firstVerifiedAt: Date | string | null };

function solanaAccounts(user: User): SolanaAccount[] {
  return user.linkedAccounts.filter((a) => a.type === "wallet" && a.chainType === "solana") as unknown as SolanaAccount[];
}

const isEmbedded = (w: SolanaAccount) => !w.walletClientType || w.walletClientType.startsWith("privy");

/** The Solana address the session should use: Phantom's if they signed in with it, else the embedded wallet. */
function solanaAddress(user: User): string | null {
  const wallets = solanaAccounts(user);
  const external = wallets.find((w) => !isEmbedded(w));
  return (external ?? wallets[0])?.address ?? null;
}

/** The "your wallet is ready" window shows once per wallet, in this browser. */
const SEEN_KEY = "score:wallet-welcome:v1";
const NEW_WALLET_MS = 24 * 3_600_000;
function welcomeSeen(address: string): boolean {
  try {
    return (JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as string[]).includes(address);
  } catch {
    return false;
  }
}
export function markWelcomeSeen(address: string): void {
  try {
    const seen = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as string[];
    if (!seen.includes(address)) window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, address].slice(-20)));
  } catch {
    // storage blocked: it may show again next time, which is harmless
  }
}

function methodOf(loginMethod: string | null, user: User): SignInMethod {
  if (loginMethod === "google" || (!loginMethod && user.google)) return "google";
  if (loginMethod === "email" || (!loginMethod && user.email)) return "email";
  return "phantom";
}

function handleOf(user: User, address: string): string {
  return user.google?.email ?? user.email?.address ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Our country + Terms answers, kept across Privy's login. Google sign-in leaves the page and comes back,
 * so this lives in sessionStorage (this tab only), not in memory.
 */
type Gate = { country: string; acceptedTerms: boolean; method?: string; newUser?: boolean };
const GATE_KEY = "score:signin-gate:v1";
const gateStore = {
  get(): Gate | null {
    try {
      const v = JSON.parse(window.sessionStorage.getItem(GATE_KEY) ?? "null");
      return v && typeof v.country === "string" ? v : null;
    } catch {
      return null;
    }
  },
  set(g: Gate | null) {
    try {
      if (g) window.sessionStorage.setItem(GATE_KEY, JSON.stringify(g));
      else window.sessionStorage.removeItem(GATE_KEY);
    } catch {
      // storage blocked: the gate only lasts while the page does
    }
  },
};

/** How long a new user's Solana wallet may take to appear before we create it ourselves, and give up. */
const WALLET_NUDGE_MS = 4_000;
const WALLET_GIVE_UP_MS = 20_000;

function PrivyBridge({ children }: { children: ReactNode }) {
  const signIn = useSignIn();
  const session = useSession();
  const openSignIn = useUi((s) => s.openSignIn);
  const showWallet = useUi((s) => s.showWallet);
  const { ready, authenticated, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const { logout: privyLogout } = useLogout();
  // Fallback when sessionStorage is blocked (same-page logins such as email still work).
  const memGate = useRef<Gate | null>(null);
  const finishing = useRef(false);
  const waitingSince = useRef<number | null>(null);
  const nudged = useRef(false);
  /** We created the wallet ourselves (Privy's automatic creation hadn't happened): it's new. */
  const nudgedFor = useRef<string | null>(null);
  const [tick, setTick] = useState(0);

  const { login } = useLogin({
    onComplete: ({ loginMethod, isNewUser }) => {
      const g = gateStore.get() ?? memGate.current;
      if (g) {
        const next = { ...g, method: loginMethod ?? g.method, newUser: isNewUser || g.newUser };
        gateStore.set(next);
        memGate.current = next;
      }
      setTick((t) => t + 1);
    },
    onError: (code) => {
      gateStore.set(null);
      memGate.current = null;
      if (code !== "exited_auth_flow") toast.error("Sign-in didn't finish", { description: String(code) });
    },
  });

  // One place that turns "signed in with Privy" into a score session: after an in-page login, after a
  // redirect back from Google, and after a reload. Waits for the user's Solana wallet to exist.
  useEffect(() => {
    if (!ready || !authenticated || !user || session.isPending || session.data || finishing.current) return;
    const g = gateStore.get() ?? memGate.current;
    if (!g) {
      // Signed in with Privy but we never got the country / Terms answers (e.g. cleared storage): ask again.
      openSignIn();
      return;
    }
    const address = solanaAddress(user);
    if (!address) {
      const since = (waitingSince.current ??= Date.now());
      const waited = Date.now() - since;
      if (waited > WALLET_GIVE_UP_MS) {
        waitingSince.current = null;
        gateStore.set(null);
        memGate.current = null;
        toast.error("Couldn't set up your wallet", { description: "Sign in again in a moment." });
        void privyLogout();
        return;
      }
      if (waited > WALLET_NUDGE_MS && !nudged.current) {
        nudged.current = true;
        nudgedFor.current = user.id;
        void createWallet().catch(() => {}); // fails harmlessly if Privy created one meanwhile
      }
      const t = setTimeout(() => setTick((x) => x + 1), 500);
      return () => clearTimeout(t);
    }
    finishing.current = true;
    waitingSince.current = null;
    nudged.current = false;
    signIn.mutate(
      { method: methodOf(g.method ?? null, user), country: g.country, acceptedTerms: g.acceptedTerms, identity: { id: user.id, address, handle: handleOf(user, address) } },
      {
        onSuccess: () => {
          gateStore.set(null);
          memGate.current = null;
          // A wallet Privy just made for them: show it, with its QR and the key backup, once.
          const acct = solanaAccounts(user).find((w) => w.address === address);
          const linked = acct?.firstVerifiedAt ? new Date(acct.firstVerifiedAt).getTime() : 0;
          const fresh = g.newUser || nudgedFor.current === user.id || (linked > 0 && Date.now() - linked < NEW_WALLET_MS);
          if (acct && isEmbedded(acct) && fresh && !welcomeSeen(address)) showWallet({ welcome: true });
        },
        onError: (e) => toast.error("Couldn't sign in", { description: errorMessage(e) }),
        onSettled: () => {
          finishing.current = false;
        },
      }
    );
  }, [ready, authenticated, user, session.isPending, session.data, tick, signIn, openSignIn, privyLogout, createWallet, showWallet]);

  const start = useCallback(
    (g: { country: string; acceptedTerms: boolean }) => {
      gateStore.set(g);
      memGate.current = g;
      // Already signed in with Privy (we only lacked the answers): finish without another login.
      if (authenticated) setTick((t) => t + 1);
      else login();
    },
    [login, authenticated]
  );
  const walletKind = useCallback(
    (address: string) => {
      const acct = user ? solanaAccounts(user).find((w) => w.address === address) : undefined;
      return acct ? (isEmbedded(acct) ? "embedded" : "external") : null;
    },
    [user]
  );
  const exportKey = useCallback((address: string) => exportWallet({ address }), [exportWallet]);
  const value = useMemo<AuthBridge>(() => ({ privy: true, login: start, logout: privyLogout, walletKind, exportKey }), [start, privyLogout, walletKind, exportKey]);
  return (
    <AuthContext.Provider value={value}>
      <WalletSigner />
      {children}
    </AuthContext.Provider>
  );
}

/**
 * On the real backend, every order is signed by the session's Solana wallet. This hands that wallet
 * (Privy's embedded one, signing without a popup, or Phantom's) to the client, plus a Privy access
 * token for the faucet. Ends the app session if Privy's has ended.
 */
function WalletSigner() {
  const api = useApiClient();
  const session = useSession();
  const signOut = useSignOut();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const address = session.data?.address;
  const wallet = useMemo(() => wallets.find((w) => w.address === address) ?? null, [wallets, address]);

  useEffect(() => {
    api?.setAccessToken(() => getAccessToken());
    return () => api?.setAccessToken(null);
  }, [api, getAccessToken]);

  useEffect(() => {
    if (!api) return;
    if (!wallet) {
      api.setSigner(null);
      return;
    }
    const silent = { uiOptions: { showWalletUIs: false } };
    api.setSigner({
      address: wallet.address,
      signMessage: async (message) => (await signMessage({ message, wallet, options: silent })).signature,
      signTransaction: async (transaction) => (await signTransaction({ transaction, wallet, chain: "solana:devnet", options: silent })).signedTransaction,
    });
  }, [api, wallet, signMessage, signTransaction]);

  // Privy's session ended (expired, or signed out in another tab): end ours too.
  useEffect(() => {
    if (!api || !ready || authenticated || !session.data || session.data.id.startsWith("burner:")) return;
    signOut.mutate();
  }, [api, ready, authenticated, session.data, signOut]);

  void walletsReady;
  return null;
}
