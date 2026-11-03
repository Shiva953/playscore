"use client";

import "./tokens.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { formatUsd } from "@/lib/format";
import { usePortfolio, useRound } from "@/lib/protocol/react/hooks";
import { LabBar } from "@/directions/lab/lab-bar";
import { matchMinute } from "@/directions/lab/derive";
import { cn } from "@/lib/utils";
import { sora } from "./font";

const NAV = [
  { href: "/lab/c-collectible/player", label: "Players" },
  { href: "/lab/c-collectible/matchday", label: "Matchday" },
  { href: "/lab/c-collectible/landing", label: "How it works" },
];

export function CShell({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div data-fullbleed className={cn("dir-c min-h-svh", sora.variable)}>
        <Header />
        {children}
        <Toaster
          position="bottom-right"
          offset={24}
          mobileOffset={16}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast: "flex w-[320px] flex-col gap-0.5 rounded-[14px] bg-[var(--c-ink)] px-4 py-3 text-white shadow-[0_12px_32px_-12px_rgba(14,17,22,0.5)]",
              title: "text-[13px] font-semibold",
              description: "text-[12px] text-white/70",
              icon: "hidden",
            },
          }}
        />
        <LabBar />
      </div>
    </MotionConfig>
  );
}

function Header() {
  const pf = usePortfolio();
  const r = useRound((x) => ({ phase: x.phase, minute: matchMinute(x) }));
  return (
    <header className="sticky top-0 z-40 bg-[var(--c-ground)] px-3 pt-3 pb-2 md:px-6">
      <div className="mx-auto flex h-12 max-w-[1320px] items-center gap-1 rounded-full border border-[var(--c-line)] bg-white pr-1.5 pl-4">
        <Link href="/lab/c-collectible/landing" className="mr-3 text-[16px] font-bold tracking-[-0.02em]" aria-label="score home">
          score
        </Link>
        <NavLinks className="hidden gap-0.5 md:flex" />
        <div className="ml-auto flex items-center gap-1.5">
          {r.data ? (
            <Link href="/lab/c-collectible/matchday" className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--c-chip)] px-3 text-[12px] font-semibold">
              {r.data.phase === "live" ? (
                <>
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--c-up)]" />
                  Live {r.data.minute}′
                </>
              ) : r.data.phase === "open" ? (
                "Before kickoff"
              ) : (
                "Full time"
              )}
            </Link>
          ) : null}
          {pf.data ? (
            <span className="c-num hidden h-9 items-center rounded-full bg-[var(--c-ink)] px-3 text-[12px] font-semibold text-white sm:flex">{formatUsd(pf.data.usdc)}</span>
          ) : null}
        </div>
      </div>
      <NavLinks className="mx-auto mt-2 flex max-w-[1320px] gap-1 overflow-x-auto md:hidden" />
    </header>
  );
}

function NavLinks({ className }: { className?: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className={className}>
      {NAV.map((n) => {
        const active = path?.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-150 max-md:h-10",
              active ? "bg-[var(--c-ink)] text-white" : "text-[var(--c-mute)] hover:bg-[var(--c-chip)] hover:text-[var(--c-ink)] max-md:bg-white"
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
