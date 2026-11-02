"use client";

import { useMemo, useState } from "react";
import { area, curveStepAfter, line } from "d3-shape";
import { formatPrice, formatTime, formatDate } from "@/lib/format";
import type { PriceRange } from "@/lib/protocol/types";
import { usePriceHistory } from "@/lib/protocol/react/hooks";
import { useWidth } from "@/directions/lab/use-width";
import { cn } from "@/lib/utils";

const RANGES: PriceRange[] = ["24H", "3D", "6D", "ALL"];

export function RangeBlocks({ value, onChange }: { value: PriceRange; onChange: (r: PriceRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Chart range" className="flex">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={r === value}
          onClick={() => onChange(r)}
          className={cn(
            "a-num h-9 min-w-12 border-2 border-black px-2 text-[15px] -ml-0.5 first:ml-0 transition-colors duration-150",
            r === value ? "bg-black text-white" : "bg-white text-black hover:bg-[var(--a-panel)]"
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/**
 * The broadcast chart: a heavy stepped line (prices move in trades, not curves), a grey field under
 * it, one baseline, and the last price as a yellow tag on the right edge. Hover reads off any step.
 */
export function StepChart({ playerId, range, height = 320 }: { playerId: string; range: PriceRange; height?: number }) {
  const q = usePriceHistory(playerId, range);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => q.data ?? [], [q.data]);
  const PAD_R = 92;
  const PAD_T = 12;
  const PAD_B = 28;

  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    const t0 = pts[0]!.t;
    const t1 = pts[pts.length - 1]!.t;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p.p);
      hi = Math.max(hi, p.p);
    }
    const pad = (hi - lo || hi * 0.02) * 0.12;
    lo -= pad;
    hi += pad;
    const w = Math.max(10, width - PAD_R);
    const h = height - PAD_T - PAD_B;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w;
    const y = (p: number) => PAD_T + (1 - (p - lo) / (hi - lo)) * h;
    const ln = line<{ t: number; p: number }>()
      .x((d) => x(d.t))
      .y((d) => y(d.p))
      .curve(curveStepAfter)(pts);
    const ar = area<{ t: number; p: number }>()
      .x((d) => x(d.t))
      .y0(PAD_T + h)
      .y1((d) => y(d.p))
      .curve(curveStepAfter)(pts);
    return { x, y, w, h, ln, ar, lo, hi, t0, t1 };
  }, [pts, width, height]);

  if (q.isPending || !geo) {
    return <div ref={ref} style={{ height }} className="bg-[var(--a-panel)]" aria-busy={q.isPending} />;
  }
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const up = last.p >= first.p;
  const hp = hover !== null ? pts[hover] : null;
  const fmtT = (t: number) => (range === "24H" ? formatTime(t) : formatDate(t));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const t = geo.t0 + (px / geo.w) * (geo.t1 - geo.t0);
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1]!.t <= t) i++;
    setHover(px > geo.w ? null : i);
  };

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Price ${range}: from ${formatPrice(first.p)} to ${formatPrice(last.p)}, ${up ? "up" : "down"}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="block touch-pan-y"
      >
        <path d={geo.ar ?? ""} fill="var(--a-panel)" />
        <line x1={0} x2={geo.w} y1={PAD_T + geo.h} y2={PAD_T + geo.h} stroke="#000" strokeWidth={3} />
        <path d={geo.ln ?? ""} fill="none" stroke="#000" strokeWidth={3} strokeLinejoin="miter" />
        {/* High and low marks on the right axis */}
        {[geo.hi, geo.lo].map((v, i) => (
          <text key={i} x={geo.w + 10} y={geo.y(v) + (i === 0 ? 14 : -4)} className="a-num" fontSize={13} fill="var(--a-mute)">
            {formatPrice(v)}
          </text>
        ))}
        <text x={0} y={height - 8} className="a-num" fontSize={13} fill="var(--a-mute)">
          {fmtT(geo.t0)}
        </text>
        <text x={geo.w} y={height - 8} textAnchor="end" className="a-num" fontSize={13} fill="var(--a-mute)">
          {fmtT(geo.t1)}
        </text>
        {/* Last price tag */}
        <g transform={`translate(${geo.w}, ${geo.y(last.p)})`}>
          <rect x={0} y={-14} width={PAD_R - 4} height={28} fill="var(--a-signal)" />
          <rect x={-5} y={-5} width={10} height={10} fill="#000" />
          <text x={10} y={6} className="a-num" fontSize={16} fill="#000">
            {formatPrice(last.p)}
          </text>
        </g>
        {hp ? (
          <g>
            <line x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={PAD_T} y2={PAD_T + geo.h} stroke="#000" strokeWidth={1} />
            <rect x={geo.x(hp.t) - 4} y={geo.y(hp.p) - 4} width={8} height={8} fill="#000" />
          </g>
        ) : null}
      </svg>
      {hp ? (
        <div
          className="pointer-events-none absolute top-0 bg-black px-2 py-1 text-white"
          style={{ left: Math.min(Math.max(0, geo.x(hp.t) - 60), geo.w - 120) }}
        >
          <span className="a-num text-[15px]">{formatPrice(hp.p)}</span> <span className="text-[12px] text-white/70">{fmtT(hp.t)}</span>
        </div>
      ) : null}
    </div>
  );
}
