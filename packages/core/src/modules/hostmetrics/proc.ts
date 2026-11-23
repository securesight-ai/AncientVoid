import type { HostMetricPoint } from "@ancientvoid/contracts";
import { join } from "node:path";
import { deviceName, list, readNumber, readText } from "./files.ts";
import { point, type SourceContext } from "./types.ts";

const SECTOR_BYTES = 512; // /proc/diskstats zählt unabhängig vom Gerät in 512-Byte-Sektoren

export async function collectProc(ctx: SourceContext): Promise<HostMetricPoint[]> {
  return (await Promise.all([cpu(ctx), load(ctx), memory(ctx), pressure(ctx), disks(ctx), network(ctx)])).flat();
}

async function cpu({ deps, rates }: SourceContext): Promise<HostMetricPoint[]> {
  const stat = await readText(join(deps.root, "proc/stat"));
  if (stat === null) throw new Error("/proc/stat nicht lesbar");
  const out: HostMetricPoint[] = [];
  for (const line of stat.split("\n")) {
    const match = /^(cpu\d*)\s+(.+)$/.exec(line);
    if (!match) continue;
    const name = match[1]!;
    // user nice system idle iowait irq softirq steal; guest steckt schon in user.
    const t = match[2]!.split(/\s+/).slice(0, 8).map(Number);
    const total = t.reduce((a, b) => a + b, 0);
    const idle = (t[3] ?? 0) + (t[4] ?? 0);
    const dTotal = rates.delta(`${name}:total`, total);
    // iowait kann rückwärts laufen; dann gibt es für diesen Takt keinen Wert.
    const dBusy = rates.delta(`${name}:busy`, total - idle);
    const value = dTotal && dBusy !== null ? Math.min(100, (dBusy / dTotal) * 100) : null;
    const core = name === "cpu" ? null : Number(name.slice(3));
    out.push(point({ key: `cpu:${name}:busy`, group: "cpu", device: name, label: core === null ? "Auslastung" : `Kern ${core}`, unit: "%", value, source: "proc" }));
    if (core !== null) {
      const khz = await readNumber(join(deps.root, `sys/devices/system/cpu/${name}/cpufreq/scaling_cur_freq`));
      if (khz !== null) out.push(point({ key: `cpu:${name}:freq`, group: "clock", device: name, label: `Kern ${core}`, unit: "MHz", value: khz / 1000, source: "sysfs" }));
    }
  }
  return out;
}

async function load({ deps }: SourceContext): Promise<HostMetricPoint[]> {
  const out: HostMetricPoint[] = [];
  const parts = (await readText(join(deps.root, "proc/loadavg")))?.split(/\s+/);
  const add = (key: string, label: string, unit: string, value: number | undefined) =>
    out.push(point({ key, group: "system", device: "host", label, unit, value: value !== undefined && Number.isFinite(value) ? value : null, source: "proc" }));
  ["1", "5", "15"].forEach((min, i) => add(`load:${min}`, `Last ${min} min`, "load", parts ? Number(parts[i]) : undefined));
  add("processes", "Threads gesamt", "count", parts ? Number(parts[3]?.split("/")[1]) : undefined);
  const uptime = (await readText(join(deps.root, "proc/uptime")))?.split(" ")[0];
  add("uptime", "Laufzeit", "s", uptime ? Number(uptime) : undefined);
  return out;
}

async function memory({ deps }: SourceContext): Promise<HostMetricPoint[]> {
  const info = await readText(join(deps.root, "proc/meminfo"));
  if (info === null) throw new Error("/proc/meminfo nicht lesbar");
  const bytes = new Map<string, number>();
  for (const line of info.split("\n")) {
    const match = /^(\w+):\s+(\d+) kB$/.exec(line);
    if (match) bytes.set(match[1]!, Number(match[2]) * 1024);
  }
  const get = (name: string): number | null => bytes.get(name) ?? null;
  const minus = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);
  const rows: [string, string, number | null][] = [
    ["total", "RAM gesamt", get("MemTotal")],
    ["available", "RAM verfügbar", get("MemAvailable")],
    ["used", "RAM belegt", minus(get("MemTotal"), get("MemAvailable"))],
    ["swap_total", "Swap gesamt", get("SwapTotal")],
    ["swap_used", "Swap belegt", minus(get("SwapTotal"), get("SwapFree"))],
  ];
  const out = rows.map(([id, label, value]) => point({ key: `memory:${id}`, group: "memory", device: "host", label, unit: "bytes", value, source: "proc" }));
  for (const dev of (await list(join(deps.root, "sys/block"))).filter((d) => /^zram\d+$/.test(d))) {
    const mm = (await readText(join(deps.root, "sys/block", dev, "mm_stat")))?.split(/\s+/).map(Number);
    if (mm && mm.length >= 3) out.push(point({ key: `memory:${dev}:used`, group: "memory", device: dev, label: `${dev} im RAM`, unit: "bytes", value: mm[2]!, source: "sysfs" }));
  }
  return out;
}

async function pressure({ deps }: SourceContext): Promise<HostMetricPoint[]> {
  const out: HostMetricPoint[] = [];
  for (const kind of ["cpu", "memory", "io"]) {
    const some = /^some avg10=([\d.]+)/.exec((await readText(join(deps.root, "proc/pressure", kind))) ?? "")?.[1];
    out.push(point({ key: `psi:${kind}`, group: "system", device: "host", label: `Druck ${kind} (10 s)`, unit: "%", value: some === undefined ? null : Number(some), source: "proc" }));
  }
  return out;
}

async function disks({ deps, rates, nowMs }: SourceContext): Promise<HostMetricPoint[]> {
  const out: HostMetricPoint[] = [];
  const whole = new Set(await list(join(deps.root, "sys/block")));
  for (const line of ((await readText(join(deps.root, "proc/diskstats"))) ?? "").split("\n")) {
    const f = line.trim().split(/\s+/);
    const name = f[2];
    if (!name || !whole.has(name) || /^(loop|ram|zram|dm-|md|mtdblock)/.test(name)) continue;
    const add = (id: string, label: string, sectors: number) => {
      const rate = Number.isFinite(sectors) ? rates.perSecond(`disk:${name}:${id}`, sectors * SECTOR_BYTES, nowMs) : null;
      out.push(point({ key: `disk:${name}:${id}`, group: "disk", device: name, label, unit: "bytes/s", value: rate, source: "proc" }));
    };
    add("read", "Lesen", Number(f[5]));
    add("write", "Schreiben", Number(f[9]));
  }
  return out;
}

/** Physische Schnittstellen und Tunnel einzeln; veth/Bridges nur als Summe. */
async function network({ deps, rates, nowMs }: SourceContext): Promise<HostMetricPoint[]> {
  const out: HostMetricPoint[] = [];
  const add = (dev: string, id: string, label: string, value: number | null) =>
    out.push(point({ key: `net:${dev}:${id}`, group: "network", device: dev, label, unit: "bytes/s", value, source: "proc" }));
  let virtual = 0;
  const sum = { rx: null as number | null, tx: null as number | null };
  for (const line of ((await readText(join(deps.root, "proc/net/dev"))) ?? "").split("\n")) {
    const match = /^\s*([^:\s]+):\s*(.+)$/.exec(line);
    if (!match || match[1] === "lo") continue;
    const name = match[1]!;
    const f = match[2]!.trim().split(/\s+/).map(Number);
    const rx = rates.perSecond(`net:${name}:rx`, f[0] ?? NaN, nowMs);
    const tx = rates.perSecond(`net:${name}:tx`, f[8] ?? NaN, nowMs);
    if (/^(tailscale|wg|tun)/.test(name) || (await deviceName(join(deps.root, "sys/class/net", name, "device"))) !== null) {
      add(name, "rx", "Empfangen", rx);
      add(name, "tx", "Senden", tx);
    } else {
      virtual += 1;
      if (rx !== null) sum.rx = (sum.rx ?? 0) + rx;
      if (tx !== null) sum.tx = (sum.tx ?? 0) + tx;
    }
  }
  if (virtual > 0) {
    add("virtual", "rx", `Empfangen (${virtual} virtuelle)`, sum.rx);
    add("virtual", "tx", `Senden (${virtual} virtuelle)`, sum.tx);
  }
  return out;
}
