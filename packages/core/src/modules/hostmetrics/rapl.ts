import type { HostMetricPoint } from "@ancientvoid/contracts";
import { posix } from "node:path";
import { readNumber, readText } from "./files.ts";
import { point, type SourceContext } from "./types.ts";

/** Nur Pakete (`intel-rapl:N`); Unterdomänen sind darin schon enthalten. */
export async function collectRapl({ deps, rates, nowMs }: SourceContext): Promise<HostMetricPoint[]> {
  const base = "sys/class/powercap";
  const out: HostMetricPoint[] = [];
  for (const entry of await deps.files.list(base)) {
    const match = /^intel-rapl:(\d+)$/.exec(entry);
    if (!match) continue;
    const dir = posix.join(base, entry);
    // `psys` u. Ä. überlappt das Paket und wird deshalb nicht summiert.
    const name = (await readText(deps.files, posix.join(dir, "name"))) ?? entry;
    const { text, denied } = await deps.files.read(posix.join(dir, "energy_uj"));
    const counter = text ? Number(text) : NaN;
    const wrap = (await readNumber(deps.files, posix.join(dir, "max_energy_range_uj"))) ?? undefined;
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
