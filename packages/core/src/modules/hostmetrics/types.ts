import type { HostMetricPoint } from "@ancientvoid/contracts";
import type { Rates } from "./rates.ts";

export interface HostCollectorDeps {
  /** Dateisystem-Wurzel; Tests zeigen auf einen Fixture-Baum. */
  root: string;
  nowMs(): number;
  /** stdout von `nvidia-smi` mit diesen Argumenten; null = nicht installiert. */
  nvidiaSmi(args: readonly string[]): Promise<string | null>;
  statfs(path: string): Promise<{ totalBytes: number; freeBytes: number; availableBytes: number }>;
}

export interface SourceContext {
  deps: HostCollectorDeps;
  rates: Rates;
  nowMs: number;
}

export function point(p: Omit<HostMetricPoint, "reason" | "powerDomain"> & Partial<Pick<HostMetricPoint, "reason" | "powerDomain">>): HostMetricPoint {
  return { reason: p.value === null ? "nicht gemeldet" : null, powerDomain: null, ...p };
}
