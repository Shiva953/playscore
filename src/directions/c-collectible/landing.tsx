"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { formatUsdCompact } from "@/lib/format";
import { usePlayers, useStats } from "@/lib/protocol/react/hooks";
import { PlayerCard } from "./card";
import { useWidth } from "@/directions/lab/use-width";

/**
 * Landing, first fold: the hand of real trading players is the picture (no photos needed: the cards
 * are typographic). One orchestrated moment: the hand deals in on load.
 */
export function CLanding() {
  const players = usePlayers();
  const stats = useStats();
  const reduce = useReducedMotion();
  const hand = (players.data ?? []).filter((p) => p.status === "trading").slice(0, 5);
  const n = hand.length;
  const [fan, fanW] = useWidth<HTMLDivElement>(560);
  const cardW = fanW < 460 ? 160 : 210;
  const step = Math.min(92, (fanW - cardW - 16) / Math.max(1, n - 1));

  return (
    <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-3 pt-6 pb-24 md:px-6">
      <section className="c-panel grid items-center gap-10 overflow-hidden px-6 pt-10 pb-6 md:px-12 md:pt-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:pb-14">
        <div className="flex flex-col gap-6">
          <h1 className="c-display text-[40px] md:text-[60px]" style={{ lineHeight: 1.04 }}>
            Collect the players. Get paid when they shine.
          </h1>
          <p className="max-w-[44ch] text-[18px] leading-[1.55] text-[var(--c-mute)]">
            Every real footballer is a card you can own in tokens. Hold one at a matchday&apos;s first kickoff, and when they finish top five on their board,
            you share its prize.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/lab/c-collectible/player" className="c-press flex h-14 items-center rounded-full bg-[var(--c-ink)] px-7 text-[17px] font-semibold text-white">
              Start your collection
            </Link>
            <Link href="/lab/c-collectible/matchday" className="text-[16px] font-semibold underline decoration-2 underline-offset-4">
              See today&apos;s matchday
            </Link>
          </div>
        </div>
        <div ref={fan} className="relative flex h-[320px] items-center justify-center md:h-[440px]" aria-label="Players trading now">
          {hand.map((p, i) => {
            const mid = (n - 1) / 2;
            const angle = (i - mid) * 8;
            const x = (i - mid) * step;
            return (
              <motion.div
                key={p.id}
                className="absolute"
                initial={reduce ? false : { y: 160, rotate: 0, x: 0, opacity: 0 }}
                animate={{ y: Math.abs(i - mid) * 18, rotate: angle, x, opacity: 1 }}
                transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: reduce ? 0 : 0.08 * i }}
                style={{ zIndex: n - Math.round(Math.abs(i - mid) * 2) }}
                whileHover={reduce ? undefined : { y: -16, rotate: 0, zIndex: 20 }}
              >
                <Link href={`/lab/c-collectible/player?player=${p.id}`} className="block rounded-[24px]" aria-label={`${p.name}, open`}>
                  <PlayerCard p={p} width={cardW} tilt={false} as="div" />
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section aria-label="How it works" className="grid gap-4 md:grid-cols-3">
        <Step n="1" title="A card launches" body="The first collectors pay the lowest price on a bonding curve, up to 240,000 tokens each." />
        <Step n="2" title="At $25,000 it bonds" body="70% seeds a trading pool that never leaves; 20% tops up the dividend vault." />
        <Step
          n="3"
          title="Top five get paid"
          body={`Every matchday a slice of the ${stats.data ? formatUsdCompact(stats.data.vault) : ""} vault is shared by the top five on each board.`}
        />
      </section>
    </main>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="c-panel flex flex-col gap-3 p-6">
      <span className="c-num flex size-10 items-center justify-center rounded-full bg-[var(--c-ink)] text-[16px] text-white">{n}</span>
      <h2 className="c-display text-[20px]">{title}</h2>
      <p className="text-[15px] text-[var(--c-mute)]">{body}</p>
    </div>
  );
}
