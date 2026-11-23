import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, dockGo } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import { freePort } from "../support/ports.ts";

/**
 * EPIC-P59 (ADR-0078): Metrik-Seite für den lokalen KI-Server. Ein Stand-in
 * für llama.cpp `/metrics` mit echten Familiennamen; eine Quelle mit
 * fehlenden Familien („nicht gemeldet“ ≠ 0, ADR-0023), eine tote Quelle (K9),
 * Offline bleibt lesbar (K10). Der API-Key liegt nur als Datei vor
 * (ADR-0011) und darf nirgends im Report oder auf der Seite auftauchen.
 */

const KEY = "e2e-geheimer-metriken-key";
const root = mkdtempSync(join(tmpdir(), "ancientvoid-p59-"));
const keyFile = join(root, "metrics.key");
writeFileSync(keyFile, `${KEY}\n`);

const port = await freePort();
const deadPort = await freePort();
let seenAuth = "";
let scrape = 0;

function fullText(): string {
  scrape += 1;
  return [
    "# TYPE llamacpp:prompt_tokens_total counter",
    `llamacpp:prompt_tokens_total ${1000 + scrape * 100}`,
    "# TYPE llamacpp:prompt_seconds_total counter",
    `llamacpp:prompt_seconds_total ${2 + scrape * 0.2}`,
    "# TYPE llamacpp:prompt_tokens_seconds gauge",
    "llamacpp:prompt_tokens_seconds 512",
    "# TYPE llamacpp:tokens_predicted_total counter",
    `llamacpp:tokens_predicted_total ${200 + scrape * 20}`,
    "# TYPE llamacpp:predicted_tokens_seconds_total counter",
    `llamacpp:predicted_tokens_seconds_total ${4 + scrape * 0.4}`,
    "# TYPE llamacpp:predicted_tokens_seconds gauge",
    "llamacpp:predicted_tokens_seconds 123.5",
    "# TYPE llamacpp:requests_processing gauge",
    "llamacpp:requests_processing 3",
    "# TYPE llamacpp:requests_deferred gauge",
    "llamacpp:requests_deferred 0",
    "# TYPE llamacpp:n_tokens_max counter",
    "llamacpp:n_tokens_max 4096",
    "# TYPE llamacpp:spec_decode_num_draft_tokens_total counter",
    `llamacpp:spec_decode_num_draft_tokens_total ${scrape}`,
    '# TYPE llamacpp:spec_decode_num_accepted_tokens_per_pos_total counter',
    `llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="0"} ${scrape}`,
    `llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="1"} ${scrape * 2}`,
  ].join("\n");
}

// Die zweite Quelle meldet bewusst nur eine Familie — alles andere muss
// „nicht gemeldet“ heißen, nie eine 0 (ADR-0023).
const partialText = "llamacpp:requests_processing 3\n";

let server: Server;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith("/full/metrics")) seenAuth = req.headers.authorization ?? "";
    if (req.url?.endsWith("/full/metrics")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(fullText());
      return;
    }
    if (req.url?.endsWith("/partial/metrics")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(partialText);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
});
test.afterAll(async () => {
  server?.close();
});

test.use({
  hubOptions: {
    aiMetrics: {
      intervalSec: 2,
      windowSec: 60,
      hostProbe: false,
      servers: [
        { url: `http://127.0.0.1:${port}/full/metrics`, label: "E2E voll", apiKeyFile: keyFile },
        { url: `http://127.0.0.1:${port}/partial/metrics`, label: "E2E lückenhaft" },
        { url: `http://127.0.0.1:${deadPort}/metrics`, label: "E2E tot" },
      ],
    },
  },
});

async function openMetrics(page: Page) {
  await page.setViewportSize({ width: 412, height: 850 });
  await page.reload();
  // BUG-0257: Metriken ist ein Reiter der Analyse-Seite — ein Menüpunkt, dann der Reiter.
  await dockGo(page, "Statistik");
  await page.getByRole("tab", { name: "Metrik" }).click();
  await expect(page).toHaveURL(/#\/statistik\/metriken$/);
}

const card = (page: Page, label: string) => page.getByRole("region", { name: `Metrik-Quelle ${label}` });

test.describe("Metrik-Seite (EPIC-P59)", () => {
  test("Dock „Mehr“ → „Metrik“ erreicht die Seite", async ({ app }) => {
    await openMetrics(app);
    await expect(card(app, "E2E voll")).toBeVisible();
  });

  test("volle Daten: gemeldete Zahl mit Quelle und Alter", async ({ app }) => {
    await openMetrics(app);
    const row = card(app, "E2E voll").locator("tr").filter({ hasText: "Decode- Durchschn. (gemeldet)" });
    await expect(row).toContainText("123,5 tokens/s");
    await expect(row).toContainText("gemeldet");
    await expect(row).toContainText(/vor \d+ s/);
  });

  test("p50/p95 aus dem eigenen Sample-Fenster (kein Histogramm)", async ({ app }) => {
    test.setTimeout(40_000);
    await openMetrics(app);
    const row = card(app, "E2E voll").locator("tr").filter({ hasText: "Decode- Durchschn. (gemeldet)" });
    await expect(row).toContainText(/123,5 tokens\/s \/ 123,5 tokens\/s \([2-9]\d*\)/, { timeout: 25_000 });
  });

  test("abgeleitete Rate aus Zähler-Deltas erscheint nach dem zweiten Tick", async ({ app }) => {
    test.setTimeout(40_000);
    await openMetrics(app);
    const row = card(app, "E2E voll").locator("tr").filter({ hasText: "Tokens/s gesamt" });
    await expect(row).not.toContainText("nicht gemeldet", { timeout: 25_000 });
    await expect(row).toContainText("abgeleitet");
  });

  test("fehlende Familien: „nicht gemeldet“, nie 0 (ADR-0023)", async ({ app }) => {
    await openMetrics(app);
    const card2 = card(app, "E2E lückenhaft");
    await expect(card2.locator("tr").filter({ hasText: "Queue: in Bearbeitung" })).toContainText("3");
    await expect(card2.locator("tr").filter({ hasText: "Spec-Decoding: drafts" })).toContainText("nicht gemeldet");
  });

  test("tote Quelle: Probe-Ausfall wird als Zustand sichtbar (K9)", async ({ app }) => {
    test.setTimeout(40_000);
    await openMetrics(app);
    await expect(card(app, "E2E tot").getByText(/Probe fehlgeschlagen/)).toBeVisible({ timeout: 25_000 });
  });

  test("Offline: letzte Daten plus Alter bleiben stehen, kein Whiteout (K10)", async ({ app }) => {
    test.setTimeout(40_000);
    await openMetrics(app);
    const row = card(app, "E2E voll").locator("tr").filter({ hasText: "Decode- Durchschn. (gemeldet)" });
    await expect(row).toContainText("123,5 tokens/s");
    await app.context().setOffline(true);
    await expect(app.getByText(/Keine frischen Daten/)).toBeVisible({ timeout: 25_000 });
    await expect(row).toContainText("123,5 tokens/s");
    await app.context().setOffline(false);
  });

  test("Redaction: der Key liegt nur als Datei vor und taucht nie auf der Seite auf", async ({ app }) => {
    test.setTimeout(40_000);
    await openMetrics(app);
    await expect(card(app, "E2E voll")).toBeVisible({ timeout: 25_000 });
    // Der Stand-in hat den Header der letzten Probe gesehen — der Key kommt an.
    await expect.poll(() => seenAuth, { timeout: 25_000 }).toBe(`Bearer ${KEY}`);
    await expect(app.locator("body")).not.toContainText(KEY);
  });
});
