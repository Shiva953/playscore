"use client";

import Link from "next/link";
import { Copy, LogOut, Plus, SlidersHorizontal, Wallet } from "lucide-react";
import { toast } from "sonner";
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
  const method = s.method === "google" ? "Google" : s.method === "email" ? "email" : "Phantom";
  const copy = () => {
    void navigator.clipboard?.writeText(s.address).then(() => toast.success("Address copied"));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon-sm" aria-label="Your wallet" className="text-[13px] font-semibold">
          {method.slice(0, 1).toUpperCase()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <DropdownMenuLabel className="flex items-center gap-3 px-2 pt-1.5 pb-3 font-normal">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-raised text-[15px] font-semibold text-ink">
            {method.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold text-ink">Your devnet wallet</span>
            <span className="truncate text-[13px] text-soft">
              Signed in with {method}, {s.country}
            </span>
          </span>
        </DropdownMenuLabel>
        <div className="mb-1 flex flex-col gap-0.5 rounded-xl bg-raised/60 px-3 py-2.5">
          <span className="text-[12px] text-soft">Balance</span>
          <span className="flex items-baseline gap-1.5">
            <span className="fig text-[24px] leading-8 font-semibold text-ink">{formatUsd(pf.data?.usdc)}</span>
            <span className="text-[13px] text-soft">USDC</span>
          </span>
        </div>
        <DropdownMenuItem onSelect={() => faucet.mutate(1_000)} disabled={faucet.isPending} className="gap-2.5">
          <Plus className="size-4 text-soft" aria-hidden="true" />
          Add 1,000 test USDC
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={copy} className="gap-2.5">
          <Copy className="size-4 text-soft" aria-hidden="true" />
          Copy address
          <span className="mono-id ml-auto text-[12px] text-faint">{shortAddress(s.address, 4)}</span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2.5">
          <Link href="/portfolio">
            <Wallet className="size-4 text-soft" aria-hidden="true" />
            Portfolio
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1.5 bg-rule" />
        <DropdownMenuItem onSelect={() => setDemoOpen(true)} className="gap-2.5">
          <SlidersHorizontal className="size-4 text-soft" aria-hidden="true" />
          Demo settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut.mutate()} className="gap-2.5 text-soft">
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
