import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostMetricsSample } from "@ancientvoid/contracts";
import { createHostCollector, sumComponentPower, type HostCollectorDeps } from "../../src/modules/hostmetrics/index.ts";

/** EPIC-P81 T81.4 (ADR-0117): Sammler gegen einen Fixture-Baum, ohne echte Gerätedaten. */

let root: string;
let now = 0;
let deps: HostCollectorDeps;

async function put(files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}
async function link(path: string, target: string) {
  await mkdir(join(root, target), { recursive: true });
  await mkdir(dirname(join(root, path)), { recursive: true });
  await symlink(join(root, target), join(root, path));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hostmetrics-"));
  now = 1_000_000;
  deps = {
    root,
    nowMs: () => now,
    nvidiaSmi: async () => null,
    statfs: async () => ({ totalBytes: 1000, freeBytes: 200, availableBytes: 100 }),
  };
  await put({
    "proc/stat": "cpu  100 0 0 800 100 0 0 0 0 0\ncpu0 100 0 0 800 100 0 0 0 0 0\nintr 1\n",
    "proc/loadavg": "1.50 1.20 1.00 3/456 999\n",
    "proc/uptime": "5000.5 1000\n",
    "proc/meminfo": "MemTotal: 1000 kB\nMemFree: 10 kB\nMemAvailable: 400 kB\nSwapTotal: 100 kB\nSwapFree: 60 kB\n",
    "proc/pressure/cpu": "some avg10=1.25 avg60=0 avg300=0 total=1\n",
    "proc/mounts": "/dev/sda1 / ext4 rw 0 0\n/dev/sda1 /home ext4 rw 0 0\ncloud: /mnt/cloud fuse.rclone rw 0 0\n",
    "proc/diskstats": " 8 0 sda 1 0 100 0 1 0 200 0\n 8 1 sda1 1 0 100 0 1 0 200 0\n 7 0 loop0 1 0 9 0 1 0 9 0\n",
    "proc/net/dev": "Inter-|\n face |\n  lo: 9 0 0 0 0 0 0 0 9 0\n eth0: 1000 0 0 0 0 0 0 0 500 0\n veth1: 10 0 0 0 0 0 0 0 10 0\n",
    "sys/block/sda/size": "1",
    "sys/block/loop0/size": "1",
  });
  await link("sys/class/net/eth0/device", "sys/devices/pci/0000:01:00.0");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function twice(change: Record<string, string> = {}) {
  const collector = createHostCollector(deps);
  await collector.collect();
  now += 10_000;
  await put(change);
  const sample = await collector.collect();
  HostMetricsSample.parse(sample);
  return { sample, get: (key: string) => sample.points.find((p) => p.key === key) };
}

describe("Host-Sammler", () => {
  it("rechnet Zähler in Raten und lässt den ersten Takt offen", async () => {
    const first = await createHostCollector(deps).collect();
    expect(first.points.find((p) => p.key === "cpu:cpu:busy")).toMatchObject({ value: null, reason: "nicht gemeldet" });
    const { get } = await twice({
      "proc/stat": "cpu  150 0 0 850 100 0 0 0 0 0\ncpu0 150 0 0 850 100 0 0 0 0 0\n",
      "proc/net/dev": " eth0: 3000 0 0 0 0 0 0 0 500 0\n veth1: 110 0 0 0 0 0 0 0 10 0\n",
      "proc/diskstats": " 8 0 sda 1 0 300 0 1 0 200 0\n",
    });
    expect(get("cpu:cpu:busy")!.value).toBe(50);
    expect(get("net:eth0:rx")!.value).toBe(200);
    expect(get("net:eth0:tx")!.value).toBe(0); // gemessene Null bleibt eine Null
    expect(get("net:virtual:rx")!.value).toBe(10);
    expect(get("net:veth1:rx")).toBeUndefined();
    expect(get("disk:sda:read")!.value).toBe(200 * 512 / 10);
    expect(get("disk:loop0:read")).toBeUndefined();
  });

  it("Speicher, Last, Druck; fehlende PSI-Datei ist „nicht gemeldet“", async () => {
    const { get } = await twice();
    expect(get("memory:used")!.value).toBe(600 * 1024);
    expect(get("memory:swap_used")!.value).toBe(40 * 1024);
    expect(get("processes")!.value).toBe(456);
    expect(get("psi:cpu")!.value).toBe(1.25);
    expect(get("psi:io")).toMatchObject({ value: null, reason: "nicht gemeldet" });
  });

  it("Dateisysteme: je Gerät einmal, Netz/FUSE nie angefasst, Prozent wie df", async () => {
    const asked: string[] = [];
    const statfs = deps.statfs;
    deps.statfs = (p) => (asked.push(p), statfs(p));
    const { get } = await twice();
    expect(new Set(asked)).toEqual(new Set(["/"]));
    expect(get("fs:/:used_percent")!.value).toBeCloseTo((800 / 900) * 100);
  });

  it("hwmon: alle Sensoren, Schlüssel ohne hwmonN, leere Datei ist keine Null", async () => {
    await put({
      "sys/class/hwmon/hwmon7/name": "k10temp\n",
      "sys/class/hwmon/hwmon7/temp1_input": "59800\n",
      "sys/class/hwmon/hwmon7/temp1_label": "Tctl\n",
      "sys/class/hwmon/hwmon7/fan1_input": "\n",
    });
    await link("sys/class/hwmon/hwmon7/device", "sys/devices/pci/0000:00:18.3");
    const { get } = await twice();
    expect(get("hwmon:k10temp:0000:00:18.3:temp1")).toMatchObject({ label: "Tctl", unit: "°C", group: "temperature" });
    expect(get("hwmon:k10temp:0000:00:18.3:temp1")!.value).toBeCloseTo(59.8);
    expect(get("hwmon:k10temp:0000:00:18.3:fan1")!.value).toBeNull();
  });

  it("RAPL: Überlauf, und fehlendes Recht trägt seinen Grund", async () => {
    const dir = "sys/class/powercap/intel-rapl:0";
    await put({ [`${dir}/name`]: "package-0", [`${dir}/max_energy_range_uj`]: "1000000000", [`${dir}/energy_uj`]: "900000000" });
    const { get } = await twice({ [`${dir}/energy_uj`]: "100000000" });
    expect(get("rapl:intel-rapl:0")!.value).toBe(20);
    if (process.getuid?.() === 0) return; // root liest trotz 0000
    await chmod(join(root, dir, "energy_uj"), 0o000);
    const denied = await createHostCollector(deps).collect();
    expect(denied.points.find((p) => p.key === "rapl:intel-rapl:0")).toMatchObject({ value: null, reason: "keine Berechtigung (RAPL)" });
  });

  it("NVIDIA: Werte, [N/A] ist keine Null, Ausfall steht in errors und lässt den Rest stehen", async () => {
    await put({ "sys/bus/pci/devices/0000:01:00.0/vendor": "0x10de\n", "sys/bus/pci/devices/0000:01:00.0/class": "0x030000\n" });
    deps.nvidiaSmi = async () => "00000000:01:00.0, Testkarte, 0, 1, 100, 200, 46, [N/A], 300, 54.10\n";
    const ok = await twice();
    expect(ok.get("nvidia:00000000:01:00.0:power.draw")!.value).toBe(54.1);
    expect(ok.get("nvidia:00000000:01:00.0:utilization.gpu")!.value).toBe(0);
    expect(ok.get("nvidia:00000000:01:00.0:fan.speed")!.value).toBeNull();
    deps.nvidiaSmi = async () => {
      throw new Error("Treiber antwortet nicht");
    };
    const { sample, get } = await twice();
    expect(sample.errors).toEqual([{ source: "nvidia-smi", error: "Treiber antwortet nicht" }]);
    expect(get("memory:total")!.value).toBe(1_024_000);
  });
});

it("ohne NVIDIA-Karte wird nvidia-smi nicht aufgerufen", async () => {
  deps.nvidiaSmi = async () => {
    throw new Error("darf nicht laufen");
  };
  expect((await twice()).sample.errors).toEqual([]);
});

describe("Leistungssumme (AC-P81-5)", () => {
  const amd = (extra: Record<string, string>) => put({ "sys/class/hwmon/hwmon1/name": "amdgpu", "sys/class/hwmon/hwmon1/power1_input": "64000000", ...extra });
  const rapl = { "sys/class/powercap/intel-rapl:0/name": "package-0", "sys/class/powercap/intel-rapl:0/energy_uj": "0" };
  const raplLater = { "sys/class/powercap/intel-rapl:0/energy_uj": "600000000" }; // 60 W

  it("APU-PPT und RAPL desselben Pakets zählen einmal", async () => {
    await amd({ "sys/class/hwmon/hwmon1/in1_label": "vddnb", ...rapl });
    const { sample } = await twice(raplLater);
    expect(sumComponentPower(sample.points).watts).toBe(60);
  });

  it("APU ohne RAPL: PPT zählt", async () => {
    await amd({ "sys/class/hwmon/hwmon1/in1_label": "vddnb" });
    expect(sumComponentPower((await twice()).sample.points).watts).toBe(64);
  });

  it("Karte und CPU sind verschiedene Bauteile und werden addiert", async () => {
    await amd({ "sys/class/hwmon/hwmon1/power1_cap": "175000000", ...rapl });
    expect(sumComponentPower((await twice(raplLater)).sample.points).watts).toBe(124);
  });

  it("nicht zuordenbar zählt nicht; ohne Wert gibt es keine Summe", async () => {
    await amd({});
    expect(sumComponentPower((await twice()).sample.points).watts).toBeNull();
  });
});
