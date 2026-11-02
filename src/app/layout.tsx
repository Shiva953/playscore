import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/shell/app-header";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { GlobalModals } from "@/components/modals/global-modals";
import { cn } from "@/lib/utils";

const instrument = Instrument_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-instrument" });
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
    <html lang="en" suppressHydrationWarning className={cn("dark", instrument.variable, geistMono.variable)}>
      <body className="min-h-dvh antialiased">
        <Providers>
          <div className="flex min-h-dvh flex-col">
            <AppHeader />
            <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-24 md:px-6 md:pt-8 md:pb-16">
              {children}
            </main>
            <SiteFooter />
          </div>
          <BottomTabBar />
          <GlobalModals />
        </Providers>
      </body>
    </html>
  );
}
