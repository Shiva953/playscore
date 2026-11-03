"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type * as React from "react";
import type { PositionCode } from "@score/core";
import { Badge } from "@/components/ui/badge";
import { formatCountdown, formatPct } from "@/lib/format";
import { useNow } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/** Change coloured by good/bad (gains lime, losses red), grey at zero. The sign lives in the text. */
export function Delta({ value, decimals = 2, className, children }: { value: number | null | undefined; decimals?: number; className?: string; children?: ReactNode }) {
  const v = value ?? 0;
  return (
    <span className={cn("fig", Math.abs(v) < 1e-9 ? "text-faint" : v > 0 ? "text-up" : "text-down", className)}>
      {children ?? (Math.abs(v) < 1e-9 ? "0.00%" : formatPct(value, { decimals, signed: true }))}
    </span>
  );
}

/** Quiet identity tint per position (DESIGN.md §3). */
export function PositionBadge({ position, className }: { position: PositionCode; className?: string }) {
  return (
    <Badge variant={position} className={className} data-position={position}>
      {position}
    </Badge>
  );
}

/** Ticker as typographic identity: semibold, uppercase is the data itself. */
export function Ticker({ ticker, className, chip = false }: { ticker: string; className?: string; chip?: boolean }) {
  if (chip) {
    // The ticker as the player's handle: a white chip, the most legible mark in the header.
    return <span className={cn("fig inline-flex h-7 items-center rounded-full bg-ink px-2.5 text-[14px] font-semibold text-black", className)}>${ticker}</span>;
  }
  return <span className={cn("font-semibold tracking-normal", className)}>${ticker}</span>;
}

/** Typographic player identity: ticker + name + position (no photos, crests or logos). */
export function PlayerTag({ id, ticker, name, position, showName = true, className }: { id: string; ticker: string; name?: string; position?: PositionCode; showName?: boolean; className?: string }) {
  return (
    <Link href={`/player/${id}`} className={cn("inline-flex min-w-0 items-center gap-2 rounded-md hover:text-ink", className)}>
      <Ticker ticker={ticker} className="text-[13px]" />
      {showName && name ? <span className="truncate text-soft">{name}</span> : null}
      {position ? <PositionBadge position={position} /> : null}
    </Link>
  );
}

export function StatusBadge({ status, progress }: { status: "scheduled" | "launching" | "trading"; progress?: number }) {
  if (status === "trading") return <Badge variant="secondary">Trading</Badge>;
  if (status === "launching") return <Badge variant="default">Launching {progress !== undefined ? formatPct(progress, { decimals: 0 }) : ""}</Badge>;
  return <Badge variant="outline">Scheduled</Badge>;
}

/** List-only sparkline (never on KPIs). One hue: up or down over its window. */
export function Sparkline({ values, className, width = 80, height = 24 }: { values: number[]; className?: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className={cn("inline-block", className)} style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * width).toFixed(1)} ${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join("");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={cn(up ? "text-up" : "text-down", className)} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function Stat({ label, value, hint, className, size = "md" }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string; size?: "md" | "lg" | "xl" }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[12px] text-soft">{label}</span>
      <span className={cn("fig fig-prop truncate font-semibold text-ink", size === "xl" ? "text-[34px] leading-10" : size === "lg" ? "text-[24px] leading-8" : "text-[20px] leading-7")}>{value}</span>
      {hint ? <span className="text-[12px] text-faint">{hint}</span> : null}
    </div>
  );
}

/** One container split into equal columns by dividers (KPIs are type, not tiles). */
export function StatStrip({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-rule max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none",
        className
      )}
    >
      {children}
    </div>
  );
}

export function StripCell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-surface px-5 py-4", className)}>{children}</div>;
}

export function Countdown({ to, className }: { to: number; className?: string }) {
  const now = useNow();
  return <span className={cn("num font-medium", className)}>{now ? formatCountdown(to - now) : "–:––"}</span>;
}

export function Section({ title, action, children, className, id, description }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string; description?: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-4", className)} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={id ? `${id}-title` : undefined} className="text-base leading-6 font-medium text-ink">
            {title}
          </h2>
          {description ? <p className="text-sm text-soft">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function KeyValue({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 text-sm", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="py-1.5 text-soft">{k}</dt>
          <dd className="num py-1.5 text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A figure that flashes up/down when it changes (colour only, safe under reduced motion)
 * and ticks to its new value over 400ms (instant under reduced motion).
 */
export function LiveFigure({
  value,
  format,
  className,
  flash = true,
  tick = false,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  flash?: boolean;
  tick?: boolean;
}) {
  const prev = useRef(value);
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (flash) {
      setDir(value > from ? "up" : "down");
      setKey((k) => k + 1);
    }
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!tick || reduce) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 400);
      const e = 1 - Math.pow(1 - k, 4);
      setShown(from + (value - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, flash, tick]);
  return (
    <span key={key} className={cn("fig", dir === "up" && "flash-up", dir === "down" && "flash-down", className)}>
      {format(shown)}
    </span>
  );
}

/** Counts up from zero once on mount (a moment, not routine feedback). Instant under reduced motion. */
export function TickUp({ value, format, className, duration = 700 }: { value: number; format: (n: number) => string; className?: string; duration?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    // Reduced motion: zero duration, so the first frame lands on the final value.
    const d = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = d === 0 ? 1 : Math.min(1, (t - start) / d);
      setShown(value * (1 - Math.pow(1 - k, 4)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={cn("fig", className)}>{format(shown)}</span>;
}
