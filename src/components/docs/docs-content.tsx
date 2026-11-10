"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  COEFFICIENTS,
  CONTROLLER_MATRIX_BPS,
  EVENT_CODES,
  EVENT_MATRIX,
  LEAGUES,
  LEAGUE_NAMES,
  PROVISIONAL_COEFFICIENTS,
  POSITIONS,
  displayScore,
  scorePoints,
  sellTaxRate,
  type EventCode,
  type LeagueCode,
  type PositionCode,
} from "@score/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Stat } from "@/components/common/bits";
import { ErrorState, LoadingRows } from "@/components/common/states";
import { IlCalculator } from "@/components/player/liquidity-panel";
import { formatPct, formatUsd } from "@/lib/format";
import { useStats } from "@/lib/protocol/react/hooks";
import { DOC_SECTIONS, type DocSlug } from "./sections";
import { cn } from "@/lib/utils";



export function DocsNav({ active }: { active: DocSlug }) {
  return (
    <nav aria-label="Docs" className="flex gap-1 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] lg:flex-col lg:overflow-visible lg:[mask-image:none]">
      {DOC_SECTIONS.map((s) => (
        <Link
          key={s.slug}
          href={`/docs/${s.slug}`}
          aria-current={s.slug === active ? "page" : undefined}
          className={cn(
            "shrink-0 py-1.5 pr-4 text-sm whitespace-nowrap transition-colors duration-150 lg:py-2",
            s.slug === active ? "text-ink" : "text-soft hover:text-ink"
          )}
        >
          {s.title}
        </Link>
      ))}
    </nav>
  );
}

function Cards({ items }: { items: [string, string][] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([t, b]) => (
        <Card key={t} size="sm">
          <CardHeader>
            <CardTitle>{t}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed text-soft">{b}</CardContent>
        </Card>
      ))}
    </div>
  );
}

export function DocSection({ slug }: { slug: DocSlug }) {
  switch (slug) {
    case "how-it-works":
      return <HowItWorksDoc />;
    case "stats":
      return <StatsDoc />;
    case "scoring":
      return <ScoringDoc />;
    case "boards":
      return <BoardsDoc />;
    case "fees":
      return <FeesDoc />;
    case "dividends":
      return <DividendsDoc />;
    case "liquidity":
      return <LiquidityDoc />;
    case "governance":
      return <GovernanceDoc />;
  }
}

// ---------------------------------------------------------------- stats

function StatsDoc() {
  const q = useStats();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-soft">Live protocol stats for this demo session.</p>
      {q.isPending ? (
        <LoadingRows rows={4} />
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 rounded-2xl bg-surface ring-1 ring-edge ring-inset p-5 sm:grid-cols-3 lg:grid-cols-4" data-testid="stats">
          <Stat label="Platform TVL" value={formatUsd(q.data.tvl, { decimals: 0 })} />
          <Stat
            label="Pool this round"
            value={formatUsd(q.data.roundPool.usd, { decimals: 0 })}
            hint={q.data.roundPool.capped ? "Annual cap applies" : undefined}
          />
          <Stat label="Controller rate" value={`${(q.data.roundPool.bps / 100).toFixed(2)}%`} hint={`matrix ${(q.data.roundPool.matrixBps / 100).toFixed(2)}%`} />
          <Stat label="Treasury" value={formatUsd(q.data.treasury, { decimals: 0 })} />
          <Stat label="Paid out (session)" value={formatUsd(q.data.totalPaidOut, { decimals: 0 })} hint={`${q.data.roundsSettled} rounds settled`} />
          <Stat label="Players bonded" value={q.data.bondedCount} />
          <Stat label="Live launches" value={q.data.launchingCount} />
          <Stat label="Scheduled" value={q.data.scheduledCount} />
          <Stat label="24h volume" value={formatUsd(q.data.volume24h, { decimals: 0 })} />
          <Stat label="USDC in pools" value={formatUsd(q.data.poolUsdcTotal, { decimals: 0 })} />
          <Stat label="USDC on launch curves" value={formatUsd(q.data.curveUsdcTotal, { decimals: 0 })} />
          <Stat label="Reserve tokens left" value={`${(q.data.reserveLeftTotal / 1e6).toFixed(1)}M`} />
          <Stat label="Third-party LP depth" value={formatUsd(q.data.externalLpDepth, { decimals: 0 })} />
        </div>
      )}
      <p className="text-xs text-soft">
        TVL here is the controller&apos;s definition: $17,500 per bonded player (the locked seed) plus the dividend vault. It ignores pool growth and
        curve funds.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- scoring

const MAIN_EVENTS: EventCode[] = ["goal", "assist", "shotOnTarget", "keyPass", "tackleWon", "cleanSheet"];

function ScoreCalculator() {
  const [pos, setPos] = useState<PositionCode>("FWD");
  const [comp, setComp] = useState<LeagueCode | "UCL">("PL");
  const [minutes, setMinutes] = useState(90);
  const [counts, setCounts] = useState<Partial<Record<EventCode, number>>>({ goal: 1, shotOnTarget: 2, keyPass: 2, tackleWon: 1 });
  const coef = COEFFICIENTS[comp];
  const points = useMemo(() => scorePoints({ minutes, ...counts }, pos, coef), [minutes, counts, pos, coef]);
  const set = (code: EventCode, v: number) => setCounts((c) => ({ ...c, [code]: v }));
  const row = (code: EventCode) => {
    const max = code === "cleanSheet" ? 1 : ["passCompleted"].includes(code) ? 80 : ["progressive", "passFailed", "recovery"].includes(code) ? 15 : 6;
    return (
      <div key={code} className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 text-sm">
        <span className="truncate">
          {EVENT_MATRIX[code].label} <span className="text-soft">×{EVENT_MATRIX[code].points[POSITIONS.indexOf(pos)]}</span>
        </span>
        <Slider value={[counts[code] ?? 0]} min={0} max={max} step={code === "xgCreated" ? 0.1 : 1} onValueChange={(v) => set(code, v[0] ?? 0)} aria-label={EVENT_MATRIX[code].label} />
        <span className="num text-right">{counts[code] ?? 0}</span>
      </div>
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Score calculator</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="calc-pos">Position</Label>
            <Select value={pos} onValueChange={(v) => setPos(v as PositionCode)}>
              <SelectTrigger id="calc-pos" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="calc-comp">Competition</Label>
            <Select value={comp} onValueChange={(v) => setComp(v as LeagueCode | "UCL")}>
              <SelectTrigger id="calc-comp" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UCL">Champions League ×1.05</SelectItem>
                {LEAGUES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LEAGUE_NAMES[l]} ×{COEFFICIENTS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 text-sm">
          <span>Minutes <span className="text-soft">×0.012</span></span>
          <Slider value={[minutes]} min={0} max={90} step={1} onValueChange={(v) => setMinutes(v[0] ?? 0)} aria-label="Minutes" />
          <span className="num text-right">{minutes}</span>
        </div>
        {MAIN_EVENTS.map(row)}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="self-start">
              More events
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-3">{EVENT_CODES.filter((c) => !MAIN_EVENTS.includes(c)).map(row)}</CollapsibleContent>
        </Collapsible>
        <div className="flex flex-wrap items-end justify-between gap-2 border-t pt-3">
          <span className="text-sm text-soft">
            {(points / coef).toFixed(2)} raw × {coef} = <span className="num">{points.toFixed(2)}</span> points
          </span>
          <span className="num text-2xl font-semibold" data-testid="calc-score">
            {displayScore(points).toFixed(1)} <span className="text-sm font-normal text-soft">/ 10</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoringDoc() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-soft">
        Every player is scored on their own contribution, by position, then multiplied by a competition coefficient. Champions League is an extra
        fixture in midweek windows. Live scores are provisional; payouts use data frozen 12 hours after the window&apos;s last whistle.
      </p>
      <ScoreCalculator />
      <h2 className="text-lg font-semibold">Points per event</h2>
      <div className="rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5 py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              {POSITIONS.map((p) => (
                <TableHead key={p} className="text-right">
                  {p}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {EVENT_CODES.map((c) => (
              <TableRow key={c}>
                <TableCell>{EVENT_MATRIX[c].label}</TableCell>
                {EVENT_MATRIX[c].points.map((v, i) => (
                  <TableCell key={i} className={cn("num text-right", v < 0 && "text-down")}>
                    {v}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            <TableRow>
              <TableCell>Minutes (per minute)</TableCell>
              {POSITIONS.map((p) => (
                <TableCell key={p} className="num text-right">
                  0.012
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <h2 className="text-lg font-semibold">Coefficients</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["UCL", ...LEAGUES] as const).map((c) => (
          <Card key={c} size="sm">
            <CardContent className="flex flex-col">
              <span className="num text-lg font-semibold">
                {COEFFICIENTS[c].toFixed(2)}
                {(PROVISIONAL_COEFFICIENTS as readonly string[]).includes(c) ? "*" : ""}
              </span>
              <span className="text-xs text-soft">{c === "UCL" ? "Champions League" : LEAGUE_NAMES[c]}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-soft">
        Display score = 10 × P ÷ (P + 6), shown 0–10. Boards rank on raw points P. *Provisional. Data from a licensed provider (the demo uses a
        simulator).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- boards

function BoardsDoc() {
  const stats = useStats();
  const runway = ["<20", "20–40", "40–80", "80–160", ">160"];
  return (
    <div className="flex flex-col gap-6">
      <Cards
        items={[
          ["Who ranks", "Bonded players who played in the window, scored on their own contribution."],
          ["Boards", "4 position boards across all leagues (FWD, MID, DEF, GK), and a Champions League board in midweek windows."],
          ["Payout", "Forwards, midfielders and defenders: top 5 get 35 / 25 / 20 / 12 / 8%. Goalkeepers: top 3 get 44 / 31 / 25%. Rank only, no market-cap weighting."],
          ["Board weight", "Players ranked (up to the paid places: 5, or 3 for goalkeepers) × the board's multiplier. Champions League 1.05, positions 1.00. League coefficients still scale each player's points."],
          ["Tie-breaks", "Goals + assists, then fewer minutes, then player ID."],
          ["Holders", "Paid pro rata to tokens held at the kickoff snapshot, including liquidity-pool shares. Trading stays open."],
        ]}
      />
      <h2 className="text-lg font-semibold">Board multipliers</h2>
      <div className="rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5 py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Board</TableHead>
              <TableHead className="text-right">Multiplier</TableHead>
              <TableHead className="text-right">Weight with 5 players</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(
              [
                ["Champions League", 1.05],
                ["Position boards (each)", 1],
                ...LEAGUES.map((l) => [LEAGUE_NAMES[l], COEFFICIENTS[l]] as [string, number]),
              ] as [string, number][]
            ).map(([n, m]) => (
              <TableRow key={n}>
                <TableCell>{n}</TableCell>
                <TableCell className="num text-right">×{m.toFixed(2)}</TableCell>
                <TableCell className="num text-right">{(5 * m).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Worked example</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-soft">
          League weekend, every board has 5+ ranked players, round pool $10,000. Weights: 4 × 5.00 + 32.05 = 52.05. Premier League board = $10,000 ×
          5 ÷ 52.05 = $960.61; #1 gets 35% = $336.22. A player who is #1 FWD and #1 Premier League earns $672.43. A holder with 1% of that
          player&apos;s eligible tokens gets $6.72.
        </CardContent>
      </Card>
      <h2 className="text-lg font-semibold">Round pool matrix</h2>
      <p className="text-sm text-soft">
        Each round pays a share of the dividend vault, set by runway (vault ÷ average payout, in rounds) and the vault&apos;s share of TVL. Changes
        are limited to ±10% a round, bounded 0.20–2.50%, and payouts can&apos;t exceed 12% of TVL a year. Dividends are never promised: the vault can
        shrink but never hit zero.
      </p>
      <div className="rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5 py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Runway \ Vault/TVL</TableHead>
              {["<5%", "5–15%", "15–30%", ">30%"].map((h) => (
                <TableHead key={h} className="text-right">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {CONTROLLER_MATRIX_BPS.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{runway[i]} rounds</TableCell>
                {r.map((v, j) => (
                  <TableCell key={j} className="num text-right">
                    {(v / 100).toFixed(2)}%
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {stats.data ? (
        <div className="grid grid-cols-2 gap-4 rounded-2xl bg-surface ring-1 ring-edge ring-inset p-5 sm:grid-cols-4">
          <Stat label="Pool this round" value={formatUsd(stats.data.roundPool.usd, { decimals: 0 })} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- fees

function SellTaxSlider() {
  const [days, setDays] = useState(30);
  const W = 640;
  const H = 120;
  const pts = Array.from({ length: 61 }, (_, i) => i * 2);
  const d = pts.map((x, i) => `${i ? "L" : "M"}${((x / 120) * W).toFixed(1)} ${(H - 8 - ((sellTaxRate(x) - 0) / 0.05) * (H - 16)).toFixed(1)}`).join("");
  const cx = (days / 120) * W;
  const cy = H - 8 - (sellTaxRate(days) / 0.05) * (H - 16);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sell tax by holding time</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Slider value={[days]} min={0} max={120} step={1} onValueChange={(v) => setDays(v[0] ?? 0)} aria-label="Days held" />
          <span className="num w-40 text-right text-sm" data-testid="tax-readout">
            {days} days → {formatPct(sellTaxRate(days))}
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-foreground" aria-hidden="true">
          <path d={d} fill="none" stroke="currentColor" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={5} fill="currentColor" />
        </svg>
      </CardContent>
    </Card>
  );
}

function HowItWorksDoc() {
  return (
    <div className="flex flex-col gap-6">
      <Cards
        items={[
          ["Launch", "Every player starts on a bonding curve, so the earlier you buy the cheaper they are. At $25,000 raised the player bonds: the liquidity is locked and the player becomes tradeable."],
          ["Trade", "Buy and sell shares in any bonded player at any time, including through a matchday. Buys pay 0.05%; sells pay a tax that falls from 5% to 0.5% over 90 days of holding."],
          ["Matchday rewards", "Hold a player when a matchday kicks off and you share the pool if they finish in an earning position on a board. Paid in USDC, or in more of the same player with a 10% bonus."],
          ["The vault", "Every bond and every sell-side fee tops up the dividend vault. Each matchday pays out a slice of it, set by the controller."],
          ["Boards", "Four position boards across all leagues (FWD, MID, DEF, GK), plus a Champions League board in midweek. Forwards, midfielders and defenders pay the top 5; goalkeepers the top 3."],
          ["Snapshot", "One snapshot at each matchday's first kickoff decides who is eligible. Trading stays open all weekend; only tokens held at that snapshot count."],
        ]}
      />
      <h2 className="text-lg font-semibold">The maths</h2>
      <Cards
        items={[
          ["Curve", "USDC raised after S tokens sold: R(S) = 0.00039·S + S³ / 1.1649e16. Spot price is the derivative, P(S) = 0.00039 + S² / 3.883e15, so each buy moves the price up."],
          ["Bonding", "At $25,000 raised about 6.4M tokens have sold (80% of the 8M float). The pool opens at about $0.0109 with the remaining 1.6M."],
          ["Score", "A player's raw points P come from goals, assists, minutes and clean sheets, scaled by the league and competition coefficient. Display score = 10·P / (P + 6), shown 0-10."],
          ["Board weight", "weight = players ranked (capped at the paid places: 5, or 3 for goalkeepers) × the board multiplier. Each board's share of the pool is its weight over the total weight."],
          ["Payout split", "Forwards, midfielders, defenders: 35 / 25 / 20 / 12 / 8%. Goalkeepers: 44 / 31 / 25%. Rank only, no market-cap weighting."],
          ["Holder share", "A board's USD is split across holders pro rata to tokens held at the kickoff snapshot, including liquidity-pool shares."],
          ["Tie-breaks", "Points, then goals + assists, then fewer minutes, then player ID ascending."],
        ]}
      />
    </div>
  );
}

function FeesDoc() {
  return (
    <div className="flex flex-col gap-6">
      <Cards
        items={[
          ["Curve", "Starts at $0.00039 and steepens. $25k raised sells about 6.4M tokens, 80% of the 8M float."],
          ["Bonding", "The pool opens at about $0.0109 with the other 1.6M float tokens. Early buyers pay about $0.0039 on average."],
          ["Launch fee", "Flat 1.25% on buys and sells until the player bonds."],
          ["After bonding", "Buys pay 0.05%. Sells pay a tax of 5% falling to 0.5% over 90 days of holding. Swaps also pay a proposed 0.25% to liquidity providers."],
          ["Fee split", "Buy-side fees: 100% treasury. Sell-side fees (launch and pool): 90% dividend vault, 10% treasury."],
          ["Bonding proceeds", "70% locked pool seed, 20% dividend vault, 10% treasury."],
          ["Limits", "During launch: max 240,000 tokens (3% of the float) per purchase and per account."],
        ]}
      />
      <SellTaxSlider />
    </div>
  );
}

function DividendsDoc() {
  return (
    <Cards
      items={[
        ["Supply", "10M tokens per player: 8M float (curve + pool) and a 2M dividend reserve."],
        ["Choice", "Take dividends in USDC, or in the same player's tokens with a 10% bonus."],
        ["Reserve", "Tokens are minted from the reserve only when holders choose them, so supply never exceeds 10M."],
        ["When empty", "Once a player's reserve runs out, dividends for that player are USDC only."],
        ["Prizes", "Up to 25% of the reserve can fund airdrops and prizes."],
        ["Why", "Token claims leave the USDC in the vault, which extends runway for everyone."],
        ["Not guaranteed", "Dividends depend on the vault, a controller that can reduce them, and the launches and sell taxes that fund it."],
      ]}
    />
  );
}

function LiquidityDoc() {
  return (
    <div className="flex flex-col gap-6">
      <Cards
        items={[
          ["Add liquidity", "Anyone can add USDC and a player's token to its pool from the player page, and earn a share of trading fees."],
          ["Fee (proposed)", "0.25% of each swap stays in the pool for LPs, separate from the sell tax and buy fee."],
          ["Locked seed", "The 70% seed from bonding is permanent. Only delisting releases it."],
          ["Impermanent loss", "LPs end up holding less of whichever side rises. The player page shows an estimate."],
          ["Snapshots at kickoff", "Liquidity changes stay open during matchdays. LP shares are recorded at kickoff and earn dividends on their tokens."],
          ["Holding age", "Tokens keep their weighted holding age through the pool, so LPs can't reset the sell tax."],
          ["Both sides or USDC only", "Add USDC and tokens together, or USDC only and we swap half for you."],
        ]}
      />
      <IlCalculator ticker="the token" />
    </div>
  );
}

function GovernanceDoc() {
  return (
    <Cards
      items={[
        ["Launches", "10 launches a week for 20 weeks to reach 200 players, then 1 a week."],
        ["Choosing", "From Season 1, holders vote on each new launch, weighted by activity rank."],
        ["Visibility", "Voting power and tiers are shown once Season 1 begins."],
        ["Delisting", "Only if a player leaves the eight covered leagues (the top five, Eredivisie, Belgian Pro League, Liga Portugal) or retires. Never for form."],
        ["Process", "Announced at least 2 rounds ahead. Then trading locks and holders redeem pro rata from the pool with no sell tax."],
        ["Parameters", "Changed only through a published, time-locked process."],
      ]}
    />
  );
}

