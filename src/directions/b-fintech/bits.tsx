"use client";

import { cn } from "@/lib/utils";
import { formatPct } from "@/lib/format";

type Tone = "neutral" | "accent" | "pos" | "neg";
const TONES: Record<Tone, string> = {
  neutral: "bg-[var(--b-pill-neutral-bg)] text-[var(--b-pill-neutral-ink)]",
  accent: "bg-[var(--b-accent-soft)] text-[var(--b-accent-ink)]",
  pos: "bg-[var(--b-pill-pos-bg)] text-[var(--b-pill-pos-ink)]",
  neg: "bg-[var(--b-pill-neg-bg)] text-[var(--b-pill-neg-ink)]",
};

/** Pale pill with the dark ink of its own hue. Positions stay neutral: one hue family per screen. */
export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

/** Signed change in the money colours, with a sign so it never relies on colour. */
export function Change({ value, className, abs }: { value: number; className?: string; abs?: string }) {
  const up = value >= 0;
  return (
    <span className={cn("b-num font-medium", className)} style={{ color: up ? "var(--b-positive)" : "var(--b-negative)" }}>
      {abs ? `${up ? "+" : "−"}${abs} ` : ""}
      {abs ? "(" : ""}
      {up ? "+" : "−"}
      {formatPct(Math.abs(value))}
      {abs ? ")" : ""}
    </span>
  );
}

export function Card({ title, aside, children, className, tint }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string; tint?: boolean }) {
  return (
    <section
      className={cn("flex flex-col gap-4 p-6", tint ? "rounded-[var(--b-radius-card)] bg-[var(--b-accent-soft)]" : "b-card", className)}
      aria-label={title}
    >
      {title ? (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={cn("text-[18px] font-semibold", tint && "text-[var(--b-accent-ink)]")}>{title}</h2>
          {aside ? <div className="text-[13px] text-[var(--b-muted)]">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Label/value pair for the key statistics grid. */
export function KV({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--b-rule)] pb-3">
      <dt className="text-[13px] text-[var(--b-muted)]">{label}</dt>
      <dd className="b-num text-[18px] font-medium">{value}</dd>
      {note ? <dd className="text-[12px] text-[var(--b-muted)]">{note}</dd> : null}
    </div>
  );
}
