import type { HostMetricPoint } from "@ancientvoid/contracts";
import { join } from "node:path";
import { deviceName, list, readNumber, readText } from "./files.ts";
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
  const base = join(deps.root, "sys/class/drm");
  const out: HostMetricPoint[] = [];
  for (const card of (await list(base)).filter((c) => /^card\d+$/.test(c))) {
    const dir = join(base, card, "device");
    if ((await readNumber(join(dir, "mem_info_vram_total"))) === null) continue;
    const address = (await deviceName(dir)) ?? card;
    for (const [file, label, unit] of AMD_FIELDS) {
      out.push(point({ key: `amdgpu:${address}:${file}`, group: "gpu", device: `amdgpu ${address}`, label, unit, value: await readNumber(join(dir, file)), source: "sysfs" }));
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
async function hasNvidiaCard(root: string): Promise<boolean> {
  const base = join(root, "sys/bus/pci/devices");
  for (const dev of await list(base)) {
    if ((await readText(join(base, dev, "vendor"))) !== "0x10de") continue;
    if ((await readText(join(base, dev, "class")))?.startsWith("0x03")) return true;
  }
  return false;
}

export async function collectNvidia({ deps }: SourceContext): Promise<HostMetricPoint[]> {
  if (!(await hasNvidiaCard(deps.root))) return [];
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
