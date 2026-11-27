import { describe, expect, it } from "vitest";
import { EVAL_METRICS, EvalResult, EvalRunInput, EvalSeriesSummary, evaluationTable } from "../src/index.ts";

const stat = { median: 1.5, mean: 2, min: 1, max: 3 };
const metrics = Object.fromEntries(EVAL_METRICS.map(({ id }) => [id, stat]));

describe("evaluationTable", () => {
  it("prints fixed decimals with units in the header, identical for every consumer", () => {
    const summary = EvalSeriesSummary.parse({
      series: "s", runs: 3, corpusHashes: [], protocolHashes: [], firstRecordedAt: null, lastRecordedAt: null, consistent: true,
      rows: [{ arm: "a", task: "gesamt", n: 3, metrics }],
    });
    const table = evaluationTable(summary);
    expect(table.columns.slice(0, 3)).toEqual(["Arm", "Aufgabe", "n"]);
    expect(table.columns).toHaveLength(3 + EVAL_METRICS.length);
    expect(table.columns[3]).toBe("Fehlerquote [Anteil 0–1] (Median; Mittel; Min–Max)");
    expect(table.rows[0]!.slice(0, 4)).toEqual(["a", "gesamt", "3", "1.50; 2.00; 1.00–3.00"]);
    expect(() => EvalSeriesSummary.parse({ series: "s" })).toThrow();
  });
});

const hash = "a".repeat(64);
const resultInput = {
  series: "s", arm: "a", task: "t", repetition: 1, corpusHash: hash, protocolHash: hash, rulesHash: hash,
  skills: false, skillHash: null, baseline: 1, acceptance: true, lint: true, typecheck: true,
  phases: [{ sessionId: crypto.randomUUID(), phase: "build", harnessVersion: "1", modelFingerprint: "m", wallMs: 100,
    billing: { kind: "cloud", date: "2026-11-27", source: "https://example.com/p", inputUsdPerMillion: 2, outputUsdPerMillion: 4 } }],
};
const resultPhase = { adapter: "a", adapterVersion: "1", model: "m", inputTokens: 10, cacheInputTokens: 0, outputTokens: 5,
  costUsd: 0.00004, turnErrors: 0, toolErrors: 0, turns: 1, startedAt: "2026-11-27T10:00:00.000Z", endedAt: "2026-11-27T10:01:00.000Z" };

describe("EvalResult — ADR-0127/0128 compatibility and outcomes", () => {
  it("fills outcome and cache write tokens with defaults for pre-ADR records (K7)", () => {
    const parsed = EvalResult.parse({ input: resultInput, recordedAt: "2026-11-27T10:02:00.000Z", phases: [resultPhase] });
    expect(parsed.input.outcome).toBe("completed");
    expect(parsed.phases[0]!.cacheWriteInputTokens).toBe(0);
  });

  it("accepts an aborted run without turns, cost or a build phase", () => {
    const aborted = EvalResult.parse({
      input: { ...resultInput, outcome: "timeout", acceptance: false, lint: false, typecheck: false, baseline: 0,
        phases: [{ ...resultInput.phases[0]!, phase: "plan" }] },
      recordedAt: "2026-11-27T10:02:00.000Z",
      phases: [{ ...resultPhase, turns: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 }],
    });
    expect(aborted.input.outcome).toBe("timeout");
    expect(EvalRunInput.parse(resultInput).outcome).toBe("completed");
  });

  it("keeps the old invariants for completed runs: positive turns and cost, build last", () => {
    expect(() => EvalResult.parse({ input: resultInput, recordedAt: "2026-11-27T10:02:00.000Z",
      phases: [{ ...resultPhase, turns: 0, costUsd: 0 }] })).toThrow(/positive turns and cost/);
    expect(() => EvalResult.parse({ input: { ...resultInput, phases: [{ ...resultInput.phases[0]!, phase: "plan" }] },
      recordedAt: "2026-11-27T10:02:00.000Z", phases: [resultPhase] })).toThrow(/build/);
  });
});
