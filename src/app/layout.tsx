import type { Metadata, Viewport } from "next";
import { Funnel_Sans, Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/shell/app-header";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { GlobalModals } from "@/components/modals/global-modals";
import { ChromeGate } from "@/components/shell/chrome-gate";
import { cn } from "@/lib/utils";

const instrument = Instrument_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-instrument" });
// Figures (prices, amounts, stats): Funnel Sans. Compact, tabular by default, narrow punctuation, and close
// to Instrument Sans in proportion, so figures stand out without looking borrowed. Chivo (too wide and heavy
// beside the labels) and Azeret Mono (the point takes a digit's width) were tried and rejected.
const funnel = Funnel_Sans({ subsets: ["latin"], variable: "--font-num" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
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
    <html lang="en" suppressHydrationWarning className={cn("dark", instrument.variable, funnel.variable, geistMono.variable)}>
      <body className="min-h-dvh antialiased">
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
