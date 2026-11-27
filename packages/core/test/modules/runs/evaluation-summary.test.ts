import type { EvalResult } from "@ancientvoid/contracts";
import { describe, expect, it } from "vitest";
import { evalRunValues, summariseSeries } from "../../../src/modules/runs/index.ts";

const hash = "a".repeat(64);
const run = (arm: string, task: string, repetition: number, over: Partial<{ acceptance: boolean; cost: number; kwh: number; cacheWrite: number; cacheWritePrice: number }> = {}): EvalResult => ({
  input: {
    series: "s", arm, task, repetition, attempt: 1, corpusHash: hash, protocolHash: hash, rulesHash: hash, skills: false, skillHash: null,
    baseline: 1, acceptance: over.acceptance ?? true, lint: true, typecheck: true,
    phases: [{
      sessionId: crypto.randomUUID(), phase: "build", harnessVersion: "1", modelFingerprint: "m", wallMs: 100 * repetition,
      billing: over.kwh === undefined
        ? { kind: "cloud", date: "2026-11-26", source: "https://example.com/p", inputUsdPerMillion: 2, cacheInputUsdPerMillion: 0.5, ...(over.cacheWritePrice !== undefined ? { cacheWriteUsdPerMillion: over.cacheWritePrice } : {}), outputUsdPerMillion: 4 }
        : { kind: "local", date: "2026-11-26", host: "h", source: "p81:power:components", kwh: over.kwh, usdPerKwh: 0.36 },
    }],
  },
  recordedAt: "2026-11-26T10:00:00.000Z",
  phases: [{ adapter: "a", adapterVersion: "1", model: "m", inputTokens: 1000, cacheInputTokens: 400, cacheWriteInputTokens: over.cacheWrite ?? 0, outputTokens: 100, costUsd: over.cost ?? 0.001, turnErrors: 0, toolErrors: repetition, turns: 1, startedAt: "2026-11-26T09:59:00.000Z", endedAt: "2026-11-26T10:00:00.000Z" }],
});

describe("P84 summary", () => {
  it("derives raw values once: failure, cloud vs energy cost, cache cost", () => {
    const cloud = evalRunValues(run("c", "t", 1));
    expect(cloud).toMatchObject({ failure: 0, cacheTokens: 400, cloudCostUsd: 0.001, energyCostUsd: 0, energyKwh: 0 });
    expect(cloud.cacheCostUsd).toBeCloseTo(0.0002, 10);
    const local = evalRunValues(run("l", "t", 1, { kwh: 0.01, cost: 0.0036, acceptance: false }));
    expect(local).toMatchObject({ failure: 1, cloudCostUsd: 0, energyCostUsd: 0.0036, energyKwh: 0.01, cacheCostUsd: 0 });
  });

  it("ADR-0127: prices cache read and write separately and sums both into cacheTokens", () => {
    // Lesen 400 × 0.5 + Schreiben 100 × 2.5 = 450 → 0.00045 USD.
    const split = evalRunValues(run("c", "t", 1, { cacheWrite: 100, cacheWritePrice: 2.5 }));
    expect(split.cacheTokens).toBe(500);
    expect(split.cacheCostUsd).toBeCloseTo(0.00045, 10);
    // Ohne Schreibpreis gilt der Input-Preis: 400 × 0.5 + 100 × 2 = 400 → 0.0004 USD.
    const fallback = evalRunValues(run("c", "t", 1, { cacheWrite: 100 }));
    expect(fallback.cacheCostUsd).toBeCloseTo(0.0004, 10);
    // z.ai-artiger Tarif: Schreiben kostenlos.
    const free = evalRunValues(run("c", "t", 1, { cacheWrite: 100, cacheWritePrice: 0 }));
    expect(free.cacheCostUsd).toBeCloseTo(0.0002, 10);
  });

  it("summarises per arm and task with median, mean, min and max, plus a total row", () => {
    const summary = summariseSeries("s", [run("a", "t1", 1), run("a", "t1", 2), run("a", "t1", 3), run("a", "t2", 4), run("b", "t1", 1)]);
    expect(summary).toMatchObject({ series: "s", runs: 5, consistent: true, firstRecordedAt: "2026-11-26T10:00:00.000Z" });
    expect(summary.rows.map((row) => `${row.arm}/${row.task}/${row.n}`)).toEqual(["a/t1/3", "a/t2/1", "a/gesamt/4", "b/t1/1", "b/gesamt/1"]);
    expect(summary.rows[0]!.metrics.wallMs).toEqual({ median: 200, mean: 200, min: 100, max: 300 });
    expect(summariseSeries("andere", [run("a", "t", 1)]).runs).toBe(0);
    expect(summariseSeries("s", [run("a", "t", 1)]).rows).toHaveLength(2);
  });

  it("flags a series that mixes protocol versions", () => {
    const mixed = run("a", "t", 2);
    mixed.input.protocolHash = "b".repeat(64);
    expect(summariseSeries("s", [run("a", "t", 1), mixed]).consistent).toBe(false);
  });
});
