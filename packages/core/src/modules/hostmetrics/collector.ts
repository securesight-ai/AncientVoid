import type { HostMetricPoint, HostMetricsSample } from "@ancientvoid/contracts";
import { collectHwmon } from "./hwmon.ts";
import { collectProc } from "./proc.ts";
import { collectNvidia, collectAmdGpu } from "./gpu.ts";
import { collectRapl } from "./rapl.ts";
import { collectFilesystems } from "./filesystems.ts";
import { createRates } from "./rates.ts";
import type { HostCollectorDeps, SourceContext } from "./types.ts";

export interface HostCollector {
  collect(): Promise<HostMetricsSample>;
}

const SOURCES: readonly { name: string; run: (ctx: SourceContext) => Promise<HostMetricPoint[]> }[] = [
  { name: "proc", run: collectProc },
  { name: "hwmon", run: collectHwmon },
  { name: "amdgpu", run: collectAmdGpu },
  { name: "nvidia-smi", run: collectNvidia },
  { name: "rapl", run: collectRapl },
  { name: "filesystems", run: collectFilesystems },
];

/** Fällt eine Quelle aus, liefern die anderen weiter; der Ausfall steht in `errors` (K9). */
export function createHostCollector(deps: HostCollectorDeps): HostCollector {
  const rates = createRates();
  return {
    async collect() {
      const nowMs = deps.nowMs();
      const ctx: SourceContext = { deps, rates, nowMs };
      const errors: HostMetricsSample["errors"] = [];
      const parts = await Promise.all(
        SOURCES.map(async ({ name, run }) => {
          try {
            return await run(ctx);
          } catch (err) {
            errors.push({ source: name, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
            return [];
          }
        }),
      );
      return { ts: new Date(nowMs).toISOString(), points: parts.flat(), errors };
    },
  };
}
