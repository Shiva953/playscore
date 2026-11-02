"use client";

import {
  AreaSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import { S_MAX, priceAt } from "@score/core";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ErrorState, LoadingBlock } from "@/components/common/states";
import { formatPrice, formatTokensCompact } from "@/lib/format";
import { bollinger, ema, rsi, sma } from "@/lib/indicators";
import type { PricePoint, PriceRange } from "@/lib/protocol/types";
import { usePriceHistory } from "@/lib/protocol/react/hooks";

// ---------------------------------------------------------------- bonding curve (SVG)

/** Price vs tokens sold on the launch curve, with progress filled and a "you are here" marker. */
export function BondingCurveChart({ sold, myAvgEntry }: { sold: number; myAvgEntry?: number | null }) {
  const W = 640;
  const H = 260;
  const ML = 64;
  const MB = 36;
  const MT = 16;
  const pw = W - ML - 16;
  const ph = H - MB - MT;
  const pmax = priceAt(S_MAX) * 1.06;
  const X = (s: number) => ML + (s / S_MAX) * pw;
  const Y = (p: number) => MT + ph - (p / pmax) * ph;
  const N = 60;
  const curve = Array.from({ length: N + 1 }, (_, i) => (S_MAX * i) / N);
  const line = curve.map((s, i) => `${i ? "L" : "M"}${X(s).toFixed(1)} ${Y(priceAt(s)).toFixed(1)}`).join("");
  const filled = curve.filter((s) => s <= sold).concat(sold);
  const area = `${filled.map((s, i) => `${i ? "L" : "M"}${X(s).toFixed(1)} ${Y(priceAt(s)).toFixed(1)}`).join("")}L${X(sold).toFixed(1)} ${Y(0)}L${X(0)} ${Y(0)}Z`;
  const cx = X(Math.min(sold, S_MAX));
  const cy = Y(priceAt(sold));
  const ticksY = [0, pmax / 3, (2 * pmax) / 3, pmax];
  const ticksX = [0, S_MAX / 4, S_MAX / 2, (3 * S_MAX) / 4, S_MAX];
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-foreground" role="img" aria-label={`Bonding curve. Current price ${formatPrice(priceAt(sold))}.`}>
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={ML} x2={W - 16} y1={Y(v)} y2={Y(v)} stroke="currentColor" strokeOpacity={0.1} />
            <text x={ML - 6} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
              {formatPrice(v)}
            </text>
          </g>
        ))}
        {ticksX.map((s) => (
          <text key={s} x={X(s)} y={H - MB + 16} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>
            {formatTokensCompact(s)}
          </text>
        ))}
        <path d={area} fill="currentColor" fillOpacity={0.12} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={2} />
        <line x1={X(S_MAX)} x2={X(S_MAX)} y1={MT} y2={Y(0)} stroke="currentColor" strokeDasharray="4 4" strokeOpacity={0.6} />
        <text x={X(S_MAX) - 6} y={MT + 10} textAnchor="end" fontSize={11} fill="currentColor">
          Bonds at $25k raised
        </text>
        {myAvgEntry ? (
          <line x1={ML} x2={W - 16} y1={Y(myAvgEntry)} y2={Y(myAvgEntry)} stroke="currentColor" strokeDasharray="2 3" strokeOpacity={0.5} />
        ) : null}
        <circle cx={cx} cy={cy} r={6} fill="currentColor" />
        <text
          x={cx > W * 0.6 ? cx - 12 : cx + 10}
          y={cx > W * 0.6 ? cy + 22 : cy - 10}
          textAnchor={cx > W * 0.6 ? "end" : "start"}
          fontSize={12}
          fontWeight={600}
          fill="currentColor"
        >
          You are here · {formatPrice(priceAt(sold))}
        </text>
        <text x={ML + pw / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>
          Tokens sold on the curve
        </text>
      </svg>
      <figcaption className="sr-only">Price rises as more tokens are sold. At $25,000 raised the player bonds.</figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- price chart (Lightweight Charts)

const PALETTE = {
  dark: { text: "#a3a3a3", grid: "#262626", line: "#e5e5e5", area: "rgba(229,229,229,0.12)", a: "#a3a3a3", b: "#737373", c: "#525252" },
  light: { text: "#525252", grid: "#e5e5e5", line: "#171717", area: "rgba(23,23,23,0.08)", a: "#525252", b: "#737373", c: "#a3a3a3" },
};

function toSeries(points: readonly PricePoint[]): LineData<UTCTimestamp>[] {
  const out: LineData<UTCTimestamp>[] = [];
  for (const pt of points) {
    const time = Math.floor(pt.t / 1000) as UTCTimestamp;
    const last = out[out.length - 1];
    if (last && last.time === time) last.value = pt.p;
    else if (!last || time > last.time) out.push({ time, value: pt.p });
  }
  return out;
}

export interface Indicators {
  ma: boolean;
  ema: boolean;
  bb: boolean;
  rsi: boolean;
}

const RANGES: PriceRange[] = ["24H", "3D", "6D", "ALL"];

export function PriceChart({
  playerId,
  range,
  onRange,
  indicators,
  height = 280,
}: {
  playerId: string;
  range: PriceRange;
  onRange: (r: PriceRange) => void;
  indicators?: Indicators;
  height?: number;
}) {
  const q = usePriceHistory(playerId, range);
  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup type="single" value={range} onValueChange={(v) => v && onRange(v as PriceRange)} variant="outline" size="sm" aria-label="Chart range">
        {RANGES.map((r) => (
          <ToggleGroupItem key={r} value={r}>
            {r}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {q.isPending ? (
        <LoadingBlock style={{ height }} />
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <LwChart points={q.data} indicators={indicators} height={height} />
      )}
    </div>
  );
}

function LwChart({ points, indicators, height }: { points: PricePoint[]; indicators?: Indicators; height: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ main: ISeriesApi<"Area">; overlays: ISeriesApi<"Line">[] } | null>(null);
  const { resolvedTheme } = useTheme();
  const pal = PALETTE[resolvedTheme === "light" ? "light" : "dark"];
  const data = useMemo(() => toSeries(points), [points]);
  const indKey = indicators ? `${indicators.ma}${indicators.ema}${indicators.bb}${indicators.rsi}` : "";

  // Create once per theme / indicator set; data updates below don't recreate the chart.
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: pal.text, attributionLogo: false },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: (p: number) => formatPrice(p) },
    });
    const main = c.addSeries(AreaSeries, { lineColor: pal.line, topColor: pal.area, bottomColor: "transparent", lineWidth: 2, priceLineVisible: true });
    const overlays: ISeriesApi<"Line">[] = [];
    if (indicators?.ma) overlays.push(c.addSeries(LineSeries, { color: pal.a, lineWidth: 1, title: "MA 7", priceLineVisible: false, lastValueVisible: false }));
    if (indicators?.ema) overlays.push(c.addSeries(LineSeries, { color: pal.b, lineWidth: 1, title: "EMA 14", priceLineVisible: false, lastValueVisible: false }));
    if (indicators?.bb) {
      overlays.push(c.addSeries(LineSeries, { color: pal.c, lineWidth: 1, lineStyle: 2, title: "BB upper", priceLineVisible: false, lastValueVisible: false }));
      overlays.push(c.addSeries(LineSeries, { color: pal.c, lineWidth: 1, lineStyle: 2, title: "BB lower", priceLineVisible: false, lastValueVisible: false }));
    }
    if (indicators?.rsi) {
      overlays.push(c.addSeries(LineSeries, { color: pal.a, lineWidth: 1, title: "RSI 14", priceLineVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } }, 1));
    }
    chart.current = c;
    series.current = { main, overlays };
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, indKey, height]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.main.setData(data);
    const values = data.map((d) => d.value);
    const line = (vals: (number | null)[]) =>
      vals.flatMap((v, i) => (v == null ? [] : [{ time: data[i]!.time, value: v }]));
    let k = 0;
    if (indicators?.ma) s.overlays[k++]?.setData(line(sma(values, 7)));
    if (indicators?.ema) s.overlays[k++]?.setData(line(ema(values, 14)));
    if (indicators?.bb) {
      const bb = bollinger(values, 20, 2);
      s.overlays[k++]?.setData(line(bb.upper));
      s.overlays[k++]?.setData(line(bb.lower));
    }
    if (indicators?.rsi) s.overlays[k++]?.setData(line(rsi(values, 14)));
    chart.current?.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, indKey, resolvedTheme]);

  return <div ref={el} style={{ height }} className="w-full" data-testid="price-chart" />;
}
