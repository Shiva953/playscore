"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Product chrome (header, footer, tab bar, modals, toasts) stays off the dev-only /lab, where each direction brings its own. */
export function ChromeGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  return path?.startsWith("/lab") ? null : children;
}
