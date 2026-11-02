"use client";

import Link from "next/link";
import { PLAYERS_BY_ID } from "@score/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyValue } from "@/components/common/bits";
import { ClaimPanel } from "@/components/portfolio/claim-panel";
import { DemoPanel } from "@/components/shell/demo-panel";
import { formatUsd } from "@/lib/format";
import { useUi } from "@/lib/protocol/react/ui-store";
import { SignInDialog } from "./sign-in-dialog";

function BondedDialog() {
  const bonded = useUi((s) => s.bonded);
  const close = useUi((s) => s.showBonded);
  const p = bonded ? PLAYERS_BY_ID[bonded.playerId] : null;
  return (
    <Dialog open={!!bonded} onOpenChange={(v) => !v && close(null)}>
      <DialogContent className="sm:max-w-md">
        {bonded && p ? (
          <>
            <DialogHeader>
              <DialogTitle>${p.ticker} bonded</DialogTitle>
              <DialogDescription>
                {p.name} reached $25,000 raised. The launch curve is closed and a permanent trading pool is open.
              </DialogDescription>
            </DialogHeader>
            <KeyValue
              rows={[
                ["Locked pool seed (70%)", formatUsd(bonded.split.pool)],
                ["Dividend vault (20%)", formatUsd(bonded.split.vault)],
                ["Treasury (10%)", formatUsd(bonded.split.treasury)],
              ]}
            />
            <p className="text-sm text-muted-foreground">
              From now on, holders at each kickoff can earn dividends. Selling pays a tax that falls from 5% to 0.5% over 90 days of holding.
            </p>
            <DialogFooter>
              <Button asChild onClick={() => close(null)}>
                <Link href={`/player/${p.id}`}>Trade {p.name}</Link>
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FullTimeDialog() {
  const ft = useUi((s) => s.fullTime);
  const close = useUi((s) => s.showFullTime);
  return (
    <Dialog open={!!ft} onOpenChange={(v) => !v && close(null)}>
      <DialogContent className="sm:max-w-md">
        {ft ? (
          <>
            <DialogHeader>
              <DialogTitle>Full time · round {ft.round}</DialogTitle>
              <DialogDescription>
                Your players finished on the boards. You earned <span className="num font-semibold">{formatUsd(ft.amount)}</span> this round.
              </DialogDescription>
            </DialogHeader>
            <ClaimPanel compact onClaimed={() => close(null)} />
            <DialogFooter className="sm:justify-start">
              <Button variant="ghost" asChild onClick={() => close(null)}>
                <Link href="/matchday">See the results</Link>
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function GlobalModals() {
  return (
    <>
      <SignInDialog />
      <BondedDialog />
      <FullTimeDialog />
      <DemoPanel />
    </>
  );
}
