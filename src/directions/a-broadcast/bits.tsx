"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import type { PositionCode } from "@score/core";
import { formatCountdown, formatPct, formatPrice, formatUsd } from "@/lib/format";
import { useNow, usePlayers, useRound } from "@/lib/protocol/react/hooks";
import { matchMinute } from "@/directions/lab/derive";
import { cn } from "@/lib/utils";

const POS: Record<PositionCode, { bg: string; fg: string; name: string }> = {
  GK: { bg: "var(--a-gk)", fg: "#000", name: "Goalkeeper" },
  DEF: { bg: "var(--a-def)", fg: "#fff", name: "Defender" },
  MID: { bg: "var(--a-mid)", fg: "#fff", name: "Midfielder" },
  FWD: { bg: "var(--a-fwd)", fg: "#000", name: "Forward" },
};

/** Position as a solid block: the colour carries the position, the code says it. */
export function PosBlock({ position, size = "md", className }: { position: PositionCode; size?: "sm" | "md" | "lg"; className?: string }) {
  const p = POS[position];
  const dims = size === "lg" ? "h-16 min-w-16 px-2 text-[28px]" : size === "md" ? "h-7 min-w-11 px-1.5 text-[15px]" : "h-5 min-w-8 px-1 text-[12px]";
  return (
    <span
      className={cn("a-num inline-flex shrink-0 items-center justify-center leading-none", dims, className)}
      style={{ background: p.bg, color: p.fg }}
      title={p.name}
    >
      {position}
    </span>
  );
}

/** Up/down as a solid block with an arrow, so direction never depends on colour alone. */
export function ChangeBlock({ value, className, suffix }: { value: number; className?: string; suffix?: string }) {
  const up = value >= 0;
  return (
    <span
      className={cn("a-num inline-flex items-center gap-1 px-2 leading-none text-white", className)}
      style={{ background: up ? "var(--a-up)" : "var(--a-down)" }}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "up" : "down"}</span>
      {formatPct(Math.abs(value), { decimals: 1 })}
      {suffix ? <span className="font-medium">{suffix}</span> : null}
    </span>
  );
}

/** Coloured change text for tables (arrow + colour). */
export function ChangeText({ value, className }: { value: number; className?: string }) {
  const up = value >= 0;
  return (
    <span className={cn("a-num", className)} style={{ color: up ? "var(--a-up)" : "var(--a-down)" }}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "up" : "down"}</span> {formatPct(Math.abs(value), { decimals: 1 })}
    </span>
  );
}

/** Section heading: a black bar with a yellow edge, like a graphic's title strip. Sentence case. */
export function BarHeading({ children, aside, as: Tag = "h2", className }: { children: React.ReactNode; aside?: React.ReactNode; as?: "h2" | "h3"; className?: string }) {
  return (
    <div className={cn("flex items-stretch justify-between bg-[var(--a-ink)] text-white", className)}>
      <Tag className="a-num flex items-stretch text-[20px] leading-none">
        <span aria-hidden="true" className="w-2 shrink-0 bg-[var(--a-signal)]" />
        <span className="py-2.5 pr-4 pl-3">{children}</span>
      </Tag>
      {aside ? <div className="flex items-center pr-3 text-[13px] text-white/80">{aside}</div> : null}
    </div>
  );
}

/**
 * The crawl: every trading player's price running along the bottom edge, like a news ticker.
 * GSAP moves it; it stops on hover/focus and under reduced motion.
 */
export function Crawl() {
  const players = usePlayers();
  const track = useRef<HTMLDivElement>(null);
  const rows = (players.data ?? []).filter((p) => p.status === "trading");

  useLayoutEffect(() => {
    const el = track.current;
    if (!el || !rows.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const tween = gsap.to(el, { xPercent: -50, ease: "none", duration: Math.max(18, rows.length * 6), repeat: -1 });
      const pause = () => tween.pause();
      const play = () => tween.play();
      el.addEventListener("mouseenter", pause);
      el.addEventListener("mouseleave", play);
      el.addEventListener("focusin", pause);
      el.addEventListener("focusout", play);
    });
    return () => ctx.revert();
  }, [rows.length]);

  if (!rows.length) return <div className="h-11 bg-[var(--a-ink)]" />;
  const items = (key: string) =>
    rows.map((p) => (
      <Link key={`${key}-${p.id}`} href={`/lab/a-broadcast/player?player=${p.id}`} className="flex shrink-0 items-center gap-2 px-5 hover:bg-white/10" tabIndex={key === "b" ? -1 : 0} aria-hidden={key === "b" ? true : undefined}>
        <span className="a-num text-[17px] text-white">{p.ticker}</span>
        <span className="a-num text-[17px] text-white">{formatPrice(p.price)}</span>
        <span className="a-num text-[15px]" style={{ color: p.change24h >= 0 ? "#3ddc84" : "#ff6b6b" }}>
          {p.change24h >= 0 ? "▲" : "▼"} {formatPct(Math.abs(p.change24h), { decimals: 1 })}
        </span>
      </Link>
    ));
  return (
    <div className="flex h-11 items-stretch overflow-hidden bg-[var(--a-ink)]" aria-label="Player prices">
      <div className="a-num flex shrink-0 items-center bg-[var(--a-signal)] px-4 text-[17px] text-black">Prices</div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div ref={track} className="flex h-full w-max items-stretch">
          {items("a")}
          {items("b")}
        </div>
      </div>
    </div>
  );
}

/** Scorebug: matchday, phase and the clock, in the header. */
export function Scorebug({ className }: { className?: string }) {
  const q = useRound();
  const now = useNow();
  if (!q.data) return <div className={cn("h-9 w-48 bg-white/10", className)} />;
  const r = q.data;
  const left = now ? Math.max(0, r.phaseEndsAt - now) : 0;
  return (
    <Link href="/lab/a-broadcast/matchday" className={cn("flex h-9 items-stretch leading-none", className)} aria-label={`Matchday ${r.round}`}>
      <span className="a-num flex items-center bg-white px-2.5 text-[16px] text-black">MD {r.round}</span>
      {r.phase === "live" ? (
        <span className="a-num flex items-center gap-2 bg-[var(--a-signal)] px-3 text-[16px] text-black">
          Live <span className="text-[18px]">{matchMinute(r)}′</span>
        </span>
      ) : r.phase === "open" ? (
        <span className="a-num flex items-center gap-2 bg-[var(--a-signal)] px-3 text-[16px] text-black">
          Kickoff <span className="text-[18px]">{now ? formatCountdown(left) : "–"}</span>
        </span>
      ) : (
        <span className="a-num flex items-center bg-[var(--a-signal)] px-3 text-[16px] text-black">Full time</span>
      )}
    </Link>
  );
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn("a-num", className)}>{formatUsd(value)}</span>;
}
