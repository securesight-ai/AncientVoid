import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import { freePort } from "../support/ports.ts";

/**
 * EPIC-P79 (ADR-0102): Token-Tempo-Seite. Zwei Engines als Stand-ins: eine
 * meldet Einzel-Requests (Verteilungen sind erlaubt), eine nur Gegenwerte
 * (Verteilungen müssen verweigert und erklärt werden) — plus eine tote Quelle
 * (K9) und ein API-Key, der nur als Datei vorliegt und nirgends auftauchen darf.
 */

const KEY = "e2e-geheimer-inferenz-key";
const root = mkdtempSync(join(tmpdir(), "ancientvoid-p79-"));
const keyFile = join(root, "inference.key");
writeFileSync(keyFile, `${KEY}\n`);

const strataPort = await freePort();
const promPort = await freePort();
const deadPort = await freePort();
let scrape = 0;
let seenAuth = "";

/** Zwölf abgeschlossene Anfragen: genug Stichproben für Perzentile ab dem ersten Tick. */
function strataText(): string {
  scrape += 1;
  const anfragen = Array.from({ length: 12 }, (_, i) => {
    const gelesen = 2_000 + i * 1_500;
    return {
      id: `e2e-r${scrape}-${i}`,
      prompt_tokens: gelesen + 60_000,
      reused: 60_000,
      prompt_read: gelesen,
      output_tokens: 80 + i * 40,
      prompt_ms: Math.round((gelesen / 900) * 1000),
      decode_ms: 2_000 + i * 400,
      first_engine_token_s: 0.9 + i * 0.2,
      duration_s: 4 + i,
      finish: "stop",
      hit_rate: 0.9,
    };
  });
  return JSON.stringify({
    engine: { model: "E2E-Modell", version: "1.2.3", max_context: 131072, context: 131072, kv_resident: true, expert_cache_mib: 900, kv: "int8", expert_slots: 4096, experts: 24576, arena_mib: 24000, batch_slots: 2, drafting: "mtp", spec: 4, pcie_frac: 0.15, pool_workers: 15, prefill_cap: 32768, conversation_cache_mib: 8192 },
    live: { state: "generating", phase: "writing", tok_s: 47.5, prefill_tok_s_mean: 910, queued: 0, generated: 320, prompt_total: 71000, prompt_read: 2400, reused: 68600, elapsed_s: 6.5, parallel: 2, waiting: 1, admitting: 0, slots: [{ slot: 0, held_tokens: 96000 }, { slot: 1, held_tokens: 128000 }] },
    totals: { requests: 144, prompt_tokens: 900000, reused: 810000, output_tokens: 150000, prompt_ms: 520000, decode_ms: 3100000, drafts_offered: 90000, drafts_accepted: 61000 },
    hardware: { gpu_util: 0.83, gpu_temp: 66, gpu_mem_used: 30_000_000_000, gpu_mem_total: 34_000_000_000, gpu_power: 240, gpu_power_limit: 300, gpu_pcie_gen: 4, gpu_pcie_width: 16, gpu_pcie_gen_max: 4, gpu_pcie_width_max: 16, gpu_pcie_own_gen: 5, gpu_pcie_path: "4/4", ram_used: 96_000_000_000, ram_total: 128_000_000_000, cpu: 42, disk_read_mb: 1.5, disk_write_mb: 0.5 },
    hardware_static: { gpu_name: "E2E-GPU", cpu_name: "E2E-CPU 16K", cores: 16 },
    conversation_cache: { bytes: 4000, evictions: 2, budget_mib: 6000, parked: 3, restores: 1, refused_total: 0 },
    history: { tok_s: [40, 42, 44, 47], prefill_tok_s_mean: [820, 880, 900], ram_used: [60_000_000_000, 61_000_000_000] },
    requests: anfragen,
  });
}

function promText(): string {
  const n = scrape + 1;
  return [
    "# TYPE llamacpp:prompt_tokens_total counter",
    `llamacpp:prompt_tokens_total ${20_000 + n * 900}`,
    "# TYPE llamacpp:prompt_tokens_cached_total counter",
    `llamacpp:prompt_tokens_cached_total ${16_000 + n * 840}`,
    "# TYPE llamacpp:prompt_seconds_total counter",
    `llamacpp:prompt_seconds_total ${12 + n * 0.4}`,
    "# TYPE llamacpp:tokens_predicted_total counter",
    `llamacpp:tokens_predicted_total ${9_000 + n * 120}`,
    "# TYPE llamacpp:tokens_predicted_seconds_total counter",
    `llamacpp:tokens_predicted_seconds_total ${140 + n * 2.4}`,
    "# TYPE llamacpp:prompt_tokens_seconds gauge",
    "llamacpp:prompt_tokens_seconds 1450",
    "# TYPE llamacpp:predicted_tokens_seconds gauge",
    "llamacpp:predicted_tokens_seconds 50.4",
    "# TYPE llamacpp:requests_deferred gauge",
    "llamacpp:requests_deferred 1",
  ].join("\n");
}

let server: Server;
let promServer: Server;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith("/strata/metrics")) {
      seenAuth = req.headers.authorization ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(strataText());
      return;
    }
    res.writeHead(404);
    res.end();
  });
  promServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(promText());
  });
  await new Promise<void>((r) => server.listen(strataPort, "127.0.0.1", r));
  await new Promise<void>((r) => promServer.listen(promPort, "127.0.0.1", r));
});
test.afterAll(async () => {
  server?.close();
  promServer?.close();
});

test.use({
  hubOptions: {
    inference: {
      intervalSec: 1,
      windowHours: 24,
      minReadPrefill: 2_000,
      engines: [
        { id: "e2estrata", kind: "strata", url: `http://127.0.0.1:${strataPort}/strata/metrics`, label: "E2E Einzel-Requests", apiKeyFile: keyFile },
        { id: "e2eprom", kind: "llamacpp", url: `http://127.0.0.1:${promPort}/prom/metrics`, label: "E2E Gegenwerte" },
        { id: "e2etot", kind: "llamacpp", url: `http://127.0.0.1:${deadPort}/metrics`, label: "E2E tot" },
      ],
    },
  },
});

async function openInferenz(page: Page): Promise<void> {
  await page.setViewportSize({ width: 412, height: 850 });
  await page.reload();
  await page.getByRole("button", { name: /Mehr/ }).first().click();
  await page.getByRole("dialog", { name: "Mehr" }).getByRole("button", { name: "Inferenz" }).click();
  await expect(page).toHaveURL(/#\/inferenz$/);
}

const karte = (page: Page, name: string) => page.getByRole("region", { name });

test.describe("Token-Tempo-Seite (EPIC-P79)", () => {
  test("eigener Menüpunkt führt zur Seite, Engine-Werte erscheinen", async ({ app }) => {
    await openInferenz(app);
    await expect(karte(app, "Im Moment")).toBeVisible();
    await expect(app.getByText(/E2E-Modell/)).toBeVisible();
    // EPIC-P79 Nachzug: Bauart und Gerät müssen stehen, sonst ist kein Befund deutbar.
    await expect(karte(app, "Engine & Bauart")).toBeVisible();
    await expect(karte(app, "Engine & Bauart")).toContainText(/131\.072/);
    await expect(karte(app, "Engine & Bauart")).toContainText(/int8/);
    await expect(karte(app, "Engine & Bauart")).toContainText(/4\.096\/24\.576|4.096 \/ 24.576/);
    await expect(karte(app, "Gerät")).toContainText(/E2E-CPU 16K/);
    // Slot-Maximum und Kartenfähigkeit sind verschiedene Befunde (real: Karte Gen 5, Slot Gen 4).
    await expect(karte(app, "Gerät")).toContainText(/Slot Gen 4 × 16 · Karte Gen 5/);
    await expect(karte(app, "Engine & Bauart")).toContainText(/15 %/);
    await expect(karte(app, "Engine & Bauart")).toContainText(/32\.768/);
    await expect(karte(app, "Im Moment")).toContainText(/128\.000/); // größter Slot-Halt
    await expect(karte(app, "Seit Engine-Start")).toContainText("144");
  });

  test("Einzel-Request-Engine: Verteilung mit Stichproben und Spitzenwert", async ({ app }) => {
    test.setTimeout(40_000);
    await openInferenz(app);
    const verteilung = karte(app, "Tempo-Verteilung");
    await expect(verteilung).toContainText("12", { timeout: 20_000 });
    await expect(verteilung).not.toContainText("Verteilungen brauchen einzelne Requests");
  });

  test("Gegenwert-Engine: keine erfundene Verteilung, sondern der Grund", async ({ app }) => {
    test.setTimeout(40_000);
    await openInferenz(app);
    await app.getByRole("button", { name: /E2E Gegenwerte/ }).click();
    await expect(karte(app, "Tempo-Verteilung")).toContainText("Verteilungen brauchen einzelne Requests", { timeout: 20_000 });
    await expect(app.getByText(/keine Hardware-Werte gemeldet/)).toBeVisible({ timeout: 20_000 });
  });

  test("tote Quelle bleibt als Ausfall sichtbar (K9)", async ({ app }) => {
    test.setTimeout(40_000);
    await openInferenz(app);
    await app.getByRole("button", { name: /E2E tot/ }).click();
    await expect(app.getByRole("status").filter({ hasText: /Probe fehlgeschlagen/ }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("Schlüssel bleibt in der Dateireferenz (ADR-0011)", async ({ app }) => {
    await openInferenz(app);
    expect(seenAuth).toBe(`Bearer ${KEY}`);
    expect(await app.content()).not.toContain(KEY);
  });
});
