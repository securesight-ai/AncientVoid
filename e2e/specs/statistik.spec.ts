import { createServer, type Server } from "node:http";
import { test, expect, dockGo } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import { StatisticsReport } from "@ancientvoid/contracts";
import { freePort } from "../support/ports.ts";

/**
 * EPIC-P56 T56.3/T56.4 + EPIC-P66: Statistik-Zentrale. Echte Sessions des
 * E2E-Hubs, echter Rollup, echte Schnitte; klappbare Sektionen mit
 * Reload-stabilem Zustand; Aimetrics-Sektionen gegen einen llamacpp-Stand-in.
 * Jede Zahl mit n; Klein-n gekennzeichnet; leere Schnitte ehrlich leer.
 */

const port = await freePort();
const METRICS = [
  "# TYPE llamacpp:prompt_tokens_total counter",
  "llamacpp:prompt_tokens_total 1000",
  "# TYPE llamacpp:requests_processing gauge",
  "llamacpp:requests_processing 3",
].join("\n");

let server: Server;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith("/metrics")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(METRICS);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>(r => server.listen(port, "127.0.0.1", r));
});
test.afterAll(() => {
  server?.close();
});

test.use({
  hubOptions: {
    aiMetrics: { intervalSec: 2, windowSec: 60, hostProbe: false, servers: [{ url: `http://127.0.0.1:${port}/metrics`, label: "E2E KI-Server" }] },
  },
});

async function openStatistics(page: Page) {
  await page.setViewportSize({ width: 412, height: 850 });
  await page.reload();
  await dockGo(page, "Statistik");
  await expect(page).toHaveURL(/#\/statistik$/);
}

/** EPIC-P66: Sektion nach Namen öffnen (Kopf-Klick, falls zugeklappt). */
async function openSection(page: Page, title: string) {
  const head = page.getByRole("region", { name: `Statistik ${title}` }).getByRole("button", { name: title });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
}

test.describe("Statistik-Zentrale (EPIC-P56/P66)", () => {
  test("BUG-0257: eine Seite, drei Reiter — Metriken/Inferenz über denselben Menüpunkt, Altlinks leiten um", async ({ app }) => {
    await openStatistics(app);
    await expect(app.getByRole("tab")).toHaveCount(3);
    await expect(app.getByRole("tab", { name: "Statistik" })).toHaveAttribute("aria-selected", "true");
    await app.getByRole("tab", { name: "Metrik" }).click();
    await expect(app).toHaveURL(/#\/statistik\/metriken$/);
    await expect(app.getByRole("tab", { name: "Metrik" })).toHaveAttribute("aria-selected", "true");
    await expect(app.getByRole("region", { name: "Metrik-Quelle E2E KI-Server" })).toBeVisible();
    await app.getByRole("tab", { name: "Inferenz" }).click();
    await expect(app).toHaveURL(/#\/statistik\/inferenz$/);
    await expect(app.getByText(/Keine Engines konfiguriert/)).toBeVisible();
    // Altlinks leiten permanent um (route.ts, redirectLegacyStatHash).
    await app.goto(`${app.url().split("#")[0]}#/metriken`);
    await expect(app).toHaveURL(/#\/statistik\/metriken$/);
  });

  test("Dock „Mehr“ → „Statistik“ zeigt Sessions mit Verteilung und n", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-Erste" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    await openStatistics(app);
    const card = app.getByRole("region", { name: "Statistik Sessions" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("opencode · e2e/fake-model");
    await expect(card).toContainText(/n \d+/);
    // Klein-n ist Pflichtkennzeichnung, kein optionaler Schmuck (AC-P56-3).
    await expect(card).toContainText("wenige Daten");

    await openSection(app, "Züge und Tokens");
    const turns = app.getByRole("region", { name: "Statistik Züge und Tokens" });
    await expect(turns).toContainText("opencode");
    await expect(turns).toContainText(/geschätzt|n \d+/);
  });

  test("Zeitraum „Woche“ umfasst heutige Sessions, Projektschnitt hält sie", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-Zweite" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    await openStatistics(app);
    const card = app.getByRole("region", { name: "Statistik Sessions" });
    await expect(card).toBeVisible();

    await app.getByRole("group", { name: "Zeitraum", exact: true }).getByRole("button", { name: "Woche" }).click();
    await expect(card).toContainText("opencode");

    const projekt = app.getByLabel("Projekt");
    const options = await projekt.locator("option").allTextContents();
    const eigenes = options.find(o => !o.includes("alle Projekte")) ?? options[0]!;
    await projekt.selectOption({ label: eigenes });
    await expect(card).toContainText("opencode");
  });

  test("API: Contract-Report, ehrlich leere Schnitte, 400 auf ungültige Query", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-API" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    const report = await hub.api<StatisticsReport>("/api/statistics");
    expect(report.status).toBe(200);
    expect(StatisticsReport.parse(report.body).sessions.length).toBeGreaterThan(0);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const empty = await hub.api<StatisticsReport>(`/api/statistics?since=${encodeURIComponent(tomorrow)}`);
    expect(empty.status).toBe(200);
    expect(empty.body.sessions).toEqual([]);
    expect(empty.body.slices.projects.length).toBeGreaterThan(0); // Scheiben bleiben belegt

    const invalid = await hub.api("/api/statistics?since=gestern");
    expect(invalid.status).toBe(400);
  });

  test("T56.4: Klein-n meldet keine Anomalien — die Sektion sagt es ehrlich", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-Anomalie" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    const report = await hub.api<StatisticsReport>("/api/statistics");
    expect(report.body.anomalies).toEqual([]);

    await openStatistics(app);
    await openSection(app, "Anomalien");
    await expect(app.getByRole("region", { name: "Statistik Anomalien" })).toContainText(/Keine Anomalien/);
  });

  test("T56.4: Zeitraum-Vergleich lädt Seite B, CSV-Export liefert die angezeigten Daten", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-Vergleich" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    await openStatistics(app);
    await openSection(app, "Zeitraum-Vergleich (A/B)");
    const compare = app.getByRole("region", { name: "Statistik Zeitraum-Vergleich (A/B)" });
    await expect(compare).toBeVisible();
    await expect(compare.locator("tbody tr").first()).toContainText("opencode");

    // AC-P56-5: CSV enthält exakt die angezeigte Session-Zeile — Download ohne Netz.
    const downloadPromise = app.waitForEvent("download");
    await app.getByRole("button", { name: "CSV herunterladen" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^statistik-export-\d{4}-\d{2}-\d{2}\.csv$/);
    const path = await download.path();
    const csv = await import("node:fs/promises").then(fs => fs.readFile(path!, "utf8"));
    expect(csv).toContain("# EPIC-P56 Statistik-Export");
    expect(csv).toContain("opencode,e2e/fake-model");
  });

  test("T66.1: Sektionen klappen und halten den Zustand über einen Reload", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-Klappen" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    await openStatistics(app);
    const sessions = app.getByRole("region", { name: "Statistik Sessions" });
    await expect(sessions).toContainText("opencode"); // Default offen (Premortem 4)

    // Zuklappen: Inhalt verschwindet, aria-expanded kippt.
    const head = sessions.getByRole("button", { name: /Sessions/ });
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(sessions).not.toContainText("opencode");

    // Reload: der Zustand steht noch (localStorage, T66.1/AC-P66-2).
    await app.reload();
    await expect(app).toHaveURL(/#\/statistik$/);
    const headAfter = app.getByRole("region", { name: "Statistik Sessions" }).getByRole("button", { name: /Sessions/ });
    await expect(headAfter).toHaveAttribute("aria-expanded", "false");
    await headAfter.click();
    await expect(app.getByRole("region", { name: "Statistik Sessions" })).toContainText("opencode");
  });

  test("T66.3: Schnitt überlebt einen Reload, „Zurücksetzen“ stellt Defaults her", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-Filter" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    await openStatistics(app);
    await app.getByRole("group", { name: "Zeitraum", exact: true }).getByRole("button", { name: "Woche" }).click();
    const projekt = app.getByLabel("Projekt");
    const options = await projekt.locator("option").allTextContents();
    const eigenes = options.find(o => !o.includes("alle Projekte")) ?? options[0]!;
    await projekt.selectOption({ label: eigenes });

    await app.reload();
    await expect(app).toHaveURL(/#\/statistik$/);
    await expect(app.getByRole("group", { name: "Zeitraum", exact: true }).getByRole("button", { name: "Woche" })).toHaveAttribute("aria-pressed", "true");
    await expect(app.getByLabel("Projekt")).not.toHaveValue("");

    await app.getByRole("button", { name: "Schnitt zurücksetzen" }).click();
    await expect(app.getByRole("group", { name: "Zeitraum", exact: true }).getByRole("button", { name: "Alles" })).toHaveAttribute("aria-pressed", "true");
    await expect(app.getByLabel("Projekt")).toHaveValue("");
  });

  test("T66.2: System- und KI-Server-Sektionen betten den Aimetrics-Report ehrlich ein", async ({ app }) => {
    await openStatistics(app);

    await openSection(app, "System (Hub-Host)");
    const system = app.getByRole("region", { name: "Statistik System (Hub-Host)" });
    await expect(system).toContainText("Host-Probe nicht konfiguriert");

    await openSection(app, "KI-Server");
    const ki = app.getByRole("region", { name: "Statistik KI-Server" });
    await expect(ki).toContainText("E2E KI-Server");
    await expect(ki).toContainText("nicht gemeldet"); // fehlende Familien bleiben ehrlich (ADR-0023)
    await expect(ki.locator("tr").filter({ hasText: "Queue: in Bearbeitung" })).toContainText("3");
  });
});
