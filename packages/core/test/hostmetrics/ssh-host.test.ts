import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSshHostCollector } from "../../src/modules/hostmetrics/index.ts";

/** EPIC-P81 T81.8: NAS-Abzug — gleiche Auswertung wie lokal, Form anonymisiert. */
const dump = (busy: number) =>
  [
    "@@ proc/stat", `cpu ${busy} 0 0 ${1000 - busy} 0 0 0 0`, "",
    "@@ proc/meminfo", "MemTotal: 1000 kB", "MemAvailable: 400 kB",
    "@@ proc/mounts", "/dev/vg1/volume_1 /volume1 btrfs rw 0 0", "/dev/loop0 /x ext4 rw 0 0",
    "@@ proc/net/dev", " eth0: 100 0 0 0 0 0 0 0 5 0",
    "@@ sys/class/net/eth0/device", "/sys/devices/platform/x.ethernet",
    "@@ sys/class/thermal/thermal_zone0/type", "cpu-thermal",
    "@@ sys/class/thermal/thermal_zone0/temp", "34752",
    "@@ run/synostorage/disks/sata1/temperature", "27",
    "@@ run/synostorage/disks/sata1/smart", "warning",
    "@@ run/synostorage/disks/sata1/remain_life", "-1",
    "@@ df", "Filesystem 1024-blocks Used Available Capacity Mounted on", "/dev/vg1/volume_1 1000 500 500 50% /volume1",
  ].join("\n");

describe("SSH-Host", () => {
  it("rechnet Raten über zwei Abzüge und liest Synology-Werte", async () => {
    let now = 0;
    let text = dump(100);
    const c = createSshHostCollector({ run: async () => text, nowMs: () => now });
    await c.collect();
    now = 60_000;
    text = dump(100).replace("cpu 100 0 0 900", "cpu 150 0 0 950");
    const { points, errors } = await c.collect();
    const get = (key: string) => points.find((p) => p.key === key);
    expect(errors).toEqual([]);
    expect(get("cpu:cpu:busy")!.value).toBe(50);
    expect(get("net:eth0:rx")!.value).toBe(0);
    expect(get("fs:/volume1:used_percent")!.value).toBe(50);
    expect(get("thermal:thermal_zone0")!.value).toBeCloseTo(34.752);
    expect(get("syno:sata1:temperature")!.value).toBe(27);
    expect(get("syno:sata1:smart")).toMatchObject({ value: 0, reason: "warning" });
    expect(get("syno:sata1:remain_life")!.value).toBeNull();
  });

  it("eine Antwort ohne Messdaten ist ein Fehler, kein leerer Host", async () => {
    const c = createSshHostCollector({ run: async () => "Willkommen\n", nowMs: () => 0 });
    await expect(c.collect()).rejects.toThrow("Abzug ohne /proc/stat");
  });

  it("das Kommando schreibt nichts und liest keine Seriennummern (AC-P81-9)", () => {
    const script = readFileSync(new URL("../../../../scripts/host-monitoring-probe.sh", import.meta.url), "utf8").replace(/^#.*$/gm, "");
    expect(script).not.toMatch(/>|\bsudo\b|\brm\b|serial|\/address|\$1|SSH_ORIGINAL_COMMAND/);
  });
});
