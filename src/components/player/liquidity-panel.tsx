"use client";

import { useState } from "react";
import { impermanentLoss } from "@score/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyValue, Stat } from "@/components/common/bits";
import { EmptyState } from "@/components/common/states";
import { formatPct, formatTokens, formatUsd, parseAmount } from "@/lib/format";
import type { PlayerDetail } from "@/lib/protocol/types";
import { useAddLiquidity, useLiquidityQuote, useRemoveLiquidity, useSession } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";

export function LiquidityPanel({ player }: { player: PlayerDetail }) {
  if (!player.pool) {
    return <EmptyState title="Liquidity opens after bonding">Once {player.name} bonds, anyone can add USDC and tokens to the pool.</EmptyState>;
  }
  const lp = player.lpPosition;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Pool depth" value={formatUsd(player.pool.depthUsd, { decimals: 0 })} />
        <Stat label="Fee APR (demo volume)" value={formatPct(player.pool.feeAprDemo, { decimals: 0 })} hint="Overstated, see note" />
        <Stat label="Your position" value={lp ? formatUsd(lp.valueUsd) : "None"} />
        <Stat label="Fees earned" value={lp ? formatUsd(lp.feesEarnedUsd) : "$0.00"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AddLiquidity player={player} />
        <div className="flex flex-col gap-4">
          {lp ? <YourLp player={player} /> : null}
          <IlCalculator ticker={player.ticker} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        You earn 0.25% of every swap (proposed), added to the pool. Fees and APR use demo trading volume, far above modelled turnover: at 5%
        weekly turnover a 0.25% fee yields only about 1.3% a year. You also earn dividends on your share of the pool&apos;s tokens as recorded at
        kickoff. The protocol&apos;s locked seed earns none. Adding or removing liquidity stays open during matchdays, and your tokens keep their
        hold age through the pool.
      </p>
    </div>
  );
}

function AddLiquidity({ player }: { player: PlayerDetail }) {
  const [mode, setMode] = useState<"pair" | "zap">("pair");
  const [amount, setAmount] = useState("");
  const usdc = parseAmount(amount);
  const quote = useLiquidityQuote(player.id, usdc > 0 ? usdc : 0, mode);
  const add = useAddLiquidity();
  const session = useSession();
  const openSignIn = useUi((s) => s.openSignIn);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Add liquidity</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "pair" | "zap")}>
          <TabsList variant="segmented" className="w-full">
            <TabsTrigger value="pair">USDC + {player.ticker}</TabsTrigger>
            <TabsTrigger value="zap">USDC only</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          {mode === "pair"
            ? `Add USDC and ${player.ticker} together at the pool ratio.`
            : `We swap half your USDC into ${player.ticker} first (fees apply), then add both.`}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`lp-${player.id}`}>USDC amount</Label>
          <Input id={`lp-${player.id}`} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
        </div>
        {quote ? (
          <KeyValue
            className="rounded-md border p-2 text-xs"
            rows={[
              [mode === "pair" ? `${player.ticker} needed` : `${player.ticker} deposited`, formatTokens(quote.tokens)],
              ["Your pool share after", formatPct(quote.poolShareAfter, { decimals: 3 })],
              ["Counted at kickoff", `${formatTokens(quote.lpTokens)} ${player.ticker}`],
              ...(mode === "zap" ? ([["Swap fees", formatUsd(quote.swapFees)]] as [string, string][]) : []),
            ]}
          />
        ) : null}
        {quote?.error ? (
          <Alert variant="destructive">
            <AlertDescription>{quote.error.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          disabled={!!session.data && (!quote?.ok || add.isPending)}
          onClick={() => {
            if (!session.data) return openSignIn();
            add.mutate({ id: player.id, usdc, mode }, { onSuccess: () => setAmount("") });
          }}
        >
          {!session.data ? "Sign in to add liquidity" : add.isPending ? "Confirming…" : "Add liquidity"}
        </Button>
      </CardContent>
    </Card>
  );
}

function YourLp({ player }: { player: PlayerDetail }) {
  const lp = player.lpPosition!;
  const remove = useRemoveLiquidity();
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Your liquidity</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <KeyValue
          rows={[
            ["Pool share", formatPct(lp.poolShare, { decimals: 3 })],
            ["USDC", formatUsd(lp.usdc)],
            [player.ticker, formatTokens(lp.tokens)],
            ["Value", formatUsd(lp.valueUsd)],
            ["Deposited", formatUsd(lp.depositedUsd)],
            ["P&L (incl. fees)", formatUsd(lp.pnl, { signed: true })],
            ["Impermanent loss", formatPct(lp.impermanentLoss)],
            ["Token hold age", `${lp.holdAgeDays.toFixed(0)}d`],
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {[0.25, 0.5, 1].map((f) => (
            <Button key={f} size="sm" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate({ id: player.id, fraction: f })}>
              Remove {f === 1 ? "all" : `${f * 100}%`}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">If the price moved, you get back more of one side than you put in. Withdrawn tokens keep their hold age.</p>
      </CardContent>
    </Card>
  );
}

export function IlCalculator({ ticker }: { ticker: string }) {
  const [move, setMove] = useState(50);
  const il = impermanentLoss(1 + move / 100);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Impermanent loss</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">If {ticker}&apos;s price moves, an LP ends up holding less of whichever side rose.</p>
        <div className="flex items-center gap-3">
          <Slider value={[move]} min={-60} max={300} step={5} onValueChange={(v) => setMove(v[0] ?? 0)} aria-label="Price change" />
          <span className="num w-16 text-right text-sm">{move > 0 ? "+" : ""}{move}%</span>
        </div>
        <p className="text-sm">
          <span className="num text-lg font-semibold">{formatPct(il, { decimals: 1 })}</span> <span className="text-muted-foreground">less than just holding</span>
        </p>
      </CardContent>
    </Card>
  );
}
