"use client";

import type { Series } from "@hashinet/types";
import { useEffect, useRef, useState } from "react";

/**
 * Gridlines from a step of 1, 2 or 5 times a power of ten, so a chart keeps about six at any size
 * (prototype `niceMax`).
 */
export function niceMax(peak: number): { max: number; ticks: number[] } {
  const power = 10 ** Math.floor(Math.log10(Math.max(peak, 1) / 6));
  const step =
    peak <= 5
      ? 2
      : peak <= 15
        ? 5
        : peak <= 40
          ? 10
          : peak <= 120
            ? 20
            : ([1, 2, 5, 10].map((m) => m * power).find((x) => peak / x <= 7) ?? 10 * power);
  const max = (Math.floor(peak / step) + 1) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { max, ticks };
}

/** "12k", "1.5M": an axis's money or count, short. */
export function shortNumber(v: number): string {
  if (v === 0) return "0";
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${+(v / 1000).toFixed(1)}k`;
  return String(v);
}

/**
 * The chart's own width in pixels, so it draws at the size it is shown: its text stays the size the
 * stylesheet sets on a phone and on a wide screen alike. Null until it is measured.
 */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The one line chart (prototype `lineChart`): Analytics' Sales and Usage and a venue's page. The
 * axis runs the whole period; the line stops at the last value, marked with a dot, as a series
 * holds null after today.
 */
export function LineChart({
  values,
  axis,
  label,
  height = 260,
}: {
  values: Series;
  /** Each bucket's key and its label on the axis. */
  axis: { key: string; label: string }[];
  /** What it shows, for screen readers: "Takings per day, TSh 412,000". */
  label: string;
  height?: number;
}) {
  const [box, measured] = useWidth();
  const w = measured ?? 1100;
  const narrow = w < 560;
  const [top, left, bottom, right] = [12, 44, 28, 26];
  const ih = height - top - bottom;
  const iw = w - left - right;
  const shown = values.filter((v): v is number => v !== null);
  const { max, ticks } = niceMax(Math.max(...shown, 4));
  const x = (i: number) => left + (iw * i) / Math.max(axis.length - 1, 1);
  const y = (v: number) => top + ih - (ih * v) / max;
  const last = shown.length - 1;
  const step = Math.max(1, Math.floor(axis.length / (narrow ? 4 : 6)));
  return (
    <div ref={box}>
      <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={left - 8} y={y(t) + 4.5} className="axis" textAnchor="end">
              {shortNumber(t)}
            </text>
          </g>
        ))}
        {shown.length > 1 ? (
          <polyline
            className="line"
            points={shown.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
          />
        ) : null}
        {last >= 0 ? (
          <circle cx={x(last)} cy={y(shown[last] ?? 0)} r={4.5} className="dot" />
        ) : null}
        {axis.map((a, i) =>
          i % step === 0 ? (
            <text key={a.key} x={x(i)} y={height - 6} className="axis" textAnchor="middle">
              {a.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
