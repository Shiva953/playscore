"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MatchdayStrip } from "@/components/common/matchday-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPct, formatPoints, formatUsd, formatUsdCompact } from "@/lib/format";
import { useRound, useStats } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/**
 * Landing in two screens (shortened after review): the line, the button and three real figures beside
 * this weekend's live board; then how it works in four short steps. The picture is the product's own
 * interface on live mock data (data-ui), never a photo of a player.
 */
export function LandingPage() {
  return (
    <div data-fullbleed className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 pt-4 pb-16 md:px-6 md:pt-6">
      <Hero />
      <Steps />
    </div>
  );
}

function Hero() {
  const stats = useStats();
  const round = useRound((r) => ({ pool: r.pool.usd, rate: r.pool.effectiveRate }));
  return (
    <section aria-labelledby="hero-title" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <div className="flex flex-col justify-center gap-6 rounded-2xl bg-surface p-5 md:p-10">
        <h1 id="hero-title" className="max-w-[20ch] text-[28px] leading-[1.08] font-semibold tracking-[-0.03em] text-ink md:text-[48px]">
          Own the players. Earn when they perform.
        </h1>
        <p className="max-w-[46ch] text-[16px] leading-[1.55] text-soft">
          Real footballers trade as tokens. Hold one at a matchday&apos;s first kickoff, and when they finish top five on a board, you share its prize.
          Devnet demo with test USDC.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/markets">Open the markets</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href="/matchday">Watch the live board</Link>
          </Button>
        </div>
        <dl className="grid grid-cols-3 gap-4 pt-2">
          <Fact label="Dividend vault" value={stats.data ? formatUsdCompact(stats.data.vault) : "—"} />
          <Fact label="This matchday" value={round.data ? formatUsd(round.data.pool, { decimals: 0 }) : "—"} />
          <Fact label="Players trading" value={stats.data ? String(stats.data.bondedCount) : "—"} />
        </dl>
      </div>
      <LiveBoard />
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-soft">{label}</dt>
      <dd className="fig text-[22px] leading-7 font-semibold text-ink">{value}</dd>
    </div>
  );
}

/** This weekend's board, live: the strip, the forwards' top five and the latest events. */
function LiveBoard() {
  const q = useRound();
  if (!q.data) return <Skeleton className="h-[520px] rounded-2xl" />;
  const r = q.data;
  const fwd = r.boards.find((b) => b.key === "pos:FWD") ?? r.boards[0];
  const events = r.events.filter((e) => e.playerId).slice(0, 3);
  return (
    <section aria-label="Live board" data-ui className="flex flex-col gap-5 rounded-2xl bg-surface p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">
          Matchday {r.round} · {r.window.title}
        </h2>
        <Link href="/matchday" className="text-[13px] text-soft underline decoration-control underline-offset-4 hover:text-ink">
          Open
        </Link>
      </div>
      <MatchdayStrip round={r} />
      {fwd ? (
        <div className="flex flex-col">
          <p className="mb-1 flex justify-between text-[13px] text-soft">
            <span>
              {fwd.label} board, {r.projection ? "projected" : "provisional"}
            </span>
            <span className="fig">{formatUsd(fwd.poolUsd, { decimals: 0 })}</span>
          </p>
          {fwd.rows.slice(0, 5).map((row) => (
            <div key={row.playerId} className="flex items-center gap-3 border-b border-rule py-2.5 text-sm last:border-0">
              <span className="fig w-3 text-[13px] text-faint">{row.rank}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{row.name}</span>
              <span className="fig w-10 text-right text-soft">{(r.projection ? row.points : row.display).toFixed(1)}</span>
              <span className="fig w-14 text-right text-ink">{formatUsd(row.usd, { decimals: 0 })}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex flex-col">
        {events.length ? (
          events.map((e) => (
            <p key={e.id} className="feed-enter flex items-baseline gap-3 py-1.5 text-sm">
              <span className="fig w-8 shrink-0 text-[13px] text-faint">{e.minute}′</span>
              <span className="min-w-0 flex-1 truncate text-soft">
                <span className="text-ink">{e.name}</span> {e.label.toLowerCase()}
              </span>
              <span className={cn("fig text-[13px]", e.points >= 0 ? "text-up" : "text-down")}>{formatPoints(e.points)}</span>
            </p>
          ))
        ) : (
          <p className="text-sm text-faint">Goals, assists and saves land here from the first kickoff.</p>
        )}
      </div>
    </section>
  );
}

const STEPS = [
  { title: "Buy while they launch", body: "Each player starts on a curve at $0.00039 and gets dearer with every buy." },
  { title: "At $25,000 they bond", body: "70% becomes a pool that can never be withdrawn; 20% tops up the dividend vault." },
  { title: "Hold at the first kickoff", body: "One snapshot per matchday decides who earns. Trading stays open all weekend." },
  { title: "Top five get paid", body: "Every position and league has a board. Claim in USDC, or in tokens with a 10% bonus." },
] as const;

function Steps() {
  const round = useRound((r) => r.pool.effectiveRate);
  return (
    <section aria-labelledby="how-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 id="how-title" className="text-sm font-medium text-ink">
          How it works
        </h2>
        <Link href="/docs/stats" className="text-[13px] text-soft underline decoration-control underline-offset-4 hover:text-ink">
          Read the docs
        </Link>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-2xl bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 bg-surface p-5">
            <h3 className="text-[15px] font-medium text-ink">{s.title}</h3>
            <p className="text-[16px] leading-[1.5] text-soft">
              {s.body}
              {i === 3 && round.data ? ` This matchday pays ${formatPct(round.data, { decimals: 1 })} of the vault.` : ""}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
