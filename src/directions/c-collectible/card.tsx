"use client";

import { useRef } from "react";
import type { PositionCode } from "@score/core";
import { formatPct, formatPrice } from "@/lib/format";
import { surname } from "@/directions/lab/derive";
import { cn } from "@/lib/utils";

export const FACE: Record<PositionCode, { bg: string; ink: string; keyline: string; shirt: string; name: string }> = {
  GK: { bg: "var(--c-gk)", ink: "#0e1116", keyline: "rgba(14,17,22,0.16)", shirt: "rgba(14,17,22,0.12)", name: "Goalkeeper" },
  DEF: { bg: "var(--c-def)", ink: "#ffffff", keyline: "rgba(255,255,255,0.32)", shirt: "rgba(14,17,22,0.2)", name: "Defender" },
  MID: { bg: "var(--c-mid)", ink: "#ffffff", keyline: "rgba(255,255,255,0.32)", shirt: "rgba(14,17,22,0.2)", name: "Midfielder" },
  FWD: { bg: "var(--c-fwd)", ink: "#0e1116", keyline: "rgba(14,17,22,0.16)", shirt: "rgba(14,17,22,0.13)", name: "Forward" },
};

export interface CardPlayer {
  id: string;
  name: string;
  ticker: string;
  position: PositionCode;
  club: string;
  avgScore: number;
  price: number;
  change24h: number;
}

/** The back of a generic shirt with the surname printed across the shoulders: the card's picture. */
function ShirtBack({ name, fill, ink }: { name: string; fill: string; ink: string }) {
  const label = surname(name).toUpperCase();
  const fs = Math.min(10, 52 / (label.length * 0.66));
  return (
    <svg viewBox="0 0 100 92" className="block h-full w-full" aria-hidden="true">
      <path d="M31 6 L42 2 Q50 8 58 2 L69 6 L94 19 L86 39 L76 35 L76 90 L24 90 L24 35 L14 39 L6 19 Z" fill={fill} />
      <text x="50" y="30" textAnchor="middle" fontSize={fs} fontWeight={600} letterSpacing="0.06em" fill={ink} opacity={0.92}>
        {label}
      </text>
    </svg>
  );
}

/**
 * The player card. Form rating in the corner (like a collectible), position under it, ticker at the
 * right, the shirt in the middle, and a white plate with name, price and the day's change.
 * Tilts slightly toward a mouse pointer (written straight to `transform`; CSS smooths it).
 */
export function PlayerCard({
  p,
  width = 220,
  tilt = true,
  className,
  as: Tag = "article",
}: {
  p: CardPlayer;
  width?: number;
  tilt?: boolean;
  className?: string;
  as?: "article" | "div";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const frame = useRef(0);
  const face = FACE[p.position];
  const s = width / 220;
  const fs = (n: number) => Math.max(11, Math.round(n * s));
  const up = p.change24h >= 0;

  const canTilt = () =>
    tilt && typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse" || !canTilt()) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.transform = `perspective(800px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg)`;
    });
  };
  const onLeave = (e: React.PointerEvent<HTMLElement>) => {
    cancelAnimationFrame(frame.current);
    e.currentTarget.style.transform = "";
  };

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      aria-label={`${p.name}, ${face.name}, ${p.club}, ${formatPrice(p.price)}`}
      className={cn("c-card relative flex shrink-0 flex-col overflow-hidden select-none", className)}
      style={{
        width,
        height: Math.round(width * 1.4),
        borderRadius: 16 * s,
        background: face.bg,
        color: face.ink,
        padding: 12 * s,
        boxShadow: "0 1px 2px rgba(14,17,22,0.08), 0 14px 28px -18px rgba(14,17,22,0.45)",
      }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <span aria-hidden="true" className="pointer-events-none absolute" style={{ inset: 5 * s, borderRadius: 12 * s, border: `1px solid ${face.keyline}` }} />
      <div className="relative flex items-start justify-between">
        <div className="flex flex-col leading-none">
          <span className="c-num font-bold tracking-[-0.02em]" style={{ fontSize: Math.round(26 * s) }} aria-label={`Form ${Math.round(p.avgScore * 10)}`}>
            {Math.round(p.avgScore * 10)}
          </span>
          <span className="font-semibold" style={{ fontSize: fs(10), marginTop: 3 * s }}>
            {p.position}
          </span>
        </div>
        <span className="font-semibold" style={{ fontSize: fs(10) }}>
          ${p.ticker}
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center" style={{ padding: `${2 * s}px ${14 * s}px` }}>
        <ShirtBack name={p.name} fill={face.shirt} ink={face.ink} />
      </div>
      <div className="relative flex flex-col bg-white text-[var(--c-ink)]" style={{ borderRadius: 10 * s, padding: `${7 * s}px ${9 * s}px`, gap: 2 * s }}>
        <span className="truncate font-semibold" style={{ fontSize: fs(13) }}>
          {p.name}
        </span>
        <span className="flex items-center justify-between" style={{ gap: 6 * s }}>
          <span className="c-num font-medium text-[var(--c-mute)]" style={{ fontSize: fs(11) }}>
            {formatPrice(p.price)}
          </span>
          <span className="c-num font-semibold" style={{ fontSize: fs(11), color: up ? "var(--c-up)" : "var(--c-down)" }}>
            {up ? "+" : "−"}
            {formatPct(Math.abs(p.change24h), { decimals: 1 })}
          </span>
        </span>
      </div>
    </Tag>
  );
}
