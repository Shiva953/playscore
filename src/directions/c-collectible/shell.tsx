"use client";

import "./tokens.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { formatUsd } from "@/lib/format";
import { usePortfolio, useRound } from "@/lib/protocol/react/hooks";
import { LabBar } from "@/directions/lab/lab-bar";
import { matchMinute } from "@/directions/lab/derive";
import { cn } from "@/lib/utils";
import { figtree, unbounded } from "./font";

const NAV = [
  { href: "/lab/c-collectible/player", label: "Players" },
  { href: "/lab/c-collectible/matchday", label: "Matchday" },
  { href: "/lab/c-collectible/landing", label: "How it works" },
];

export function CShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-fullbleed className={cn("dir-c min-h-svh", unbounded.variable, figtree.variable)}>
      <Header />
      {children}
      <Toaster
        position="bottom-center"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "flex w-[340px] flex-col gap-0.5 rounded-[20px] bg-[var(--c-ink)] px-5 py-3.5 text-white shadow-[0_6px_0_rgba(15,20,25,0.2)]",
            title: "text-[15px] font-semibold",
            description: "text-[13px] text-white/75",
            icon: "hidden",
          },
        }}
      />
      <LabBar />
    </div>
  );
}

/** A floating white pill bar: brand, three destinations, the matchday state and your balance. */
function Header() {
  const pf = usePortfolio();
  const r = useRound((x) => ({ phase: x.phase, minute: matchMinute(x), round: x.round }));
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 md:px-6">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-2 rounded-full bg-white pr-2 pl-5 shadow-[0_4px_0_rgba(15,20,25,0.08)]">
        <Link href="/lab/c-collectible/landing" className="c-display mr-3 text-[19px]" aria-label="score home">
          score
        </Link>
        <NavLinks className="hidden gap-1 md:flex" />
        <div className="ml-auto flex items-center gap-2">
          {r.data ? (
            <Link
              href="/lab/c-collectible/matchday"
              className="flex h-10 items-center gap-2 rounded-full bg-[var(--c-chip)] px-4 text-[14px] font-semibold"
            >
              {r.data.phase === "live" ? (
                <>
                  <span aria-hidden="true" className="size-2 rounded-full bg-[var(--c-up)]" />
                  Live {r.data.minute}′
                </>
              ) : r.data.phase === "open" ? (
                "Before kickoff"
              ) : (
                "Full time"
              )}
            </Link>
          ) : null}
          {pf.data ? <span className="c-num hidden h-10 items-center rounded-full bg-[var(--c-ink)] px-4 text-[14px] text-white sm:flex">{formatUsd(pf.data.usdc)}</span> : null}
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
              "flex h-10 shrink-0 items-center rounded-full px-4 text-[15px] font-semibold transition-colors duration-150",
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
