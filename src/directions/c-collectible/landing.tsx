"use client";

import Link from "next/link";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";
import { usePlayers, useRound, useStats } from "@/lib/protocol/react/hooks";
import { useSize } from "@/directions/lab/use-width";
import { PlayerCard } from "./card";

/**
 * Landing in about one screen: the line, the button, and the hand of real trading players as the
 * picture (one dealing moment on load). Under it, the three steps in one quiet strip.
 */
export function CLanding() {
  const players = usePlayers();
  const stats = useStats();
  const round = useRound((r) => ({ pool: r.pool.usd, rate: r.pool.effectiveRate }));
  const hand = (players.data ?? []).filter((p) => p.status === "trading").slice(0, 5);
  const n = hand.length;
  // The fan scales with the room the hero gives it (the hero fills the screen's height on desktop).
  const [fan, fanSize] = useSize<HTMLDivElement>(520, 300);
  const fanW = fanSize.width;
  const cardW = Math.round(Math.max(120, Math.min(fanW < 440 ? 140 : 230, (fanSize.height - 40) / 1.4)));
  const step = Math.min(cardW * 0.46, (fanW - cardW - 24) / Math.max(1, n - 1));

  return (
    <main className="mx-auto flex max-w-[1120px] flex-col gap-3 px-3 pt-3 pb-6 md:px-6 lg:min-h-[calc(100svh-68px)]">
      <section className="c-panel grid flex-1 items-center gap-6 overflow-hidden px-5 py-8 md:px-10 md:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <h1 className="max-w-[16ch] text-[32px] leading-[1.08] font-bold tracking-[-0.03em] md:text-[44px]">Collect the players. Get paid when they score.</h1>
          <p className="max-w-[42ch] text-[15px] leading-[1.55] text-[var(--c-mute)]">
            Real footballers, as cards you own in tokens. Hold one at a matchday&apos;s first kickoff and share the prize when they finish top five.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href="/lab/c-collectible/player" className="c-press flex h-11 items-center rounded-full bg-[var(--c-ink)] px-5 text-[14px] font-semibold text-white hover:bg-[#262c35]">
              Start collecting
            </Link>
            <Link href="/lab/c-collectible/matchday" className="flex h-11 items-center rounded-full px-4 text-[14px] font-semibold hover:bg-[var(--c-chip)]">
              Today&apos;s matchday
            </Link>
          </div>
          <dl className="flex gap-6 pt-3 text-[12px]">
            <Fact label="Vault" value={stats.data ? formatUsdCompact(stats.data.vault) : "—"} />
            <Fact label="This matchday" value={round.data ? formatUsd(round.data.pool, { decimals: 0 }) : "—"} />
            <Fact label="Trading" value={stats.data ? `${stats.data.bondedCount} players` : "—"} />
          </dl>
        </div>
        <div ref={fan} className="c-fan relative h-[240px] md:h-[300px] lg:h-full lg:min-h-[320px]" aria-label="Players trading now">
          {hand.map((p, i) => {
            const mid = (n - 1) / 2;
            return (
              <Link
                key={p.id}
                href={`/lab/c-collectible/player?player=${p.id}`}
                aria-label={`${p.name}, open`}
                className="c-deal absolute top-1/2 left-1/2 -mt-[calc(var(--h)/2)] -ml-[calc(var(--w)/2)] block rounded-[16px]"
                style={
                  {
                    "--w": `${cardW}px`,
                    "--h": `${Math.round(cardW * 1.4)}px`,
                    "--x": `${(i - mid) * step}px`,
                    "--y": `${Math.abs(i - mid) * 10}px`,
                    "--r": `${(i - mid) * 6}deg`,
                    zIndex: n - Math.round(Math.abs(i - mid) * 2),
                    animationDelay: `${i * 50}ms`,
                  } as React.CSSProperties
                }
              >
                <PlayerCard p={p} width={cardW} tilt={false} as="div" />
              </Link>
            );
          })}
        </div>
      </section>

      <ol aria-label="How it works" className="c-panel grid divide-[var(--c-line)] max-md:divide-y md:grid-cols-3 md:divide-x">
        <Step n={1} title="A card launches">
          The first collectors pay the lowest price on a bonding curve.
        </Step>
        <Step n={2} title="At $25,000 it bonds">
          A trading pool opens that can never be withdrawn.
        </Step>
        <Step n={3} title="Top five get paid">
          {round.data ? `About ${formatPct(round.data.rate, { decimals: 1 })} of the vault` : "A slice of the vault"} is shared every matchday.
        </Step>
      </ol>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[var(--c-mute)]">{label}</dt>
      <dd className="c-num text-[15px] font-semibold">{value}</dd>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 px-5 py-4">
      <span className="c-num flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--c-ink)] text-[11px] font-semibold text-white">{n}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[12px] leading-[1.45] text-[var(--c-mute)]">{children}</span>
      </span>
    </li>
  );
}
