"use client";

import Link from "next/link";
import { formatPct, formatPrice, formatUsd, formatUsdCompact } from "@/lib/format";
import { usePlayer, useRound, useStats } from "@/lib/protocol/react/hooks";
import { matchMinute } from "@/directions/lab/derive";
import { Change, Pill } from "./bits";
import { ScrubChart } from "./chart";

/**
 * Landing, first fold. One sentence and one button on the left; on the right the product itself:
 * KANE's real chart and what his holders are making this matchday.
 */
export function BLanding() {
  const stats = useStats();
  const round = useRound();
  const kane = usePlayer("kane");
  const s = stats.data;
  const r = round.data;
  const p = kane.data;
  const kaneUsd = r?.boards.flatMap((b) => b.rows).filter((x) => x.playerId === "kane").reduce((a, x) => a + x.usd, 0) ?? 0;

  return (
    <div className="min-h-svh">
      <header className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-4 md:px-6">
        <Link href="/lab/b-fintech/landing" className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em]">
          <span aria-hidden="true" className="h-4 w-2 rounded-[2px] bg-[var(--b-accent)]" />
          score
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-[14px]">
          <Link href="/lab/b-fintech/matchday" className="hidden rounded-[var(--b-radius-control)] px-3 py-1.5 text-[var(--b-muted)] hover:text-[var(--b-text)] sm:block">
            Matchday
          </Link>
          <Link
            href="/lab/b-fintech/player"
            className="b-control flex items-center rounded-[var(--b-radius-control)] bg-[var(--b-text)] px-3.5 text-[13px] font-semibold text-white hover:bg-black"
          >
            Open the app
          </Link>
        </nav>
      </header>

      <main className="mx-auto grid max-w-[1180px] gap-12 px-4 pt-10 pb-16 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-center lg:pt-20">
        <section className="flex flex-col gap-6">
          <h1 className="max-w-[14ch] text-[44px] leading-[1.05] font-bold tracking-[-0.025em] md:text-[60px]">Own a stake in the players you follow.</h1>
          <p className="max-w-[46ch] text-[17px] leading-[1.55] text-[var(--b-muted)]">
            Real footballers trade as tokens priced in USDC. Hold one at a matchday&apos;s first kickoff, and if they finish in the top five of their board, you
            share its prize.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/lab/b-fintech/player"
              className="flex h-11 items-center rounded-[var(--b-radius-control)] bg-[var(--b-accent)] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[var(--b-accent-hover)]"
            >
              Open the markets
            </Link>
            <Link href="/lab/b-fintech/matchday" className="text-[15px] font-medium text-[var(--b-accent-ink)] underline decoration-[var(--b-accent-track)] underline-offset-4 hover:decoration-[var(--b-accent-ink)]">
              See this matchday
            </Link>
          </div>
          <dl className="mt-4 grid max-w-[520px] grid-cols-3 gap-6 border-t border-[var(--b-border)] pt-6">
            <Fact label="Dividend vault" value={s ? formatUsdCompact(s.vault) : "—"} />
            <Fact label="This matchday's pool" value={r ? formatUsd(r.pool.usd, { decimals: 0 }) : "—"} />
            <Fact label="Players trading" value={s ? String(s.bondedCount) : "—"} />
          </dl>
        </section>

        <section data-ui aria-label="Harry Kane, live" className="b-card flex flex-col gap-5 p-6 shadow-[0_24px_48px_-24px_rgba(30,58,138,0.18)]">
          {p ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold">{p.name}</span>
                    <Pill>{p.position}</Pill>
                  </div>
                  <span className="b-num text-[30px] leading-none font-semibold tracking-[-0.02em]">{formatPrice(p.price)}</span>
                  <span className="text-[13px]">
                    <Change value={p.change24h} /> <span className="text-[var(--b-muted)]">today</span>
                  </span>
                </div>
                {r?.phase === "live" ? (
                  <Pill tone="accent">Live · {matchMinute(r)}′</Pill>
                ) : (
                  <Pill>{r?.phase === "open" ? "Before kickoff" : "Full time"}</Pill>
                )}
              </div>
              <ScrubChart playerId="kane" range="6D" height={200} />
              <div className="flex items-baseline justify-between rounded-[var(--b-radius-control)] bg-[var(--b-accent-soft)] px-4 py-3">
                <span className="text-[13px] text-[var(--b-accent-ink)]">Kane&apos;s holders this matchday</span>
                <span className="b-num text-[18px] font-semibold text-[var(--b-accent-ink)]">{formatUsd(kaneUsd)}</span>
              </div>
            </>
          ) : (
            <div className="h-[360px] rounded-[var(--b-radius-control)] bg-[var(--b-raised)]" />
          )}
        </section>
      </main>

      <section aria-label="How it works" className="border-t border-[var(--b-border)] bg-white">
        <ol className="mx-auto grid max-w-[1180px] gap-8 px-4 py-12 md:grid-cols-3 md:px-6">
          <Step title="A player launches" body="The first buyers get the lowest price on a bonding curve, up to 240,000 tokens each." />
          <Step title="At $25,000 it bonds" body="70% seeds a trading pool that can never be withdrawn; 20% goes to the dividend vault." />
          <Step
            title="The top five get paid"
            body={`Each matchday a share of the vault (${r ? formatPct(r.pool.effectiveRate, { decimals: 1 }) : "about 1%"} now) is split among the top five on every board.`}
          />
        </ol>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[12px] text-[var(--b-muted)]">{label}</dt>
      <dd className="b-num text-[20px] font-semibold">{value}</dd>
    </div>
  );
}

function Step({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex flex-col gap-2">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <p className="max-w-[40ch] text-[14px] text-[var(--b-muted)]">{body}</p>
    </li>
  );
}
