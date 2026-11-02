"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONTROLLER_MATRIX_BPS, LEAGUES, LEAGUE_NAMES, PLAYERS_BY_ID } from "@score/core";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { LiveFigure, PositionBadge, Ticker } from "@/components/common/bits";
import { MatchdayStrip } from "@/components/common/matchday-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { BondingCurveChart } from "@/components/player/charts";
import { formatPct, formatPoints, formatPrice, formatTokens, formatUsd, parseAmount } from "@/lib/format";
import type { PlayerSummary, RoundState } from "@/lib/protocol/types";
import { useBuyQuote, usePlayer, usePlayers, useRound, useStats } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/**
 * Landing: the dealt "split stage" direction (docs/DESIGN.md §1).
 * On this page, this weekend's real matchday board becomes the half of the screen that never moves.
 * Every picture is the product's own interface on live mock data (data-ui), never a photo of a player.
 */
export function LandingPage() {
  useReveal();
  return (
    <div data-fullbleed className="flex flex-col">
      <SplitStage />
      <Showcase />
      <Squad />
      <Proof />
      <Mosaic />
      <Closing />
    </div>
  );
}

// ---------------------------------------------------------------- reveal (taste motion layer)

function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("reveal-on");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" }
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove("reveal-on");
    };
  }, []);
}

// ---------------------------------------------------------------- hero + how it works (the split)

const STEPS = [
  {
    title: "Buy a player while they launch.",
    body: "Every new player starts on a curve at $0.00039 and gets dearer with each buy. Each account can take up to 240,000 tokens.",
  },
  {
    title: "At $25,000 they bond.",
    body: "The curve closes. 70% becomes a trading pool that can never be withdrawn, 20% goes to the dividend vault, 10% to the treasury.",
  },
  {
    title: "Hold them at the first kickoff.",
    body: "One snapshot per matchday decides who earns that round. Trading stays open all weekend.",
  },
  {
    title: "Top five on a board, and you’re paid.",
    body: "Boards for every position and league. Take your share in USDC, or in more of the same player with a 10% bonus.",
  },
] as const;

function SplitStage() {
  const [active, setActive] = useState(-1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section aria-labelledby="hero-title" className="relative grid lg:grid-cols-[47fr_53fr]">
      {/* The fixed half */}
      <div className="relative px-3 pt-3 lg:sticky lg:top-14 lg:h-[calc(100svh-56px)] lg:px-5 lg:pt-5 lg:pb-5">
        <div className="relative h-[58svh] overflow-hidden rounded-2xl bg-surface lg:h-full" data-ui>
          {[-1, 0, 1, 2, 3].map((i) => (
            <div key={i} className="stage-frame absolute inset-0" data-active={active === i} style={{ opacity: active === i ? 1 : 0, pointerEvents: active === i ? "auto" : "none" }} aria-hidden={active !== i}>
              <StageFragment step={i} />
            </div>
          ))}
        </div>
      </div>

      {/* The reading column */}
      <div className="flex flex-col px-5 md:px-8 lg:ml-auto lg:w-[min(100%,600px)] lg:pr-[20px] lg:pl-0">
        <div className="flex min-h-[calc(42svh)] flex-col justify-center gap-6 pt-[calc(clamp(64px,13vw,190px))] pb-16 lg:min-h-[calc(100svh-56px)] lg:pt-0 lg:pb-[clamp(140px,14vw,230px)]" data-step={-1} ref={(el) => void (refs.current[4] = el)}>
          <p className="max-w-[26ch] text-2xl leading-[1.3] tracking-[-0.01em] text-ink" data-reveal>
            Own real footballers as tokens. Get paid when they finish in the top five.
          </p>
          <p className="text-[17px] leading-[1.55] text-soft" data-reveal style={{ ["--i" as string]: 1 }}>
            Back a player before kickoff, follow the live board all weekend, and claim your share of the round when the data freezes. Devnet demo
            with test USDC: a matchday runs every two minutes.
          </p>
          <div className="flex flex-wrap items-center gap-4" data-reveal style={{ ["--i" as string]: 2 }}>
            <Button asChild size="lg">
              <Link href="/markets">Open the markets</Link>
            </Button>
            <Link href="/matchday" className="text-[15px] text-ink underline decoration-control underline-offset-4 hover:decoration-ink">
              Watch the live board
            </Link>
          </div>
        </div>
        <h2 className="sr-only">How it works</h2>
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            data-step={i}
            ref={(el) => void (refs.current[i] = el)}
            className="flex flex-col justify-center gap-4 py-16 lg:min-h-[80vh] lg:py-0"
          >
            <p className={cn("max-w-[20ch] text-2xl leading-[1.25] tracking-[-0.015em] transition-colors duration-300 lg:text-[40px] lg:leading-[1.1]", active === i ? "text-ink" : "text-soft lg:text-faint")}>{s.title}</p>
            <p className="text-[17px] leading-[1.55] text-soft">{s.body}</p>
            <div className="mt-2 overflow-hidden rounded-2xl bg-surface lg:hidden" data-ui>
              <div className="relative h-[340px]">
                <StageFragment step={i} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* The name, crossing the fixed half's lower-right corner */}
      <h1
        id="hero-title"
        className="wordmark pointer-events-none absolute top-[calc(58svh+12px-0.32em)] left-4 z-10 m-0 text-[21vw] leading-[0.8] font-medium tracking-[-0.04em] text-ink select-none lg:top-[calc(100svh-56px-40px-0.74em)] lg:left-[calc(47%-10vw)] lg:text-[clamp(120px,12vw,200px)]"
      >
        score<span className="sr-only">: own the players, earn when they perform</span>
      </h1>
    </section>
  );
}

function StageFragment({ step }: { step: number }) {
  if (step === -1) return <LiveBoardFragment />;
  if (step === 0) return <CurveFragment />;
  if (step === 1) return <BondFragment />;
  if (step === 2) return <SnapshotFragment />;
  return <ClaimFragment />;
}

function FragmentFrame({ title, aside, children, clearCorner = false }: { title: string; aside?: React.ReactNode; children: React.ReactNode; clearCorner?: boolean }) {
  return (
    <div className={cn("flex h-full flex-col gap-5 p-6 lg:p-8", clearCorner && "lg:pb-[clamp(150px,13vw,220px)]")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">{title}</p>
        {aside ? <span className="num text-xs text-faint">{aside}</span> : null}
      </div>
      {children}
    </div>
  );
}

function LiveBoardFragment() {
  const q = useRound();
  if (!q.data) return <Skeleton className="m-6 h-[calc(100%-48px)]" />;
  const r = q.data;
  const fwd = r.boards.find((b) => b.key === "pos:FWD") ?? r.boards[0];
  const second = [...r.boards].filter((b) => b !== fwd).sort((a, b) => b.poolUsd - a.poolUsd)[0];
  const hasEvents = r.events.some((e) => e.playerId);
  return (
    <FragmentFrame title={`Matchday ${r.round} · ${r.window.title}`} aside={`${r.window.fromLabel} → ${r.window.toLabel}`} clearCorner>
      <MatchdayStrip round={r} />
      {[fwd, second].filter(Boolean).map((b) => (
        <div key={b!.key} className="flex flex-col">
          <p className="mb-1 flex justify-between text-xs text-faint">
            <span>{b!.label} board {r.projection ? "· projection" : "· provisional"}</span>
            <span className="num">{formatUsd(b!.poolUsd, { decimals: 0 })}</span>
          </p>
          {b!.rows.slice(0, b === fwd ? (hasEvents ? 3 : 4) : 3).map((row) => (
            <div key={row.playerId} className="num flex items-center gap-3 border-b border-rule py-2.5 text-sm last:border-0">
              <span className="w-3 text-xs text-faint">{row.rank}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{row.name}</span>
              <span className="w-8 text-right text-faint">{(r.projection ? row.points : row.display).toFixed(1)}</span>
              <span className="w-12 text-right text-ink">{formatUsd(row.usd, { decimals: 0 })}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="mt-auto flex flex-col">
        {(r.events.filter((e) => e.playerId).slice(0, 3).length
          ? r.events.filter((e) => e.playerId).slice(0, 3)
          : []
        ).map((e) => (
          <p key={e.id} className="feed-enter num flex items-baseline gap-3 py-1.5 text-sm">
            <span className="w-16 shrink-0 text-xs text-faint">{e.minute}′</span>
            <span className="min-w-0 flex-1 truncate text-soft">
              <span className="text-ink">{e.name}</span> {e.label.toLowerCase()}
            </span>
            <span className={cn("text-xs", e.points >= 0 ? "text-up" : "text-down")}>{formatPoints(e.points)}</span>
          </p>
        ))}
        {r.events.filter((e) => e.playerId).length === 0 ? <p className="text-sm text-faint">Goals, assists and saves land here from the first kickoff.</p> : null}
      </div>
    </FragmentFrame>
  );
}

function CurveFragment() {
  const q = usePlayers({ status: "launching" });
  const p = useMemo(() => [...(q.data ?? [])].sort((a, b) => b.bondProgress - a.bondProgress)[0], [q.data]);
  const d = usePlayer(p?.id ?? "kane");
  if (!p || !d.data || d.data.status !== "launching") return <Skeleton className="m-6 h-[calc(100%-48px)]" />;
  return (
    <FragmentFrame title={`${p.name} · launching`} aside={formatPrice(p.price)}>
      <div className="flex flex-col gap-2">
        <div className="num flex justify-between text-sm text-soft">
          <span>
            <span className="text-ink">{formatUsd(p.raised, { decimals: 0 })}</span> of $25,000
          </span>
          <span className="text-ink">{formatPct(p.bondProgress, { decimals: 0 })}</span>
        </div>
        <Progress value={p.bondProgress * 100} tone="up" aria-label="Bonding progress" />
      </div>
      <BondingCurveChart sold={d.data.curve.sold} />
      <div className="mt-auto flex flex-col">
        {[
          ["Started at", formatPrice(d.data.curve.launchPrice)],
          ["Price now", formatPrice(p.price)],
          ["Trading opens at", formatPrice(d.data.curve.poolOpenPrice)],
          ["Left to raise", formatUsd(Math.max(0, d.data.curve.threshold - p.raised), { decimals: 0 })],
        ].map(([k, v]) => (
          <div key={k} className="num flex justify-between border-b border-rule py-2.5 text-sm last:border-0">
            <span className="text-soft">{k}</span>
            <span className="text-ink">{v}</span>
          </div>
        ))}
      </div>
    </FragmentFrame>
  );
}

function BondFragment() {
  const parts = [
    { label: "Trading pool, locked for good", share: 0.7, usd: 17_500, tone: "bg-ink" },
    { label: "Dividend vault", share: 0.2, usd: 5_000, tone: "bg-up" },
    { label: "Treasury", share: 0.1, usd: 2_500, tone: "bg-soft" },
  ];
  return (
    <FragmentFrame title="Bonded at $25,000" aside="Pool opens at $0.01094">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.map((x) => (
          <span key={x.label} className={x.tone} style={{ width: `${x.share * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-col">
        {parts.map((x) => (
          <li key={x.label} className="num flex items-center gap-3 border-b border-rule py-3 text-sm last:border-0">
            <span className={cn("size-2 rounded-full", x.tone)} aria-hidden="true" />
            <span className="flex-1 text-soft">{x.label}</span>
            <span className="text-faint">{formatPct(x.share, { decimals: 0 })}</span>
            <span className="w-20 text-right text-ink">{formatUsd(x.usd, { decimals: 0 })}</span>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-sm text-soft">The pool pairs $17,500 with 1.6M tokens, so trading opens exactly where the curve ended. Selling early pays up to 5%, and 90% of that goes to holders.</p>
    </FragmentFrame>
  );
}

function SnapshotFragment() {
  const q = useRound();
  const bonded = usePlayers({ status: "trading" });
  if (!q.data) return <Skeleton className="m-6 h-[calc(100%-48px)]" />;
  const r = q.data;
  const sample = (bonded.data ?? []).slice(0, 3);
  return (
    <FragmentFrame title="Counted at kickoff" aside={`Matchday ${r.round}`}>
      <MatchdayStrip round={r} showPool={false} />
      <ul className="flex flex-col">
        {[
          ["Held at the first kickoff", "Earns this round", "text-up"],
          ["Sold after kickoff", "Still earns this round", "text-ink"],
          ["Bought after kickoff", "Earns from the next round", "text-soft"],
        ].map(([k, v, tone]) => (
          <li key={k} className="flex justify-between border-b border-rule py-3 text-sm last:border-0">
            <span className="text-soft">{k}</span>
            <span className={tone}>{v}</span>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-xs text-faint">{r.my.players.length ? "Your holdings right now" : "Trading now"}</p>
      <ul className="-mt-3 flex flex-col">
        {(r.my.players.length ? r.my.players.slice(0, 3).map((p) => ({ id: p.playerId, ticker: p.ticker, name: p.name, note: `${formatTokens(p.tokens)} tokens` })) : sample.map((p) => ({ id: p.id, ticker: p.ticker, name: p.name, note: p.playsThisWindow ? "Plays this window" : "Not playing" }))).map((x) => (
          <li key={x.id} className="num flex items-center gap-3 border-b border-rule py-3 text-sm last:border-0">
            <Ticker ticker={x.ticker} className="text-[13px] text-ink" />
            <span className="min-w-0 flex-1 truncate text-soft">{x.name}</span>
            <span className="text-ink">{x.note}</span>
          </li>
        ))}
      </ul>
    </FragmentFrame>
  );
}

/** A worked example whose figures add up: two board wins, one holder's share of them. */
const CLAIM_EXAMPLE = { fwd: 82.04, league: 44.21, share: 0.0332 };

function ClaimFragment() {
  const won = CLAIM_EXAMPLE.fwd + CLAIM_EXAMPLE.league;
  const yours = Math.round(won * CLAIM_EXAMPLE.share * 100) / 100;
  return (
    <FragmentFrame title="Full time · round settled" aside="Example">
      <div className="flex flex-col gap-1">
        <span className="num text-[40px] leading-none font-medium tracking-[-0.02em] text-up">{formatUsd(yours)}</span>
        <span className="text-sm text-soft">ready to claim from Harry Kane</span>
      </div>
      <div className="flex flex-col">
        {[
          ["#1 on the FWD board", formatUsd(CLAIM_EXAMPLE.fwd)],
          ["#1 on the Bundesliga board", formatUsd(CLAIM_EXAMPLE.league)],
          ["Kane won in total", formatUsd(won)],
          ["Your share of his holders at kickoff", formatPct(CLAIM_EXAMPLE.share)],
        ].map(([k, v]) => (
          <div key={k} className="num flex justify-between border-b border-rule py-2.5 text-sm last:border-0">
            <span className="text-soft">{k}</span>
            <span className="text-ink">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2" aria-hidden="true">
        <span className="flex h-11 items-center justify-center rounded-full bg-ink text-sm font-medium text-black">Take {formatUsd(yours)} USDC</span>
        <span className="flex h-11 items-center justify-center rounded-full bg-raised text-sm font-medium text-ink">Take tokens · +10%</span>
      </div>
    </FragmentFrame>
  );
}

// ---------------------------------------------------------------- showcase: input half, output half

function Showcase() {
  const bonded = usePlayers({ status: "trading" });
  const [id, setId] = useState("kane");
  const [stake, setStake] = useState("50");
  const usdc = parseAmount(stake);
  const p = usePlayer(id);
  // Quotes are synchronous against the local mock; wait for client data so server and client render the same text.
  const quote = useBuyQuote(id, usdc > 0 && p.data ? usdc : 0);
  const round = useRound();
  const projected = useMemo(() => {
    if (!quote?.ok || !p.data || !round.data) return null;
    const payout = round.data.boards.reduce((a, b) => a + b.rows.filter((r) => r.playerId === id).reduce((x, r) => x + r.usd, 0), 0);
    const s = p.data.supply;
    const pool = p.data.pool;
    const eligible = s.holderTokens + (pool ? s.inPool * (1 - pool.protocolShare) : 0);
    return eligible > 0 ? (payout * quote.tokens) / (eligible + quote.tokens) : 0;
  }, [quote, p.data, round.data, id]);
  const name = PLAYERS_BY_ID[id]?.name ?? id;
  return (
    <section aria-labelledby="try-title" className="mt-24 grid lg:mt-32 lg:grid-cols-2">
      <div className="relative flex min-h-[62svh] flex-col bg-surface px-5 pt-[18svh] pb-24 md:px-8 lg:min-h-[90svh] lg:px-16">
        <p className="max-w-[34ch] text-2xl leading-[1.45] text-soft" data-reveal>
          I&apos;d put{" "}
          <span className="inline-flex items-baseline border-b border-control focus-within:border-ink">
            <span className="text-ink">$</span>
            <input
              aria-label="Stake in USDC"
              inputMode="decimal"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="num w-[4.5ch] bg-transparent text-ink outline-none"
            />
          </span>{" "}
          on{" "}
          <select
            aria-label="Player"
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="max-w-full appearance-none border-b border-control bg-transparent text-ink outline-none focus:border-ink"
          >
            {(bonded.data ?? []).map((x) => (
              <option key={x.id} value={x.id} className="bg-surface text-base">
                {x.name}
              </option>
            ))}
          </select>{" "}
          before kickoff.
        </p>
        <h2 id="try-title" className="absolute bottom-8 left-5 text-[clamp(40px,5vw,72px)] leading-none font-medium tracking-[-0.03em] text-ink md:left-8 lg:left-16">
          Try a
        </h2>
      </div>
      <div className="relative flex min-h-[62svh] flex-col bg-[#ededed] px-5 pt-12 pb-28 text-black md:px-8 lg:min-h-[90svh] lg:pt-[18svh] lg:pl-12">
        <div className="w-full max-w-[480px] rounded-2xl bg-white p-6 shadow-[0_1px_0_rgba(0,0,0,0.06)]" data-ui>
          <p className="flex items-baseline justify-between text-sm text-[#555]">
            <span>
              Buying <span className="text-black">{name}</span>
            </span>
            <span className="num">{p.data ? formatPrice(p.data.price) : ""}</span>
          </p>
          <p className="num mt-4 text-[40px] leading-none font-medium tracking-[-0.02em] text-black">{quote?.ok ? formatTokens(quote.tokens) : "—"}</p>
          <p className="mt-1 text-sm text-[#555]">tokens of ${PLAYERS_BY_ID[id]?.ticker}</p>
          <dl className="num mt-5 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-[#555]">Fees</dt>
            <dd className="text-right">{quote?.ok ? formatUsd(quote.totalFees) : "—"}</dd>
            <dt className="text-[#555]">Price impact</dt>
            <dd className="text-right">{quote?.ok ? formatPct(quote.priceImpact) : "—"}</dd>
            <dt className="text-[#555]">If this round paid as projected</dt>
            <dd className="text-right font-medium">{projected !== null ? formatUsd(projected) : "—"}</dd>
            <dt className="text-[#555]">Sell tax if you sold today</dt>
            <dd className="text-right">5.00%</dd>
          </dl>
          <p className="mt-5 text-xs text-[#5c5c5c]">
            {quote?.error ? quote.error.message : "Projection from form ratings and this round’s pool. Real payouts come from frozen match data and are never guaranteed."}
          </p>
        </div>
        <span className="absolute right-5 bottom-8 text-[clamp(40px,5vw,72px)] leading-none font-medium tracking-[-0.03em] text-black md:right-8" aria-hidden="true">
          stake
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- list: giant word, filled bars

function Squad() {
  const q = usePlayers({ status: "all" });
  const byLeague = useMemo(() => {
    const m = new Map<string, PlayerSummary[]>();
    for (const lg of LEAGUES) m.set(lg, []);
    for (const p of q.data ?? []) m.get(p.league)?.push(p);
    return LEAGUES.map((lg) => ({ lg, name: LEAGUE_NAMES[lg], players: m.get(lg) ?? [] })).filter((x) => x.players.length);
  }, [q.data]);
  return (
    <section aria-labelledby="squad-title" className="mx-auto mt-24 w-full max-w-[640px] px-5 pt-12 [container-type:inline-size] md:px-0 lg:mt-36">
      <h2 id="squad-title" className="text-[44cqw] leading-[0.8] font-semibold tracking-[-0.03em] text-ink uppercase [font-stretch:75%]">
        Squad
      </h2>
      <p className="mt-6 max-w-[46ch] text-[17px] leading-[1.55] text-soft" data-reveal>
        {q.data
          ? `${q.data.length} players across ${byLeague.length} leagues. ${q.data.filter((p) => p.status === "trading").length} trade today, ${q.data.filter((p) => p.status === "launching").length} are launching, and two more join every weekday.`
          : "Players across seven leagues, with two more launching every weekday."}
      </p>
      <div className="mt-6 flex flex-col gap-1.5">
        {byLeague.map((g, i) => (
          <details key={g.lg} open={i === 0} className="group rounded-xl bg-surface">
            <summary className="flex h-14 cursor-pointer list-none items-center justify-between px-[18px] text-base font-medium text-ink [&::-webkit-details-marker]:hidden">
              {g.name}
              <span className="text-xl leading-none text-soft transition-transform duration-200 group-open:rotate-45" aria-hidden="true">
                +
              </span>
            </summary>
            <ul className="flex flex-col gap-3.5 px-5 pb-5">
              {g.players.map((p) => (
                <li key={p.id} className="num flex items-center justify-between gap-3 text-base">
                  <Link href={`/player/${p.id}`} className="flex min-w-0 items-center gap-2.5 text-ink hover:underline">
                    <span className="truncate">{p.name}</span>
                    <PositionBadge position={p.position} />
                  </Link>
                  <span className="shrink-0 text-soft">
                    {p.status === "trading" ? formatPrice(p.price) : p.status === "launching" ? `Launching · ${formatPct(p.bondProgress, { decimals: 0 })}` : "Scheduled"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {!q.data ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 rounded-xl" />) : null}
      </div>
      <Movers players={q.data ?? []} />
    </section>
  );
}

function Movers({ players }: { players: PlayerSummary[] }) {
  const top = [...players].filter((p) => p.status === "trading").sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 4);
  if (!top.length) return null;
  return (
    <div className="mt-10 rounded-2xl bg-surface px-5 py-4" data-ui>
      <p className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">Moving today</span>
        <Link href="/markets" className="text-soft hover:text-ink">
          All players
        </Link>
      </p>
      <ul className="mt-2 flex flex-col">
        {top.map((p) => (
          <li key={p.id} className="num flex items-center gap-3 border-b border-rule py-3 text-sm last:border-0">
            <Ticker ticker={p.ticker} className="w-24 text-[13px] text-ink" />
            <span className="min-w-0 flex-1 truncate text-soft">{p.name}</span>
            <span className="text-ink">{formatPrice(p.price)}</span>
            <span className={cn("w-16 text-right", p.change24h >= 0 ? "text-up" : "text-down")}>{formatPct(p.change24h, { decimals: 1, signed: true })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- proof: the table

const PROOF: [string, string, string][] = [
  ["Dividends", "Promised per share and paid by the operator, then cut sharply in March 2021", "A share of a funded vault, 0.2–2.5% a round, never a promise"],
  ["Your exit", "The operator's own market, which froze", "A trading pool per player that can never be withdrawn"],
  ["Supply", "New shares issued as demand grew", "10 million tokens per player, fixed"],
  ["The rules", "Changed by the operator", "Published, time-locked changes only"],
];

function Proof() {
  return (
    <section aria-labelledby="proof-title" className="mx-auto mt-32 w-full max-w-[1200px] px-5 md:px-8 lg:mt-48">
      <h2 id="proof-title" className="text-[clamp(40px,5vw,72px)] leading-[1.02] font-medium tracking-[-0.03em] text-ink">
        Not another
        <br />
        <span className="ml-[16.6%]">Football Index</span>
      </h2>
      <p className="mt-6 max-w-[56ch] text-[17px] leading-[1.55] text-soft" data-reveal>
        Football Index sold player shares in the UK from 2015 and collapsed in 2021. score is built around the four things that broke.
      </p>
      <table className="mt-[72px] w-full border-collapse text-left text-base">
        <thead className="sr-only md:not-sr-only">
          <tr className="text-sm text-faint">
            <th className="w-[18%] px-4 pb-3 font-normal">&nbsp;</th>
            <th className="w-[41%] px-4 pb-3 font-normal">Football Index</th>
            <th className="px-4 pb-3 font-normal">score</th>
          </tr>
        </thead>
        <tbody>
          {PROOF.map(([topic, them, us], i) => (
            <tr key={topic} className={cn("block md:table-row", i % 2 === 0 && "bg-surface")}>
              <th scope="row" className="block px-4 pt-3.5 font-medium text-ink md:table-cell md:py-3.5">
                {topic}
              </th>
              <td className="block px-4 text-soft md:table-cell md:py-3.5">{them}</td>
              <td className="block px-4 pb-3.5 text-ink md:table-cell md:py-3.5">{us}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link href="/docs/boards" className="mt-6 inline-block text-[15px] text-ink underline decoration-control underline-offset-4 hover:decoration-ink">
        How each round&apos;s pool is sized
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------- stats: fragment with two figure tiles

function Mosaic() {
  const s = useStats();
  const runway = ["<20", "20–40", "40–80", "80–160", ">160"];
  const runwayIdx = s.data ? (Number.isFinite(s.data.runwayRounds) ? [20, 40, 80, 160].filter((e) => s.data!.runwayRounds >= e).length : 4) : -1;
  const ratioIdx = s.data ? [0.05, 0.15, 0.3].filter((e) => s.data!.vaultToTvl >= e).length : -1;
  return (
    <section aria-labelledby="vault-title" className="mt-32 pt-2 lg:mt-48">
      <h2 id="vault-title" className="mx-auto mb-10 w-full max-w-[1200px] px-5 text-[clamp(40px,5vw,72px)] leading-[1.02] font-medium tracking-[-0.03em] text-ink md:px-8">
        Paid from a funded vault
      </h2>
      <div className="grid lg:grid-cols-[2fr_1fr]">
        <div className="bg-surface px-5 py-10 md:px-8 lg:min-h-[44vw] lg:px-16 lg:py-16" data-ui>
          <p className="max-w-[52ch] text-[17px] leading-[1.55] text-soft" data-reveal>
            Each round pays a percentage of the vault, chosen by how long it would last and how large it is next to everything locked in the
            pools. It moves at most 10% a round, so it can shrink but never run dry. This round&apos;s cell is lit.
          </p>
          <table className="num mt-8 w-full max-w-[640px] text-sm">
            <thead>
              <tr className="text-faint">
                <th className="py-2 text-left font-normal">Rounds of runway</th>
                {["<5%", "5–15%", "15–30%", ">30%"].map((h) => (
                  <th key={h} className="py-2 text-right font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONTROLLER_MATRIX_BPS.map((row, i) => (
                <tr key={i} className="border-t border-rule">
                  <td className="py-2.5 text-soft">{runway[i]}</td>
                  {row.map((v, j) => (
                    <td key={j} className="py-1.5 text-right">
                      <span className={cn("inline-block rounded-full px-2.5 py-1", i === runwayIdx && j === ratioIdx ? "bg-up font-medium text-black" : "text-ink")}>{(v / 100).toFixed(2)}%</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-faint">Columns: the vault as a share of all value locked. Payouts are also capped at 12% of that value a year.</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-1">
          <div className="flex flex-col gap-3 bg-up p-7 text-black">
            <span className="num text-[clamp(40px,5.6vw,96px)] leading-none font-medium tracking-[-0.03em]">
              {s.data ? <LiveFigure value={s.data.vault} format={(n) => formatUsd(n, { decimals: 0 })} tick flash={false} /> : "—"}
            </span>
            <span className="max-w-[20ch] text-[17px] leading-snug">in the dividend vault right now</span>
          </div>
          <div className="flex flex-col gap-3 bg-raised p-7 text-ink">
            <span className="num text-[clamp(40px,5.6vw,96px)] leading-none font-medium tracking-[-0.03em]">{s.data ? formatPct(s.data.roundPool.effectiveRate) : "—"}</span>
            <span className="max-w-[20ch] text-[17px] leading-snug text-soft">of it paid out this round, never more than 2.5%</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- cta

function Closing() {
  const r = useRound((x: RoundState) => ({ phase: x.phase }));
  return (
    <section aria-labelledby="cta-title" className="mx-auto w-full max-w-[1200px] px-5 pt-[30svh] pb-[20svh] md:px-8">
      <h2 id="cta-title" className="sr-only">
        Start
      </h2>
      <p className="max-w-[34ch] text-2xl leading-[1.35] text-ink" data-reveal>
        {r.data?.phase === "live" ? "A matchday is live right now. Pick a player for the next kickoff." : "Pick a player before the next kickoff and see what they earn."}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-5" data-reveal style={{ ["--i" as string]: 1 }}>
        <Button asChild>
          <Link href="/markets">Open the markets</Link>
        </Button>
        <Link href="/docs/scoring" className="text-[15px] text-ink underline decoration-control underline-offset-4 hover:decoration-ink">
          How players are scored
        </Link>
      </div>
    </section>
  );
}
