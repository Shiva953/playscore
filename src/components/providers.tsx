"use client";

import { ThemeProvider } from "next-themes";
import type { PropsWithChildren } from "react";
import { ChromeGate } from "@/components/shell/chrome-gate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtocolProvider } from "@/lib/protocol/react/provider";

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ProtocolProvider>
        <TooltipProvider delayDuration={200}>
          {children}
          <ChromeGate>
            <Toaster position="bottom-right" offset={24} mobileOffset={{ bottom: 76 }} />
          </ChromeGate>
        </TooltipProvider>
      </ProtocolProvider>
    </ThemeProvider>
  );
}
