import type { HostMetricPoint, HostMetricsSample } from "@ancientvoid/contracts";
import { createHostCollector, type HostCollector } from "./collector.ts";
import { snapshotFiles } from "./files.ts";
import { point } from "./types.ts";

const MARK = "@@ ";

/**
 * Auswertung des Abzugs aus `scripts/host-monitoring-probe.sh` (ADR-0117 §7). Das
 * Skript liegt auf dem Zielhost hinter `command=`; der Hub schickt nichts mit.
 */
export function parseProbe(output: string): Map<string, string> {
  const files = new Map<string, string>();
  let path: string | null = null;
  let lines: string[] = [];
  const store = () => {
    if (path !== null) files.set(path, lines.join("\n").trim());
  };
  for (const line of output.split("\n")) {
    if (line.startsWith(MARK)) {
      store();
      path = line.slice(MARK.length).trim();
      lines = [];
    } else lines.push(line);
  }
  store();
  if (!files.get("proc/stat")) throw new Error("Abzug ohne /proc/stat");
  return files;
}

export function createSshHostCollector(deps: { run(): Promise<string>; nowMs(): number }): HostCollector {
  let files = new Map<string, string>();
  let df = new Map<string, { totalBytes: number; freeBytes: number; availableBytes: number }>();
  const collector = createHostCollector({
    // Der Sammler behält seine Zählerstände; nur der Abzug darunter wechselt.
    files: {
      read: (p) => snapshotFiles(files).read(p),
      list: (d) => snapshotFiles(files).list(d),
      linkName: (p) => snapshotFiles(files).linkName(p),
    },
    nowMs: deps.nowMs,
    nvidiaSmi: async () => null,
    statfs: async (path) => {
      const entry = df.get(path);
      if (!entry) throw new Error("nicht im Abzug");
      return entry;
    },
  });
  return {
    async collect(): Promise<HostMetricsSample> {
      files = parseProbe(await deps.run());
      df = parseDf(files.get("df") ?? "");
      const sample = await collector.collect();
      return { ...sample, points: [...sample.points, ...thermalZones(files), ...synologyDisks(files)] };
    },
  };
}

function parseDf(text: string) {
  const out = new Map<string, { totalBytes: number; freeBytes: number; availableBytes: number }>();
  for (const line of text.split("\n").slice(1)) {
    const m = /^\S+\s+(\d+)\s+(\d+)\s+(\d+)\s+\S+\s+(.+)$/.exec(line.trim());
    if (m) out.set(m[4]!, { totalBytes: Number(m[1]) * 1024, freeBytes: (Number(m[1]) - Number(m[2])) * 1024, availableBytes: Number(m[3]) * 1024 });
  }
  return out;
}

const numeric = (text: string | undefined): number | null => {
  const n = text ? Number(text) : NaN;
  return Number.isFinite(n) ? n : null;
};

function thermalZones(files: ReadonlyMap<string, string>): HostMetricPoint[] {
  return [...files.keys()].flatMap((path) => {
    const zone = /^sys\/class\/thermal\/(thermal_zone\d+)\/temp$/.exec(path)?.[1];
    if (!zone) return [];
    const milli = numeric(files.get(path));
    const type = files.get(`sys/class/thermal/${zone}/type`) ?? zone;
    return [point({ key: `thermal:${zone}`, group: "temperature", device: type, label: zone, unit: "°C", value: milli === null ? null : milli / 1000, source: "sysfs" })];
  });
}

function synologyDisks(files: ReadonlyMap<string, string>): HostMetricPoint[] {
  return [...files.keys()].flatMap((path) => {
    const m = /^run\/synostorage\/disks\/([^/]+)\/(temperature|remain_life|smart)$/.exec(path);
    if (!m) return [];
    const [, disk, kind] = m as unknown as [string, string, string];
    const base = { device: disk, source: "synology" };
    const value = numeric(files.get(path));
    if (kind === "temperature") return [point({ ...base, key: `syno:${disk}:temperature`, group: "temperature", label: "Platte", unit: "°C", value })];
    if (kind === "remain_life") return [point({ ...base, key: `syno:${disk}:remain_life`, group: "disk", label: "Restlebensdauer", unit: "%", value: value !== null && value >= 0 ? value : null })];
    const text = files.get(path) ?? "";
    return [point({ ...base, key: `syno:${disk}:smart`, group: "disk", label: "SMART in Ordnung", unit: "bool", value: text === "" ? null : text === "normal" ? 1 : 0, ...(text === "normal" || text === "" ? {} : { reason: text.slice(0, 200) }) })];
  });
}
