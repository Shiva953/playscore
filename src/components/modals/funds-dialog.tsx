"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Droplets } from "lucide-react";
import { isAddress } from "@solana/kit";
import { ActionButton, usePhase } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckDraw, Spinner } from "@/components/ui/status";
import { Switch } from "@/components/ui/switch";
import { AutoHeight } from "@/components/common/auto-height";
import { OrbLink } from "@/components/common/orb-link";
import { UsdcIcon } from "@/components/common/usdc";
import { AddressRow, Qr } from "@/components/modals/wallet-dialog";
import { AUTO_ADD_MIN } from "@/components/modals/auto-add";
import { formatUsd, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCash, useFaucet, useFunds, useSession, useToTrading, useWithdraw } from "@/lib/protocol/react/hooks";
import { useUi, type FundsIntent, type FundsMode } from "@/lib/protocol/react/ui-store";

/**
 * Money in and out over one balance, "cash". Under it there are two places on Solana, the user's own
 * wallet (their deposit address) and their trading balance in the score program, but deposits move
 * from the first to the second on their own (AutoAddDeposits) and withdrawals draw on both. The split
 * is shown only under "How deposits work", for people who want to see it.
 * Solana fees are paid by our relayer throughout, so the wallet never needs SOL.
 */
const COPY: Record<FundsMode, { title: string; description: string }> = {
  deposit: { title: "Deposit", description: "Send USDC on Solana to this address. It's added to your cash automatically, ready to trade." },
  withdraw: { title: "Withdraw", description: "Send USDC from your cash to any Solana address." },
};

export function FundsDialog() {
  const intent = useUi((s) => s.funds);
  const open = useUi((s) => s.openFunds);
  // Keep the last intent while the dialog animates closed, so its title doesn't flip mid-exit.
  const [shown, setShown] = useState<FundsIntent>({ mode: "deposit" });
  if (intent && intent !== shown) setShown(intent);
  const c = COPY[shown.mode];
  return (
    <Dialog open={!!intent} onOpenChange={(v) => !v && open(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.description}</DialogDescription>
        </DialogHeader>
        {/* The dialog grows and shrinks with its step (form, review, sent) instead of jumping. */}
        <AutoHeight>{intent ? intent.mode === "deposit" ? <Deposit /> : <Withdraw key={intent.amount ?? ""} initial={intent.amount} onDone={() => open(null)} /> : null}</AutoHeight>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- deposit

function Deposit() {
  const session = useSession();
  const faucet = useFaucet();
  const faucetPhase = usePhase(faucet);
  const funds = useFunds();
  const cash = useCash();
  const address = session.data?.address;
  const { refetch } = funds;
  // Poll faster while this is open, so a payment shows up (and gets added) within a few seconds.
  useEffect(() => {
    const t = setInterval(() => void refetch(), 3_000);
    return () => clearInterval(t);
  }, [refetch]);

  return (
    <div className="flex flex-col gap-4">
      {address ? (
        <div className="flex flex-col items-center gap-3">
          <Qr key={address} value={address} />
          <AddressRow address={address} />
        </div>
      ) : null}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-2xl bg-raised/50 px-4 py-3 text-[0.8125rem]">
        <dt className="text-soft">Network</dt>
        <dd className="text-right text-ink">Solana devnet</dd>
        <dt className="text-soft">Token</dt>
        <dd className="flex items-center justify-end gap-1.5 text-ink">
          <UsdcIcon className="size-3.5" />
          Test USDC only
        </dd>
        <dt className="text-soft">Your cash</dt>
        <dd className="num text-right text-ink">{cash.loading ? <Skeleton className="ml-auto h-4 w-16" /> : formatUsd(cash.total)}</dd>
      </dl>

      <Arriving amount={cash.arriving} />

      <div className="flex items-center justify-between gap-3 rounded-2xl bg-raised/50 p-3 pl-4">
        <span className="flex min-w-0 flex-col">
          <span className="text-[0.8125rem] font-medium text-ink">Devnet test USDC</span>
          <span className="text-xs text-soft">1,000 at a time. Not real money</span>
        </span>
        <ActionButton variant="secondary" size="sm" className="shrink-0" onClick={() => faucet.mutate(1_000, { onSettled: () => void refetch() })} phase={faucetPhase} pending="Minting" success="1,000 added" error="Try again">
          <Droplets className="size-3.5" aria-hidden="true" />
          Get 1,000
        </ActionButton>
      </div>

      <HowItWorks wallet={funds.data?.wallet} trading={cash.trading} />
    </div>
  );
}

/** A deposit seen in the wallet and not yet in trading: say it's on its way, not "in your wallet". */
function Arriving({ amount }: { amount: number }) {
  const auto = useUi((s) => s.autoAdd);
  if (!(amount >= 0.01) || !auto) return null;
  return (
    <p role="status" className="flex items-center gap-2 rounded-2xl bg-up-tint/40 px-4 py-3 text-[0.8125rem] text-ink">
      {amount >= AUTO_ADD_MIN ? (
        <>
          <Spinner className="size-3.5 text-up" />
          Adding {formatUsd(amount)} to your cash
        </>
      ) : (
        <>Deposits under {formatUsd(AUTO_ADD_MIN)} wait until there&apos;s at least {formatUsd(AUTO_ADD_MIN)} to add.</>
      )}
    </p>
  );
}

/**
 * Why there's an address at all, and where the money sits, for anyone who asks. Closed by default:
 * a first-time depositor only needs the address.
 */
function HowItWorks({ wallet, trading }: { wallet: number | undefined; trading: number }) {
  const auto = useUi((s) => s.autoAdd);
  const setAuto = useUi((s) => s.setAutoAdd);
  const toTrading = useToTrading();
  const movePhase = usePhase(toTrading);
  const [open, setOpen] = useState(false);
  const w = wallet ?? 0;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="-mt-1">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg py-1 text-[0.8125rem] text-soft transition-colors duration-150 hover:text-ink focus-visible:text-ink">
        How deposits work
        <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pt-2">
        <p className="text-[0.8125rem] leading-relaxed text-soft">
          This address is your own Solana wallet, made when you signed in. USDC that arrives is moved into your trading balance in the score program, so trades fill instantly instead of waiting for a Solana transaction each time. Withdraw takes it back out in seconds, and score pays every network fee.
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[0.8125rem]">
          <dt className="text-soft">Ready to trade</dt>
          <dd className="num text-right text-ink">{formatUsd(trading)}</dd>
          <dt className="text-soft">In your wallet</dt>
          <dd className="num flex justify-end text-right text-ink">{wallet === undefined ? <Skeleton className="h-4 w-14" /> : formatUsd(w)}</dd>
        </dl>
        <label className="flex items-start justify-between gap-4 text-[0.8125rem]">
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-ink">Add deposits automatically</span>
            <span className="text-xs text-soft">When off, USDC stays in your wallet until you move it</span>
          </span>
          <Switch checked={auto} onCheckedChange={setAuto} className="mt-0.5" aria-label="Add deposits automatically" />
        </label>
        {!auto && w >= 0.01 ? (
          <ActionButton variant="secondary" onClick={() => toTrading.mutate(Math.floor(w * 100) / 100)} phase={movePhase} pending="Moving to trading" success="Moved to trading">
            Move {formatUsd(Math.floor(w * 100) / 100)} to trading
          </ActionButton>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------- withdraw: cash → an address

function Withdraw({ initial, onDone }: { initial?: number; onDone: () => void }) {
  const session = useSession();
  const cash = useCash();
  // The "Sent" step below is the confirmation while this is open; the toast only speaks if it was closed mid-send.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const withdraw = useWithdraw({ shown: () => alive.current });
  const [to, setTo] = useState("");
  const [raw, setRaw] = useState(initial ? String(initial) : "");
  const [review, setReview] = useState(false);
  // form → review → sending → (the tick on the button) → sent
  const [sent, setSent] = useState<{ amount: number; to: string; signature?: string } | null>(null);
  const [showSent, setShowSent] = useState(false);
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setShowSent(true), 750);
    return () => clearTimeout(t);
  }, [sent]);
  const amount = parseAmount(raw);
  const dest = to.trim();
  const available = Math.floor(cash.available * 100) / 100;
  const own = dest !== "" && dest === session.data?.address;
  const badAddress = dest !== "" && (!isAddress(dest) || own);
  const tooMuch = amount > available + 1e-9;
  const ready = isAddress(dest) && !own && amount >= 1 && !tooMuch && cash.ready;

  if (sent && showSent) {
    return (
      <div className="step-in flex flex-col gap-4" role="status" data-testid="withdraw-sent">
        <div className="flex items-center gap-3">
          <CheckDraw ring className="size-9 text-up" />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm text-soft">Sent</span>
            <span className="fig fig-prop flex items-center gap-2 text-[2.125rem] leading-[1.06] text-ink">
              <UsdcIcon className="size-6" />
              {formatUsd(sent.amount).replace("$", "")}
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-2xl bg-raised/50 px-4 py-3 text-[0.8125rem]">
          <dt className="text-soft">To</dt>
          <dd className="mono-id text-right text-ink" title={sent.to}>
            {shortAddress(sent.to, 6)}
          </dd>
          <dt className="text-soft">Network fee</dt>
          <dd className="text-right text-ink">Paid by score</dd>
        </dl>
        <div className="flex items-center justify-between gap-3">
          {sent.signature ? <OrbLink signature={sent.signature} className="text-[0.8125rem]" /> : <span />}
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  if (review) {
    const phase = sent ? "success" : withdraw.status === "pending" ? "pending" : withdraw.status === "error" ? "error" : "idle";
    return (
      <div className="step-in flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-2xl bg-raised/50 p-4">
          <span className="flex flex-col gap-1">
            <span className="text-xs text-soft">You&apos;re sending</span>
            <span className="fig fig-prop flex items-center gap-2 text-[1.75rem] leading-none text-ink">
              <UsdcIcon className="size-5" />
              {formatUsd(amount).replace("$", "")}
            </span>
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-xs text-soft">To</span>
            <code className="mono-id text-[0.8125rem] leading-snug break-all text-ink">{dest}</code>
          </span>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-rule pt-3 text-[0.8125rem]">
            <dt className="text-soft">Network fee</dt>
            <dd className="text-right text-ink">Paid by score</dd>
            <dt className="text-soft">Arrives</dt>
            <dd className="text-right text-ink">In a few seconds</dd>
          </dl>
        </div>
        <p className="text-xs text-soft">Sends on Solana can&apos;t be undone. Check the address: the first and last few characters should match.</p>
        {withdraw.isPending ? (
          <p className="step-in text-[0.8125rem] text-soft" role="status">
            Taking it out of your cash and sending it on Solana. This usually takes a few seconds.
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setReview(false)} disabled={phase !== "idle"}>
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back
          </Button>
          <ActionButton
            size="lg"
            className="flex-1"
            onClick={() => withdraw.mutate({ to: dest, amount }, { onSuccess: (r) => setSent({ amount, to: dest, signature: r.signature }), onError: () => setTimeout(() => withdraw.reset(), 2000) })}
            phase={phase}
            pending="Sending on Solana"
            success="Sent"
          >
            Send {formatUsd(amount)}
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div className="step-in flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="funds-to" className="text-[0.8125rem] text-soft">
          To
        </label>
        <Input id="funds-to" placeholder="Solana address" value={to} onChange={(e) => setTo(e.target.value)} className="mono-id h-12" aria-invalid={badAddress} autoComplete="off" spellCheck={false} autoFocus />
        {badAddress ? <p className="text-xs text-down">{own ? "That's your own deposit address." : "That isn't a Solana address."}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="funds-amount" className="text-[0.8125rem] text-soft">
            Amount
          </label>
          <span className={cn("num text-xs", tooMuch ? "text-down" : "text-soft")} aria-live="polite">
            {cash.loading ? <Skeleton className="h-3 w-24" /> : `${formatUsd(available)} available`}
          </span>
        </div>
        <div className="relative">
          <Input id="funds-amount" inputMode="decimal" placeholder="0.00" value={raw} onChange={(e) => setRaw(e.target.value)} className="num h-12 pr-16 text-lg" aria-invalid={tooMuch} autoComplete="off" />
          <button type="button" onClick={() => setRaw(String(available))} disabled={!(available > 0)} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-soft transition-colors duration-150 hover:text-ink disabled:opacity-40">
            Max
          </button>
        </div>
      </div>

      {tooMuch && cash.inOrders >= 0.01 ? (
        <p className="text-xs text-soft">Another {formatUsd(cash.inOrders)} is held in open buy orders. Cancel them to withdraw it.</p>
      ) : amount > 0 && amount < 1 ? (
        <p className="text-xs text-soft">Withdrawals start at $1.</p>
      ) : null}

      <Button size="lg" onClick={() => setReview(true)} disabled={!ready}>
        Review
      </Button>
    </div>
  );
}

function parseAmount(raw: string): number {
  return Number(raw.replace(/[^0-9.]/g, "")) || 0;
}
