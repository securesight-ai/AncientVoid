import type { EvalMetricId, EvalResult, EvalSeriesSummary, EvalStat, EvalSummaryRow } from "@ancientvoid/contracts";
import { EVAL_METRICS } from "@ancientvoid/contracts";

function stat(values: readonly number[]): EvalStat {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
  return { median: mid, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, min: sorted[0]!, max: sorted.at(-1)! };
}

/** Rohwerte eines Laufs — dieselben Definitionen wie der Report, nur an einer Stelle. */
export function evalRunValues({ input, phases }: EvalResult): Record<EvalMetricId, number> {
  const sum = (pick: (phase: EvalResult["phases"][number], index: number) => number) => phases.reduce((total, phase, index) => total + pick(phase, index), 0);
  const cloud = (index: number) => input.phases[index]?.billing.kind === "cloud";
  return {
    failure: Number(input.outcome !== "completed" || !(input.acceptance && input.lint && input.typecheck && phases.every((phase) => phase.turnErrors === 0))),
    wallMs: input.phases.reduce((total, phase) => total + phase.wallMs, 0),
    inputTokens: sum((phase) => phase.inputTokens),
    cacheTokens: sum((phase) => phase.cacheInputTokens + (phase.cacheWriteInputTokens ?? 0)),
    outputTokens: sum((phase) => phase.outputTokens),
    costUsd: sum((phase) => phase.costUsd),
    cloudCostUsd: sum((phase, index) => (cloud(index) ? phase.costUsd : 0)),
    // ADR-0127: Lesen und Schreiben getrennt zu ihrem Preis (Schreiben ohne Angabe = Inputpreis).
    cacheCostUsd: sum((phase, index) => {
      const billing = input.phases[index]?.billing;
      if (billing?.kind !== "cloud") return 0;
      return (phase.cacheInputTokens * (billing.cacheInputUsdPerMillion ?? billing.inputUsdPerMillion) +
        (phase.cacheWriteInputTokens ?? 0) * (billing.cacheWriteUsdPerMillion ?? billing.inputUsdPerMillion)) / 1_000_000;
    }),
    energyCostUsd: sum((phase, index) => (cloud(index) ? 0 : phase.costUsd)),
    energyKwh: sum((_phase, index) => {
      const billing = input.phases[index]?.billing;
      return billing?.kind === "local" ? billing.kwh : 0;
    }),
    toolErrors: sum((phase) => phase.toolErrors),
    turns: sum((phase) => phase.turns),
  };
}

const rowOf = (arm: string, task: string, results: readonly EvalResult[]): EvalSummaryRow => {
  const values = results.map(evalRunValues);
  return {
    arm, task, n: results.length,
    metrics: Object.fromEntries(EVAL_METRICS.map(({ id }) => [id, stat(values.map((value) => value[id]))])) as EvalSummaryRow["metrics"],
  };
};

/** Fasst die erfassten Läufe einer Serie je Arm und Aufgabe (plus `gesamt`) zusammen. */
export function summariseSeries(series: string, results: readonly EvalResult[]): EvalSeriesSummary {
  const mine = results.filter((result) => result.input.series === series);
  const arms = [...new Set(mine.map((result) => result.input.arm))].sort();
  const rows: EvalSummaryRow[] = [];
  for (const arm of arms) {
    const ofArm = mine.filter((result) => result.input.arm === arm);
    for (const task of [...new Set(ofArm.map((result) => result.input.task))].sort()) {
      rows.push(rowOf(arm, task, ofArm.filter((result) => result.input.task === task)));
    }
    rows.push(rowOf(arm, "gesamt", ofArm));
  }
  const recorded = mine.map((result) => result.recordedAt).sort();
  const corpusHashes = [...new Set(mine.map((result) => result.input.corpusHash))].sort();
  const protocolHashes = [...new Set(mine.map((result) => result.input.protocolHash))].sort();
  return {
    series, runs: mine.length, corpusHashes, protocolHashes,
    firstRecordedAt: recorded[0] ?? null, lastRecordedAt: recorded.at(-1) ?? null,
    consistent: corpusHashes.length <= 1 && protocolHashes.length <= 1, rows,
  };
}
