"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ChartLine, Trophy, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/markets", label: "Markets", icon: ChartLine, match: "/markets" },
  { href: "/matchday", label: "Matchday", icon: Trophy, match: "/matchday" },
  { href: "/portfolio", label: "Portfolio", icon: Wallet, match: "/portfolio" },
  { href: "/docs/stats", label: "Docs", icon: BookOpen, match: "/docs" },
];

/** Phone navigation: four destinations, active by brightness alone (hidden ≥ md). */
export function BottomTabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 bg-ground pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--rule)] md:hidden">
      <ul className="grid grid-cols-4">
        {TABS.map((t) => {
          const active = path.startsWith(t.match);
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150", active ? "text-ink" : "text-faint")}
              >
                <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
