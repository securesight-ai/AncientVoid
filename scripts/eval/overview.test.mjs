import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupKey, readSeriesFolders, renderOverview } from "./overview.mjs";

const lauf = (over = {}) => ({
  schema_version: 1, lauf_id: "2026-11-27-kern-a", datum: "2026-11-27", pruefstand: "fixture",
  messwerkzeug: "fixture", suite_version: `p84-korpus ${"a".repeat(53)}`, protokoll_sha256: "a".repeat(64),
  wiederholungen: 2, zellen: [{ id: "pi-cloud", harness: "pi", version: "1", configurationFingerprint: "f", model: "m", fingerprint: "fp", provider: "fixture", billing: { kind: "cloud" } }],
  laeufe_erwartet: 2, laeufe_erfasst: 2, infrastruktur_versuche_verworfen: 0, laeufe_abgebrochen: 0,
  kosten_cloud_usd_je_provider: {}, messung_gueltig: true, runtime: "fixture",
  ...over,
});

const row = (arm, task, outcome, acceptance = true) => ({
  input: { series: "kern-a", arm, task, repetition: 1, attempt: 1, corpusHash: "a".repeat(64), protocolHash: "a".repeat(64),
    rulesHash: "a".repeat(64), skills: false, skillHash: null, baseline: 1, acceptance, lint: acceptance, typecheck: acceptance, outcome,
    phases: [{ sessionId: randomUUID(), phase: "build", harnessVersion: "1", modelFingerprint: "fp", wallMs: 100, billing: { kind: "cloud", date: "2026-11-27", source: "https://example.com", inputUsdPerMillion: 1, outputUsdPerMillion: 2 } }] },
  recordedAt: "2026-11-27T10:00:00.000Z",
  phases: [{ adapter: "pi", adapterVersion: "1", model: "m", inputTokens: 10, cacheInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 5,
    costUsd: 0.00002, turnErrors: 0, toolErrors: 0, turns: 1, startedAt: "2026-11-27T10:00:00.000Z", endedAt: "2026-11-27T10:01:00.000Z" }],
});

describe("T84.15 overview", () => {
  it("lists series × cell × task per stand and never merges different corpus/protocol stands", () => {
    const dir = mkdtempSync(join(tmpdir(), "p84-overview-"));
    try {
      const exportAs = (name, manifest, rows) => {
        const folder = join(dir, "evaluation", "laeufe", name);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "lauf.yaml"), `${JSON.stringify(manifest, null, 2)}\n`);
        writeFileSync(join(folder, "ergebnisse.jsonl"), rows.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      };
      exportAs("2026-11-26-kern-a", lauf(), [
        row("pi-cloud-plain", "notizen-route", "completed"),
        row("pi-cloud-plain", "notizen-route", "completed", false),
        row("pi-cloud-plain", "notizen-route", "timeout"),
        row("pi-cloud-skills", "notizen-route", "completed"),
      ]);
      // Gleicher Stand: gleiche Suite und gleiches Protokoll.
      exportAs("2026-11-26-kern-b", lauf({ lauf_id: "2026-11-26-kern-b", laeufe_erfasst: 1 }), [row("pi-cloud-plain", "notizen-route", "completed")]);
      // Anderer Korpusstand: eigene Gruppe, keine Summe.
      exportAs("2026-11-27-kern-alt", lauf({ lauf_id: "2026-11-27-kern-alt", suite_version: "p84-korpus b".repeat(4).slice(0, 64), messung_gueltig: false, laeufe_erfasst: 1, grund_ungueltig: "korpuswechsel" }), [
        row("pi-cloud-plain", "andere-aufgabe", "approval"),
      ]);
      const { markdown, groups, series } = renderOverview(dir, { generatedAt: "2026-11-27" });
      expect(series).toHaveLength(3);
      expect(groups).toHaveLength(2);
      // Ein Stand: zwei Serien gemeinsam; der andere getrennt und als ungültig markiert.
      expect(markdown).toContain("2 inkompatible Stände");
      expect(markdown).toContain("### 2026-11-26-kern-b (2026-11-27)");
      expect(markdown).toContain("### 2026-11-27-kern-alt (2026-11-27 · messung_gueltig=false)");
      // Zelle und Arm getrennt, Abbrüche je Ursache, Fehlerquote aus allen Ergebnissen (ADR-0128).
      expect(markdown).toContain("| pi-cloud | pi-cloud-plain | notizen-route | 3 | 1 | 1 | 0 | 0.67 |");
      expect(markdown).toContain("| pi-cloud | pi-cloud-plain | **gesamt** | 3 | 1 | 1 | 0 | 0.67 |");
      expect(markdown).toContain("| pi-cloud | pi-cloud-plain | andere-aufgabe | 1 | 0 | 0 | 1 | 1.00 |");
      expect(markdown).toContain("Serien, Zellen oder Stände hinweg gibt es bewusst keine Summe");
      expect(readSeriesFolders(dir).map((entry) => entry.name)).toEqual(series);
      expect(groupKey(lauf())).toBe(`p84-korpus ${"a".repeat(53)} · ${"a".repeat(12)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails loud on incomplete exports instead of guessing", () => {
    const dir = mkdtempSync(join(tmpdir(), "p84-overview-"));
    try {
      const folder = join(dir, "evaluation", "laeufe", "2026-11-26-bloed");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "lauf.yaml"), `${JSON.stringify({ ...lauf(), zellen: undefined }, null, 2)}\n`);
      writeFileSync(join(folder, "ergebnisse.jsonl"), `${JSON.stringify(row("pi-cloud-plain", "t", "completed"))}\n`);
      expect(() => renderOverview(dir, { generatedAt: "2026-11-27" })).toThrow(/lauf.yaml lacks zellen/);
      writeFileSync(join(folder, "lauf.yaml"), `${JSON.stringify(lauf(), null, 2)}\n`);
      writeFileSync(join(folder, "ergebnisse.jsonl"), `${JSON.stringify({ input: { arm: "pi-cloud-plain", task: "t", outcome: "kaputt" } })}\n`);
      expect(() => renderOverview(dir, { generatedAt: "2026-11-27" })).toThrow(/unknown outcome/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads pre-ADR-0128 exports without outcome as completed runs (K7)", () => {
    const dir = mkdtempSync(join(tmpdir(), "p84-overview-"));
    try {
      const folder = join(dir, "evaluation", "laeufe", "2026-11-26-alt");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "lauf.yaml"), `${JSON.stringify(lauf(), null, 2)}\n`);
      const legacy = row("pi-cloud-plain", "notizen-route", "completed");
      delete legacy.input.outcome;
      writeFileSync(join(folder, "ergebnisse.jsonl"), `${JSON.stringify(legacy)}\n`);
      const { markdown } = renderOverview(dir, { generatedAt: "2026-11-27" });
      expect(markdown).toContain("| pi-cloud | pi-cloud-plain | notizen-route | 1 | 1 | 0 | 0 | 0.00 |");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
