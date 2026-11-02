"use client";

import "./tokens.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { formatUsd } from "@/lib/format";
import { usePortfolio } from "@/lib/protocol/react/hooks";
import { LabBar } from "@/directions/lab/lab-bar";
import { cn } from "@/lib/utils";
import { archivo } from "./font";
import { Crawl, Scorebug } from "./bits";

const NAV = [
  { href: "/lab/a-broadcast/player", label: "Players" },
  { href: "/lab/a-broadcast/matchday", label: "Matchday" },
  { href: "/lab/a-broadcast/landing", label: "How it works" },
];

export function AShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-fullbleed className={cn("dir-a flex min-h-svh flex-col", archivo.variable)}>
      <Header />
      <div className="sticky top-[52px] z-30">
        <Crawl />
      </div>
      <div className="flex-1">{children}</div>
      <Toaster
        position="top-center"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "flex w-[360px] items-stretch bg-black text-white shadow-[0_6px_0_rgba(0,0,0,0.15)]",
            title: "a-num px-3 py-2.5 text-[17px]",
            description: "px-3 pb-2.5 -mt-1.5 text-[13px] text-white/75",
            icon: "hidden",
          },
        }}
      />
      <LabBar />
    </div>
  );
}

function Header() {
  const path = usePathname();
  const pf = usePortfolio();
  return (
    <header className="sticky top-0 z-40 bg-black text-white">
      <div className="mx-auto flex h-[52px] max-w-[1440px] items-center gap-6 px-4 md:px-8">
        <Link href="/lab/a-broadcast/landing" className="flex items-center gap-1.5" aria-label="score home">
          <span className="a-num text-[26px] leading-none" style={{ fontStretch: "75%" }}>
            score
          </span>
          <span aria-hidden="true" className="h-[18px] w-2.5 bg-[var(--a-signal)]" />
        </Link>
        <nav aria-label="Main" className="hidden items-stretch gap-1 self-stretch md:flex">
          {NAV.map((n) => {
            const active = path?.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "a-num flex items-center border-b-4 px-3 text-[17px] transition-colors duration-150",
                  active ? "border-[var(--a-signal)] text-white" : "border-transparent text-white/70 hover:text-white"
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          {pf.data ? <span className="a-num hidden text-[17px] sm:inline">{formatUsd(pf.data.usdc)}</span> : null}
          <Scorebug />
        </div>
      </div>
    </header>
  );
}
