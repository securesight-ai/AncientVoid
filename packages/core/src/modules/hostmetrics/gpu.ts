import type { HostMetricPoint } from "@ancientvoid/contracts";
import { posix } from "node:path";
import { readNumber, readText } from "./files.ts";
import { point, type SourceContext } from "./types.ts";

const AMD_FIELDS: readonly [file: string, label: string, unit: string][] = [
  ["gpu_busy_percent", "Auslastung", "%"],
  ["mem_busy_percent", "Speicher-Auslastung", "%"],
  ["mem_info_vram_used", "VRAM belegt", "bytes"],
  ["mem_info_vram_total", "VRAM gesamt", "bytes"],
  ["mem_info_gtt_used", "GTT belegt", "bytes"],
  ["mem_info_gtt_total", "GTT gesamt", "bytes"],
];

export async function collectAmdGpu({ deps }: SourceContext): Promise<HostMetricPoint[]> {
  const base = "sys/class/drm";
  const out: HostMetricPoint[] = [];
  for (const card of (await deps.files.list(base)).filter((c) => /^card\d+$/.test(c))) {
    const dir = posix.join(base, card, "device");
    if ((await readNumber(deps.files, posix.join(dir, "mem_info_vram_total"))) === null) continue;
    const address = (await deps.files.linkName(dir)) ?? card;
    for (const [file, label, unit] of AMD_FIELDS) {
      out.push(point({ key: `amdgpu:${address}:${file}`, group: "gpu", device: `amdgpu ${address}`, label, unit, value: await readNumber(deps.files, posix.join(dir, file)), source: "sysfs" }));
    }
  }
  return out;
}

const NVIDIA_FIELDS: readonly [query: string, group: string, label: string, unit: string, scale: number][] = [
  ["utilization.gpu", "gpu", "Auslastung", "%", 1],
  ["utilization.memory", "gpu", "Speicher-Auslastung", "%", 1],
  ["memory.used", "gpu", "VRAM belegt", "bytes", 1_048_576],
  ["memory.total", "gpu", "VRAM gesamt", "bytes", 1_048_576],
  ["temperature.gpu", "temperature", "GPU", "°C", 1],
  ["fan.speed", "fan", "GPU-Lüfter", "%", 1],
  ["clocks.gr", "clock", "GPU-Takt", "MHz", 1],
  ["power.draw", "power", "GPU-Leistung", "W", 1],
];

/** Display-Klasse (0x03…) von NVIDIA: ohne Karte wäre ein installiertes nvidia-smi ein Dauerfehler. */
async function hasNvidiaCard(deps: SourceContext["deps"]): Promise<boolean> {
  const base = "sys/bus/pci/devices";
  for (const dev of await deps.files.list(base)) {
    if ((await readText(deps.files, posix.join(base, dev, "vendor"))) !== "0x10de") continue;
    if ((await readText(deps.files, posix.join(base, dev, "class")))?.startsWith("0x03")) return true;
  }
  return false;
}

export async function collectNvidia({ deps }: SourceContext): Promise<HostMetricPoint[]> {
  if (!(await hasNvidiaCard(deps))) return [];
  const csv = await deps.nvidiaSmi([`--query-gpu=pci.bus_id,name,${NVIDIA_FIELDS.map((f) => f[0]).join(",")}`, "--format=csv,noheader,nounits"]);
  if (csv === null) return [];
  const out: HostMetricPoint[] = [];
  for (const line of csv.split("\n").filter((l) => l.trim() !== "")) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length !== NVIDIA_FIELDS.length + 2) throw new Error(`unerwartete nvidia-smi-Zeile mit ${cells.length} Feldern`);
    const address = cells[0]!.toLowerCase();
    NVIDIA_FIELDS.forEach(([query, group, label, unit, scale], i) => {
      const text = cells[i + 2]!;
      const n = text === "" ? NaN : Number(text); // „[N/A]“ ist keine Null
      out.push(
        point({
          key: `nvidia:${address}:${query}`,
          group,
          device: cells[1]!.slice(0, 120),
          label,
          unit,
          value: Number.isFinite(n) ? n * scale : null,
          source: "nvidia-smi",
          powerDomain: query === "power.draw" ? `gpu:${address}` : null,
        }),
      );
    });
  }
  return out;
}
