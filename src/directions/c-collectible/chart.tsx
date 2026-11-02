"use client";

import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FormEntry } from "@score/core";
import { formatDate, formatPrice, formatScore } from "@/lib/format";
import type { PriceRange } from "@/lib/protocol/types";
import { usePriceHistory } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";

const RANGES: PriceRange[] = ["24H", "3D", "6D", "ALL"];

export function RangePills({ value, onChange }: { value: PriceRange; onChange: (r: PriceRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Chart range" className="flex gap-1.5">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={cn(
            "h-10 min-w-12 rounded-full px-3 text-[14px] font-semibold transition-colors duration-150",
            value === r ? "bg-[var(--c-ink)] text-white" : "bg-[var(--c-chip)] text-[var(--c-ink)] hover:bg-[var(--c-line)]"
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/** Soft area in the player's own colour: the chart belongs to the card. */
export function PriceArea({ playerId, range, color, height = 260 }: { playerId: string; range: PriceRange; color: string; height?: number }) {
  const q = usePriceHistory(playerId, range);
  const data = q.data ?? [];
  if (q.isPending || data.length < 2) return <div style={{ height }} className="rounded-[16px] bg-[var(--c-chip)]" aria-busy={q.isPending} />;
  const first = data[0]!.p;
  const last = data[data.length - 1]!.p;
  return (
    <div style={{ height }} role="img" aria-label={`Price ${range}: ${formatPrice(first)} to ${formatPrice(last)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="t" hide />
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Tooltip
            cursor={{ stroke: "var(--c-ink)", strokeWidth: 1 }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="rounded-full bg-[var(--c-ink)] px-3 py-1 text-[13px] text-white">
                  <span className="c-num">{formatPrice(payload[0].payload.p)}</span> · {formatDate(payload[0].payload.t)}
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="p" stroke={color} strokeWidth={3} fill={color} fillOpacity={0.18} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Card back: the last eight match scores as rounded bars, paid finishes in the card colour. */
export function FormChart({ form, color }: { form: FormEntry[]; color: string }) {
  const data = form.slice(-8).map((f) => ({ ...f, fill: f.rank <= 5 ? color : "rgba(15,20,25,0.18)" }));
  return (
    <div className="h-[150px]" role="img" aria-label={`Last ${data.length} scores: ${data.map((d) => formatScore(d.score)).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" hide />
          <YAxis domain={[0, 10]} hide />
          <Bar dataKey="score" radius={[8, 8, 8, 8]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
