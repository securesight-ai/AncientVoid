import type { HostMetricPoint, HostMetricsHost } from "@ancientvoid/contracts";
import { fmtNumber } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";

const GROUPS = ["power", "cpu", "memory", "gpu", "temperature", "fan", "disk", "network", "system", "clock", "voltage"] as const;
type Known = (typeof GROUPS)[number];

export function groupName(group: string): string {
  return (GROUPS as readonly string[]).includes(group) ? t(`hosts.group.${group as Known}`) : t("hosts.group.other");
}

const scaled = (value: number, unit: string): string => {
  const steps = ["", "K", "M", "G", "T"];
  let v = value;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < steps.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${fmtNumber(v, { maximumFractionDigits: v < 100 && i > 0 ? 1 : 0 })} ${steps[i]}${unit}`;
};

/** null bleibt „nicht gemeldet“, nie eine 0 (ADR-0023). */
export function formatHostValue(value: number | null, unit: string): string {
  if (value === null) return t("hosts.none");
  if (unit === "bytes") return scaled(value, "B");
  if (unit === "bytes/s") return scaled(value, "B/s");
  if (unit === "bool") return value ? "✓" : "✕";
  if (unit === "s") return `${fmtNumber(value / 3600, { maximumFractionDigits: 0 })} h`;
  if (unit === "count" || unit === "load") return fmtNumber(value, { maximumFractionDigits: 2 });
  const digits = unit === "V" ? 2 : unit === "W" || unit === "°C" || unit === "%" ? 1 : 0;
  return `${fmtNumber(value, { maximumFractionDigits: digits })} ${unit}`;
}

export function formatWh(wh: number): string {
  return wh >= 1000 ? `${fmtNumber(wh / 1000, { maximumFractionDigits: 2 })} kWh` : `${fmtNumber(wh, { maximumFractionDigits: 0 })} Wh`;
}

export const domainName = (domain: string): string => (domain.startsWith("cpu-package") ? t("hosts.cpu") : domain);

/** Summe über erreichbare Hosts; Ausgefallene werden genannt, nicht mitgezählt (AC-P81-3). */
export function totalPower(hosts: readonly HostMetricsHost[]): { watts: number | null; excluded: string[]; missing: string[] } {
  const live = hosts.filter((h) => h.status.ok);
  const values = live.flatMap((h) => (h.summary?.watts === null || h.summary?.watts === undefined ? [] : [h.summary.watts]));
  return {
    watts: values.length === 0 ? null : values.reduce((a, b) => a + b, 0),
    excluded: hosts.filter((h) => !h.status.ok).map((h) => h.label),
    missing: live.flatMap((h) => {
      const domains = h.summary?.wattMissing ?? [];
      const noPower = h.summary !== null && h.summary.watts === null && domains.length === 0;
      return noPower ? [h.label] : domains.map((d) => `${h.label} ${domainName(d)}`);
    }),
  };
}

/**
 * Reihen mehrerer Hosts je Schritt addieren. `series` summiert, wer gemessen hat;
 * `partial` macht sichtbar, dass nicht überall alle dabei waren. `complete` hält nur
 * volle Schritte, damit ein ausfallender Host keinen Trend vortäuscht.
 */
export function sumSeries(input: readonly (readonly (readonly [number, number])[])[]): { series: [number, number][]; complete: [number, number][]; partial: boolean } {
  const active = input.filter((s) => s.length > 0);
  const sums = new Map<number, { value: number; n: number }>();
  for (const [ts, v] of active.flat()) {
    const e = sums.get(ts) ?? { value: 0, n: 0 };
    sums.set(ts, { value: e.value + v, n: e.n + 1 });
  }
  const steps = [...sums].sort((a, b) => a[0] - b[0]);
  const full = steps.filter(([, e]) => e.n === active.length);
  const toPoint = ([ts, e]: (typeof steps)[number]): [number, number] => [ts, e.value];
  return { series: steps.map(toPoint), complete: full.map(toPoint), partial: full.length < steps.length };
}

export function groupPoints(points: readonly HostMetricPoint[], query: string): { group: string; points: HostMetricPoint[] }[] {
  const needle = query.trim().toLowerCase();
  const hits = needle ? points.filter((p) => `${p.device} ${p.label} ${groupName(p.group)} ${p.source}`.toLowerCase().includes(needle)) : points;
  const known: readonly string[] = GROUPS;
  return [...GROUPS, "other"]
    .map((group) => ({ group, points: hits.filter((p) => (known.includes(p.group) ? p.group : "other") === group) }))
    .filter((g) => g.points.length > 0);
}
