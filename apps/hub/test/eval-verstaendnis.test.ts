import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * T84.12 — Verständnisfrage mit deterministischer Prüfung. Die Antwort steht
 * in `eval-verstaendnis-antwort.txt` neben diesem Test; die gefragten Bezeichner
 * existieren im Start-Stand (P84-Korpusaufgabe `k7-verstaendnis`). Im Benchmark
 * schreibt der Agent die Antwortdatei, der Prüfer hier liest sie.
 */
describe("Verständnisfrage: K7 — Zug-Metriken und Abnahme aus dem Journal", () => {
  it("nennt Funktion samt Datei und das Abnahme-Ereignis", () => {
    const antwort = readFileSync(new URL("./eval-verstaendnis-antwort.txt", import.meta.url), "utf8");
    expect(antwort).toContain("deriveTurnMetrics");
    expect(antwort).toContain("derive.ts");
    expect(antwort).toContain("evaluation.completed");
  });
});
