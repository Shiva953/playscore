"use client";

import Link from "next/link";
import { useState } from "react";
import { RESTRICTED_COUNTRIES, SIGN_IN_COUNTRIES } from "@score/core";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/protocol/errors";
import type { SignInMethod } from "@/lib/protocol/types";
import { useSignIn } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";

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
  const [country, setCountry] = useState<string>("");
  const [accepted, setAccepted] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const signIn = useSignIn();
  const restricted = (RESTRICTED_COUNTRIES as readonly string[]).includes(country);

  const go = (method: SignInMethod) => {
    if (restricted) {
      setBlocked(country);
      return;
    }
    signIn.mutate({ method, country, acceptedTerms: accepted }, { onSuccess: onDone });
  };

  if (blocked) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Not available in {blocked}</DialogTitle>
          <DialogDescription>
            score isn&apos;t available to people located in {blocked}. In production this check also runs at the network edge and on wallet
            screening. See the{" "}
            <Link href="/terms" className="underline" onClick={onDone}>
              Terms
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBlocked(null)}>
            Back
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        </div>
      </>
    );
  }

  const ready = !!country && accepted && !signIn.isPending;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Sign in</DialogTitle>
        <DialogDescription>An embedded wallet is created for you. No SOL or seed phrase needed. Devnet only: simulated sign-in.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country">Where are you located?</Label>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger id="country" className="w-full">
              <SelectValue placeholder="Select your country" />
            </SelectTrigger>
            <SelectContent>
              {SIGN_IN_COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {restricted ? <p className="text-xs text-destructive">score isn&apos;t available in {country}.</p> : null}
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="terms" checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
          <Label htmlFor="terms" className="text-sm leading-snug font-normal">
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
          <Button onClick={() => go("google")} disabled={!ready && !restricted}>
            Continue with Google
          </Button>
          <Button variant="outline" onClick={() => go("email")} disabled={!ready && !restricted}>
            Continue with email
          </Button>
          <Button variant="outline" onClick={() => go("phantom")} disabled={!ready && !restricted}>
            Connect Phantom
          </Button>
        </div>
        {!country || !accepted ? <p className="text-xs text-soft">Choose your country and accept the Terms to continue.</p> : null}
      </div>
    </>
  );
}
