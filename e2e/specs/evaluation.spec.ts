import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluationTable } from "@ancientvoid/contracts";
import type { EvalResult, EvalSeriesSummary, TurnMetric } from "@ancientvoid/contracts";
import { test, expect, signIn } from "../support/fixtures.ts";

test("P90 startet ein registriertes Messprotokoll und zeigt den Prüfstandfehler", async ({ hub, page }) => {
  const dir = join(hub.dataDir, "evaluation");
  await mkdir(dir);
  const protocol = join(dir, "protocol.json");
  const tokenFile = join(dir, "token");
  await writeFile(tokenFile, hub.token, { mode: 0o600 });
  // The configured subprocess must fail its own preflight. No provider is contacted.
  await writeFile(protocol, JSON.stringify({ repoScan: { repo: hub.alpha } }));
  await writeFile(join(dir, "presets.json"), JSON.stringify([{
    id: "p90-fixture", label: "Repo-Scan A/B", repo: hub.alpha, protocol, scratch: dir, origin: hub.origin, tokenFile,
  }]));
  await signIn(page, hub);
  await page.goto(`${hub.origin}/#/statistik/evaluation`);
  await page.getByLabel("Repository").selectOption(hub.alpha);
  await expect(page.getByLabel("Messprotokoll")).toHaveValue("p90-fixture");
  await page.getByRole("button", { name: "Vergleich starten" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Messlauf fehlgeschlagen" })).toBeVisible({ timeout: 20_000 });
});

test("P84 speichert Abnahme und Richtungstokens an der Sitzung und behält sie beim Neustart", async ({ hub, page }) => {
  const id = await hub.createSession({ adapter: "opencode", model: "e2e/fake-model", prompt: "Lies README.md" });
  await hub.until(async () => {
    const response = await hub.api<{ turns: TurnMetric[] }>(`/api/sessions/${id}/turns`);
    return response.body.turns.length > 0;
  }, "one OpenCode turn with usage");
  expect((await hub.api(`/api/sessions/${id}/stop`, { body: {} })).status).toBe(200);
  const hash = "a".repeat(64);
  const path = `/api/sessions/${id}/evaluation`;
  const saved = await hub.api<EvalResult>(path, {
    body: {
      series: "e2e", arm: "opencode-cloud-plain", task: "readme", repetition: 1,
      corpusHash: hash, protocolHash: hash, rulesHash: hash, skillHash: null,
      skills: false, acceptance: true, lint: true, typecheck: true, baseline: 1,
      phases: [{
        sessionId: id, phase: "build", harnessVersion: "1.2.3-e2e", modelFingerprint: "fixture-v1", wallMs: 500,
        billing: { kind: "cloud", date: "2026-11-25", source: "https://example.com/prices", inputUsdPerMillion: 2, outputUsdPerMillion: 4 },
      }],
    },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.phases[0]).toMatchObject({ inputTokens: 300, outputTokens: 21, costUsd: 0.000684 });
  await hub.restart();
  const restored = await hub.api(path);
  expect(restored.status).toBe(200);
  expect(restored.body).toEqual(saved.body);
  // Die PWA zeigt dieselbe Tabelle wie der Report: Zelle für Zelle aus `evaluationTable` der Zusammenfassung.
  const summary = await hub.api<EvalSeriesSummary>("/api/evaluation/series/e2e");
  expect(summary.status).toBe(200);
  const expected = evaluationTable(summary.body);
  await signIn(page, hub);
  await page.goto(`${hub.origin}/#/statistik/evaluation`);
  const table = page.getByTestId("evaluation-table");
  await expect(table).toBeVisible();
  const cells = await table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent ?? "")));
  expect(cells).toEqual(expected.rows);
  expect(await table.locator("thead th").allTextContents()).toEqual(expected.columns);
});

test("P90 trennt Repo-Serien und verlinkt den konkreten Qualitätsrückschritt", async ({ hub, page }) => {
  test.setTimeout(90_000);
  const repo = "/fixtures/p90-first";
  const cases = [
    ...Array.from({ length: 5 }, (_, repetition) => [
      { project: repo, arm: "reference", repetition: repetition + 1, acceptance: true },
      { project: repo, arm: "candidate", repetition: repetition + 1, acceptance: repetition > 0 },
    ]).flat(),
    { project: "/fixtures/p90-second", arm: "candidate", repetition: 1, acceptance: true },
  ];
  let failedSession: string | undefined;
  for (const { project, arm, repetition, acceptance } of cases) {
    const id = await hub.createSession({ adapter: "opencode", model: "e2e/fake-model", prompt: "Lies README.md" });
    if (!acceptance) failedSession = id;
    await hub.until(async () => (await hub.api<{ turns: TurnMetric[] }>(`/api/sessions/${id}/turns`)).body.turns.length > 0, "completed turn");
    expect((await hub.api(`/api/sessions/${id}/stop`, { body: {} })).status).toBe(200);
    const hash = "a".repeat(64);
    const saved = await hub.api(`/api/sessions/${id}/evaluation`, { body: {
      series: "vergleich", arm, task: "readme", repetition,
      corpusHash: hash, protocolHash: hash, rulesHash: hash, skillHash: null,
      skills: false, acceptance, lint: true, typecheck: true, baseline: 1,
      comparison: { repo: project, kind: "hook", source: project === repo ? "format" : "lint-hook",
        reference: hash, candidate: "b".repeat(64), applied: true, minimumEffect: 0.2 },
      phases: [{ sessionId: id, phase: "build", harnessVersion: "e2e", modelFingerprint: "fixture-v1", wallMs: 500,
        billing: { kind: "cloud", date: "2026-11-25", source: "https://example.com/prices", inputUsdPerMillion: 2, outputUsdPerMillion: 4 },
      }],
    } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  }
  await signIn(page, hub);
  await page.goto(`${hub.origin}/#/statistik/evaluation`);
  await page.getByLabel("Repository").selectOption(repo);
  await expect(page.getByText("format", { exact: true })).toBeVisible();
  await expect(page.getByText(/Verschlechtert/)).toBeVisible();
  const acceptance = page.getByRole("row", { name: /Abnahme.*5\/5.*4\/5/ });
  await expect(acceptance.getByRole("link", { name: "Sitzung 1" })).toHaveAttribute("href", `#/sessions/${failedSession}`);
  await page.getByLabel("Repository").selectOption("/fixtures/p90-second");
  await expect(page.getByText("lint-hook", { exact: true })).toBeVisible();
  await expect(page.getByText(/Evidenz fehlt/)).toBeVisible();
  await expect(page.getByText(/mindestens fünf eindeutige Paare/)).toBeVisible();
  await expect(page.getByText("format", { exact: true })).toHaveCount(0);
});
