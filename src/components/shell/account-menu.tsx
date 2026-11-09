"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, BriefcaseBusiness, Copy, LogOut, Plus, QrCode, SlidersHorizontal } from "lucide-react";
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
import { methodLabel } from "@/lib/protocol/labels";
import { useAuthBridge } from "@/lib/auth/auth-provider";
import { formatUsd, shortAddress } from "@/lib/format";
import { useCash, useFaucet, useSession, useSignOut } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";
import { useProtocolClient } from "@/lib/protocol/react/provider";

export function HeaderBalance() {
  const session = useSession();
  const cash = useCash();
  if (!session.data) return null;
  if (!cash.ready) return <Skeleton className="hidden h-5 w-24 sm:block" />;
  return (
    <span className="hidden items-center gap-1.5 text-[0.875rem] sm:inline-flex" aria-label={`Cash ${formatUsd(cash.total)} USDC`}>
      <UsdcIcon />
      <LiveFigure value={cash.total} format={(n) => formatUsd(n).replace("$", "")} className="font-medium text-ink" />
    </span>
  );
}

/** "$1,640.05" as a big dollar figure with quieter cents. */
function Money({ value }: { value: number | undefined }) {
  const [whole, cents = "00"] = formatUsd(value ?? 0).split(".");
  return (
    <span className="fig fig-prop flex items-baseline leading-none">
      <span className="text-[2.125rem] font-semibold tracking-[-0.02em] text-ink">{whole}</span>
      <span className="text-[1.25rem] font-medium text-soft">.{cents}</span>
    </span>
  );
}

export function AccountMenu() {
  const session = useSession();
  const openSignIn = useUi((s) => s.openSignIn);
  const setDemoOpen = useUi((s) => s.setDemoOpen);
  const openFunds = useUi((s) => s.openFunds);
  const showWallet = useUi((s) => s.showWallet);
  const devnet = useProtocolClient().mode === "devnet";
  const faucet = useFaucet();
  const cash = useCash();
  const signOut = useSignOut();
  const auth = useAuthBridge();
  const autoAdd = useUi((x) => x.autoAdd);

  if (session.isPending) return <Skeleton className="h-8 w-20 rounded-full" />;
  if (!session.data) {
    return (
      <div className="flex items-center gap-1">
        {devnet ? null : (
          <Button variant="ghost" size="sm" onClick={() => setDemoOpen(true)} className="hidden sm:inline-flex">
            Demo
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={openSignIn}>
          Sign in
        </Button>
      </div>
    );
  }
  const s = session.data;
  const method = methodLabel(s.method, devnet ? "devnet" : "mock");
  const copy = () => {
    void navigator.clipboard?.writeText(s.address).then(() => toast.success("Address copied"));
  };
  const pill = "flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-raised px-3 text-[0.8125rem] font-medium text-ink outline-none focus:bg-control data-[highlighted]:bg-control";
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
            <span className="mono-id truncate text-[0.875rem] text-ink">{shortAddress(s.address, 6)}</span>
            <span className="flex gap-1">
              <span className="rounded-full bg-raised px-1.5 py-px text-[0.75rem] font-medium text-soft">Devnet</span>
              <span className="rounded-full bg-raised px-1.5 py-px text-[0.75rem] font-medium text-soft">{method}</span>
            </span>
          </span>
          <Copy className="size-4 text-soft" aria-hidden="true" />
        </DropdownMenuItem>

        <div className="my-1.5 flex flex-col gap-3 rounded-2xl bg-raised/50 p-3">
          <span className="flex items-center gap-1.5 text-[0.75rem] text-soft">
            <UsdcIcon className="size-3.5" />
            Cash
          </span>
          <Money value={cash.ready ? cash.total : undefined} />
          {devnet && cash.arriving >= 0.01 ? (
            <span className="num -mt-1 text-[0.75rem] text-soft" role="status">
              {autoAdd ? `${formatUsd(cash.arriving)} arriving, ready in a moment` : `${formatUsd(cash.arriving)} waiting in your wallet`}
            </span>
          ) : null}
          {devnet ? (
            <div className="flex gap-2">
              {(
                [
                  ["deposit", "Deposit", ArrowDownToLine],
                  ["withdraw", "Withdraw", ArrowUpFromLine],
                ] as const
              ).map(([mode, label, Icon]) => (
                <DropdownMenuItem key={mode} onSelect={() => openFunds(mode)} className={pill}>
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </DropdownMenuItem>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              <DropdownMenuItem onSelect={() => faucet.mutate(1_000)} disabled={faucet.isPending} className={pill}>
                <Plus className="size-3.5" aria-hidden="true" />
                Top up
              </DropdownMenuItem>
              <DropdownMenuItem asChild className={cn(pill, "flex-none")}>
                <Link href="/portfolio">Portfolio</Link>
              </DropdownMenuItem>
            </div>
          )}
        </div>

        {devnet ? (
          <DropdownMenuItem asChild className="gap-2.5">
            <Link href="/portfolio">
              <BriefcaseBusiness className="size-4 text-soft" aria-hidden="true" />
              Portfolio
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => showWallet({ welcome: false })} className="gap-2.5">
          <QrCode className="size-4 text-soft" aria-hidden="true" />
          {auth.privy ? "Your wallet · back up key" : "Your wallet"}
        </DropdownMenuItem>
        {devnet ? (
          <DropdownMenuItem onSelect={() => faucet.mutate(1_000)} disabled={faucet.isPending} className="gap-2.5">
            <Plus className="size-4 text-soft" aria-hidden="true" />
            {faucet.isPending ? "Getting test USDC…" : "Get 1,000 test USDC"}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setDemoOpen(true)} className="gap-2.5">
            <SlidersHorizontal className="size-4 text-soft" aria-hidden="true" />
            Demo settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => signOut.mutate(undefined, { onSuccess: () => void auth.logout() })} className="gap-2.5 text-soft">
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
