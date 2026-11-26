import { describe, expect, it } from "vitest";
import { EVAL_METRICS, EvalSeriesSummary, evaluationTable } from "../src/index.ts";

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
