"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/** localStorage that never throws (private mode, blocked storage, previews). */
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      // ignore
    }
  },
  removeItem: (k) => {
    try {
      window.localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

export type FundsMode = "deposit" | "withdraw";
export interface FundsIntent {
  mode: FundsMode;
  amount?: number;
}

interface UiState {
  signInOpen: boolean;
  openSignIn: () => void;
  closeSignIn: () => void;

  bonded: { playerId: string; split: { pool: number; vault: number; treasury: number } } | null;
  showBonded: (v: UiState["bonded"]) => void;

  fullTime: { round: number; amount: number } | null;
  showFullTime: (v: UiState["fullTime"]) => void;

  demoOpen: boolean;
  setDemoOpen: (v: boolean) => void;

  /**
   * The funds window. deposit = your deposit address (QR); withdraw = cash → another address.
   * `amount` prefills a withdrawal.
   */
  funds: FundsIntent | null;
  openFunds: (mode: FundsIntent["mode"] | null, opts?: Omit<FundsIntent, "mode">) => void;

  /** Your wallet: address, QR, key backup. `welcome` = just created, shown once after sign-in. */
  wallet: { welcome: boolean } | null;
  showWallet: (v: { welcome: boolean } | null) => void;

  /** The one-tap buy size on list rows (persisted per viewer). */
  quickBuyUsd: number;
  setQuickBuyUsd: (v: number) => void;

  /** Move USDC that lands in the wallet into trading as soon as it arrives (persisted per viewer). */
  autoAdd: boolean;
  setAutoAdd: (v: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      signInOpen: false,
      openSignIn: () => set({ signInOpen: true }),
      closeSignIn: () => set({ signInOpen: false }),
      bonded: null,
      showBonded: (bonded) => set({ bonded }),
      fullTime: null,
      showFullTime: (fullTime) => set({ fullTime }),
      demoOpen: false,
      setDemoOpen: (demoOpen) => set({ demoOpen }),
      funds: null,
      openFunds: (mode, opts) => set({ funds: mode ? { mode, ...opts } : null }),
      wallet: null,
      showWallet: (wallet) => set({ wallet }),
      quickBuyUsd: 25,
      setQuickBuyUsd: (quickBuyUsd) => set({ quickBuyUsd }),
      autoAdd: true,
      setAutoAdd: (autoAdd) => set({ autoAdd }),
    }),
    {
      name: "score:ui:v1",
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ quickBuyUsd: s.quickBuyUsd, autoAdd: s.autoAdd }),
      skipHydration: true,
    }
  )
);
