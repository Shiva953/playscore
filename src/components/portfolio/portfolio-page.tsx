"use client";

import Link from "next/link";
import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { PLAYERS_BY_ID, type PositionCode } from "@score/core";
import { Button } from "@/components/ui/button";
import { Delta, LiveFigure, Section, Sparkline, Ticker } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/common/states";
import { UsdcIcon } from "@/components/common/usdc";
import { UserAvatar } from "@/components/common/user-avatar";
import { formatCountdown, formatDate, formatPct, formatRelative, formatTokens, formatUsd, shortAddress } from "@/lib/format";
import type { ActivityItem, Portfolio, PositionView } from "@/lib/protocol/types";
import { useFaucet, useNow, usePlayers, usePortfolio, useRound, useRoundHistory, useSession, useSignIn } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";
import { ClaimPanel } from "./claim-panel";
import { cn } from "@/lib/utils";
import { METHOD_LABEL } from "@/lib/protocol/labels";

/**
 * Portfolio as a consumer home (after Phantom's home, Robinhood's portfolio and the .fun profile pages):
 * who you are, one headline figure with its split, the claim moment (or your next chance to earn),
 * your players as cards, then activity in plain sentences, earnings per matchday and points.
 */
export function PortfolioPage() {
  const session = useSession();
  const pf = usePortfolio();
  if (session.isPending || (session.data && pf.isPending)) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <LoadingBlock className="h-16" />
        <LoadingBlock className="h-44" />
        <LoadingBlock className="h-64" />
      </div>
    );
  }
  if (!session.data) return <SignedOut />;
  if (pf.isError || !pf.data) return <ErrorState error={pf.error} onRetry={() => void pf.refetch()} />;
  const d = pf.data;
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <Profile d={d} />
        <Hero d={d} />
        {d.claimable.totalUsd > 0.005 ? <ClaimCard /> : <NextChance d={d} />}
      </div>
      <Squad d={d} />
      {d.lp.length ? <Liquidity d={d} /> : null}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <Activity items={d.history} />
        <div className="flex flex-col gap-10 lg:gap-6">
          <Earnings />
          <Points d={d} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- who you are

function Profile({ d }: { d: Portfolio }) {
  const faucet = useFaucet();
  const s = d.user;
  const method = METHOD_LABEL[s.method];
  const copy = () => void navigator.clipboard?.writeText(s.address).then(() => toast.success("Address copied"));
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <UserAvatar seed={s.address} size={56} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <h1 className="mono-id truncate text-[18px] text-ink">
              <span className="sr-only">Portfolio of </span>
              {shortAddress(s.address, 6)}
            </h1>
            <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy address">
              <Copy aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[12px] font-medium">
            <span className="rounded-full bg-up-tint px-2 py-0.5 text-up">Devnet</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-soft">{method}</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-soft">Since {formatDate(s.createdAt)}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => faucet.mutate(1_000)} disabled={faucet.isPending}>
          Top up
        </Button>
        {d.claimable.totalUsd > 0.005 ? (
          <Button asChild>
            <a href="#claim">Claim {formatUsd(d.claimable.totalUsd)}</a>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- the headline figure and its split

/** Dark-mode slots 1–3 of the dataviz reference palette, validated on #111 (all checks pass). */
const SPLIT = [
  { key: "cash", label: "Cash", color: "#3987e5" },
  { key: "players", label: "Players", color: "#d95926" },
  { key: "lp", label: "Liquidity", color: "#199e70" },
] as const;

function Hero({ d }: { d: Portfolio }) {
  const cents = formatUsd(d.totalValue).split(".")[1] ?? "00";
  const values = { cash: d.usdc, players: d.positionsValue, lp: d.lpValue };
  return (
    <section aria-label="Portfolio value" data-testid="portfolio-summary" className="grid gap-6 rounded-2xl bg-surface p-5 md:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-end">
      <div className="flex flex-col gap-3">
        <span className="text-[13px] text-soft">Portfolio value</span>
        <span className="fig fig-prop flex items-baseline leading-none" aria-label={formatUsd(d.totalValue)}>
          <LiveFigure value={d.totalValue} format={(n) => formatUsd(n).split(".")[0]!} tick className="fig-prop text-[52px] font-semibold tracking-[-0.03em] text-ink" />
          <span className="text-[28px] font-medium text-soft">.{cents}</span>
        </span>
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-semibold", d.pnl < 0 ? "bg-down-tint" : "bg-up-tint")}>
            <Delta value={d.pnl}>{formatUsd(d.pnl, { signed: true })}</Delta>
            <span className="text-[12px] font-medium text-soft">all time</span>
          </span>
          {d.dividendsEarned > 0.005 ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-raised px-3">
              <span className="fig font-semibold text-up">{formatUsd(d.dividendsEarned)}</span>
              <span className="text-[12px] text-soft">earned from boards</span>
            </span>
          ) : null}
        </div>
      </div>
      <Split values={values} total={Math.max(d.totalValue, 0.01)} />
    </section>
  );
}

/** Tall segmented bar (dataviz): 28px, 4px block corners, 2px surface gaps, share printed where it fits, names in the legend. */
function Split({ values, total }: { values: Record<(typeof SPLIT)[number]["key"], number>; total: number }) {
  const parts = SPLIT.map((p) => ({ ...p, value: values[p.key], share: values[p.key] / total })).filter((p) => p.value > 0.005);
  const label = parts.map((p) => `${p.label} ${formatUsd(p.value)}, ${formatPct(p.share, { decimals: 0 })}`).join("; ");
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={`Split: ${label}`} className="flex h-7 gap-[2px]">
        {parts.map((p) => (
          <span
            key={p.key}
            title={`${p.label}: ${formatUsd(p.value)} (${formatPct(p.share, { decimals: 1 })})`}
            className="flex min-w-1 items-center overflow-hidden rounded-[4px] px-2 text-[12px] font-semibold text-black"
            style={{ flexGrow: p.share, flexBasis: 0, background: p.color }}
          >
            {p.share >= 0.12 ? formatPct(p.share, { decimals: 0 }) : null}
          </span>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: p.color }} />
            <span className="text-soft">{p.label}</span>
            <span className="fig text-ink">{formatUsd(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- the moment

function ClaimCard() {
  return (
    <section id="claim" aria-label="Claimable dividends" className="rounded-2xl bg-surface p-5 ring-1 ring-up/25 md:p-6">
      <ClaimPanel />
    </section>
  );
}

/** Nothing to claim: say when the next chance to earn is, in one line. */
function NextChance({ d }: { d: Portfolio }) {
  const r = useRound((x) => ({ round: x.round, phase: x.phase, endsAt: x.phaseEndsAt, provisional: x.my.provisionalUsd, counted: x.my.players.length }));
  const now = useNow();
  if (!r.data) return null;
  const left = now ? formatCountdown(Math.max(0, r.data.endsAt - now)) : "";
  const counting = d.positions.filter((p) => p.countsNextKickoff).length;
  const line =
    r.data.phase === "open"
      ? `Matchday ${r.data.round} kicks off in ${left}. ${counting ? `${counting} of your players will count.` : "Hold a bonded player by then to earn."}`
      : r.data.phase === "live"
        ? `Matchday ${r.data.round} is live. ${r.data.counted ? `You'd take ${formatUsd(r.data.provisional)} if it ended now.` : "None of your players were held at kickoff."}`
        : `Full time. Payouts land here when the data freezes in ${left}.`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-5 py-4">
      <p className="text-[14px] text-soft">
        <span className={cn("mr-2 inline-block size-2 rounded-full align-middle", r.data.phase === "live" ? "bg-up" : "bg-soft")} aria-hidden="true" />
        {line}
      </p>
      <Link href="/matchday" className="text-[13px] text-ink underline decoration-control underline-offset-4 hover:decoration-ink">
        Open matchday
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------- your players

const POS_TINT: Record<PositionCode, string> = { FWD: "bg-pos-fwd/15 text-pos-fwd", MID: "bg-pos-mid/15 text-pos-mid", DEF: "bg-pos-def/15 text-pos-def", GK: "bg-pos-gk/15 text-pos-gk" };

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Squad({ d }: { d: Portfolio }) {
  const players = usePlayers();
  const spark = new Map((players.data ?? []).map((p) => [p.id, p.sparkline]));
  const rows = [...d.positions].sort((a, b) => b.value - a.value);
  return (
    <Section title="Your players" description={rows.length ? `${rows.length} held, worth ${formatUsd(d.positionsValue)}` : undefined} id="positions">
      {rows.length === 0 ? (
        <EmptyState
          title="No players yet"
          action={
            <Button asChild size="sm">
              <Link href="/trade">Find players</Link>
            </Button>
          }
        >
          Buy a launching player on the curve, or a bonded one in its pool. Players you hold at kickoff earn from their board finishes.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <li key={p.playerId}>
              <PlayerTile p={p} spark={spark.get(p.playerId) ?? []} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PlayerTile({ p, spark }: { p: PositionView; spark: number[] }) {
  return (
    <Link
      href={`/player/${p.playerId}`}
      className="group flex h-full flex-col gap-4 rounded-2xl bg-surface p-4 transition-colors duration-150 hover:bg-[#161616] focus-visible:outline-2 focus-visible:outline-ink"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", POS_TINT[p.position])}>
          {initials(p.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-medium text-ink">{p.name}</span>
          <Ticker ticker={p.ticker} className="text-[12px] text-soft" />
        </span>
        <Sparkline values={spark} width={64} height={24} className="ml-auto shrink-0" />
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="fig fig-prop text-[22px] leading-7 font-semibold text-ink">{formatUsd(p.value)}</span>
          <span className="fig text-[12px] text-soft">{formatTokens(p.tokens)} tokens</span>
        </span>
        <span className={cn("rounded-full px-2.5 py-1 text-[13px] font-semibold", p.pnl < 0 ? "bg-down-tint" : "bg-up-tint")}>
          <Delta value={p.pnlPct} />
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-rule pt-3 text-[12px]">
        {p.countsNextKickoff ? (
          <span className="flex items-center gap-1.5 text-ink">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-up" />
            Counts at kickoff
          </span>
        ) : (
          <span className="text-soft">Counts once it bonds</span>
        )}
        <span className="text-soft">
          Sell tax <span className="fig text-ink">{formatPct(p.sellTaxNow, { decimals: 1 })}</span>
        </span>
      </div>
    </Link>
  );
}

function Liquidity({ d }: { d: Portfolio }) {
  return (
    <Section title="Liquidity" description={`Earning 0.25% of every swap in ${d.lp.length} pool${d.lp.length > 1 ? "s" : ""}`} id="lp">
      <ul className="flex flex-col divide-y divide-rule rounded-2xl bg-surface px-5">
        {d.lp.map((l) => (
          <li key={l.playerId} className="flex flex-wrap items-center justify-between gap-3 py-3.5 text-[14px]">
            <Link href={`/player/${l.playerId}`} className="flex items-center gap-2 hover:underline">
              <Ticker ticker={l.ticker} className="text-ink" />
              <span className="text-soft">pool, {formatPct(l.poolShare, { decimals: 3 })} share</span>
            </Link>
            <span className="flex items-center gap-4">
              <span className="text-soft">
                Fees <span className="fig text-up">{formatUsd(l.feesEarnedUsd)}</span>
              </span>
              <span className="fig font-medium text-ink">{formatUsd(l.valueUsd)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- what happened

function sentence(a: ActivityItem): { text: string; amount: string; tone: "up" | "ink" | "soft" } {
  const t = a.ticker ? `$${a.ticker}` : "";
  const tok = a.tokens ? formatTokens(a.tokens) : "";
  switch (a.kind) {
    case "buy":
      return { text: `Bought ${tok} ${t}`, amount: `−${formatUsd(a.usdc)}`, tone: "ink" };
    case "sell":
      return { text: `Sold ${tok} ${t}`, amount: `+${formatUsd(a.usdc)}`, tone: "ink" };
    case "dividend":
      return { text: t ? `${t} finished top five` : "Your players finished top five", amount: `+${formatUsd(a.usdc)}`, tone: "up" };
    case "claim-usdc":
      return { text: "Claimed dividends in USDC", amount: `+${formatUsd(a.usdc)}`, tone: "up" };
    case "claim-tokens":
      return { text: `Claimed ${tok ? `${tok} tokens` : "dividends in tokens"}`, amount: formatUsd(a.usdc), tone: "up" };
    case "lp-add":
      return { text: `Added liquidity to ${t}`, amount: `−${formatUsd(a.usdc)}`, tone: "ink" };
    case "lp-remove":
      return { text: `Removed liquidity from ${t}`, amount: `+${formatUsd(a.usdc)}`, tone: "ink" };
    case "faucet":
      return { text: "Topped up test USDC", amount: `+${formatUsd(a.usdc)}`, tone: "soft" };
  }
}

function Activity({ items }: { items: ActivityItem[] }) {
  const now = useNow();
  const [all, setAll] = useState(false);
  const shown = all ? items.slice(0, 60) : items.slice(0, 8);
  return (
    <Section title="Activity" id="history" action={items.length > 8 ? <Button variant="link" size="sm" onClick={() => setAll((v) => !v)}>{all ? "Show less" : `Show all ${Math.min(items.length, 60)}`}</Button> : undefined}>
      {items.length === 0 ? (
        <EmptyState title="Nothing yet">Your buys, sells, payouts and claims show up here.</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-rule rounded-2xl bg-surface px-5" data-testid="history">
          {shown.map((a) => {
            const s = sentence(a);
            return (
              <li key={a.id} className="flex items-center gap-3 py-3">
                {a.playerId && PLAYERS_BY_ID[a.playerId] ? (
                  <span
                    aria-hidden="true"
                    className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", POS_TINT[PLAYERS_BY_ID[a.playerId]!.position])}
                  >
                    {initials(PLAYERS_BY_ID[a.playerId]!.name)}
                  </span>
                ) : (
                  <UsdcIcon className="size-8" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] text-ink">{s.text}</span>
                  <span className="truncate text-[12px] text-faint">{a.detail}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className={cn("fig text-[14px] font-medium", s.tone === "up" ? "text-up" : s.tone === "soft" ? "text-soft" : "text-ink")}>{s.amount}</span>
                  <span className="text-[12px] text-faint">{now ? formatRelative(a.at, now) : ""}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** Dividends per matchday as columns (dataviz bars: ≤24px, 4px rounded top, square base). One series, no legend. */
function Earnings() {
  const q = useRoundHistory(10);
  const [hi, setHi] = useState<number | null>(null);
  const rows = [...(q.data ?? [])].sort((a, b) => a.round - b.round);
  const max = Math.max(...rows.map((r) => r.myDividends), 0.01);
  const total = rows.reduce((a, r) => a + r.myDividends, 0);
  const shown = hi !== null ? rows[hi] : rows[rows.length - 1];
  return (
    <Section title="Earnings by matchday">
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-5">
        {rows.length === 0 ? (
          <p className="text-[14px] text-soft">No matchday has settled yet. Payouts appear here after each data freeze.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="fig fig-prop text-[22px] font-semibold text-ink">{formatUsd(total)}</span>
              <span className="text-[12px] text-soft">
                {shown ? (
                  <>
                    Matchday {shown.round}: <span className="fig text-ink">{formatUsd(shown.myDividends)}</span>
                  </>
                ) : null}
              </span>
            </div>
            <ol className="flex h-24 items-end gap-[2px] border-b border-rule" aria-label="Your dividends per matchday">
              {rows.map((r, i) => (
                <li
                  key={r.round}
                  className="flex h-full flex-1 items-end justify-center"
                  onPointerEnter={() => setHi(i)}
                  onPointerLeave={() => setHi(null)}
                  aria-label={`Matchday ${r.round}: ${formatUsd(r.myDividends)}`}
                >
                  <span
                    className="block w-full max-w-6 rounded-t-[4px] bg-up transition-opacity duration-150"
                    style={{ height: `${Math.max(r.myDividends > 0 ? 4 : 0, (r.myDividends / max) * 100)}%`, opacity: hi === null || hi === i ? 1 : 0.5 }}
                  />
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </Section>
  );
}

function Points({ d }: { d: Portfolio }) {
  const p = d.points;
  const rows: [string, number][] = [
    ["Holding at kickoff", p.holding],
    ["Launch buys", p.launch],
    ["Dividends", p.dividends],
    ["Liquidity", p.liquidity],
    ["Volume", p.volume],
    ["Fees paid", p.fees],
  ];
  return (
    <Section title="Activity points">
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-5">
        <span className="fig fig-prop text-[22px] font-semibold text-ink">{formatTokens(p.total)}</span>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-soft">{k}</dt>
              <dd className="fig text-ink">{formatTokens(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12px] text-faint">From Season 1, points become voting weight for new launches. The weighting isn&apos;t final.</p>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- signed out

/**
 * Signed out (PLAN 1B.5): a way in on top (sign in, or a one-step demo account that seeds a few holdings),
 * then what a portfolio looks like, drawn from live prices and labelled as an example.
 */
function SignedOut() {
  const openSignIn = useUi((s) => s.openSignIn);
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="pf-signin" className="flex flex-col gap-5 rounded-2xl bg-surface p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex flex-col gap-2">
          <h1 id="pf-signin" className="text-[28px] leading-8 font-semibold tracking-[-0.02em] text-ink">
            Your players and payouts live here
          </h1>
          <p className="max-w-[52ch] text-[15px] leading-relaxed text-soft">
            Sign in with email, Google or Phantom and a wallet is made for you, with 1,000 test USDC on devnet. Or open a demo account that already holds a few players.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="lg" onClick={openSignIn}>
            Sign in
          </Button>
          <DemoAccountButton />
        </div>
      </section>
      <ExamplePortfolio />
    </div>
  );
}

/** One step: our country and Terms defaults for the devnet demo, then a seeded account. */
function DemoAccountButton() {
  const signIn = useSignIn();
  return (
    <Button
      size="lg"
      variant="secondary"
      disabled={signIn.isPending}
      onClick={() => signIn.mutate({ method: "demo", country: "Germany", acceptedTerms: true })}
    >
      {signIn.isPending ? "Opening…" : "Try a demo account"}
    </Button>
  );
}

/** The example: five live players at today's prices, bought a little lower, so the figures move with the market. */
const EXAMPLE_STAKES = [220, 160, 120, 90, 60];

function ExamplePortfolio() {
  const players = usePlayers();
  if (players.isPending) return <LoadingBlock className="h-64" />;
  const pick = (players.data ?? [])
    .filter((p) => p.status === "trading")
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, EXAMPLE_STAKES.length);
  if (!pick.length) return null;
  const positions: PositionView[] = pick.map((p, i) => {
    const value = EXAMPLE_STAKES[i]!;
    const costBasis = value / (1 + [0.18, 0.07, -0.04, 0.22, 0.03][i]!);
    return {
      playerId: p.id,
      ticker: p.ticker,
      name: p.name,
      position: p.position,
      status: p.status,
      tokens: value / Math.max(p.price, 1e-9),
      price: p.price,
      value,
      costBasis,
      pnl: value - costBasis,
      pnlPct: value / costBasis - 1,
      holdAgeDays: 9,
      sellTaxNow: 0.02,
      realisableUsd: value * 0.97,
      curvePurchased: 0,
      snapshotTokens: null,
      countsNextKickoff: true,
    };
  });
  const positionsValue = positions.reduce((a, p) => a + p.value, 0);
  const pnl = positions.reduce((a, p) => a + p.pnl, 0);
  const usdc = 352.4;
  const spark = new Map(pick.map((p) => [p.id, p.sparkline]));
  const example = { usdc, positionsValue, lpValue: 0, totalValue: usdc + positionsValue, pnl, dividendsEarned: 41.6 } as Portfolio;
  return (
    <section aria-labelledby="pf-example" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pf-example" className="text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">
          An example portfolio
        </h2>
        <p className="text-[13px] text-soft">Not a real account. Live prices, made-up holdings.</p>
      </div>
      <div aria-hidden="true" inert className="flex flex-col gap-4 select-none">
        <Hero d={example} />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {positions.map((p) => (
            <li key={p.playerId}>
              <PlayerTile p={p} spark={spark.get(p.playerId) ?? []} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
