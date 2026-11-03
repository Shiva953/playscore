import type { Metadata, Viewport } from "next";
import { Chivo, Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/shell/app-header";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { GlobalModals } from "@/components/modals/global-modals";
import { ChromeGate } from "@/components/shell/chrome-gate";
import { cn } from "@/lib/utils";

const instrument = Instrument_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-instrument" });
// Figures (prices, amounts, stats): a sturdy grotesque with tabular digits and narrow punctuation,
// so "$0.01066" reads as one number. A monospace was tried and rejected: its point takes a digit's width.
const chivo = Chivo({ subsets: ["latin"], variable: "--font-num" });
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
    <html lang="en" suppressHydrationWarning className={cn("dark", instrument.variable, chivo.variable, geistMono.variable)}>
      <body className="min-h-dvh antialiased">
        <Providers>
          <div className="flex min-h-dvh flex-col">
            <ChromeGate>
              <AppHeader />
            </ChromeGate>
            <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-24 md:px-6 md:pt-8 md:pb-16 has-[>[data-fullbleed]]:max-w-none has-[>[data-fullbleed]]:px-0 has-[>[data-fullbleed]]:pt-0 has-[>[data-fullbleed]]:pb-0">
              {children}
            </main>
            <ChromeGate>
              <SiteFooter />
            </ChromeGate>
          </div>
          <ChromeGate>
            <BottomTabBar />
            <GlobalModals />
          </ChromeGate>
        </Providers>
      </body>
    </html>
  );
}
