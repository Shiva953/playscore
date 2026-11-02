"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveFigure } from "@/components/common/bits";
import { formatUsd, shortAddress } from "@/lib/format";
import { useFaucet, usePortfolio, useSession, useSignOut } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";

export function HeaderBalance() {
  const session = useSession();
  const pf = usePortfolio();
  if (!session.data) return null;
  if (pf.isPending || !pf.data) return <Skeleton className="hidden h-5 w-24 sm:block" />;
  return (
    <span className="hidden text-[13px] text-soft sm:inline" aria-label="USDC balance">
      <LiveFigure value={pf.data.usdc} format={(n) => formatUsd(n)} className="text-ink" /> USDC
    </span>
  );
}

export function AccountMenu() {
  const session = useSession();
  const openSignIn = useUi((s) => s.openSignIn);
  const setDemoOpen = useUi((s) => s.setDemoOpen);
  const faucet = useFaucet();
  const signOut = useSignOut();
  const pf = usePortfolio();

  if (session.isPending) return <Skeleton className="h-8 w-20 rounded-full" />;
  if (!session.data) {
    return (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setDemoOpen(true)} className="hidden sm:inline-flex">
          Demo
        </Button>
        <Button variant="secondary" size="sm" onClick={openSignIn}>
          Sign in
        </Button>
      </div>
    );
  }
  const s = session.data;
  const initial = s.label.slice(0, 1);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon-sm" aria-label="Account" className="text-[13px] font-semibold">
          {initial}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1.5">
        <DropdownMenuLabel className="flex flex-col gap-1 px-2.5 py-2 font-normal">
          <span className="text-sm font-medium text-ink">{s.label}</span>
          <span className="mono-id text-xs text-soft">{shortAddress(s.address, 6)}</span>
          <span className="text-xs text-faint">Embedded wallet · positions held in the protocol · {s.country}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-rule" />
        <div className="flex items-baseline justify-between px-2.5 py-2">
          <span className="text-sm text-soft">Balance</span>
          <span className="num text-sm font-medium text-ink">{formatUsd(pf.data?.usdc)} USDC</span>
        </div>
        <DropdownMenuItem onSelect={() => faucet.mutate(1_000)} disabled={faucet.isPending}>
          Get 1,000 test USDC
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/portfolio">Portfolio</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-rule" />
        <DropdownMenuItem onSelect={() => setDemoOpen(true)}>Demo settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut.mutate()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
