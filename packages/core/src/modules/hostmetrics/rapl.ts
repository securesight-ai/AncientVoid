import type { HostMetricPoint } from "@ancientvoid/contracts";
import { join } from "node:path";
import { list, readGuarded, readNumber, readText } from "./files.ts";
import { point, type SourceContext } from "./types.ts";

/** Nur Pakete (`intel-rapl:N`); Unterdomänen sind darin schon enthalten. */
export async function collectRapl({ deps, rates, nowMs }: SourceContext): Promise<HostMetricPoint[]> {
  const base = join(deps.root, "sys/class/powercap");
  const out: HostMetricPoint[] = [];
  for (const entry of await list(base)) {
    const match = /^intel-rapl:(\d+)$/.exec(entry);
    if (!match) continue;
    const dir = join(base, entry);
    // `psys` u. Ä. überlappt das Paket und wird deshalb nicht summiert.
    const name = (await readText(join(dir, "name"))) ?? entry;
    const { text, denied } = await readGuarded(join(dir, "energy_uj"));
    const counter = text ? Number(text) : NaN;
    const wrap = (await readNumber(join(dir, "max_energy_range_uj"))) ?? undefined;
    const microwatts = Number.isFinite(counter) ? rates.perSecond(`rapl:${entry}`, counter, nowMs, wrap) : null;
    out.push(
      point({
        key: `rapl:${entry}`,
        group: "power",
        device: "cpu",
        label: name,
        unit: "W",
        value: microwatts === null ? null : microwatts / 1e6,
        ...(denied ? { reason: "keine Berechtigung (RAPL)" } : {}),
        source: "rapl",
        powerDomain: name.startsWith("package") ? `cpu-package:${match[1]}` : null,
      }),
    );
  }
  return out;
}
