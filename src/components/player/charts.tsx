"use client";

import {
  AreaSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type ISeriesApi,
  type HistogramData,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { S_MAX, priceAt } from "@score/core";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ErrorState } from "@/components/common/states";
import { ChartSkeleton } from "@/components/common/skeletons";
import { formatPct, formatPrice, formatTokensCompact } from "@/lib/format";
import { bollinger, ema, rsi, sma } from "@/lib/indicators";
import type { PricePoint, PriceRange } from "@/lib/protocol/types";
import { usePortfolio, usePriceHistory, useRecentTrades } from "@/lib/protocol/react/hooks";
import { tradeWeight } from "@/lib/identity/traders";
import { chartTheme } from "@/lib/theme";

/** Chart colours, read from the theme tokens at runtime (see lib/theme). */
function colors() {
  const t = chartTheme();
  return {
    text: t.text,
    grid: t.grid,
    ink: t.ink,
    soft: t.soft,
    up: t.up,
    down: t.down,
    brand: t.brand,
    surface: t.surface,
    raised: t.raised,
    upFill: t.alpha(t.up, 0.12),
    downFill: t.alpha(t.down, 0.12),
    /** Volume bars stay recessive: the up/down hues at low alpha, under the price line. */
    upVol: t.alpha(t.up, 0.32),
    downVol: t.alpha(t.down, 0.32),
    alpha0: t.alpha(t.surface, 0),
  };
}

// ---------------------------------------------------------------- bonding curve (SVG)

/** Price against tokens sold on the launch curve; the sold part in the data hue, "you are here" in ink. */
export function BondingCurveChart({ sold, myAvgEntry }: { sold: number; myAvgEntry?: number | null }) {
  const C = colors();
  const W = 640;
  const H = 248;
  const ML = 64;
  const MB = 28;
  const MT = 24;
  const MR = 12;
  const pw = W - ML - MR;
  const ph = H - MB - MT;
  const pmax = 0.012;
  const X = (s: number) => ML + (s / S_MAX) * pw;
  const Y = (p: number) => MT + ph - (p / pmax) * ph;
  const N = 64;
  const curve = Array.from({ length: N + 1 }, (_, i) => (S_MAX * i) / N);
  const line = curve.map((s, i) => `${i ? "L" : "M"}${X(s).toFixed(1)} ${Y(priceAt(s)).toFixed(1)}`).join("");
  const done = curve.filter((s) => s < sold).concat(sold);
  const area = `${done.map((s, i) => `${i ? "L" : "M"}${X(s).toFixed(1)} ${Y(priceAt(s)).toFixed(1)}`).join("")}L${X(sold).toFixed(1)} ${Y(0)}L${X(0)} ${Y(0)}Z`;
  const cx = X(Math.min(sold, S_MAX));
  const cy = Y(priceAt(sold));
  const right = cx > W * 0.62;
  return (
    <figure className="w-full min-w-0 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label={`Launch curve. Price now ${formatPrice(priceAt(sold))}, ${formatPct(sold / S_MAX, { decimals: 0 })} of curve tokens sold.`}>
        {[0, 0.004, 0.008, 0.012].map((v) => (
          <g key={v}>
            <line x1={ML} x2={W - MR} y1={Y(v)} y2={Y(v)} stroke={C.grid} />
            <text x={ML - 8} y={Y(v) + 4} textAnchor="end" fontSize={12} fill={C.text} className="num">
              {v === 0 ? "$0" : formatPrice(v).replace(/0+$/, "")}
            </text>
          </g>
        ))}
        {[0, 2e6, 4e6, 6e6].map((s) => (
          <text key={s} x={X(s)} y={H - 8} textAnchor={s === 0 ? "start" : "middle"} fontSize={12} fill={C.text} className="num">
            {s === 0 ? "0" : formatTokensCompact(s)}
          </text>
        ))}
        <path d={area} fill={C.brand} fillOpacity={0.22} />
        <path d={line} fill="none" stroke={C.soft} strokeWidth={2} />
        <line x1={X(S_MAX)} x2={X(S_MAX)} y1={MT - 8} y2={Y(0)} stroke={C.text} strokeDasharray="3 4" />
        <text x={X(S_MAX) - 8} y={MT - 10} textAnchor="end" fontSize={12} fill={C.soft}>
          Bonds at $25,000
        </text>
        {myAvgEntry ? (
          <>
            <line x1={ML} x2={W - MR} y1={Y(myAvgEntry)} y2={Y(myAvgEntry)} stroke={C.soft} strokeDasharray="2 4" />
            <text x={ML + 6} y={Y(myAvgEntry) - 6} fontSize={12} fill={C.soft}>
              Your average {formatPrice(myAvgEntry)}
            </text>
          </>
        ) : null}
        <circle cx={cx} cy={cy} r={6} fill={C.ink} stroke={C.surface} strokeWidth={3} />
        <text x={right ? cx - 12 : cx + 12} y={right ? cy + 22 : cy - 10} textAnchor={right ? "end" : "start"} fontSize={13} fontWeight={500} fill={C.ink}>
          You are here · {formatPrice(priceAt(sold))}
        </text>
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------- price chart (Lightweight Charts)

function toSeries(points: readonly PricePoint[]): { price: LineData<UTCTimestamp>[]; volume: HistogramData<UTCTimestamp>[] } {
  const C = colors();
  const price: LineData<UTCTimestamp>[] = [];
  const vols: number[] = [];
  for (const pt of points) {
    const time = Math.floor(pt.t / 1000) as UTCTimestamp;
    const last = price[price.length - 1];
    if (last && last.time === time) {
      last.value = pt.p;
      vols[vols.length - 1]! += pt.v ?? 0;
    } else if (!last || time > last.time) {
      price.push({ time, value: pt.p });
      vols.push(pt.v ?? 0);
    }
  }
  // Each bar takes the direction of its own move.
  const volume = price.map((d, i) => ({ time: d.time, value: vols[i]!, color: i > 0 && d.value < price[i - 1]!.value ? C.downVol : C.upVol }));
  return { price, volume };
}

export interface Indicators {
  ma: boolean;
  ema: boolean;
  bb: boolean;
  rsi: boolean;
  /** Volume bars along the bottom of the price pane. */
  vol?: boolean;
}

const RANGES: PriceRange[] = ["24H", "3D", "6D", "ALL"];

/** Segmented range control; lives in the chart card's header row. */
export function RangeControl({ value, onChange }: { value: PriceRange; onChange: (r: PriceRange) => void }) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as PriceRange)} size="sm" aria-label="Chart range" className="rounded-full bg-ground p-0.5">
      {RANGES.map((r) => (
        <ToggleGroupItem key={r} value={r} className="h-7 rounded-full px-3 text-xs">
          {r === "ALL" ? "All" : r}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A trade drawn on the chart: yours (labelled) or someone else's big one (a dot). */
export interface ChartMark {
  at: number;
  side: "buy" | "sell";
  mine: boolean;
}

/** Your buys and sells of this player, plus other people's big trades, as marks on the line. */
function useChartMarks(playerId: string): ChartMark[] {
  const pf = usePortfolio();
  const trades = useRecentTrades(playerId, 40);
  return useMemo(() => {
    const mine: ChartMark[] = (pf.data?.history ?? [])
      .filter((a) => a.playerId === playerId && (a.kind === "buy" || a.kind === "sell"))
      .map((a) => ({ at: a.at, side: a.kind as "buy" | "sell", mine: true }));
    const big: ChartMark[] = (trades.data ?? []).filter((t) => !t.mine && tradeWeight(t.usdc) === "big").map((t) => ({ at: t.at, side: t.side, mine: false }));
    return [...mine, ...big];
  }, [pf.data?.history, trades.data, playerId]);
}

export function PriceChart({ playerId, range, indicators, height = 280 }: { playerId: string; range: PriceRange; indicators?: Indicators; height?: number }) {
  const q = usePriceHistory(playerId, range);
  const marks = useChartMarks(playerId);
  if (q.isPending) return <ChartSkeleton height={height} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <LwChart points={q.data} indicators={indicators} height={height} marks={marks} />;
}

/** Marks snap to the last bar at or before them (markers need a time the series has). */
function toMarkers(marks: readonly ChartMark[], data: readonly LineData<UTCTimestamp>[]): SeriesMarker<UTCTimestamp>[] {
  const C = colors();
  if (!data.length) return [];
  const first = data[0]!.time;
  const out: SeriesMarker<UTCTimestamp>[] = [];
  for (const m of marks) {
    const t = Math.floor(m.at / 1000);
    if (t < first) continue;
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (data[mid]!.time <= t) lo = mid;
      else hi = mid - 1;
    }
    const time = data[lo]!.time;
    if (m.mine) {
      out.push({ time, position: m.side === "buy" ? "belowBar" : "aboveBar", shape: m.side === "buy" ? "arrowUp" : "arrowDown", color: m.side === "buy" ? C.up : C.down, text: "You", size: 1 });
    } else {
      out.push({ time, position: "inBar", shape: "circle", color: m.side === "buy" ? C.upVol : C.downVol, size: 0.6 });
    }
  }
  // Markers must be in time order; yours draw over the dots when they share a bar.
  return out.sort((a, b) => a.time - b.time || Number(!!a.text) - Number(!!b.text));
}

function LwChart({ points, indicators, height, marks = [] }: { points: PricePoint[]; indicators?: Indicators; height: number; marks?: readonly ChartMark[] }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ main: ISeriesApi<"Area">; overlays: ISeriesApi<"Line">[]; volume: ISeriesApi<"Histogram"> | null; markers: ISeriesMarkersPluginApi<Time> } | null>(null);
  const series2 = useMemo(() => toSeries(points), [points]);
  const data = series2.price;
  const up = data.length < 2 || data[data.length - 1]!.value >= data[0]!.value;
  const indKey = indicators ? `${indicators.ma}${indicators.ema}${indicators.bb}${indicators.rsi}${indicators.vol}` : "";

  // Created once per indicator set; data and direction updates below don't recreate the chart.
  useEffect(() => {
    const C = colors();
    if (!el.current) return;
    const c = createChart(el.current, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: C.text, fontSize: 12, fontFamily: getComputedStyle(document.body).fontFamily, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: C.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: indicators?.vol ? 0.24 : 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: C.soft, labelBackgroundColor: C.raised }, horzLine: { color: C.soft, labelBackgroundColor: C.raised } },
      localization: { priceFormatter: (p: number) => formatPrice(p) },
      handleScale: false,
    });
    // Volume sits on its own hidden scale in the bottom fifth of the price pane, drawn before the line.
    const volume = indicators?.vol
      ? c.addSeries(HistogramSeries, { priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "volume" } })
      : null;
    if (volume) c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
    const main = c.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerRadius: 4,
      // Prices are never negative: keep the axis from dipping below zero on a launch-curve run-up.
      autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = base();
        return r ? { ...r, priceRange: { minValue: Math.max(0, r.priceRange.minValue), maxValue: r.priceRange.maxValue } } : r;
      },
    });
    const overlays: ISeriesApi<"Line">[] = [];
    const quiet = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    if (indicators?.ma) overlays.push(c.addSeries(LineSeries, { ...quiet, color: C.ink, title: "MA 7" }));
    if (indicators?.ema) overlays.push(c.addSeries(LineSeries, { ...quiet, color: C.soft, title: "EMA 14" }));
    if (indicators?.bb) {
      overlays.push(c.addSeries(LineSeries, { ...quiet, color: C.text, lineStyle: LineStyle.Dashed, title: "BB" }));
      overlays.push(c.addSeries(LineSeries, { ...quiet, color: C.text, lineStyle: LineStyle.Dashed }));
    }
    if (indicators?.rsi) overlays.push(c.addSeries(LineSeries, { ...quiet, color: C.soft, title: "RSI 14", priceFormat: { type: "price", precision: 0, minMove: 1 } }, 1));
    chart.current = c;
    series.current = { main, overlays, volume, markers: createSeriesMarkers(main, []) };
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indKey, height]);

  useEffect(() => {
    const C = colors();
    const s = series.current;
    if (!s) return;
    s.main.applyOptions({ lineColor: up ? C.up : C.down, topColor: up ? C.upFill : C.downFill, bottomColor: C.alpha0 });
    s.main.setData(data);
    s.volume?.setData(series2.volume);
    const values = data.map((d) => d.value);
    const line = (vals: (number | null)[]) => vals.flatMap((v, i) => (v == null ? [] : [{ time: data[i]!.time, value: v }]));
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
  }, [series2, up, indKey]);

  const markers = useMemo(() => toMarkers(marks, data), [marks, data]);
  useEffect(() => {
    series.current?.markers.setMarkers(markers);
  }, [markers, indKey]);

  return <div ref={el} style={{ height }} className="w-full" data-testid="price-chart" />;
}
