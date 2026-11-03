"use client";

import { useMemo, useState } from "react";
import type { FormEntry } from "@score/core";
import { formatDate, formatPrice, formatScore, formatTime } from "@/lib/format";
import type { PriceRange } from "@/lib/protocol/types";
import { usePriceHistory } from "@/lib/protocol/react/hooks";
import { useWidth } from "@/directions/lab/use-width";
import { cn } from "@/lib/utils";

const RANGES: PriceRange[] = ["24H", "3D", "6D", "ALL"];

export function RangePills({ value, onChange }: { value: PriceRange; onChange: (r: PriceRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Chart range" className="flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={cn(
            "h-8 min-w-11 rounded-full px-3 text-[12px] font-semibold transition-colors duration-150",
            value === r ? "bg-[var(--c-ink)] text-white" : "text-[var(--c-mute)] hover:bg-[var(--c-chip)] hover:text-[var(--c-ink)]"
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

const X_BAND = 22; // room for the date labels under the plot (inside the chart's own height)

/**
 * Price over time (dataviz marks): a 2px line in the card's colour over a ~10% wash, an end dot
 * (r 4, 2px surface ring), two recessive hairlines at the range's high and low with their values,
 * dates under the plot, and a crosshair that snaps to the nearest point with a tooltip.
 * The chart keeps a landscape shape: its height follows its width (`aspect`), clamped.
 */
export function PriceArea({
  playerId,
  range,
  color,
  height,
  aspect = 0.42,
  minHeight = 200,
  maxHeight = 380,
}: {
  playerId: string;
  range: PriceRange;
  color: string;
  /** Fixed height; otherwise width × aspect, clamped. */
  height?: number;
  aspect?: number;
  minHeight?: number;
  maxHeight?: number;
}) {
  const q = usePriceHistory(playerId, range);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const pts = useMemo(() => q.data ?? [], [q.data]);
  const total = height ?? Math.round(Math.min(maxHeight, Math.max(minHeight, width * aspect)));
  const plotH = total - X_BAND;

  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    let lo = Infinity;
    let top = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p.p);
      top = Math.max(top, p.p);
    }
    const pad = (top - lo || top * 0.02) * 0.12;
    const t0 = pts[0]!.t;
    const t1 = pts[pts.length - 1]!.t;
    const plotW = Math.max(10, width - 8); // keep the end dot inside the box
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * plotW;
    const y = (p: number) => 6 + (1 - (p - lo + pad) / (top - lo + 2 * pad)) * (plotH - 12);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
    return { x, y, line, area: `${line}L${plotW},${plotH}L0,${plotH}Z`, t0, t1, lo, top };
  }, [pts, width, plotH]);

  if (q.isPending || !geo) return <div ref={ref} style={{ height: total }} className="rounded-[12px] bg-[var(--c-chip)]" aria-busy={q.isPending} />;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const p = hi !== null ? pts[hi]! : null;
  const fmt = range === "24H" ? formatTime : formatDate;

  return (
    <div ref={ref} className="relative" style={{ height: total }}>
      <svg
        width={width}
        height={total}
        className="block touch-pan-y"
        role="img"
        aria-label={`Price ${range}: ${formatPrice(first.p)} to ${formatPrice(last.p)}, high ${formatPrice(geo.top)}, low ${formatPrice(geo.lo)}`}
        onPointerMove={(e) => {
          const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const t = geo.t0 + (px / Math.max(1, width - 8)) * (geo.t1 - geo.t0);
          let i = 0;
          while (i < pts.length - 1 && Math.abs(pts[i + 1]!.t - t) <= Math.abs(pts[i]!.t - t)) i++;
          setHi(i);
        }}
        onPointerLeave={() => setHi(null)}
      >
        {/* recessive hairlines at the range's high and low */}
        {[geo.top, geo.lo].map((v) => (
          <line key={v} x1={0} x2={width} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--c-line)" strokeWidth={1} />
        ))}
        <path d={geo.area} fill={color} fillOpacity={0.1} />
        <path d={geo.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {p ? <line x1={geo.x(p.t)} x2={geo.x(p.t)} y1={0} y2={plotH} stroke="var(--c-mute)" strokeOpacity={0.5} strokeWidth={1} /> : null}
        {(() => {
          const d = p ?? last;
          return <circle cx={geo.x(d.t)} cy={geo.y(d.p)} r={4} fill={color} stroke="#fff" strokeWidth={2} />;
        })()}
        <text x={2} y={geo.y(geo.top) - 5} fontSize={11} fill="var(--c-mute)">
          {formatPrice(geo.top)}
        </text>
        <text x={2} y={geo.y(geo.lo) + 14} fontSize={11} fill="var(--c-mute)">
          {formatPrice(geo.lo)}
        </text>
        <text x={0} y={total - 6} fontSize={11} fill="var(--c-mute)">
          {fmt(first.t)}
        </text>
        <text x={width} y={total - 6} fontSize={11} fill="var(--c-mute)" textAnchor="end">
          Now
        </text>
      </svg>
      {p ? (
        <span
          className="c-num pointer-events-none absolute top-0 rounded-full bg-[var(--c-ink)] px-2.5 py-0.5 text-[12px] whitespace-nowrap text-white"
          style={{ left: Math.min(Math.max(0, geo.x(p.t) - 60), width - 150) }}
        >
          {formatPrice(p.p)} · {fmt(p.t)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Last eight match scores as columns (dataviz bars: at most 24px thick, 4px rounded top, square at the
 * baseline, 2px surface gap). Two categories, so a legend; no number on every bar: the latest is
 * labelled and hover reads any of them.
 */
export function FormBars({
  form,
  color,
  height = 110,
  legend = false,
}: {
  form: FormEntry[];
  color: string;
  /** A number, or "fill" to take the panel's free height (100–260px). */
  height?: number | "fill";
  legend?: boolean;
}) {
  const rows = form.slice(-8);
  const [hi, setHi] = useState<number | null>(null);
  const shown = rows[hi ?? rows.length - 1];
  return (
    <div className={cn("flex flex-col gap-2", height === "fill" && "min-h-0 flex-1")}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-[var(--c-mute)]">{hi === null ? "Latest" : shown?.label}</span>
        {shown ? (
          <span className="font-semibold">
            {formatScore(shown.score)}
            <span className="font-normal text-[var(--c-mute)]">, #{shown.rank} on a board</span>
          </span>
        ) : null}
      </div>
      <ol
        className={cn("flex items-end justify-between gap-[2px] border-b border-[var(--c-line)]", height === "fill" && "max-h-[260px] min-h-[100px] flex-1")}
        style={height === "fill" ? undefined : { height }}
        aria-label="Last match scores"
      >
        {rows.map((f, i) => (
          <li
            key={i}
            className="flex h-full flex-1 items-end justify-center"
            onPointerEnter={() => setHi(i)}
            onPointerLeave={() => setHi(null)}
            aria-label={`${f.label}: ${formatScore(f.score)}, rank ${f.rank}${f.rank <= 5 ? ", paid" : ""}`}
          >
            <span
              className="block w-full max-w-6 rounded-t-[4px] transition-opacity duration-150"
              style={{ height: `${(f.score / 10) * 100}%`, background: f.rank <= 5 ? color : "var(--c-line)", opacity: hi === null || hi === i ? 1 : 0.55 }}
            />
          </li>
        ))}
      </ol>
      {legend ? (
        <div className="flex gap-4 text-[12px] text-[var(--c-mute)]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: color }} />
            Top five, paid
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-[var(--c-line)]" />
            Outside the top five
          </span>
        </div>
      ) : null}
    </div>
  );
}
