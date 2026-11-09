"use client";

import {
  AreaSeries,
  ColorType,
  LineType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDateTime, formatPct, formatUsd } from "@/lib/format";
import type { Portfolio, ValuePoint, ValueRange } from "@/lib/protocol/types";
import { useValueHistory } from "@/lib/protocol/react/hooks";
import { cn } from "@/lib/utils";
import { chartTheme } from "@/lib/theme";

/** Chart colours, read from the theme tokens at runtime (see lib/theme). */
function colors() {
  const t = chartTheme();
  return {
    text: t.text,
    grid: t.grid,
    ink: t.ink,
    up: t.up,
    down: t.down,
    control: t.control,
    upFill: t.alpha(t.up, 0.14),
    downFill: t.alpha(t.down, 0.14),
    inkFill: t.alpha(t.ink, 0.06),
    clear: t.alpha(t.surface, 0),
  };
}

const RANGES: ValueRange[] = ["1H", "24H", "7D", "ALL"];
const RANGE_WORDS: Record<ValueRange, string> = {
  "1H": "past hour",
  "24H": "past 24 hours",
  "7D": "past 7 days",
  ALL: "all time",
};

/** One point per second (the chart's time unit); the latest sample in a second wins. */
function toSeries(points: readonly ValuePoint[]) {
  const out: { time: UTCTimestamp; value: number; pnl: number }[] = [];
  for (const p of points) {
    const time = Math.floor(p.t / 1000) as UTCTimestamp;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.value = p.value;
      last.pnl = p.pnl;
    } else if (!last || time > last.time)
      out.push({ time, value: p.value, pnl: p.pnl });
  }
  return out;
}

/** "$1,640.05" as a big figure with quieter cents (the account menu's Money, at headline size). */
function BigMoney({ value }: { value: number }) {
  const [whole, cents = "00"] = formatUsd(value).split(".");
  return (
    <span
      className="fig fig-prop flex items-baseline leading-none text-ink"
      aria-live="polite"
    >
      <span className="text-[3rem] font-semibold tracking-[-0.03em] md:text-[4rem]">
        {whole}
      </span>
      <span className="text-[1.75rem] font-semibold tracking-[-0.02em] text-soft md:text-[2.25rem]">
        .{cents}
      </span>
    </span>
  );
}

/**
 * The portfolio's headline (after pump.fun's portfolio): what everything is worth, as the biggest
 * figure on the screen; the P&L for the chosen range under it in its colour; money in and out right
 * beside it. Hovering the line moves the figure to that moment; letting go returns it to now.
 * `arriving` is a deposit seen in the wallet and still being added: noted, not counted, until it lands.
 */
export function PortfolioHero({
  d,
  arriving = 0,
  actions,
  children,
}: {
  d: Portfolio;
  arriving?: number;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [range, setRange] = useState<ValueRange>("ALL");
  const [hover, setHover] = useState<{
    t: number;
    v: number;
    pnl: number;
  } | null>(null);
  const q = useValueHistory(range);
  const pts = useMemo(() => q.data ?? [], [q.data]);
  const series = useMemo(() => toSeries(pts), [pts]);

  const total = d.totalValue;
  const start = series[0];
  // P&L, not value change: a deposit raises the value but isn't a gain.
  const pnlNow = hover ? hover.pnl : d.pnl;
  const change = range === "ALL" ? pnlNow : pnlNow - (start?.pnl ?? pnlNow);
  const base = range === "ALL" ? d.totalValue - d.pnl : (start?.value ?? 0);
  const tone = change < -0.005 ? "down" : change > 0.005 ? "up" : "flat";

  return (
    <section
      aria-label="Portfolio value and P&L"
      data-testid="portfolio-summary"
      className="flex flex-col gap-5 rounded-2xl bg-surface p-5 ring-1 ring-edge ring-inset md:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[0.8125rem] text-soft">
            {hover ? formatDateTime(hover.t) : "Portfolio value"}
          </span>
          <BigMoney value={hover ? hover.v : total} />
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem]">
            <span className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "fig font-semibold",
                  tone === "up"
                    ? "text-up"
                    : tone === "down"
                      ? "text-down"
                      : "text-soft"
                )}
              >
                {formatUsd(change, { signed: true })}
                {base > 0.005 && tone !== "flat"
                  ? ` (${formatPct(change / base, { signed: true })})`
                  : ""}
              </span>
              <span className="text-soft">{RANGE_WORDS[range]}</span>
            </span>
            {arriving >= 0.01 ? (
              <span className="num text-soft">{formatUsd(arriving)} arriving</span>
            ) : null}
            {d.dividendsEarned > 0.005 ? (
              <span className="text-soft">
                <span className="fig text-brand">
                  {formatUsd(d.dividendsEarned)}
                </span>{" "}
                earned from boards
              </span>
            ) : null}
          </span>
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <Segmented
            label="Range"
            value={range}
            onChange={(v) => setRange(v as ValueRange)}
            options={RANGES.map((r) => [r, r === "ALL" ? "All" : r])}
          />
        </div>
        <ValueLine data={series} tone={tone} onHover={setHover} />
      </div>
      {children}
    </section>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-full bg-ground p-0.5"
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-7 rounded-full px-3 text-[0.75rem] font-medium transition-colors duration-150",
            value === v ? "bg-raised text-ink" : "text-soft hover:text-ink"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function ValueLine({
  data,
  tone,
  onHover,
}: {
  data: { time: UTCTimestamp; value: number; pnl: number }[];
  tone: "up" | "down" | "flat";
  onHover: (h: { t: number; v: number; pnl: number } | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const line = useRef<ISeriesApi<"Area"> | null>(null);
  const hoverRef = useRef(onHover);
  const pnlAt = useRef(new Map<number, number>());
  useEffect(() => {
    hoverRef.current = onHover;
  });

  useEffect(() => {
    if (!el.current) return;
    const C = colors();
    const c = createChart(el.current, {
      height: 240,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: C.text,
        fontSize: 12,
        fontFamily: getComputedStyle(document.body).fontFamily,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: C.grid } },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 0,
        fixRightEdge: true,
        fixLeftEdge: true,
      },
      crosshair: {
        vertLine: { color: C.control, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      localization: {
        priceFormatter: (p: number) =>
          formatUsd(p, { decimals: Math.abs(p) < 100 ? 2 : 0 }),
      },
      handleScale: false,
      handleScroll: false,
    });
    line.current = c.addSeries(AreaSeries, {
      lineWidth: 2,
      lineType: LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 5,
    });
    c.subscribeCrosshairMove((p) => {
      const s = line.current;
      const d =
        s && p.time !== undefined
          ? (p.seriesData.get(s) as { value?: number } | undefined)
          : undefined;
      hoverRef.current(
        d && typeof d.value === "number"
          ? {
              t: (p.time as number) * 1000,
              v: d.value,
              pnl: pnlAt.current.get(p.time as number) ?? 0,
            }
          : null
      );
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      line.current = null;
    };
  }, []);

  useEffect(() => {
    const C = colors();
    const s = line.current;
    if (!s) return;
    const col = tone === "down" ? C.down : tone === "up" ? C.up : C.ink;
    s.applyOptions({
      lineColor: col,
      topColor:
        tone === "down" ? C.downFill : tone === "up" ? C.upFill : C.inkFill,
      bottomColor: C.clear,
    });
    pnlAt.current = new Map(data.map((p) => [p.time as number, p.pnl]));
    // Under three points there's no line yet: draw nothing (no flat stroke under the message, no
    // axis repeating one figure seven times), just the sentence.
    const empty = data.length < 3;
    s.setData(empty ? [] : data.map(({ time, value }) => ({ time, value })));
    chart.current?.applyOptions({ rightPriceScale: { visible: !empty }, timeScale: { visible: !empty } });
    // A short history needs seconds on the axis, or every label reads the same minute.
    const span =
      data.length > 1 ? data[data.length - 1]!.time - data[0]!.time : 0;
    chart.current?.timeScale().applyOptions({ secondsVisible: span < 15 * 60 });
    chart.current?.timeScale().fitContent();
  }, [data, tone]);

  return (
    <div className="relative">
      <div
        ref={el}
        style={{ height: 240 }}
        className="w-full"
        data-testid="value-chart"
        onMouseLeave={() => onHover(null)}
      />
      {data.length < 3 ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-soft">
          Your line fills in as the market moves and you trade.
        </p>
      ) : null}
    </div>
  );
}
