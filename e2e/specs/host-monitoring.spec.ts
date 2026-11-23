import { test, expect, dockGo } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import { HostMetricsDetail, HostMetricsHistory, HostMetricsReport } from "@ancientvoid/contracts";

/**
 * EPIC-P81 T81.10: Hosts-Reiter. Ein Test fährt gegen die echte Messung des E2E-Hubs;
 * die übrigen legen feste, gegen den Vertrag geprüfte Antworten unter die Oberfläche
 * (Sensoren hängen vom Rechner ab).
 */
const now = Date.now();
const minute = Math.floor(now / 60_000) * 60_000;
const wave = (base: number, n: number, step: number) => Array.from({ length: n }, (_, i) => [minute - (n - 1 - i) * step, base + 12 * Math.sin(i / 9) + (i % 7)] as [number, number]);
const summary = (over: object) => ({ cpuPercent: 23.4, memUsedBytes: 21e9, memTotalBytes: 67e9, gpuPercent: 8, hottest: { label: "CPU Tctl", value: 61.2 }, fullestDisk: { label: "/", value: 88 }, watts: 64, wattParts: [], wattMissing: [], ...over });
const alpha = { id: "alpha", label: "Werkbank", kind: "hub", status: { ok: true }, ts: new Date(now).toISOString(), intervalSec: 5, spark: wave(64, 60, 60_000), today: { day: "2026-11-23", wh: 812, coveredSec: 40_000 }, summary: summary({ wattParts: [{ label: "RTX", value: 64, domain: "gpu-0" }], wattMissing: ["cpu-package-0"] }) };
const beta = { ...alpha, id: "beta", label: "Server", kind: "peer", spark: wave(107, 60, 60_000), summary: summary({ watts: 107, gpuPercent: null, fullestDisk: { label: "/", value: 96 }, wattParts: [{ label: "CPU-Package", value: 53, domain: "cpu-package-0" }, { label: "RTX", value: 54, domain: "gpu-0" }] }) };
const gone = { id: "gone", label: "Altgerät", kind: "peer", status: { ok: false, error: "nicht erreichbar" }, ts: new Date(now - 600_000).toISOString(), intervalSec: 5, spark: [], today: null, summary: summary({ watts: 900 }) };
const point = (key: string, group: string, device: string, label: string, value: number | null, unit: string, extra = {}) => ({ key, group, device, label, value, unit, source: "hwmon", reason: null, powerDomain: null, ...extra });

async function stub(page: Page, state: { down: boolean }) {
  const report = HostMetricsReport.parse({ generatedAt: new Date(now).toISOString(), hosts: [alpha, beta, gone] });
  const detail = HostMetricsDetail.parse({
    host: alpha,
    sample: {
      ts: new Date(now).toISOString(),
      points: [
        point("power:gpu", "power", "RTX", "Leistung", 64, "W"),
        point("power:cpu", "power", "CPU", "Package", null, "W", { reason: "RAPL nicht lesbar" }),
        point("temp:cpu", "temperature", "CPU", "Tctl", 61.2, "°C"),
        point("temp:nvme", "temperature", "NVMe", "Composite", 44, "°C"),
        point("fan:1", "fan", "Board", "Lüfter 1", 0, "RPM"),
      ],
      errors: [{ source: "smart", error: "kein Zugriff" }],
    },
  });
  await page.route("**/api/hostmetrics**", (route) => {
    if (state.down) return route.fulfill({ status: 503, json: { error: "weg" } });
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/host")) return route.fulfill({ json: detail });
    if (url.pathname.endsWith("/history")) {
      const id = url.searchParams.get("id");
      const points = id === "gone" ? [] : wave(id === "beta" ? 107 : 64, 700, 120_000).map(([ts, v]) => [ts, v, v - 3, v + 4]);
      return route.fulfill({ json: HostMetricsHistory.parse({ key: url.searchParams.get("key") ?? "power:components", range: url.searchParams.get("range") ?? "24h", stepSec: 120, points, days: [{ day: "2026-11-22", wh: 1430, coveredSec: 86_000 }, { day: "2026-11-23", wh: 812, coveredSec: 40_000 }] }) });
    }
    return route.fulfill({ json: report });
  });
}

async function openHosts(page: Page) {
  await page.setViewportSize({ width: 412, height: 850 });
  await page.reload();
  await dockGo(page, "Statistik");
  await page.getByRole("tab", { name: "Hosts" }).click();
  await expect(page).toHaveURL(/#\/statistik\/hosts$/);
}

const overflow = (page: Page) => page.evaluate(() => [document.documentElement, ...document.querySelectorAll(".hosts")].some((e) => e.scrollWidth > e.clientWidth + 1));

test.describe("Hosts-Reiter (EPIC-P81)", () => {
  test("echte Messung des Hubs: eigener Host mit CPU und RAM, Detailseite listet Messpunkte", async ({ app }) => {
    test.skip(process.platform !== "linux", "Messung liest /proc");
    await openHosts(app);
    const card = app.getByRole("listitem").filter({ has: app.getByRole("button", { name: /^Details zu/ }) }).first();
    await expect(card).toContainText("RAM", { timeout: 20_000 });
    await expect(card).toContainText(/GB \/ /);
    await card.getByRole("button", { name: /^Details zu/ }).click();
    await expect(app).toHaveURL(/#\/statistik\/hosts\/.+/);
    await app.getByLabel("Messpunkt suchen").fill("proc");
    await expect(app.getByText(/\d+ Werte/).first()).toBeVisible();
  });

  test("Summe ohne ausgefallenen Host, Lücken benannt, kein Querscrollen", async ({ app }) => {
    await stub(app, { down: false });
    await openHosts(app);
    const hero = app.getByRole("region", { name: "Gemessene Leistung" });
    await expect(hero).toContainText("171");
    await expect(hero).toContainText("nicht mitgezählt: Altgerät");
    await expect(hero).toContainText("Werkbank CPU");
    await expect(app.getByText("Ausfall: nicht erreichbar")).toBeVisible();
    await expect(app.getByRole("figure", { name: /Verlauf von/ })).toBeVisible();
    expect(await overflow(app)).toBe(false);
    await app.screenshot({ path: test.info().outputPath("hosts-412.png"), fullPage: true });
    await app.setViewportSize({ width: 1400, height: 1000 });
    await app.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await app.screenshot({ path: test.info().outputPath("hosts-1400.png") });
  });

  test("Detailseite: Direktlink, Suche, Messpunkt als Kurve, Quellenfehler, zurück", async ({ app }) => {
    await stub(app, { down: false });
    await openHosts(app);
    await app.getByRole("button", { name: "Details zu Werkbank" }).click();
    await expect(app).toHaveURL(/#\/statistik\/hosts\/alpha$/);
    await app.reload();
    await expect(app.getByText("smart: kein Zugriff")).toBeVisible();
    await expect(app.getByText("RAPL nicht lesbar")).toBeVisible();
    expect(await overflow(app)).toBe(false);
    await app.screenshot({ path: test.info().outputPath("detail-412.png"), fullPage: true });
    await app.getByLabel("Messpunkt suchen").fill("nvme");
    const row = app.getByRole("button", { name: /NVMe · Composite/ });
    await expect(app.getByRole("button", { name: /CPU · Tctl/ })).toHaveCount(0);
    await row.click();
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(app.getByRole("figure", { name: "Verlauf von NVMe Composite" })).toBeVisible();
    await app.getByText("Als Tabelle").click();
    await expect(app.getByRole("columnheader", { name: "Mittel" })).toBeVisible();
    await app.getByRole("button", { name: "Alle Hosts" }).click();
    await expect(app).toHaveURL(/#\/statistik\/hosts$/);
  });

  test("Abfrage fällt aus: letzte Werte bleiben stehen und gelten als alt (K10)", async ({ app }) => {
    const state = { down: false };
    await stub(app, state);
    await openHosts(app);
    const hero = app.getByRole("region", { name: "Gemessene Leistung" });
    await expect(hero).toContainText("171");
    state.down = true;
    await expect(app.getByText(/Keine frischen Daten/)).toBeVisible({ timeout: 12_000 });
    await expect(hero).toContainText("171");
  });
});
