"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { PositionCode } from "@score/core";
import { Badge } from "@/components/ui/badge";
import { formatCountdown, formatPct } from "@/lib/format";
import { useNow } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

/** Up/down coloured change. Green/red is reserved for direction and P&L. */
export function Delta({ value, decimals = 2, className, children }: { value: number | null | undefined; decimals?: number; className?: string; children?: ReactNode }) {
  const v = value ?? 0;
  return (
    <span className={cn("num", v > 0 ? "text-up" : v < 0 ? "text-down" : "text-muted-foreground", className)}>
      {children ?? formatPct(value, { decimals, signed: true })}
    </span>
  );
}

export function PositionBadge({ position }: { position: PositionCode }) {
  return (
    <Badge variant="outline" className="font-mono" data-position={position}>
      {position}
    </Badge>
  );
}

/** Typographic player identity: ticker + position (no photos, crests or logos). */
export function PlayerTag({ id, ticker, name, position, showName = true, className }: { id: string; ticker: string; name?: string; position?: PositionCode; showName?: boolean; className?: string }) {
  return (
    <Link href={`/player/${id}`} className={cn("inline-flex min-w-0 items-center gap-2 hover:underline", className)}>
      <span className="font-mono text-xs font-semibold">${ticker}</span>
      {showName && name ? <span className="truncate">{name}</span> : null}
      {position ? <PositionBadge position={position} /> : null}
    </Link>
  );
}

export function StatusBadge({ status, progress }: { status: "scheduled" | "launching" | "trading"; progress?: number }) {
  if (status === "trading") return <Badge variant="secondary">Trading</Badge>;
  if (status === "launching") return <Badge variant="outline">Launching {progress !== undefined ? formatPct(progress, { decimals: 0 }) : ""}</Badge>;
  return <Badge variant="ghost">Scheduled</Badge>;
}

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
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="num truncate text-base font-semibold">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function Countdown({ to, className }: { to: number; className?: string }) {
  const now = useNow();
  return <span className={cn("num font-mono", className)}>{now ? formatCountdown(to - now) : "–:––"}</span>;
}

export function Section({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function KeyValue({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="num text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
