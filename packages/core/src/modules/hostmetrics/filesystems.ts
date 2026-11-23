import type { HostMetricPoint } from "@ancientvoid/contracts";
import { readText } from "./files.ts";
import { point, type SourceContext } from "./types.ts";

/**
 * Nur Einhängepunkte auf lokalen Blockgeräten: `statfs` auf Netz- oder
 * FUSE-Laufwerken kann hängen. Je Gerät zählt der erste Einhängepunkt.
 */
export async function collectFilesystems({ deps }: SourceContext): Promise<HostMetricPoint[]> {
  const mounts = await readText(deps.files, "proc/mounts");
  if (mounts === null) throw new Error("/proc/mounts nicht lesbar");
  const seen = new Set<string>();
  const out: HostMetricPoint[] = [];
  for (const line of mounts.split("\n")) {
    const [device = "", rawPath = "", type = ""] = line.split(" ");
    if (!device.startsWith("/dev/") || device.startsWith("/dev/loop") || type.startsWith("fuse") || seen.has(device)) continue;
    seen.add(device);
    const path = rawPath.replace(/\\(\d{3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)));
    const stat = await deps.statfs(path).catch(() => null);
    const add = (id: string, label: string, unit: string, value: number | null) =>
      out.push(point({ key: `fs:${path}:${id}`.slice(0, 200), group: "disk", device: path.slice(0, 120), label, unit, value, source: "statfs" }));
    const used = stat && stat.totalBytes - stat.freeBytes;
    add("total", "Größe", "bytes", stat?.totalBytes ?? null);
    add("available", "Frei", "bytes", stat?.availableBytes ?? null);
    add("used", "Belegt", "bytes", used);
    // Wie `df`: reservierte Blöcke zählen nicht zum nutzbaren Platz.
    add("used_percent", "Belegung", "%", stat && used !== null && used + stat.availableBytes > 0 ? (used / (used + stat.availableBytes)) * 100 : null);
  }
  return out;
}
