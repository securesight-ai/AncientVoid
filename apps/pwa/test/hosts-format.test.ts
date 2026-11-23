import { describe, expect, it } from "vitest";
import type { HostMetricsHost } from "@ancientvoid/contracts";
import { formatHostValue, formatWh, groupPoints, sumSeries, totalPower } from "../src/features/statistics/hosts-format.ts";
import { t } from "../src/shared/i18n/index.ts";
import { nearestIndex, niceMax, segments, trend } from "../src/shared/ui/charts/geometry.ts";

const host = (id: string, watts: number | null, ok = true, wattMissing: string[] = []): HostMetricsHost => ({
  id, label: id, kind: "peer", status: ok ? { ok: true } : { ok: false, error: "weg" }, ts: null, intervalSec: 5, spark: [], today: null,
  summary: { cpuPercent: null, memUsedBytes: null, memTotalBytes: null, gpuPercent: null, hottest: null, fullestDisk: null, watts, wattParts: [], wattMissing },
});

describe("Hosts-Reiter: Zahlen (EPIC-P81 T81.10)", () => {
  it("ausgefallene Hosts zählen nicht mit und werden genannt, fehlende Watt sind keine 0", () => {
    expect(totalPower([host("a", 60, true, ["cpu-package-0"]), host("b", 40), host("c", 500, false), host("nas", null)])).toEqual({ watts: 100, excluded: ["c"], missing: ["a CPU", "nas"] });
    expect(totalPower([host("nas", null)]).watts).toBeNull();
  });

  it("null heißt nicht gemeldet, Null bleibt Null", () => {
    expect(formatHostValue(null, "W")).toBe(t("hosts.none"));
    expect(formatHostValue(0, "W")).toBe("0 W");
    expect(formatHostValue(1536 * 1024 ** 2, "bytes")).toMatch(/^1[.,]5 GB$/);
    expect(formatWh(950)).toBe("950 Wh");
    expect(formatWh(1250)).toMatch(/^1[.,]25 kWh$/);
  });

  it("Summe nennt unvollständige Schritte und hält sie aus dem Trend", () => {
    expect(sumSeries([[[1, 10], [2, 10]], [[2, 5]], []])).toEqual({ series: [[1, 10], [2, 15]], complete: [[2, 15]], partial: true });
  });

  it("unbekannte Gruppen landen unter Weitere, die Suche trifft Gerät und Label", () => {
    const p = { key: "x", group: "neu", device: "Kiste", label: "Wert", value: 1, unit: "W", source: "s" } as never;
    expect(groupPoints([p], "").map((g) => g.group)).toEqual(["other"]);
    expect(groupPoints([p], "kist")).toHaveLength(1);
    expect(groupPoints([p], "fehlt")).toEqual([]);
  });
});

describe("Diagramm-Geometrie (EPIC-P81 T81.9)", () => {
  it("bricht Kurven an Lücken und rundet die Achse", () => {
    expect(segments([[0, 1], [60, 1], [600, 1]], 60)).toHaveLength(2);
    expect([0, 63, 101, 240].map(niceMax)).toEqual([1, 100, 200, 250]);
    expect(nearestIndex([[0, 1], [100, 1]], 70)).toBe(1);
  });

  it("Trend nur mit passend altem Vergleichspunkt", () => {
    expect(trend([[0, 10], [300, 25]], 300)).toBe(15);
    expect(trend([[0, 10], [900, 25]], 300)).toBeNull();
    expect(trend([], 300)).toBeNull();
  });
});
