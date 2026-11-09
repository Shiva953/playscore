"use client";

import { useId } from "react";
import { clubIdentity, playerIdentity, type ClubIdentity } from "@/lib/identity/clubs";
import { cn } from "@/lib/utils";

/** A front-on shirt in a 64-unit box: collar at the top, sleeves out to the sides. */
const SHIRT = "M24 6 L12 10 L4 22 L11 27 L14 24 L14 57 Q14 60 17 60 L47 60 Q50 60 50 57 L50 24 L53 27 L60 22 L52 10 L40 6 Q36 12 32 12 Q28 12 24 6 Z";

function Pattern({ kit }: { kit: ClubIdentity }) {
  switch (kit.pattern) {
    case "stripes":
      return (
        <>
          {[14, 26, 38, 50].map((x) => (
            <rect key={x} x={x - 3} y={0} width={6} height={64} fill={kit.second} />
          ))}
        </>
      );
    case "band":
      return (
        <>
          <rect x={25} y={0} width={14} height={64} fill={kit.trim} />
          <rect x={26.5} y={0} width={11} height={64} fill={kit.second} />
        </>
      );
    case "sleeves":
      return (
        <>
          <rect x={0} y={0} width={14.5} height={64} fill={kit.second} />
          <rect x={49.5} y={0} width={14.5} height={64} fill={kit.second} />
        </>
      );
    case "hoops":
      return (
        <>
          {[22, 36, 50].map((y) => (
            <rect key={y} x={0} y={y} width={64} height={6} fill={kit.second} />
          ))}
        </>
      );
    default:
      return null;
  }
}

/** The shirt itself, in the club's colours, with the player's number. Decorative: a name always sits beside it. */
/** `size` in px, or a CSS length (e.g. "0.7em") to scale with the text around it. */
export function Kit({ club, number, size = 40, className }: { club: string; number?: number | null; size?: number | string; className?: string }) {
  const kit = clubIdentity(club);
  const clip = useId();
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cn("shrink-0", className)} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d={SHIRT} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width={64} height={64} fill={kit.base} />
        <Pattern kit={kit} />
        {/* A quiet fold on the left panel gives the cloth some depth without a gradient. */}
        <path d="M14 24 L14 60 L20 60 L20 26 Z" fill="#000" opacity={0.12} />
      </g>
      <path d="M24 6 Q28 12 32 12 Q36 12 40 6" fill="none" stroke={kit.trim} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M4.6 22.8 L10.8 26.6 M59.4 22.8 L53.2 26.6" stroke={kit.trim} strokeWidth={2.4} strokeLinecap="round" />
      {number != null && (typeof size === "string" || size >= 24) ? (
        <text
          x={32}
          y={46}
          textAnchor="middle"
          fontSize={number >= 10 ? 19 : 21}
          fontWeight={600}
          fill={kit.number}
          style={{ fontFamily: "var(--font-display-face)", letterSpacing: "-0.04em" }}
        >
          {number}
        </text>
      ) : null}
    </svg>
  );
}

/** The club as a small roundel in its colours (two halves), with its code when there's room. */
export function ClubMark({ club, size = 16, className, ring = true }: { club: string; size?: number; className?: string; ring?: boolean }) {
  const kit = clubIdentity(club);
  const showCode = size >= 28;
  const other = kit.pattern === "solid" ? kit.trim : kit.second;
  const clip = useId();
  return (
    <span title={club} className={cn("inline-flex shrink-0 rounded-full", ring && "ring-2 ring-[var(--kit-ring)]", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <circle cx={16} cy={16} r={16} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <rect width={32} height={32} fill={kit.base} />
          <polygon points="32,0 32,32 0,32" fill={other} />
        </g>
        {showCode ? (
          <text x={16} y={20} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={kit.number} style={{ fontFamily: "var(--font-display-face)" }}>
            {kit.code}
          </text>
        ) : null}
      </svg>
    </span>
  );
}

/**
 * A player's face in the product: their shirt on a tile, with the club roundel in the corner.
 * Used wherever a player appears in a list, a card or a header.
 */
export function PlayerAvatar({ id, size = 36, className, mark = true }: { id: string; size?: number; className?: string; mark?: boolean }) {
  const p = playerIdentity(id);
  if (!p) return <span className={cn("inline-block shrink-0 rounded-xl bg-kit-tile", className)} style={{ width: size, height: size }} aria-hidden="true" />;
  const markSize = Math.max(10, Math.round(size * 0.36));
  return (
    <span className={cn("kit-tile relative inline-flex shrink-0 items-end justify-center rounded-[28%] bg-kit-tile", className)} style={{ width: size, height: size }} aria-hidden="true">
      <Kit club={p.club} number={p.number} size={Math.round(size * 0.86)} className="kit-shirt -mb-[2%]" />
      {mark ? <ClubMark club={p.club} size={markSize} className="absolute -right-[8%] -bottom-[8%]" /> : null}
    </span>
  );
}
