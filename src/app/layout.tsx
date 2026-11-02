import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/shell/app-header";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { GlobalModals } from "@/components/modals/global-modals";
import { cn } from "@/lib/utils";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
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
    <html lang="en" suppressHydrationWarning className={cn(geistSans.variable, geistMono.variable)}>
      <body className="min-h-dvh antialiased">
        <Providers>
          <div className="flex min-h-dvh flex-col">
            <AppHeader />
            <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-4 pb-24 md:pb-10">
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
