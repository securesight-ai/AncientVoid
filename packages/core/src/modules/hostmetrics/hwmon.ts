import type { HostMetricPoint } from "@ancientvoid/contracts";
import { posix } from "node:path";
import { readNumber, readText } from "./files.ts";
import { point, type SourceContext } from "./types.ts";

const KINDS: Record<string, { group: string; unit: string; scale: number }> = {
  temp: { group: "temperature", unit: "°C", scale: 1e-3 },
  fan: { group: "fan", unit: "rpm", scale: 1 },
  in: { group: "voltage", unit: "V", scale: 1e-3 },
  freq: { group: "clock", unit: "MHz", scale: 1e-6 },
  power: { group: "power", unit: "W", scale: 1e-6 },
};

/**
 * Jeder Sensor jedes Chips. Schlüssel aus Treiber und Gerät, weil `hwmonN` nach
 * jedem Boot anders heißen kann.
 */
export async function collectHwmon({ deps }: SourceContext): Promise<HostMetricPoint[]> {
  const base = "sys/class/hwmon";
  const out: HostMetricPoint[] = [];
  for (const entry of await deps.files.list(base)) {
    const dir = posix.join(base, entry);
    const chip = (await readText(deps.files, posix.join(dir, "name"))) ?? entry;
    const address = (await deps.files.linkName(posix.join(dir, "device"))) ?? "virtual";
    const files = await deps.files.list(dir);
    const apu = chip === "amdgpu" && (await Promise.all(files.filter((f) => /^in\d+_label$/.test(f)).map((f) => readText(deps.files, posix.join(dir, f))))).includes("vddnb");
    const capped = files.includes("power1_cap");
    const seen = new Set<string>();
    for (const file of files) {
      const match = /^(temp|fan|in|freq|power)(\d+)_(average|input)$/.exec(file);
      if (!match) continue;
      const [, kind, index] = match as unknown as [string, string, string];
      const id = `${kind}${index}`;
      if (seen.has(id)) continue; // `average` steht vor `input` und geht vor
      seen.add(id);
      const def = KINDS[kind]!;
      const raw = await readNumber(deps.files, posix.join(dir, file));
      const label = await readText(deps.files, posix.join(dir, `${id}_label`));
      let powerDomain: string | null = null;
      if (kind === "power" && chip === "amdgpu" && apu !== capped) powerDomain = apu ? "cpu-package:0" : `gpu:${address}`;
      out.push(
        point({
          key: `hwmon:${chip}:${address}:${id}`,
          group: def.group,
          device: chip,
          label: label || id,
          unit: def.unit,
          value: raw === null ? null : raw * def.scale,
          source: "hwmon",
          powerDomain,
        }),
      );
    }
  }
  return out;
}
