"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Countdown, Delta } from "@/components/common/bits";
import { Progress } from "@/components/ui/progress";
import { Logo } from "@/components/shell/app-header";
import { formatPct, formatPrice, formatUsd } from "@/lib/format";
import type { PlayerSummary } from "@/lib/protocol/types";
import { usePlayers, useRound, useStats } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/**
 * The product homepage (PLAN 1B.2), separate from the app: its own header and close, no tab bar.
 * Direction dealt by the taste skill: "the sentence is the layout" (.taste-skill/home, seed 1168320087).
 * Idea: a live player share sits inside the sentence where the noun would be; tap it for another player,
 * and the primary action buys whichever one is showing. Everything on the page is live mock data.
 * Three screens: the sentence, the launches and the money, the closing choice.
 */
export function LandingPage() {
  return (
    <div data-fullbleed className="flex flex-col bg-ground">
      <HomeHeader />
      <Hero />
      <Launches />
      <Money />
      <Close />
      <HomeFooter />
    </div>
  );
}

const FRAME = "mx-auto w-full max-w-[1440px] px-4 md:px-8";

function HomeHeader() {
  return (
    <header className="pt-[env(safe-area-inset-top)]">
      <div className={cn(FRAME, "flex h-16 items-center gap-8")}>
        <Logo />
        <nav aria-label="Product" className="hidden items-center gap-6 text-[14px] md:flex">
          <Link href="/launch" className="text-soft transition-colors duration-150 hover:text-ink">
            Launches
          </Link>
          <Link href="/trade" className="text-soft transition-colors duration-150 hover:text-ink">
            Trade
          </Link>
          <Link href="/matchday" className="text-soft transition-colors duration-150 hover:text-ink">
            Matchday
          </Link>
          <Link href="/docs/stats" className="text-soft transition-colors duration-150 hover:text-ink">
            How it works
          </Link>
        </nav>
        <Button asChild className="ml-auto">
          <Link href="/trade">Open the app</Link>
        </Button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- the sentence

/** The five most valuable trading players, the cast of the sentence's slot. */
function useCast(): PlayerSummary[] {
  const q = usePlayers();
  return useMemo(
    () =>
      (q.data ?? [])
        .filter((p) => p.status === "trading")
        .sort((a, b) => b.marketCap - a.marketCap)
        .slice(0, 5),
    [q.data]
  );
}

function Hero() {
  const cast = useCast();
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  // The slot moves on by itself until the visitor picks someone.
  useEffect(() => {
    if (held || cast.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [held, cast.length]);
  const p = cast.length ? cast[i % cast.length]! : null;
  const next = () => {
    setHeld(true);
    setI((n) => n + 1);
  };

  return (
    <section aria-labelledby="hero-title" className={cn(FRAME, "flex min-h-[calc(100svh-4rem)] flex-col justify-center gap-10 py-16 md:gap-12")}>
      <h1 id="hero-title" className="hero-mask text-[clamp(56px,10.5vw,168px)] leading-[0.96] font-semibold tracking-[-0.045em] text-ink">
        <span className="flex flex-wrap items-center gap-x-[0.22em]">
          <span>Buy</span>
          <PlayerSlot p={p} onNext={next} />
        </span>
        <span className="block">before kickoff.</span>
      </h1>
      <div className="flex max-w-[720px] flex-col gap-8">
        <p className="text-[clamp(17px,1.5vw,21px)] leading-[1.5] text-ink">
          Real footballers trade as shares. Hold one when a matchday kicks off, and if they finish top five on a board, you share the prize in USDC.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="h-12 px-6 text-[16px]">
            <Link href={p ? `/trade/${p.id}` : "/trade"}>Buy player shares</Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="h-12 px-6 text-[16px]">
            <Link href="/launch">Explore launches</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * The live thing: one player share, sized to a line of the headline, ticking with the market.
 * A real button (tap for the next player); its text is in the accessible name so the sentence still reads.
 */
function PlayerSlot({ p, onNext }: { p: PlayerSummary | null; onNext: () => void }) {
  if (!p) return <span aria-hidden="true" className="inline-block h-[0.82em] w-[3.2em] rounded-[0.16em] bg-surface" />;
  return (
    <button
      type="button"
      data-ui
      onClick={onNext}
      aria-label={`${p.name}, $${p.ticker}, ${formatPrice(p.price)}, ${formatPct(p.change24h, { signed: true })} today. Show another player.`}
      className="group inline-flex h-[0.82em] cursor-pointer items-center gap-[0.14em] rounded-[0.16em] bg-surface px-[0.16em] align-middle tracking-normal transition-colors duration-150 outline-none hover:bg-overlay focus-visible:ring-2 focus-visible:ring-ink motion-safe:active:scale-[0.98]"
    >
      <span key={p.id} className="slot-swap flex flex-col items-start justify-center gap-[0.06em] text-left">
        <span className="fig text-[0.26em] leading-none font-semibold text-ink">${p.ticker}</span>
        <span className="text-[0.13em] leading-none font-medium text-soft">{p.name}</span>
      </span>
      <span className="flex flex-col items-end justify-center gap-[0.06em]">
        <span className="fig text-[0.26em] leading-none font-semibold text-ink">{formatPrice(p.price)}</span>
        <Delta value={p.change24h} className="text-[0.13em] leading-none font-medium">
          {formatPct(p.change24h, { signed: true })}
        </Delta>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- launches

function Launches() {
  const q = usePlayers();
  const live = useMemo(
    () =>
      (q.data ?? [])
        .filter((p) => p.status === "launching")
        .sort((a, b) => b.bondProgress - a.bondProgress)
        .slice(0, 4),
    [q.data]
  );
  const next = useMemo(
    () => (q.data ?? []).filter((p) => p.status === "scheduled" && p.launchAt).sort((a, b) => a.launchAt! - b.launchAt!)[0],
    [q.data]
  );
  return (
    <section aria-labelledby="launch-title" className="bg-surface">
      <div className={cn(FRAME, "grid gap-12 py-24 md:py-32 lg:grid-cols-12 lg:gap-8")}>
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <h2 id="launch-title" className="text-[clamp(36px,4.4vw,68px)] leading-[1.0] font-semibold tracking-[-0.035em] text-ink">
            Get in before they bond.
          </h2>
          <p className="max-w-[44ch] text-[17px] leading-[1.55] text-ink">
            Every player launches on a curve that starts at $0.00039 and gets dearer with each buy. At $25,000 raised they bond: a trading pool opens and holders
            start earning from matchday boards.
          </p>
          <p className="text-[15px] text-soft">
            {next?.launchAt ? (
              <>
                Next launch, {next.name}, in <Countdown to={next.launchAt} className="fig text-ink" />
              </>
            ) : (
              "New launches at 14:00 and 20:00 UTC."
            )}
          </p>
        </div>
        <div className="min-w-0 lg:col-span-6 lg:col-start-7">
          {live.length ? (
            <ul data-ui className="flex flex-col gap-2">
              {live.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/launch?p=${p.id}`}
                    className="flex flex-col gap-3 rounded-2xl bg-ground px-5 py-4 transition-colors duration-150 hover:bg-overlay focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="fig text-[15px] font-semibold text-ink">${p.ticker}</span>
                        <span className="truncate text-[14px] text-soft">
                          {p.name}, {p.club}
                        </span>
                      </span>
                      <span className="fig text-[15px] text-ink">{formatPrice(p.price)}</span>
                    </span>
                    <Progress value={p.bondProgress * 100} tone="up" aria-label={`${p.name} bonding progress`} />
                    <span className="flex justify-between text-[13px] text-soft">
                      <span>
                        <span className="fig text-ink">{formatUsd(p.raised, { decimals: 0 })}</span> of $25,000
                      </span>
                      <span className="fig text-ink">{formatPct(p.bondProgress, { decimals: 0 })}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl bg-ground px-5 py-6 text-[15px] text-soft">No live launches this minute. They appear here the moment a curve opens.</p>
          )}
          <Link href="/launch" className="mt-5 inline-block text-[15px] text-ink underline decoration-control underline-offset-4 hover:decoration-ink">
            See every launch
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the money

/** Splits "$412.6k" into "$412" and ".6k" so the column aligns on the point. */
function splitFigure(s: string): [string, string] {
  const m = s.match(/^([^.]*)(\..*)?$/);
  return [m?.[1] ?? s, m?.[2] ?? ""];
}

function compact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return formatUsd(n, { decimals: 0 });
}

function Money() {
  const stats = useStats();
  const round = useRound((r) => ({ round: r.round, phase: r.phase, endsAt: r.phaseEndsAt, pool: r.pool.usd, rate: r.pool.effectiveRate }));
  const s = stats.data;
  const r = round.data;
  const rows: { value: string; caption: string }[] = [
    { value: s ? compact(s.vault) : "—", caption: "in the dividend vault, topped up by every bond and every fee" },
    { value: r ? compact(r.pool) : "—", caption: r ? `paid out at the end of matchday ${r.round}, ${formatPct(r.rate, { decimals: 1 })} of the vault` : "paid out this matchday" },
    { value: s ? compact(s.totalPaidOut) : "—", caption: "paid to holders of top-five finishers so far" },
    { value: s ? String(s.bondedCount) : "—", caption: "players trading now, with more launching" },
  ];
  return (
    <section aria-labelledby="money-title">
      <div className={cn(FRAME, "grid gap-12 py-24 md:py-32 lg:grid-cols-12 lg:items-center lg:gap-8")}>
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <h2 id="money-title" className="text-[clamp(36px,4.4vw,68px)] leading-[1.0] font-semibold tracking-[-0.035em]">
            <span className="block text-soft">The vault pays</span>
            <span className="block text-ink">the top five.</span>
          </h2>
          <p className="max-w-[44ch] text-[17px] leading-[1.55] text-ink">
            One snapshot at each matchday&apos;s first kickoff decides who earns. Every position and league has a board; claim your share in USDC, or in more of the
            same player with a 10% bonus. Trading stays open all weekend.
          </p>
          <p className="text-[15px] text-soft">
            {r ? (
              r.phase === "open" ? (
                <>
                  Matchday {r.round} kicks off in <Countdown to={r.endsAt} className="fig text-ink" />
                </>
              ) : r.phase === "live" ? (
                <>Matchday {r.round} is live now.</>
              ) : (
                <>Matchday {r.round} is at full time; payouts land when the data freezes.</>
              )
            ) : (
              " "
            )}
          </p>
        </div>
        <dl className="flex flex-col gap-5 lg:col-span-6 lg:col-start-7">
          {rows.map((row) => {
            const [whole, rest] = splitFigure(row.value);
            return (
              <div key={row.caption} className="grid grid-cols-[52%_1fr] items-baseline gap-x-4 gap-y-1 md:grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,16rem)]">
                <dd className="fig fig-prop order-1 text-right text-[clamp(52px,6.4vw,104px)] leading-none font-semibold tracking-[-0.03em] text-ink">{whole}</dd>
                <dd className="fig fig-prop order-2 text-[clamp(52px,6.4vw,104px)] leading-none font-semibold tracking-[-0.03em] text-soft">{rest}</dd>
                <dt className="order-3 col-span-2 text-[15px] leading-snug text-soft md:col-span-1">{row.caption}</dt>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the choice

function Close() {
  return (
    <section aria-labelledby="close-title" className="bg-surface">
      <div className={cn(FRAME, "flex flex-col items-center gap-10 py-28 text-center md:py-36")}>
        <h2 id="close-title" className="max-w-[20ch] text-[clamp(34px,7vw,112px)] sm:max-w-[14ch] leading-[0.98] font-semibold tracking-[-0.04em] text-ink">
          A player trading, or one still launching?
        </h2>
        <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:gap-6">
          <Button asChild size="lg" className="h-14 w-[72%] px-8 text-[17px] sm:w-auto">
            <Link href="/trade">Buy player shares</Link>
          </Button>
          <span className="text-[17px] text-soft">or</span>
          <Button asChild size="lg" variant="secondary" className="h-14 w-[72%] px-8 text-[17px] sm:w-auto">
            <Link href="/launch">Explore launches</Link>
          </Button>
        </div>
        <p className="text-[15px] text-soft">Either way you sign in once, and a wallet with 1,000 test USDC is made for you.</p>
      </div>
    </section>
  );
}

function HomeFooter() {
  return (
    <footer className={cn(FRAME, "flex flex-col gap-10 pt-24 pb-10")}>
      <p aria-hidden="true" className="text-[clamp(96px,22vw,360px)] leading-[0.8] font-semibold tracking-[-0.06em] text-ink">
        score
      </p>
      <div className="grid gap-2 text-[13px] text-soft md:grid-cols-3 md:items-baseline">
        <span className="flex gap-6">
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link href="/docs/stats" className="hover:text-ink">
            Docs
          </Link>
          <Link href="/trade" className="hover:text-ink">
            Open the app
          </Link>
        </span>
        <span className="md:text-center">Devnet demo · test USDC and simulated match data · dividends are not guaranteed</span>
        <span className="md:text-right">London · Breakpoint 2026</span>
      </div>
    </footer>
  );
}
