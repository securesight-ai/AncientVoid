import type { HostMetricPoint } from "@ancientvoid/contracts";

export interface ComponentPower {
  /** null = kein zuordenbarer Messwert; nie 0 (ADR-0023). */
  watts: number | null;
  parts: HostMetricPoint[];
}

/**
 * Summe gemessener Komponenten, kein Steckdosenwert. Je Domäne zählt genau ein
 * Punkt: RAPL und APU-PPT messen dasselbe Paket (ADR-0117).
 */
export function sumComponentPower(points: readonly HostMetricPoint[]): ComponentPower {
  const chosen = new Map<string, HostMetricPoint>();
  for (const point of points) {
    if (point.powerDomain === null || point.value === null) continue;
    const current = chosen.get(point.powerDomain);
    if (!current || (point.source === "rapl" && current.source !== "rapl")) chosen.set(point.powerDomain, point);
  }
  const parts = [...chosen.values()];
  return { watts: parts.length === 0 ? null : parts.reduce((sum, p) => sum + (p.value ?? 0), 0), parts };
}
