import type { HostMetricPoint, HostMetricsSummary } from "@ancientvoid/contracts";
import { sumComponentPower } from "./power.ts";

export function summarizeHost(points: readonly HostMetricPoint[]): HostMetricsSummary {
  const value = (key: string): number | null => points.find((p) => p.key === key)?.value ?? null;
  const highest = (match: (p: HostMetricPoint) => boolean): HostMetricPoint | null =>
    points.reduce<HostMetricPoint | null>((best, p) => (match(p) && p.value !== null && (best === null || p.value > best.value!) ? p : best), null);
  const reading = (p: HostMetricPoint | null, label: (p: HostMetricPoint) => string) => (p === null ? null : { label: label(p), value: p.value! });
  const power = sumComponentPower(points);
  const measured = new Set(power.parts.map((p) => p.powerDomain));
  const missing = new Set(points.flatMap((p) => (p.powerDomain !== null && !measured.has(p.powerDomain) ? [p.powerDomain] : [])));
  return {
    cpuPercent: value("cpu:cpu:busy"),
    memUsedBytes: value("memory:used"),
    memTotalBytes: value("memory:total"),
    gpuPercent: highest((p) => p.group === "gpu" && p.label === "Auslastung")?.value ?? null,
    hottest: reading(highest((p) => p.group === "temperature"), (p) => `${p.device} ${p.label}`),
    fullestDisk: reading(highest((p) => p.group === "disk" && p.key.endsWith(":used_percent")), (p) => p.device),
    watts: power.watts,
    wattParts: power.parts.slice(0, 50).map((p) => ({ domain: p.powerDomain!, label: p.powerDomain!.startsWith("cpu-package") ? "CPU" : p.device, value: p.value! })),
    wattMissing: [...missing].slice(0, 50),
  };
}
