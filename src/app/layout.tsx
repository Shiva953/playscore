import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/shell/app-header";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { GlobalModals } from "@/components/modals/global-modals";
import { ChromeGate } from "@/components/shell/chrome-gate";
import { cn } from "@/lib/utils";

// Type (8 Nov, chosen with ui-ux-pro-max and checked against taste and unslop): Barlow Condensed for display
// (headlines, the big figures, tickers, Buy/Sell, shirt numbers) and Barlow for everything else. One family in
// two widths, so one voice; the condensed figures read like shirt numbers and a matchday scoreboard. Compared
// in context against Bebas Neue + Source Sans 3, Anton + Epilogue, Saira Extra Condensed + Saira and
// Russo One + Chakra Petch. Geist (round two) read as a generic exchange, not a football app.
const text = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-text" });
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600"], variable: "--font-display" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://playscore.fun"),
  title: { default: "score · own the players", template: "%s · score" },
  description: "Own the players. Earn when they perform. A football player trading protocol on Solana (devnet demo).",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("dark", text.variable, display.variable)}>
      <body className="min-h-dvh">
        <Providers>
          <div className="flex min-h-dvh flex-col">
            <ChromeGate app>
              <AppHeader />
            </ChromeGate>
            <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-24 md:px-6 md:pt-8 md:pb-16 has-[>[data-fullbleed]]:max-w-none has-[>[data-fullbleed]]:px-0 has-[>[data-fullbleed]]:pt-0 has-[>[data-fullbleed]]:pb-0">
              {children}
            </main>
            <ChromeGate app>
              <SiteFooter />
            </ChromeGate>
          </div>
          <ChromeGate app>
            <BottomTabBar />
          </ChromeGate>
          <ChromeGate>
            <GlobalModals />
          </ChromeGate>
        </Providers>
      </body>
    </html>
  );
}
