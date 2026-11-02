"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AccountMenu, HeaderBalance } from "./account-menu";
import { MatchdayPill } from "./matchday-pill";

export const NAV = [
  { href: "/markets", label: "Markets", match: "/markets" },
  { href: "/matchday", label: "Matchday", match: "/matchday" },
  { href: "/portfolio", label: "Portfolio", match: "/portfolio" },
  { href: "/docs/stats", label: "Docs", match: "/docs" },
] as const;

/** The product's mark: the name, and the scoreboard cell from the prototype logo in the data hue. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-[3px] text-[19px] leading-none font-semibold tracking-[-0.02em] text-ink", className)} aria-label="score, home">
      score
      <span aria-hidden="true" className="inline-block h-[15px] w-[8px] translate-y-[1px] rounded-[2px] bg-up" />
    </Link>
  );
}

export function AppHeader() {
  const path = usePathname();
  if (path === "/") return <LandingHeader />;
  return <ProductHeader path={path} />;
}

/** Landing: no logo (the page's wordmark is the logo), five plain links, the last one the action. */
function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 bg-ground pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-6 px-5 md:px-8">
        <span className="text-[13px] text-faint">Devnet demo</span>
        <nav className="ml-auto flex items-center gap-6" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hidden text-[15px] text-[#bbbbbb] transition-colors duration-150 hover:text-ink md:inline">
              {n.label}
            </Link>
          ))}
          <Link href="/markets" className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-black transition-[transform,background-color] duration-150 ease-out-strong hover:bg-[#e6e6e6] active:scale-[0.96]">
            Open the markets
          </Link>
        </nav>
      </div>
    </header>
  );
}

function ProductHeader({ path }: { path: string }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-40 bg-ground pt-[env(safe-area-inset-top)] transition-[box-shadow] duration-150", scrolled && "shadow-[0_1px_0_var(--rule)]")}>
      <div className="mx-auto flex h-12 w-full max-w-[1200px] items-center gap-6 px-4 md:px-6">
        <Logo />
        <nav className="hidden items-center gap-5 md:flex" aria-label="Main">
          {NAV.map((n) => {
            const active = path.startsWith(n.match);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn("text-[14px] font-medium transition-colors duration-150", active ? "text-ink" : "text-[#bbbbbb] hover:text-ink")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <MatchdayPill />
          <span className="hidden rounded-full border border-control px-2 py-0.5 text-[11px] leading-4 font-medium text-soft sm:inline">Devnet</span>
          <HeaderBalance />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
