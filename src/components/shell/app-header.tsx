"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AccountMenu, HeaderBalance } from "./account-menu";
import { MatchdayPill } from "./matchday-pill";
import { LiveTape } from "@/components/live/live-tape";

export const NAV = [
  { href: "/launch", label: "Launch", match: ["/launch"] },
  { href: "/trade", label: "Trade", match: ["/trade", "/player"] },
  { href: "/matchday", label: "Matchday", match: ["/matchday"] },
  { href: "/portfolio", label: "Portfolio", match: ["/portfolio"] },
  { href: "/docs/stats", label: "Docs", match: ["/docs"] },
] as const;

/** The product's mark: the name, and the scoreboard cell from the prototype logo in the data hue. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-[3px] text-[1.1875rem] leading-none font-semibold tracking-[-0.02em] text-ink", className)} aria-label="score, home">
      score
      <span aria-hidden="true" className="inline-block h-[15px] w-[8px] translate-y-[1px] rounded-[2px] bg-brand" />
    </Link>
  );
}

export function AppHeader() {
  const path = usePathname();
  return <ProductHeader path={path} />;
}

/** Screens where the market is the subject get the live tape under the header. */
const TAPE_ON = ["/launch", "/trade", "/player", "/matchday", "/portfolio"];

function ProductHeader({ path }: { path: string }) {
  const [scrolled, setScrolled] = useState(false);
  const wide = path.startsWith("/trade");
  const tape = TAPE_ON.some((m) => path.startsWith(m));
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-40 bg-ground pt-[env(safe-area-inset-top)] transition-[box-shadow] duration-150", scrolled && "shadow-[0_1px_0_var(--rule)]")}>
      {/* The terminal runs wider than the other pages; the header lines up with whichever page it's on. */}
      <div className={cn("mx-auto flex h-12 w-full items-center gap-4 px-4 lg:gap-6", wide ? "max-w-[1680px] md:px-4" : "max-w-[1200px] md:px-6")}>
        <Logo />
        <nav className="hidden items-center gap-4 md:flex lg:gap-5" aria-label="Main">
          {NAV.map((n) => {
            const active = n.match.some((m) => path.startsWith(m));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn("text-[0.875rem] font-medium transition-colors duration-150", active ? "text-ink" : "text-soft hover:text-ink")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <MatchdayPill />
          <span className="hidden rounded-full border border-control px-2 py-0.5 text-[0.75rem] leading-[1.33] font-medium text-soft sm:inline md:hidden lg:inline">Devnet</span>
          <HeaderBalance />
          <AccountMenu />
        </div>
      </div>
      {tape ? <LiveTape className={cn("mx-auto w-full px-4", wide ? "max-w-[1680px] md:px-4" : "max-w-[1200px] md:px-6")} /> : null}
    </header>
  );
}
