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

/** A thin line in the card's colour over a faint fill of the same hue. Hover reads a point. */
export function PriceArea({ playerId, range, color, height = 180 }: { playerId: string; range: PriceRange; color: string; height?: number }) {
  const q = usePriceHistory(playerId, range);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const pts = useMemo(() => q.data ?? [], [q.data]);

  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    let lo = Infinity;
    let top = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p.p);
      top = Math.max(top, p.p);
    }
    const pad = (top - lo || top * 0.02) * 0.1;
    const t0 = pts[0]!.t;
    const t1 = pts[pts.length - 1]!.t;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * width;
    const y = (p: number) => 4 + (1 - (p - lo + pad) / (top - lo + 2 * pad)) * (height - 8);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
    return { x, y, line, area: `${line}L${width},${height}L0,${height}Z`, t0, t1 };
  }, [pts, width, height]);

  if (q.isPending || !geo) return <div ref={ref} style={{ height }} className="rounded-[12px] bg-[var(--c-chip)]" aria-busy={q.isPending} />;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const p = hi !== null ? pts[hi]! : null;
  const fmt = range === "24H" ? formatTime : formatDate;

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        className="block touch-pan-y"
        role="img"
        aria-label={`Price ${range}: ${formatPrice(first.p)} to ${formatPrice(last.p)}`}
        onPointerMove={(e) => {
          const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const t = geo.t0 + (px / width) * (geo.t1 - geo.t0);
          let i = 0;
          while (i < pts.length - 1 && Math.abs(pts[i + 1]!.t - t) <= Math.abs(pts[i]!.t - t)) i++;
          setHi(i);
        }}
        onPointerLeave={() => setHi(null)}
      >
        <path d={geo.area} fill={color} fillOpacity={0.12} />
        <path d={geo.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {p ? (
          <>
            <line x1={geo.x(p.t)} x2={geo.x(p.t)} y1={0} y2={height} stroke="var(--c-line)" />
            <circle cx={geo.x(p.t)} cy={geo.y(p.p)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
          </>
        ) : null}
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

/** Card back: the last eight match scores as rounded bars; finishes that paid are in the card's colour. */
export function FormBars({ form, color }: { form: FormEntry[]; color: string }) {
  const rows = form.slice(-8);
  return (
    <ol className="grid h-[110px] items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }} aria-label="Last match scores">
      {rows.map((f, i) => (
        <li key={i} className="flex h-full flex-col justify-end gap-1" title={`${f.label}: ${formatScore(f.score)}, #${f.rank}`}>
          <span className="c-num text-center text-[11px] text-[var(--c-mute)]">{formatScore(f.score)}</span>
          <span className="block w-full rounded-full" style={{ height: `${(f.score / 10) * 76}px`, background: f.rank <= 5 ? color : "var(--c-line)" }} />
        </li>
      ))}
    </ol>
  );
}
