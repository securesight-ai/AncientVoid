import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMPONENT_POWER_KEY, type HostMetricsSample } from "@ancientvoid/contracts";
import { createHostMetricsService, HostMetricsHistoryStore } from "../../src/modules/hostmetrics/index.ts";

/** EPIC-P81 T81.6 (ADR-0117 §5): Verlauf, Energie, Wiederherstellung. */

const T0 = new Date(2026, 10, 23, 12, 0, 0).getTime();
let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hm-history-"));
  path = join(dir, "hostmetrics.db");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function sample(ms: number, watts: number | null, extra: HostMetricsSample["points"] = []): HostMetricsSample {
  const base = { group: "power", device: "gpu", label: "PPT", unit: "W", reason: null, source: "hwmon" };
  return { ts: new Date(ms).toISOString(), errors: [], points: [{ ...base, key: "p", value: watts, powerDomain: "gpu:1" }, ...extra] };
}

describe("Verlauf", () => {
  it("bildet Minutenmittel mit Min/Max und überlebt den Neustart", () => {
    const store = new HostMetricsHistoryStore(path);
    store.record("a", sample(T0, 100), 15_000);
    store.record("a", sample(T0 + 5_000, 200), 15_000);
    store.record("a", sample(T0 + 60_000, 50), 15_000); // schließt die erste Minute ab
    // Absturz: kein close(). Die abgeschlossene Minute muss trotzdem da sein.
    const again = new HostMetricsHistoryStore(path);
    expect(again.history("a", COMPONENT_POWER_KEY, "1h", T0 + 60_000).points).toEqual([[T0, 150, 100, 200]]);
    expect(again.history("b", COMPONENT_POWER_KEY, "1h", T0 + 60_000).points).toEqual([]);
    again.close();
    store.close();
  });

  it("Energie nur über gemessene Zeit: Lücke und fehlender Wert zählen nicht", () => {
    const store = new HostMetricsHistoryStore(path);
    store.record("a", sample(T0, 3600), 15_000);
    store.record("a", sample(T0 + 10_000, 3600), 15_000); // 10 s × 3600 W = 10 Wh
    store.record("a", sample(T0 + 3_600_000, 3600), 15_000); // Lücke
    store.record("a", sample(T0 + 3_605_000, null), 15_000); // nicht gemeldet
    store.record("a", sample(T0 + 3_610_000, 3600), 15_000); // Neubeginn
    const [day] = store.days("a");
    expect(day!.wh).toBeCloseTo(10);
    expect(day!.coveredSec).toBe(10);
    store.close();
    const again = new HostMetricsHistoryStore(path);
    expect(again.days("a")[0]!.wh).toBeCloseTo(10); // nichts doppelt gebucht
    again.close();
  });

  it("verdichtet auf Viertelstunden und räumt Minuten nach 7 Tagen weg", () => {
    const store = new HostMetricsHistoryStore(path);
    for (let m = 0; m <= 30; m++) store.record("a", sample(T0 + m * 60_000, m < 15 ? 10 : 30), 15_000);
    expect(store.history("a", COMPONENT_POWER_KEY, "7d", T0 + 31 * 60_000).points.map((p) => p[1])).toEqual([10, 30]);
    const later = T0 + 8 * 86_400_000;
    store.record("a", sample(later, 1), 15_000);
    store.record("a", sample(later + 60_000, 1), 15_000);
    store.record("a", sample(later + 120_000, 1), 15_000);
    expect(store.history("a", COMPONENT_POWER_KEY, "24h", T0 + 31 * 60_000).points).toEqual([]);
    expect(store.history("a", COMPONENT_POWER_KEY, "90d", later + 120_000).points[0]![1]).toBeCloseTo((15 * 10 + 16 * 30) / 31);
    store.close();
  });

  it("legt eine defekte Datei beiseite statt den Start zu verhindern", async () => {
    await writeFile(path, "das ist keine Datenbank".repeat(500));
    const store = new HostMetricsHistoryStore(path, 42);
    expect(store.recoveredFrom).toBe(`${path}.defekt-42`);
    expect(await readdir(dir)).toContain("hostmetrics.db.defekt-42");
    store.record("a", sample(T0, 1), 15_000);
    store.close();
  });

  it("90 Tage bleiben unter 200 MB und 720 Punkten (AC-P81-7/8)", async () => {
    // Hochrechnung aus einem Tag: 70 Reihen je Host, zwei Hosts je Hub.
    const store = new HostMetricsHistoryStore(path);
    const extra = Array.from({ length: 69 }, (_, i) => ({ key: `hwmon:chip:0000:00:00.0:temp${i}`, group: "temperature", device: "c", label: "t", unit: "°C", value: 40.123 + i, reason: null, source: "hwmon", powerDomain: null }));
    for (let m = 0; m < 1440; m++) store.record("a", sample(T0 + m * 60_000, 10.5 + m, extra), 15_000);
    const points = store.history("a", COMPONENT_POWER_KEY, "24h", T0 + 1440 * 60_000).points;
    expect(points.length).toBeGreaterThan(700);
    expect(points.length).toBeLessThanOrEqual(720);
    expect(points[0]![0]).toBeLessThanOrEqual(T0 + 120_000); // nicht abgeschnitten
    store.close();
    const perRow = (await stat(path)).size / (1440 * 70 + 96 * 70);
    const rows = 70 * (7 * 1440 + 90 * 96);
    const megabytes = (rows * perRow * 2) / 1_048_576;
    expect(perRow).toBeGreaterThan(10); // Plausibilität der Messung
    expect(megabytes, `${perRow.toFixed(1)} Byte je Zeile`).toBeLessThan(200);
  });
});

describe("Dienst", () => {
  it("Ausfall und Hänger werden sichtbar, der letzte Wert bleibt mit Zeit stehen (AC-P81-3)", async () => {
    let now = T0;
    let mode: "ok" | "fail" | "hang" = "ok";
    const warnings: string[] = [];
    const service = createHostMetricsService({
      history: new HostMetricsHistoryStore(path),
      nowMs: () => now,
      logger: { warn: (m) => warnings.push(m) },
      sources: [
        {
          id: "nas",
          label: "NAS",
          kind: "ssh",
          intervalSec: 5,
          collector: {
            collect: async () => {
              if (mode === "hang") await new Promise(() => undefined);
              if (mode === "fail") throw new Error("keine Verbindung");
              return sample(now, 7);
            },
          },
        },
      ],
    });
    expect(service.hosts()[0]!.status).toEqual({ ok: false, error: "noch kein Messwert" });
    await service.tick("nas");
    expect(service.hosts()[0]).toMatchObject({ status: { ok: true }, summary: { watts: 7 } });
    mode = "fail";
    await service.tick("nas");
    await service.tick("nas");
    expect(service.hosts()[0]).toMatchObject({ status: { ok: false, error: "keine Verbindung" }, ts: new Date(T0).toISOString(), summary: { watts: 7 } });
    expect(warnings).toHaveLength(1); // kein Log-Rauschen je Takt
    mode = "ok";
    await service.tick("nas");
    mode = "hang";
    void service.tick("nas");
    now += 59_000;
    expect(service.hosts()[0]!.status).toEqual({ ok: false, error: "keine Antwort seit 59 s" });
    service.stop();
  });
});
