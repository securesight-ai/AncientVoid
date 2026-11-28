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
    failure: Number(!(input.acceptance && input.lint && input.typecheck && phases.every((phase) => phase.turnErrors === 0))),
    wallMs: input.phases.reduce((total, phase) => total + phase.wallMs, 0),
    inputTokens: sum((phase) => phase.inputTokens),
    cacheTokens: sum((phase) => phase.cacheInputTokens),
    outputTokens: sum((phase) => phase.outputTokens),
    costUsd: sum((phase) => phase.costUsd),
    cloudCostUsd: sum((phase, index) => (cloud(index) ? phase.costUsd : 0)),
    cacheCostUsd: sum((phase, index) => {
      const billing = input.phases[index]?.billing;
      return billing?.kind === "cloud" ? phase.cacheInputTokens * (billing.cacheInputUsdPerMillion ?? billing.inputUsdPerMillion) / 1_000_000 : 0;
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

type Comparison = NonNullable<EvalSeriesSummary["comparison"]>;
type Task = Comparison["tasks"][number];
type Check = Task["checks"][number];

const checkRun: Record<Check["id"], (run: EvalResult) => boolean | undefined> = {
  acceptance: ({ input }) => input.acceptance,
  lint: ({ input }) => input.lint,
  typecheck: ({ input }) => input.typecheck,
  runtime: ({ phases }) => phases.every((phase) => phase.turnErrors === 0),
  policy: ({ input }) => input.comparison?.policyPassed,
};
type Effort = NonNullable<Task["effort"]>[number];
const effortValue: Record<Effort["id"], (run: EvalResult) => number | undefined> = {
  wallMs: ({ input }) => input.phases.reduce((sum, phase) => sum + phase.wallMs, 0),
  tokens: ({ phases }) => phases.reduce((sum, phase) => sum + phase.inputTokens + phase.outputTokens, 0),
  costUsd: ({ phases }) => phases.reduce((sum, phase) => sum + phase.costUsd, 0),
  enhancerMs: ({ input }) => input.comparison?.enhancer?.wallMs,
  contextChars: ({ input }) => input.comparison?.enhancer?.contextChars,
};

function compareTask(task: string, runs: EvalResult[], consistent: boolean, comparison: Comparison, expected?: number): Task {
  const reference = runs.filter(({ input }) => input.arm === "reference");
  const candidate = runs.filter(({ input }) => input.arm === "candidate");
  const candidates = new Map(candidate.map((run) => [run.input.repetition, run]));
  const pairs = reference.flatMap((baseline) => {
    const changed = candidates.get(baseline.input.repetition);
    return changed ? [{ baseline, changed }] : [];
  });
  const comparableEnvironment = (run: EvalResult) => JSON.stringify({
    rules: comparison.kind === "rule" ? undefined : run.input.rulesHash,
    skills: comparison.kind === "skill" ? undefined : run.input.skillHash,
    phases: run.phases.map(({ adapter, adapterVersion, model }, index) => [
      adapter, adapterVersion, model, run.input.phases[index]?.harnessVersion, run.input.phases[index]?.modelFingerprint,
    ]),
  });
  const drift = !consistent || new Set(runs.map(comparableEnvironment)).size > 1;
  const enoughPairs = expected === undefined ? pairs.length >= 5 :
    pairs.length === expected && pairs.every(({ baseline }) => baseline.input.repetition <= expected);
  const complete = enoughPairs && pairs.length === reference.length && pairs.length === candidate.length &&
    pairs.length === new Set(reference.map(({ input }) => input.repetition)).size && pairs.length === candidates.size;
  const unverified = runs.some(({ input }) => !input.comparison?.applied ||
    ((comparison.kind === "guardrail" || comparison.kind === "rule") && input.comparison.policyPassed === undefined));
  const checks = (Object.keys(checkRun) as Check["id"][]).flatMap((id) => {
    const evaluate = checkRun[id];
    if (pairs.length === 0 || pairs.some(({ baseline, changed }) => evaluate(baseline) === undefined || evaluate(changed) === undefined)) return [];
    return [{
      id,
      reference: pairs.filter(({ baseline }) => evaluate(baseline)).length,
      candidate: pairs.filter(({ changed }) => evaluate(changed)).length,
      evidence: pairs.flatMap(({ baseline, changed }) => {
        const before = evaluate(baseline);
        const after = evaluate(changed);
        return before === after ? [] : [(after ? baseline : changed).input.phases.at(-1)!.sessionId];
      }),
    }];
  });
  const effort = (Object.keys(effortValue) as Effort["id"][]).flatMap((id) => {
    const evaluate = effortValue[id];
    const measurements = pairs.flatMap(({ baseline, changed }) => {
      const before = evaluate(baseline);
      const after = evaluate(changed);
      return before === undefined || after === undefined ? [] : [{ before, after }];
    });
    if (pairs.length === 0 || measurements.length !== pairs.length) return [];
    return [{
      id,
      reference: stat(measurements.map(({ before }) => before)),
      candidate: stat(measurements.map(({ after }) => after)),
      pairedDifference: stat(measurements.map(({ before, after }) => after - before)),
    }];
  });
  const result = { task, pairs: pairs.length, checks, effort };
  if (drift || unverified || !complete) {
    return { ...result, status: "insufficient", reason: drift ? "drift" : unverified ? "unverified" : "coverage" };
  }
  const regressed = checks.some((check) => check.candidate < check.reference);
  const improved = checks.some((check) => (check.candidate - check.reference) / pairs.length >= comparison.minimumEffect);
  return { ...result, status: regressed ? "regressed" : improved ? "improved" : "unchanged", reason: "measured" };
}

function compareRuns(runs: EvalResult[], consistent: boolean): Comparison | undefined {
  const metadata = runs[0]?.input.comparison;
  if (!metadata) return undefined;
  const { kind, source, reference, candidate, minimumEffect } = metadata;
  const comparison: Comparison = { kind, source, reference, candidate, minimumEffect, tasks: [] };
  const sameChange = runs.every(({ input }) => {
    const meta = input.comparison;
    return meta?.kind === kind && meta.source === source && meta.reference === reference &&
      meta.candidate === candidate && meta.minimumEffect === minimumEffect &&
      JSON.stringify(meta.expected) === JSON.stringify(metadata.expected);
  });
  const actualTasks = runs.map(({ input }) => input.task);
  const expectedTasks = metadata.expected?.tasks;
  const tasks = [...new Set([...(expectedTasks ?? []), ...actualTasks])].sort();
  const knownTasks = !expectedTasks || actualTasks.every((task) => expectedTasks.includes(task));
  comparison.tasks = tasks.map((task) => compareTask(task, runs.filter(({ input }) => input.task === task),
    consistent && sameChange && knownTasks, comparison, metadata.expected?.repetitions));
  return comparison;
}

/** Fasst die erfassten Läufe einer Serie je Arm und Aufgabe (plus `gesamt`) zusammen. */
export function summariseSeries(series: string, results: readonly EvalResult[], repo?: string): EvalSeriesSummary {
  const mine = results.filter((result) => result.input.series === series && result.input.comparison?.repo === repo);
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
  const consistent = corpusHashes.length <= 1 && protocolHashes.length <= 1;
  const comparison = compareRuns(mine, consistent);
  return {
    series, runs: mine.length, corpusHashes, protocolHashes,
    firstRecordedAt: recorded[0] ?? null, lastRecordedAt: recorded.at(-1) ?? null,
    consistent, rows, ...(comparison && { comparison }),
  };
}
