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
import { formatUsd, shortAddress } from "@/lib/format";
import { useFaucet, usePortfolio, useSession, useSignOut } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";

export function HeaderBalance() {
  const session = useSession();
  const pf = usePortfolio();
  if (!session.data) return null;
  if (pf.isPending) return <Skeleton className="h-5 w-20" />;
  return <span className="num hidden text-sm sm:inline">{formatUsd(pf.data?.usdc)} USDC</span>;
}

export function AccountMenu() {
  const session = useSession();
  const openSignIn = useUi((s) => s.openSignIn);
  const setDemoOpen = useUi((s) => s.setDemoOpen);
  const faucet = useFaucet();
  const signOut = useSignOut();
  const pf = usePortfolio();

  if (session.isPending) return <Skeleton className="h-8 w-20" />;
  if (!session.data) {
    return (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setDemoOpen(true)} className="hidden sm:inline-flex">
          Demo
        </Button>
        <Button size="sm" onClick={openSignIn}>
          Sign in
        </Button>
      </div>
    );
  }
  const s = session.data;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Account">
          {s.label.split(" · ")[0]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span>{s.label}</span>
          <span className="font-mono text-xs text-muted-foreground">{shortAddress(s.address, 6)}</span>
          <span className="text-xs text-muted-foreground">Embedded wallet · positions held in the protocol · {s.country}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="num font-normal">
          Balance <span className="font-semibold">{formatUsd(pf.data?.usdc)} USDC</span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => faucet.mutate(1_000)} disabled={faucet.isPending}>
          Get 1,000 test USDC
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/portfolio">Portfolio</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setDemoOpen(true)}>Demo settings…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut.mutate()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
