"use client";

import { ThemeProvider } from "next-themes";
import type { PropsWithChildren } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtocolProvider } from "@/lib/protocol/react/provider";

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ProtocolProvider>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="bottom-right" offset={{ bottom: 84 }} mobileOffset={{ bottom: 84 }} />
        </TooltipProvider>
      </ProtocolProvider>
    </ThemeProvider>
  );
}
