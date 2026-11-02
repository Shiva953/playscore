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

  /** Player hub layout preference (persisted). */
  proView: boolean;
  setProView: (v: boolean) => void;
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
      proView: false,
      setProView: (proView) => set({ proView }),
    }),
    {
      name: "score:ui:v1",
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ proView: s.proView }),
      skipHydration: true,
    }
  )
);
