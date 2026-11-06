"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Product chrome stays off the dev-only /lab, where each direction brings its own. `app` chrome (the app
 * header, footer and tab bar) also stays off the homepage, which is a separate product page with its own
 * header and close (PLAN 1B.1). Modals and toasts use the default and appear on the homepage too.
 */
export function ChromeGate({ children, app = false }: { children: ReactNode; app?: boolean }) {
  const path = usePathname();
  if (path?.startsWith("/lab")) return null;
  if (app && path === "/") return null;
  return children;
}
