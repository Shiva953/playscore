"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { markWelcomeSeen, useAuthBridge } from "@/lib/auth/auth-provider";
import { useSession } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";

/**
 * Your wallet: the address as a QR and as text to copy, and a way to back up the private key. The key
 * is only ever shown inside Privy's export window (an iframe on Privy's domain), never to this app.
 * Opens once after a wallet is created for you, and any time from the account menu.
 */
export function WalletDialog() {
  const state = useUi((s) => s.wallet);
  const show = useUi((s) => s.showWallet);
  const session = useSession();
  const address = session.data?.address ?? null;
  const open = !!state && !!address;

  // Shown once: remember it the moment it opens, so a reload doesn't bring it back.
  useEffect(() => {
    if (open && state?.welcome && address) markWelcomeSeen(address);
  }, [open, state?.welcome, address]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && show(null)}>
      <DialogContent className="sm:max-w-[560px]">
        {open && address ? <Body address={address} welcome={state!.welcome} onDone={() => show(null)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ address, welcome, onDone }: { address: string; welcome: boolean; onDone: () => void }) {
  const auth = useAuthBridge();
  const kind = auth.privy ? auth.walletKind(address) : null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{welcome ? "Your wallet is ready" : "Your wallet"}</DialogTitle>
        <DialogDescription>
          {welcome
            ? "A Solana wallet was created for you. It's yours: score never holds its key. Back it up now so you can always get to it."
            : "Your Solana wallet, which is also your deposit address. USDC sent here is added to your cash."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4">
        <Qr key={address} value={address} />
        <AddressRow address={address} />
        <p className="text-center text-xs text-faint">Devnet: send only test tokens to this address.</p>
      </div>

      {kind === "embedded" ? <Backup address={address} exportKey={auth.exportKey} /> : <KeyNote kind={kind} />}

      <DialogFooter>
        <Button onClick={onDone} className="w-full sm:w-auto">
          {welcome ? "Start trading" : "Done"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** The address as a QR. Dark modules on white with a quiet zone, so every scanner reads it in both themes. */
export function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 2, width: 440, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [value]);
  if (failed) return null; // the address below still works
  return (
    <div className="rounded-2xl bg-white p-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing to optimise
        <img src={src} alt={`QR code for wallet address ${value}`} width={200} height={200} className="block size-[180px] sm:size-[200px]" />
      ) : (
        <Skeleton className="size-[180px] rounded-xl sm:size-[200px]" />
      )}
    </div>
  );
}

export function AddressRow({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Couldn't copy", { description: "Select the address and copy it by hand." });
    }
  };
  return (
    <div className="flex w-full items-center gap-2 rounded-2xl bg-raised/50 p-2 pl-3">
      {/* Two even halves, each kept whole: two lines of 22 at every width, never a 3-character orphan. */}
      <code className="mono-id min-w-0 flex-1 text-[0.8125rem] leading-snug break-all text-ink select-all">
        <span className="inline-block">{address.slice(0, Math.ceil(address.length / 2))}</span>
        <wbr />
        <span className="inline-block">{address.slice(Math.ceil(address.length / 2))}</span>
      </code>
      <Button variant="secondary" size="sm" onClick={copy} aria-label={copied ? "Address copied" : "Copy address"} className="shrink-0">
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </Button>
    </div>
  );
}

function Backup({ address, exportKey }: { address: string; exportKey: (address: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const backup = async () => {
    setBusy(true);
    try {
      await exportKey(address);
      setDone(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/exit|clos|cancel/i.test(msg)) toast.error("Couldn't open the backup", { description: "Sign in again, then try once more." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-raised/50 p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-soft" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <span className="text-[0.875rem] font-medium text-ink">Back up your private key</span>
          <span className="text-xs leading-relaxed text-soft">
            Opens a secure window from Privy, our wallet provider. Your key is shown only there, never to score. With it you can open this wallet in Phantom or any Solana wallet.
          </span>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-xl bg-down-tint/40 p-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-down" aria-hidden="true" />
        <span className="text-xs leading-relaxed text-soft">
          Anyone with this key controls the wallet. Write it down or keep it in a password manager. Never share it, and never paste it into a website or chat. score will never ask for it.
        </span>
      </div>
      <ActionButton variant="secondary" onClick={backup} phase={busy ? "pending" : "idle"} pending="Opening the secure window">
        {done ? "Show my key again" : "Back up private key"}
      </ActionButton>
    </div>
  );
}

function KeyNote({ kind }: { kind: "embedded" | "external" | null }) {
  const text =
    kind === "external"
      ? "Your key stays in your own wallet app (such as Phantom). Back it up there."
      : "This test wallet's key is kept in this browser only. Clearing site data removes it, so use it for devnet testing only.";
  return <p className="rounded-2xl bg-raised/50 p-4 text-xs leading-relaxed text-soft">{text}</p>;
}
