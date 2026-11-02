"use client";

import { useMemo, useState } from "react";
import { LinePath, Line } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";
import type { PricePoint, PriceRange } from "@/lib/protocol/types";
import { usePriceHistory } from "@/lib/protocol/react/hooks";
import { useWidth } from "@/directions/lab/use-width";
import { cn } from "@/lib/utils";

export const RANGES: { id: PriceRange; label: string }[] = [
  { id: "24H", label: "1D" },
  { id: "3D", label: "3D" },
  { id: "6D", label: "1W" },
  { id: "ALL", label: "All" },
];

export function RangeChips({ value, onChange }: { value: PriceRange; onChange: (r: PriceRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Chart range" className="flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={value === r.id}
          onClick={() => onChange(r.id)}
          className={cn(
            "b-control min-w-11 rounded-[var(--b-radius-control)] px-3 text-[13px] font-semibold transition-colors duration-150",
            value === r.id ? "bg-[var(--b-accent-soft)] text-[var(--b-accent-ink)]" : "text-[var(--b-muted)] hover:bg-[var(--b-raised)] hover:text-[var(--b-text)]"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The hero chart: one blue line, no grid, a dashed line at the range's opening price.
 * Scrubbing moves a hairline and reports the point to the page title (the price follows the pointer).
 */
export function ScrubChart({
  playerId,
  range,
  height = 340,
  onScrub,
}: {
  playerId: string;
  range: PriceRange;
  height?: number;
  onScrub?: (p: PricePoint | null, first: PricePoint | null) => void;
}) {
  const q = usePriceHistory(playerId, range);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const pts = useMemo(() => q.data ?? [], [q.data]);

  const scales = useMemo(() => {
    if (pts.length < 2) return null;
    let lo = Infinity;
    let hiP = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p.p);
      hiP = Math.max(hiP, p.p);
    }
    const pad = (hiP - lo || hiP * 0.02) * 0.08;
    return {
      x: scaleLinear({ domain: [pts[0]!.t, pts[pts.length - 1]!.t], range: [0, width] }),
      y: scaleLinear({ domain: [lo - pad, hiP + pad], range: [height - 8, 8] }),
    };
  }, [pts, width, height]);

  if (q.isPending || !scales) return <div ref={ref} style={{ height }} className="rounded-[var(--b-radius-card)] bg-[var(--b-raised)]" aria-busy={q.isPending} />;

  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const p = hi !== null ? pts[hi] : null;
  const fmt = range === "24H" ? formatDateTime : formatDate;

  const move = (e: React.PointerEvent<SVGRectElement>) => {
    const pt = localPoint(e);
    if (!pt) return;
    const t = scales.x.invert(pt.x);
    let i = 0;
    while (i < pts.length - 1 && Math.abs(pts[i + 1]!.t - t) < Math.abs(pts[i]!.t - t)) i++;
    setHi(i);
    onScrub?.(pts[i]!, first);
  };
  const leave = () => {
    setHi(null);
    onScrub?.(null, first);
  };

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={`Price over ${range}: ${formatPrice(first.p)} to ${formatPrice(last.p)}`} className="block">
        <Line from={{ x: 0, y: scales.y(first.p) }} to={{ x: width, y: scales.y(first.p) }} stroke="var(--b-control)" strokeDasharray="2 4" strokeWidth={1} />
        <LinePath data={pts} x={(d) => scales.x(d.t)} y={(d) => scales.y(d.p)} curve={curveMonotoneX} stroke="var(--b-accent)" strokeWidth={2} />
        {p ? (
          <>
            <Line from={{ x: scales.x(p.t), y: 0 }} to={{ x: scales.x(p.t), y: height }} stroke="var(--b-control)" strokeWidth={1} />
            <circle cx={scales.x(p.t)} cy={scales.y(p.p)} r={5} fill="var(--b-accent)" stroke="#fff" strokeWidth={2} />
          </>
        ) : (
          <circle cx={scales.x(last.t)} cy={scales.y(last.p)} r={4} fill="var(--b-accent)" />
        )}
        <rect width={width} height={height} fill="transparent" onPointerMove={move} onPointerLeave={leave} style={{ touchAction: "pan-y" }} />
      </svg>
      <div className="mt-2 flex justify-between text-[12px] text-[var(--b-muted)]">
        <span>{fmt(first.t)}</span>
        <span aria-live="polite">{p ? fmt(p.t) : "Now"}</span>
      </div>
    </div>
  );
}
