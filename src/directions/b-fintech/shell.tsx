"use client";

import "./tokens.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BookOpen, ChartLine, Menu, Trophy, X } from "lucide-react";
import { Toaster } from "sonner";
import { formatUsd, shortAddress } from "@/lib/format";
import { usePortfolio, useSession } from "@/lib/protocol/react/hooks";
import { LabBar } from "@/directions/lab/lab-bar";
import { cn } from "@/lib/utils";
import { hanken } from "./font";

const NAV = [
  { href: "/lab/b-fintech/player", label: "Markets", icon: ChartLine },
  { href: "/lab/b-fintech/matchday", label: "Matchday", icon: Trophy },
  { href: "/lab/b-fintech/landing", label: "How it works", icon: BookOpen },
];

/**
 * Shell "open plane": a labelled sidebar on the page ground, no top bar; the page header and cards
 * sit straight on the ground. Phones: a 48px bar with the screen name and a menu sheet.
 */
export function BShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const landing = path?.endsWith("/landing");
  return (
    <div data-fullbleed className={cn("dir-b min-h-svh", hanken.variable)}>
      {landing ? (
        children
      ) : (
        <div className="lg:grid lg:grid-cols-[230px_minmax(0,1fr)]">
          <Sidebar />
          <MobileBar />
          <div className="min-w-0 px-4 pt-6 pb-16 lg:px-10 lg:pt-9">{children}</div>
        </div>
      )}
      <Toaster
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "flex w-[340px] flex-col gap-0.5 rounded-[8px] border border-[var(--b-border)] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(17,24,39,0.12)]",
            title: "text-[14px] font-semibold text-[var(--b-text)]",
            description: "text-[13px] text-[var(--b-muted)]",
            icon: "hidden",
          },
        }}
      />
      <LabBar />
    </div>
  );
}

function Brand() {
  return (
    <Link href="/lab/b-fintech/landing" className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em]" aria-label="score home">
      <span aria-hidden="true" className="h-4 w-2 rounded-[2px] bg-[var(--b-accent)]" />
      score
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const active = path?.startsWith(n.href);
        const Icon = n.icon;
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-[var(--b-radius-control)] px-2.5 text-[14px] transition-colors duration-150",
                active ? "bg-[var(--b-accent-soft)] font-medium text-[var(--b-accent-ink)]" : "text-[var(--b-muted)] hover:bg-[var(--b-raised)] hover:text-[var(--b-text)]"
              )}
            >
              <Icon className={cn("size-4", active && "text-[var(--b-accent)]")} strokeWidth={1.5} aria-hidden="true" />
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Account() {
  const s = useSession();
  const pf = usePortfolio();
  if (!s.data) return <p className="px-2.5 text-[13px] text-[var(--b-muted)]">Signed out</p>;
  return (
    <div className="flex items-center gap-2.5 px-2.5">
      <span className="flex size-7 items-center justify-center rounded-full bg-[var(--b-accent-soft)] text-[12px] font-semibold text-[var(--b-accent-ink)]">D</span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="b-num text-[13px] font-medium">{formatUsd(pf.data?.usdc)}</span>
        <span className="truncate text-[12px] text-[var(--b-muted)]">{shortAddress(s.data.address)} · devnet</span>
      </span>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-svh flex-col gap-8 py-8 pr-2 pl-5 lg:flex">
      <Brand />
      <nav aria-label="Main">
        <NavList />
      </nav>
      <div className="mt-auto">
        <Account />
      </div>
    </aside>
  );
}

function MobileBar() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const name = NAV.find((n) => path?.startsWith(n.href))?.label ?? "score";
  return (
    <>
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-[var(--b-border)] bg-[var(--b-ground)] px-4 lg:hidden">
        <span className="text-[15px] font-semibold">{name}</span>
        <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="flex size-11 items-center justify-center -mr-2.5">
          <Menu className="size-5" strokeWidth={1.5} />
        </button>
      </div>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-50 flex flex-col gap-8 bg-[var(--b-ground)] p-5 lg:hidden">
          <div className="flex items-center justify-between">
            <Brand />
            <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="flex size-11 items-center justify-center -mr-2.5">
              <X className="size-5" strokeWidth={1.5} />
            </button>
          </div>
          <NavList onNavigate={() => setOpen(false)} />
          <div className="mt-auto">
            <Account />
          </div>
        </div>
      ) : null}
    </>
  );
}
