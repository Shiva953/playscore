"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/protocol/errors";
import type { SignInMethod } from "@/lib/protocol/types";
import { useSignIn } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";
import { useProtocolClient } from "@/lib/protocol/react/provider";
import { useAuthBridge } from "@/lib/auth/auth-provider";

export function SignInDialog() {
  const open = useUi((s) => s.signInOpen);
  const close = useUi((s) => s.closeSignIn);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md">{open ? <SignInBody onDone={close} /> : null}</DialogContent>
    </Dialog>
  );
}

function SignInBody({ onDone }: { onDone: () => void }) {
  const [accepted, setAccepted] = useState(false);
  const signIn = useSignIn();
  const auth = useAuthBridge();
  const devnet = useProtocolClient().mode === "devnet";

  const go = (method: SignInMethod) => {
    if (auth.privy && method !== "demo") {
      // The Terms gate passed; Privy takes it from here (email, Google or Phantom) and the bridge signs us in.
      onDone();
      auth.login({ acceptedTerms: accepted });
      return;
    }
    signIn.mutate({ method, acceptedTerms: accepted }, { onSuccess: onDone });
  };

  const ready = accepted && !signIn.isPending;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Sign in</DialogTitle>
        <DialogDescription>
          {auth.privy
            ? "A Solana wallet is created for you when you sign in. No SOL or seed phrase needed. Devnet, with test USDC."
            : devnet
              ? "A test wallet is created in this browser. No SOL needed. Devnet, with test USDC."
              : "A wallet is created for you. No SOL or seed phrase needed. Devnet only: simulated sign-in."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <Checkbox id="terms" checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
          <Label htmlFor="terms" className="block text-sm leading-snug font-normal">
            I&apos;m 18 or older, I accept the{" "}
            <Link href="/terms" className="underline" onClick={onDone}>
              Terms
            </Link>
            , and I&apos;m not in a restricted country.
          </Label>
        </div>
        {signIn.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t sign in</AlertTitle>
            <AlertDescription>{errorMessage(signIn.error)}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-2">
          {auth.privy ? (
            <Button onClick={() => go("email")} disabled={!ready}>
              Sign in
            </Button>
          ) : devnet ? (
            <Button onClick={() => go("demo")} disabled={!ready}>
              Continue with a test wallet
            </Button>
          ) : (
            <>
              <Button onClick={() => go("google")} disabled={!ready}>
                Continue with Google
              </Button>
              <Button variant="outline" onClick={() => go("email")} disabled={!ready}>
                Continue with email
              </Button>
              <Button variant="outline" onClick={() => go("phantom")} disabled={!ready}>
                Connect Phantom
              </Button>
            </>
          )}
          {devnet ? null : (
            <Button variant="ghost" onClick={() => go("demo")} disabled={!ready}>
              Try a demo account
            </Button>
          )}
        </div>
        {!accepted ? <p className="text-xs text-soft">Accept the Terms to continue.</p> : null}
      </div>
    </>
  );
}
