import { z } from "zod";

/** P84 (ADR-0126): eine Quelle für PWA und Markdown-Report — die Zusammenfassung einer Serie. */

const stat = z.strictObject({ median: z.number(), mean: z.number(), min: z.number(), max: z.number() });
export type EvalStat = z.infer<typeof stat>;

export const EVAL_METRICS = [
  { id: "failure", label: "Fehlerquote", unit: "Anteil 0–1", digits: 2 },
  { id: "wallMs", label: "Wandzeit", unit: "ms", digits: 0 },
  { id: "inputTokens", label: "Input-Tokens", unit: "Tokens", digits: 0 },
  { id: "cacheTokens", label: "davon Cache-Tokens", unit: "Tokens", digits: 0 },
  { id: "outputTokens", label: "Output-Tokens", unit: "Tokens", digits: 0 },
  { id: "costUsd", label: "Kosten gesamt", unit: "USD", digits: 5 },
  { id: "cloudCostUsd", label: "Cloud", unit: "USD", digits: 5 },
  { id: "cacheCostUsd", label: "davon Cache", unit: "USD", digits: 5 },
  { id: "energyCostUsd", label: "Energie (P81)", unit: "USD", digits: 5 },
  { id: "energyKwh", label: "Energie (P81)", unit: "kWh", digits: 6 },
  { id: "toolErrors", label: "Werkzeugfehler", unit: "Anzahl", digits: 1 },
  { id: "turns", label: "Züge", unit: "Anzahl", digits: 1 },
] as const;
export type EvalMetricId = (typeof EVAL_METRICS)[number]["id"];

const metrics = z.strictObject(Object.fromEntries(EVAL_METRICS.map(({ id }) => [id, stat])) as Record<EvalMetricId, typeof stat>);

export const EvalSummaryRow = z.strictObject({
  arm: z.string(),
  /** Aufgaben-ID oder `gesamt` über alle Aufgaben des Arms. */
  task: z.string(),
  n: z.number().int().positive(),
  metrics,
});
export type EvalSummaryRow = z.infer<typeof EvalSummaryRow>;

const comparison = z.strictObject({
  kind: z.enum(["context", "skill", "hook", "guardrail", "rule"]),
  source: z.string(),
  reference: z.string(),
  candidate: z.string(),
  minimumEffect: z.number(),
  tasks: z.array(z.strictObject({
    task: z.string(),
    pairs: z.number().int().nonnegative(),
    status: z.enum(["improved", "regressed", "unchanged", "insufficient"]),
    reason: z.enum(["drift", "coverage", "unverified", "measured", "efficiency"]),
    checks: z.array(z.strictObject({
      id: z.enum(["acceptance", "lint", "typecheck", "runtime", "policy"]),
      reference: z.number().int().nonnegative(),
      candidate: z.number().int().nonnegative(),
      evidence: z.array(z.uuid()),
    })),
    effort: z.array(z.strictObject({
      id: z.enum(["wallMs", "totalMs", "tokens", "costUsd", "enhancerMs", "contextChars"]),
      reference: stat,
      candidate: stat,
      pairedDifference: stat,
    })).optional(),
  })),
});

export const EvalSeriesSummary = z.strictObject({
  series: z.string(),
  runs: z.number().int().nonnegative(),
  corpusHashes: z.array(z.string()),
  protocolHashes: z.array(z.string()),
  firstRecordedAt: z.iso.datetime().nullable(),
  lastRecordedAt: z.iso.datetime().nullable(),
  /** Mehr als ein Hash heißt: die Serie mischt Stände und ist nicht vergleichbar. */
  consistent: z.boolean(),
  rows: z.array(EvalSummaryRow),
  comparison: comparison.optional(),
});
export type EvalSeriesSummary = z.infer<typeof EvalSeriesSummary>;

export const EvalSeriesList = z.strictObject({
  series: z.array(z.strictObject({ series: z.string(), repo: z.string().optional(), runs: z.number().int().nonnegative(), lastRecordedAt: z.iso.datetime().nullable() })),
});
export type EvalSeriesList = z.infer<typeof EvalSeriesList>;

export interface EvalLaunch {
  series: string;
  preset: string;
  repo: string;
  startedAt: string;
  state: "running" | "finished" | "partial" | "failed" | "interrupted";
  interruptions?: { key: string; cause: "timeout" | "approval" | "infrastructure" }[];
}

export interface EvalLaunchList {
  presets: { id: string; label: string; repo: string }[];
  runs: EvalLaunch[];
}

const num = (value: number, digits: number): string => value.toFixed(digits);

/** Tabelle für PWA und Report: feste Dezimalpunkte, Einheiten im Kopf, damit sich beide nie unterscheiden. */
export function evaluationTable(summary: EvalSeriesSummary): { columns: string[]; rows: string[][] } {
  const columns = ["Arm", "Aufgabe", "n", ...EVAL_METRICS.map(({ label, unit }) => `${label} [${unit}] (Median; Mittel; Min–Max)`)];
  const rows = summary.rows.map((row) => [
    row.arm, row.task, String(row.n),
    ...EVAL_METRICS.map(({ id, digits }) => {
      const s = row.metrics[id];
      return `${num(s.median, digits)}; ${num(s.mean, digits)}; ${num(s.min, digits)}–${num(s.max, digits)}`;
    }),
  ]);
  return { columns, rows };
}

