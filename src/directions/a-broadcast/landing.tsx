"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { PLAYERS_BY_ID } from "@score/core";
import { formatPct, formatScore, formatUsd, formatUsdCompact } from "@/lib/format";
import type { RoundState } from "@/lib/protocol/types";
import { useRound, useStats } from "@/lib/protocol/react/hooks";
import { matchMinute, sortedBoards, surname } from "@/directions/lab/derive";
import { PosBlock } from "./bits";

/**
 * Landing hero: the headline is the graphic (condensed, three lines, the full width of its column);
 * beside it the real broadcast: the scorebug and who is leading the forwards right now.
 * One orchestrated moment: the three lines wipe in on load, then nothing else moves but the data.
 */
export function ALanding() {
  const round = useRound();
  const stats = useStats();
  const head = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (!head.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.from("[data-line]", { clipPath: "inset(0 100% 0 0)", duration: 0.6, ease: "power3.out", stagger: 0.09 });
    }, head);
    return () => ctx.revert();
  }, []);

  return (
    <main className="flex flex-col">
      <section className="mx-auto grid w-full max-w-[1440px] gap-x-10 gap-y-8 px-4 pt-8 pb-12 md:px-8 md:pt-12 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end">
        <div className="flex flex-col gap-8">
          <h1 ref={head} className="a-display flex flex-col text-[clamp(56px,9.4vw,136px)]">
            <span data-line>Own the players.</span>
            <span data-line>Get paid when</span>
            <span data-line>they deliver.</span>
          </h1>
          <p className="max-w-[52ch] text-[18px] leading-[1.5]">
            Every real footballer trades as a token. Hold one at kickoff, and when they finish in the top five of their board, you share that board&apos;s
            prize in USDC. On devnet, with test money.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <Link
              href="/lab/a-broadcast/player"
              className="a-num flex h-14 items-center bg-black px-6 text-[22px] text-white transition-transform duration-150 hover:bg-[#222] motion-safe:active:scale-[0.98]"
            >
              Open the markets
            </Link>
            <Link href="/lab/a-broadcast/matchday" className="a-num text-[19px] underline decoration-2 underline-offset-4">
              Watch the live matchday
            </Link>
          </div>
        </div>
        {round.data ? <LiveSide r={round.data} /> : <div className="h-[420px] bg-[var(--a-panel)]" />}
      </section>

      <section aria-label="How it works" className="border-t-[3px] border-black">
        <ol className="mx-auto grid max-w-[1440px] md:grid-cols-3">
          <Step n={1} title="Launch on a curve" figure={stats.data ? `${stats.data.launchingCount} launching` : "–"}>
            The first buyers get the lowest price. Each account can buy up to 240,000 tokens of a launch.
          </Step>
          <Step n={2} title="Bond at $25,000" figure="70% locked">
            The curve closes. 70% seeds a pool that can never be withdrawn, 20% goes to the dividend vault, 10% to the treasury.
          </Step>
          <Step n={3} title="Top five get paid" figure={stats.data ? `${formatUsdCompact(stats.data.vault)} vault` : "–"}>
            Each matchday, the top five on every board share a prize taken from the vault, capped so it can keep paying.
          </Step>
        </ol>
      </section>
    </main>
  );
}

function LiveSide({ r }: { r: RoundState }) {
  const fwd = sortedBoards(r).find((b) => b.label === "FWD") ?? sortedBoards(r)[0];
  const lead = fwd?.rows[0];
  return (
    <aside aria-label="Live now" className="flex flex-col">
      <div className="flex items-stretch bg-black text-white">
        <span className="a-num flex items-center px-4 py-3 text-[22px]">Matchday {r.round}</span>
        <span className="a-num ml-auto flex items-center bg-[var(--a-signal)] px-4 text-[22px] text-black">
          {r.phase === "live" ? `Live ${matchMinute(r)}′` : r.phase === "open" ? "Before kickoff" : "Full time"}
        </span>
      </div>
      <div className="flex items-baseline justify-between bg-[var(--a-panel)] px-4 py-3">
        <span className="text-[14px] text-[var(--a-mute)]">Round pool</span>
        <span className="a-num text-[28px]">
          {formatUsd(r.pool.usd, { decimals: 0 })}
          <span className="ml-2 text-[15px] font-medium text-[var(--a-mute)]">{formatPct(r.pool.effectiveRate, { decimals: 1 })} of the vault</span>
        </span>
      </div>
      {lead && fwd ? (
        <div className="flex flex-col gap-2 border-x-[3px] border-b-[3px] border-black p-4">
          <span className="text-[14px] text-[var(--a-mute)]">Leading the {fwd.label === "FWD" ? "forwards" : fwd.label}</span>
          <div className="flex items-end justify-between gap-4">
            <span className="flex items-end gap-3">
              {PLAYERS_BY_ID[lead.playerId] ? <PosBlock position={PLAYERS_BY_ID[lead.playerId]!.position} size="lg" /> : null}
              <span className="a-display min-w-0 truncate text-[56px] md:text-[64px]">{surname(lead.name)}</span>
            </span>
            <span className="a-num shrink-0 text-[40px] leading-none">{formatScore(lead.display)}</span>
          </div>
          <ol className="mt-2 flex flex-col">
            {fwd.rows.slice(1, 5).map((row) => (
              <li key={row.playerId} className="grid grid-cols-[32px_1fr_auto_auto] items-center gap-3 border-t border-black py-1.5">
                <span className="a-num text-[18px]">{row.rank}</span>
                <span className="a-num text-[18px]">{surname(row.name)}</span>
                <span className="a-num text-[18px]">{formatScore(row.display)}</span>
                <span className="a-num w-20 text-right text-[18px]">{formatUsd(row.usd)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}

function Step({ n, title, figure, children }: { n: number; title: string; figure: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 border-black px-4 py-6 not-last:border-b-[3px] md:px-8 md:not-last:border-r-[3px] md:not-last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="a-num flex items-baseline gap-3 text-[28px] leading-none">
          <span className="flex h-9 w-9 items-center justify-center bg-black text-[22px] text-[var(--a-signal)]">{n}</span>
          {title}
        </h2>
        <span className="a-num text-[18px]">{figure}</span>
      </div>
      <p className="max-w-[46ch] text-[15px] text-[var(--a-mute)]">{children}</p>
    </li>
  );
}
