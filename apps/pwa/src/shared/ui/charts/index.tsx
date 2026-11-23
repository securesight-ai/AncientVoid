import { useId, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { nearestIndex, niceMax, segments, type SeriesPoint } from "./geometry.ts";

/**
 * EPIC-P81 T81.9: Diagramm-Bausteine in eigenem SVG. Farbe folgt dem Inhalt über
 * `data-tone`, Text trägt Texttöne, und jede Kurve hat daneben eine Tabelle.
 */
export type ChartTone = "cpu" | "gpu" | "other";

const W = 600;

function paths(points: readonly SeriesPoint[], stepMs: number, height: number, max: number) {
  const from = points[0]![0];
  const span = Math.max(1, points.at(-1)![0] - from);
  const x = (ts: number) => ((ts - from) / span) * W;
  const y = (v: number) => height - (v / max) * height;
  return segments(points, stepMs).map((seg) => {
    const line = seg.map(([ts, v], i) => `${i === 0 ? "M" : "L"}${x(ts).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const dot = seg.length === 1;
    return { line: dot ? `${line}h0.01` : line, area: `${line}L${x(seg.at(-1)![0]).toFixed(1)},${height}L${x(seg[0]![0]).toFixed(1)},${height}Z` };
  });
}

export function Sparkline({ points, stepMs = 60_000 }: { points: readonly SeriesPoint[]; stepMs?: number }) {
  if (points.length < 2) return null;
  return (
    <svg class="chart-spark" viewBox={`0 0 ${W} 40`} preserveAspectRatio="none" aria-hidden="true">
      {paths(points, stepMs, 38, Math.max(...points.map((p) => p[1])) * 1.1 || 1).map((p) => (
        <path key={p.line} class="chart-line" d={p.line} />
      ))}
    </svg>
  );
}

export function AreaChart({ points, stepMs, label, format, formatTime, table }: {
  points: readonly SeriesPoint[];
  stepMs: number;
  label: string;
  format: (v: number) => string;
  formatTime: (ts: number) => string;
  /** Tabellenansicht derselben Reihe (Tastatur, Screenreader). */
  table: ComponentChildren;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = niceMax(Math.max(...points.map((p) => p[1])));
  const from = points[0]![0];
  const span = Math.max(1, points.at(-1)![0] - from);
  const active = hover === null ? null : points[Math.min(hover, points.length - 1)]!;
  const left = active ? ((active[0] - from) / span) * 100 : 0;
  const pick = (e: PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHover(nearestIndex(points, from + ((e.clientX - box.left) / box.width) * span));
  };
  return (
    <figure class="chart-area" aria-label={label}>
      <div class="chart-plot" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        <span class="chart-max">{format(max)}</span>
        <svg viewBox={`0 0 ${W} 160`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" class="chart-fade-top" />
              <stop offset="1" class="chart-fade-bottom" />
            </linearGradient>
          </defs>
          {[0, 80, 159.5].map((y) => (
            <line key={y} class="chart-grid" x1="0" x2={W} y1={y} y2={y} />
          ))}
          {paths(points, stepMs, 160, max).map((p) => (
            <g key={p.line}>
              <path d={p.area} fill={`url(#${id})`} />
              <path class="chart-line" d={p.line} />
            </g>
          ))}
        </svg>
        {active && (
          <>
            <span class="chart-cross" style={`--at: ${left}%`} />
            <span class="chart-dot" style={`--at: ${left}%; --up: ${(active[1] / max) * 100}%`} />
            <span class="chart-tip" data-side={left > 50 ? "left" : "right"} style={`--at: ${left}%`}>
              <strong>{format(active[1])}</strong> {formatTime(active[0])}
            </span>
          </>
        )}
      </div>
      <div class="chart-axis" aria-hidden="true">
        <span>{formatTime(from)}</span>
        <span>{formatTime(points.at(-1)![0])}</span>
      </div>
      {table}
    </figure>
  );
}

/** Waagerechte Balken; Beschriftung und Wert stehen immer daneben. */
export function ShareBars({ rows, label }: { rows: readonly { key: string; label: string; value: number; text: string; note?: string; tone: ChartTone }[]; label: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul class="chart-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} title={r.note}>
          <span class="chart-bar-label">{r.label}</span>
          <span class="chart-bar-value">{r.text}</span>
          <span class="chart-bar" data-tone={r.tone}><i style={`--fill: ${(r.value / max) * 100}%`} /></span>
          {r.note && <small>{r.note}</small>}
        </li>
      ))}
    </ul>
  );
}

/** Füllstand 0–100 %; der Zustand steht zusätzlich als Zahl daneben. */
export function Meter({ label, percent, text }: { label: string; percent: number | null; text: string }) {
  const level = percent === null ? "none" : percent >= 95 ? "err" : percent >= 85 ? "warn" : "ok";
  return (
    <div class="chart-meter">
      <span class="chart-bar-label">{label}</span>
      <span class="chart-bar-value">{text}</span>
      <span class="chart-bar" data-level={level}>{percent !== null && <i style={`--fill: ${Math.min(100, Math.max(0, percent))}%`} />}</span>
    </div>
  );
}

export function TrendChip({ delta, text, label }: { delta: number; text: string; label: string }) {
  return (
    <span class="chart-trend" title={label}>
      <span aria-hidden="true">{delta > 0 ? "↗" : delta < 0 ? "↘" : "→"}</span> {text} <span class="sr-only">{label}</span>
    </span>
  );
}

export function StatTile({ label, value, note, children }: { label: string; value: string; note?: string; children?: ComponentChildren }) {
  return (
    <div class="stat-tile">
      <span class="chart-bar-label">{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
      {children}
    </div>
  );
}
