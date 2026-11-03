"use client";

import Link from "next/link";
import { Copy, LogOut, Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveFigure } from "@/components/common/bits";
import { UsdcIcon } from "@/components/common/usdc";
import { UserAvatar } from "@/components/common/user-avatar";
import { cn } from "@/lib/utils";
import { formatUsd, shortAddress } from "@/lib/format";
import { useFaucet, usePortfolio, useSession, useSignOut } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";

export function HeaderBalance() {
  const session = useSession();
  const pf = usePortfolio();
  if (!session.data) return null;
  if (pf.isPending || !pf.data) return <Skeleton className="hidden h-5 w-24 sm:block" />;
  return (
    <span className="hidden items-center gap-1.5 text-[14px] sm:inline-flex" aria-label={`Balance ${formatUsd(pf.data.usdc)} USDC`}>
      <UsdcIcon />
      <LiveFigure value={pf.data.usdc} format={(n) => formatUsd(n).replace("$", "")} className="font-medium text-ink" />
    </span>
  );
}

/** "$1,640.05" as a big dollar figure with quieter cents. */
function Money({ value }: { value: number | undefined }) {
  const [whole, cents = "00"] = formatUsd(value ?? 0).split(".");
  return (
    <span className="fig fig-prop flex items-baseline leading-none">
      <span className="text-[34px] font-semibold tracking-[-0.02em] text-ink">{whole}</span>
      <span className="text-[20px] font-medium text-soft">.{cents}</span>
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
  const method = s.method === "google" ? "Google" : s.method === "email" ? "Email" : "Phantom";
  const copy = () => {
    void navigator.clipboard?.writeText(s.address).then(() => toast.success("Address copied"));
  };
  const pill = "flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-raised px-3 text-[13px] font-medium text-ink outline-none focus:bg-control data-[highlighted]:bg-control";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Your wallet"
          className="rounded-full outline-none ring-offset-2 ring-offset-ground transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ink motion-safe:active:scale-[0.96]"
        >
          <UserAvatar seed={s.address} size={32} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <DropdownMenuItem onSelect={copy} aria-label={`Copy address ${shortAddress(s.address, 6)}`} className="gap-3 rounded-xl px-2 py-2">
          <UserAvatar seed={s.address} size={40} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="mono-id truncate text-[14px] text-ink">{shortAddress(s.address, 6)}</span>
            <span className="flex gap-1">
              <span className="rounded-full bg-up-tint px-1.5 py-px text-[11px] font-medium text-up">Devnet</span>
              <span className="rounded-full bg-raised px-1.5 py-px text-[11px] font-medium text-soft">{method}</span>
            </span>
          </span>
          <Copy className="size-4 text-soft" aria-hidden="true" />
        </DropdownMenuItem>

        <div className="my-1.5 flex flex-col gap-3 rounded-2xl bg-raised/50 p-3">
          <span className="flex items-center gap-1.5 text-[12px] text-soft">
            <UsdcIcon className="size-3.5" />
            USDC balance
          </span>
          <Money value={pf.data?.usdc} />
          <div className="flex gap-2">
            <DropdownMenuItem onSelect={() => faucet.mutate(1_000)} disabled={faucet.isPending} className={pill}>
              <Plus className="size-3.5" aria-hidden="true" />
              Top up
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={cn(pill, "flex-none")}>
              <Link href="/portfolio">Portfolio</Link>
            </DropdownMenuItem>
          </div>
        </div>

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
