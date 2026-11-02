"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { PositionCode } from "@score/core";
import { formatPct, formatPrice } from "@/lib/format";
import { firstName, surname } from "@/directions/lab/derive";
import { cn } from "@/lib/utils";

export const FACE: Record<PositionCode, { bg: string; ink: string; name: string }> = {
  GK: { bg: "var(--c-gk)", ink: "#0f1419", name: "Goalkeeper" },
  DEF: { bg: "var(--c-def)", ink: "#ffffff", name: "Defender" },
  MID: { bg: "var(--c-mid)", ink: "#ffffff", name: "Midfielder" },
  FWD: { bg: "var(--c-fwd)", ink: "#0f1419", name: "Forward" },
};

/** Where each position plays, as a band of the pitch (0–100 along its length, attacking right). */
const ZONE: Record<PositionCode, [number, number]> = { GK: [0, 17], DEF: [8, 40], MID: [32, 68], FWD: [62, 100] };

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

/** A pitch in white line, with the player's zone lit: the card's picture, since photos are off limits. */
export function Pitch({ position, className }: { position: PositionCode; className?: string }) {
  const [a, b] = ZONE[position];
  return (
    <svg viewBox="0 0 100 64" className={cn("block w-full", className)} aria-hidden="true">
      <rect x="0.75" y="0.75" width="98.5" height="62.5" rx="2" fill="rgba(0,0,0,0.1)" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
      <rect x={a} y="0.75" width={b - a} height="62.5" fill="currentColor" fillOpacity="0.2" />
      <line x1="50" y1="0.75" x2="50" y2="63.25" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
      <circle cx="50" cy="32" r="8" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
      <rect x="0.75" y="17" width="14" height="30" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
      <rect x="85.25" y="17" width="14" height="30" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
      <circle cx={(a + b) / 2} cy="32" r="4.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The player card. Rating (form × 10) top left like a collectible, position under it, ticker top right,
 * the pitch in the middle, a white name band with the price at the bottom. Tilts toward the pointer.
 */
export function PlayerCard({
  p,
  width = 300,
  tilt = true,
  badge,
  className,
  as: Tag = "article",
}: {
  p: CardPlayer;
  width?: number;
  tilt?: boolean;
  badge?: React.ReactNode;
  className?: string;
  as?: "article" | "div";
}) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 260, damping: 22 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-9, 9]), { stiffness: 260, damping: 22 });
  const face = FACE[p.position];
  const s = width / 300; // everything scales with the card…
  const fs = (n: number) => Math.max(11, n * s); // …but reading text never drops below 11px
  const up = p.change24h >= 0;
  const MotionTag = Tag === "article" ? motion.article : motion.div;

  return (
    <MotionTag
      aria-label={`${p.name}, ${face.name}, ${p.club}, ${formatPrice(p.price)}`}
      className={cn("relative flex shrink-0 flex-col overflow-hidden select-none", className)}
      style={{
        width,
        height: width * 1.4,
        borderRadius: 24 * s,
        background: face.bg,
        color: face.ink,
        boxShadow: `inset 0 0 0 ${6 * s}px #fff, var(--c-sticker)`,
        padding: 18 * s,
        rotateX: tilt && !reduce ? rx : 0,
        rotateY: tilt && !reduce ? ry : 0,
        transformPerspective: 900,
      }}
      onPointerMove={(e) => {
        if (!tilt || reduce || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col" style={{ gap: 4 * s }}>
          <span className="c-num leading-none" style={{ fontSize: 46 * s }} aria-label={`Form ${Math.round(p.avgScore * 10)}`}>
            {Math.round(p.avgScore * 10)}
          </span>
          <span className="c-display" style={{ fontSize: 15 * s }}>
            {p.position}
          </span>
        </div>
        <span className="c-display rounded-full bg-white text-[#0f1419]" style={{ fontSize: fs(12), padding: `${5 * s}px ${10 * s}px` }}>
          ${p.ticker}
        </span>
      </div>
      <div className="flex flex-1 items-center" style={{ padding: `${10 * s}px ${2 * s}px` }}>
        <Pitch position={p.position} />
      </div>
      <div className="flex flex-col bg-white text-[#0f1419]" style={{ borderRadius: 16 * s, padding: `${12 * s}px ${14 * s}px`, gap: 6 * s }}>
        <div className="flex flex-col" style={{ gap: 2 * s }}>
          <span className="truncate text-[var(--c-mute)]" style={{ fontSize: fs(12) }}>
            {firstName(p.name) || p.club}
          </span>
          <span className="c-display truncate" style={{ fontSize: 24 * s }}>
            {surname(p.name)}
          </span>
        </div>
        <div className="flex items-center justify-between" style={{ gap: 8 * s }}>
          <span className="c-num" style={{ fontSize: fs(15) }}>
            {formatPrice(p.price)}
          </span>
          <span
            className="c-num rounded-full"
            style={{
              fontSize: fs(12),
              padding: `${3 * s}px ${8 * s}px`,
              background: up ? "var(--c-up-soft)" : "var(--c-down-soft)",
              color: up ? "var(--c-up)" : "var(--c-down)",
            }}
          >
            {up ? "+" : "−"}
            {formatPct(Math.abs(p.change24h), { decimals: 1 })}
          </span>
        </div>
      </div>
      {badge}
    </MotionTag>
  );
}
