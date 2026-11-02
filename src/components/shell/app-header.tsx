"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AccountMenu, HeaderBalance } from "./account-menu";
import { MatchdayPill } from "./matchday-pill";

export const NAV = [
  { href: "/markets", label: "Markets" },
  { href: "/matchday", label: "Matchday" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/docs/stats", label: "Docs", match: "/docs" },
] as const;

export function Logo() {
  return (
    <Link href="/" className="text-lg font-bold tracking-tight" aria-label="score home">
      score<span aria-hidden="true">▮</span>
    </Link>
  );
}

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => {
            const active = path.startsWith("match" in n ? n.match : n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn("rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground", active && "bg-muted text-foreground")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <MatchdayPill className="hidden sm:inline-flex" />
          <Badge variant="outline" className="hidden sm:inline-flex">
            DEVNET
          </Badge>
          <HeaderBalance />
          <AccountMenu />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-4 py-1.5 sm:hidden">
        <MatchdayPill />
        <Badge variant="outline">DEVNET</Badge>
      </div>
    </header>
  );
}
