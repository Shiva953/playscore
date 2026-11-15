"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Copy } from "lucide-react";
import { toast } from "sonner";
import { PLAYERS_BY_ID } from "@score/core";
import { PlayerAvatar } from "@/components/common/kit";
import { orbAddressUrl } from "@/lib/solana/explorer";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Delta, LiveFigure, Section, Sparkline, Ticker } from "@/components/common/bits";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/common/states";
import { PortfolioSkeleton } from "@/components/common/skeletons";
import { UsdcIcon } from "@/components/common/usdc";
import { UserAvatar } from "@/components/common/user-avatar";
import { formatCountdown, formatDate, formatPct, formatRelative, formatTokens, formatUsd, shortAddress } from "@/lib/format";
import type { ActivityItem, Portfolio, PositionView } from "@/lib/protocol/types";
import { useCash, useFaucet, useNow, usePlayers, usePortfolio, useRound, useRoundHistory, useSession, useSignIn } from "@/lib/protocol/react/hooks";
import { useUi } from "@/lib/protocol/react/ui-store";
import { ClaimPanel } from "./claim-panel";
import { PortfolioHero } from "./value-chart";
import { cn } from "@/lib/utils";
import { methodLabel } from "@/lib/protocol/labels";
import { useProtocolClient } from "@/lib/protocol/react/provider";

/**
 * Portfolio as a consumer home (after Phantom's home, Robinhood's portfolio and the .fun profile pages):
 * who you are, one headline figure with its split, the claim moment (or your next chance to earn),
 * your players as cards, then activity in plain sentences, earnings per matchday and points.
 */
export function PortfolioPage() {
  const session = useSession();
  const pf = usePortfolio();
  // A claim empties `claimable` the moment it lands; the card stays until it has shown what it paid.
  const [claiming, setClaiming] = useState(false);
  if (session.isPending || (session.data && pf.isPending)) {
    return <PortfolioSkeleton />;
  }
  if (!session.data) return <SignedOut />;
  if (pf.isError || !pf.data) return <ErrorState error={pf.error} onRetry={() => void pf.refetch()} />;
  const d = pf.data;
  return (
    <div className="content-in flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <Profile d={d} />
        <Hero d={d} />
        {d.claimable.totalUsd > 0.005 || claiming ? <ClaimCard onBusy={setClaiming} /> : <NextChance d={d} />}
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
  const mode = useProtocolClient().mode;
  const s = d.user;
  const method = methodLabel(s.method, mode);
  const copy = () => void navigator.clipboard?.writeText(s.address).then(() => toast.success("Address copied"));
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <UserAvatar seed={s.address} size={56} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <h1 className="mono-id truncate text-[1.125rem] font-normal text-ink">
              <span className="sr-only">Portfolio of </span>
              {/* The address opens the wallet on Orb; underlined on hover and focus, like any link. */}
              <a
                href={orbAddressUrl(s.address)}
                target="_blank"
                rel="noopener noreferrer"
                title="View this wallet on Orb"
                className="rounded-sm decoration-soft underline-offset-4 transition-colors duration-150 hover:underline focus-visible:underline"
              >
                {shortAddress(s.address, 6)}
                <span className="sr-only"> (view on Orb, opens in a new tab)</span>
              </a>
            </h1>
            <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy address">
              <Copy aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[0.75rem] font-medium">
            <span className="rounded-full bg-raised px-2 py-0.5 text-soft">Devnet</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-soft">{method}</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-soft">Since {formatDate(s.createdAt)}</span>
          </div>
        </div>
      </div>
      {d.claimable.totalUsd > 0.005 ? (
        <Button asChild>
          <a href="#claim">Claim {formatUsd(d.claimable.totalUsd)}</a>
        </Button>
      ) : null}
    </header>
  );
}

// ---------------------------------------------------------------- the headline figure and its split

/**
 * What you own, by kind, each in the hue it has everywhere else (15 Nov: this was three greys, and the
 * biggest block of colourless chrome on the page). Cash is USDC's blue, the coin beside every cash figure;
 * players are gold, the colour of holding and of what pays; liquidity is pool water. One hue per kind,
 * three kinds: a chart telling series apart, which is where colour belongs. Dark labels measure 7:1+ on each.
 */
const SPLIT = [
  { key: "cash", label: "Cash", color: "var(--cash)" },
  { key: "players", label: "Players", color: "var(--brand)" },
  { key: "lp", label: "Liquidity", color: "var(--pool)" },
] as const;

function Hero({ d, example = false }: { d: Portfolio; example?: boolean }) {
  const faucet = useFaucet();
  const devnet = useProtocolClient().mode === "devnet";
  const openFunds = useUi((x) => x.openFunds);
  const cash = useCash();
  const actions = devnet ? (
    <>
      <Button onClick={() => openFunds("deposit")}>
        <ArrowDownToLine aria-hidden="true" />
        Deposit
      </Button>
      <Button variant="secondary" onClick={() => openFunds("withdraw")}>
        <ArrowUpFromLine aria-hidden="true" />
        Withdraw
      </Button>
    </>
  ) : (
    <Button variant="secondary" onClick={() => faucet.mutate(1_000)} disabled={faucet.isPending}>
      Top up
    </Button>
  );
  return (
    <PortfolioHero d={d} arriving={example ? 0 : cash.arriving} actions={example ? null : actions}>
      <Split values={{ cash: d.usdc, players: d.positionsValue, lp: d.lpValue }} total={Math.max(d.totalValue, 0.01)} />
    </PortfolioHero>
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
            className="flex min-w-1 items-center overflow-hidden rounded-[4px] px-2 text-[0.75rem] font-semibold text-ground"
            style={{ flexGrow: p.share, flexBasis: 0, background: p.color }}
          >
            {p.share >= 0.12 ? formatPct(p.share, { decimals: 0 }) : null}
          </span>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[0.8125rem]">
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

function ClaimCard({ onBusy }: { onBusy: (busy: boolean) => void }) {
  return (
    <section id="claim" aria-label="Claimable dividends" className="rounded-2xl bg-surface p-5 ring-1 ring-brand/30 md:p-6">
      <ClaimPanel onBusy={onBusy} />
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5 py-4">
      <p className="text-[0.875rem] text-soft">
        <span className={cn("mr-2 inline-block size-2 rounded-full align-middle", r.data.phase === "ended" ? "bg-soft" : "bg-brand")} aria-hidden="true" />
        {line}
      </p>
      <Link href="/matchday" className="text-[0.8125rem] text-ink underline decoration-control underline-offset-4 hover:decoration-ink">
        Open matchday
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------- your players

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
      className="group flex h-full flex-col gap-4 rounded-2xl bg-surface ring-1 ring-edge ring-inset p-4 transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink"
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar id={p.playerId} size={48} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[0.9375rem] font-medium text-ink">{p.name}</span>
          <Ticker ticker={p.ticker} className="text-[0.75rem] text-soft" />
        </span>
        <Sparkline values={spark} width={64} height={24} className="ml-auto shrink-0" />
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <LiveFigure value={p.value} format={(n) => formatUsd(n)} className="fig-prop text-[1.5rem] leading-[1.17] text-ink" />
          <span className="fig text-[0.75rem] text-soft">{formatTokens(p.tokens)} tokens</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <Delta value={p.pnl} className="text-[0.9375rem] font-semibold">
            {formatUsd(p.pnl, { signed: true })}
          </Delta>
          <span className={cn("rounded-full px-2 py-0.5 text-[0.75rem] font-semibold", p.pnl < 0 ? "bg-down-tint" : "bg-up-tint")}>
            <Delta value={p.pnlPct} />
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-rule pt-3 text-[0.75rem]">
        {p.countsNextKickoff ? (
          <span className="flex items-center gap-1.5 text-ink">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
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
      <ul className="flex flex-col divide-y divide-rule rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5">
        {d.lp.map((l) => (
          <li key={l.playerId} className="flex flex-wrap items-center justify-between gap-3 py-3.5 text-[0.875rem]">
            <Link href={`/player/${l.playerId}`} className="flex items-center gap-2 hover:underline">
              <Ticker ticker={l.ticker} className="text-ink" />
              <span className="text-soft">pool, {formatPct(l.poolShare, { decimals: 3 })} share</span>
            </Link>
            <span className="flex items-center gap-4">
              <span className="text-soft">
                Fees <span className="fig text-brand">{formatUsd(l.feesEarnedUsd)}</span>
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
      return { text: `Bought ${[tok, t].filter(Boolean).join(" ")}`, amount: `−${formatUsd(a.usdc)}`, tone: "ink" };
    case "sell":
      return { text: `Sold ${[tok, t].filter(Boolean).join(" ")}`, amount: `+${formatUsd(a.usdc)}`, tone: "ink" };
    case "dividend":
      return { text: t ? `${t} finished top five` : "Your players finished top five", amount: `+${formatUsd(a.usdc)}`, tone: "up" };
    case "claim-usdc":
      return { text: "Claimed dividends in USDC", amount: `+${formatUsd(a.usdc)}`, tone: "up" };
    case "claim-tokens":
      return { text: `Claimed ${tok ? `${tok} tokens` : "dividends in tokens"}`, amount: a.usdc > 0 ? formatUsd(a.usdc) : "", tone: "up" };
    case "lp-add":
      return { text: `Added liquidity${t ? ` to ${t}` : ""}`, amount: `−${formatUsd(a.usdc)}`, tone: "ink" };
    case "lp-remove":
      return { text: `Removed liquidity${t ? ` from ${t}` : ""}`, amount: `+${formatUsd(a.usdc)}`, tone: "ink" };
    case "faucet":
      return { text: "Topped up test USDC", amount: `+${formatUsd(a.usdc)}`, tone: "soft" };
    case "deposit":
      return { text: "Deposit added to your cash", amount: `+${formatUsd(a.usdc)}`, tone: "soft" };
    case "withdraw":
      return { text: "Withdrew from your cash", amount: `−${formatUsd(a.usdc)}`, tone: "ink" };
    case "withdraw-returned":
      return { text: "Unused withdrawal returned", amount: `+${formatUsd(a.usdc)}`, tone: "soft" };
    case "order":
      return { text: a.detail.replace(/^Limit/, `Limit order on ${t}:`), amount: "", tone: "soft" };
    case "order-fill":
      return { text: `${/sell/.test(a.detail) ? "Limit sell" : "Limit buy"} filled · ${tok} ${t}`, amount: `${/sell/.test(a.detail) ? "+" : "−"}${formatUsd(a.usdc)}`, tone: "ink" };
    case "order-cancel":
      return { text: `Cancelled a limit order${t ? ` on ${t}` : ""}`, amount: "", tone: "soft" };
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
        <ul className="flex flex-col divide-y divide-rule rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5" data-testid="history">
          {shown.map((a) => {
            const s = sentence(a);
            return (
              <li key={a.id} className="flex items-center gap-3 py-3">
                {a.playerId && PLAYERS_BY_ID[a.playerId] ? (
                  <PlayerAvatar id={a.playerId} size={32} mark={false} className="rounded-[9px]" />
                ) : (
                  <UsdcIcon className="size-8" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[0.875rem] text-ink">{s.text}</span>
                  {/* The read model words money moves in wallet terms; the sentence already says it all. */}
                  {a.kind === "deposit" || a.kind === "withdraw" ? null : <span className="truncate text-[0.75rem] text-faint">{a.detail}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className={cn("fig text-[0.875rem] font-medium", s.tone === "up" ? "text-brand" : s.tone === "soft" ? "text-soft" : "text-ink")}>{s.amount}</span>
                  <span className="text-[0.75rem] text-faint">{now ? formatRelative(a.at, now) : ""}</span>
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
      <div className="flex flex-col gap-3 rounded-2xl bg-surface ring-1 ring-edge ring-inset p-5">
        {rows.length === 0 ? (
          <p className="text-[0.875rem] text-soft">No matchday has settled yet. Payouts appear here after each data freeze.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="fig fig-prop text-[1.5rem] text-ink">{formatUsd(total)}</span>
              <span className="text-[0.75rem] text-soft">
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
                    className="block w-full max-w-6 rounded-t-[4px] bg-brand transition-opacity duration-150"
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
      <div className="flex flex-col gap-3 rounded-2xl bg-surface ring-1 ring-edge ring-inset p-5">
        <span className="fig fig-prop text-[1.5rem] text-ink">{formatTokens(p.total)}</span>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[0.8125rem]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-soft">{k}</dt>
              <dd className="fig text-ink">{formatTokens(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[0.75rem] text-faint">From Season 1, points become voting weight for new launches. The weighting isn&apos;t final.</p>
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
  const devnet = useProtocolClient().mode === "devnet";
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="pf-signin" className="flex flex-col gap-5 rounded-2xl bg-surface ring-1 ring-edge ring-inset p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex flex-col gap-2">
          <h1 id="pf-signin" className="text-[2.125rem] leading-[1.06] font-semibold text-ink">
            Your players and payouts live here
          </h1>
          <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-soft">
            {devnet
              ? "Sign in and a Solana wallet is made for you, with 1,000 test USDC on devnet to trade real markets."
              : "Sign in with email, Google or Phantom and a wallet is made for you, with 1,000 test USDC on devnet. Or open a demo account that already holds a few players."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="lg" onClick={openSignIn}>
            Sign in
          </Button>
          {devnet ? null : <DemoAccountButton />}
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
    <ActionButton
      size="lg"
      variant="secondary"
      phase={signIn.isPending ? "pending" : signIn.isSuccess ? "success" : "idle"}
      pending="Setting up your account"
      success="Account ready"
      onClick={() => signIn.mutate({ method: "demo", country: "Germany", acceptedTerms: true })}
    >
      Try a demo account
    </ActionButton>
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
        <h2 id="pf-example" className="text-[1.25rem] leading-[1.4] font-semibold text-ink">
          An example portfolio
        </h2>
        <p className="text-[0.8125rem] text-soft">Not a real account. Live prices, made-up holdings.</p>
      </div>
      <div aria-hidden="true" inert className="flex flex-col gap-4 select-none">
        <Hero d={example} example />
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
