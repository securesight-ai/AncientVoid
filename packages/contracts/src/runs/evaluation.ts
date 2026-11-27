import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const label = z.string().min(1).max(200);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative();

export const EvalCloudPrice = z.strictObject({
  kind: z.literal("cloud"),
  date: z.iso.date(),
  source: z.url().max(300),
  inputUsdPerMillion: z.number().positive(),
  cacheInputUsdPerMillion: z.number().positive().optional(),
  /** ADR-0127: Preis für ins Cache geschriebene Tokens (z. B. 0 bei z.ai,
   * 1,25 × Input bei Anthropic). Fehlt er, wird Schreiben zum Inputpreis gerechnet. */
  cacheWriteUsdPerMillion: z.number().nonnegative().optional(),
  outputUsdPerMillion: z.number().positive(),
});

export const EvalEnergy = z.strictObject({
  kind: z.literal("local"),
  date: z.iso.date(),
  host: label,
  source: z.literal("p81:power:components"),
  kwh: z.number().positive(),
  usdPerKwh: z.number().positive(),
  eurPerKwh: z.number().positive().optional(),
  usdPerEur: z.number().positive().optional(),
  fxDate: z.iso.date().optional(),
});

const phase = z.strictObject({
  sessionId: z.uuid(),
  phase: z.enum(["plan", "build"]),
  harnessVersion: label,
  modelFingerprint: label,
  wallMs: z.number().positive(),
  billing: z.discriminatedUnion("kind", [EvalCloudPrice, EvalEnergy]),
});

export const EvalOutcome = z.enum(["completed", "timeout", "approval"]);
export type EvalOutcome = z.infer<typeof EvalOutcome>;

export const EvalRunInput = z.strictObject({
  series: id,
  arm: id,
  task: id,
  repetition: z.number().int().positive(),
  attempt: z.number().int().positive().default(1),
  corpusHash: hash,
  protocolHash: hash,
  rulesHash: hash,
  skills: z.boolean(),
  skillHash: hash.nullable(),
  baseline: count,
  acceptance: z.boolean(),
  lint: z.boolean(),
  typecheck: z.boolean(),
  /** ADR-0128: Zeitlimit und offene Rückfrage sind Ergebnisse (keine Lücke).
   * `approval` = Abbruch auf unbeantwortete Rückfrage, `timeout` = Zeitlimit. */
  outcome: EvalOutcome.default("completed"),
  phases: z.array(phase).min(1).max(2),
}).refine((run) => {
  const phases = run.phases;
  return (run.outcome === "completed" ? phases.at(-1)?.phase === "build" : phases.at(-1) !== undefined) &&
    (phases.length === 1 || (phases[0]?.phase === "plan" && phases[0].sessionId !== phases[1]?.sessionId)) &&
    run.skills === (run.skillHash !== null);
}, "Expected build, or distinct plan and build phases, with a hash for enabled skills; aborted runs may end on the plan phase");

export type EvalRunInput = z.infer<typeof EvalRunInput>;

export const EvalResult = z.strictObject({
  input: EvalRunInput,
  recordedAt: z.iso.datetime(),
  phases: z.array(z.strictObject({
    adapter: label,
    adapterVersion: label,
    model: label,
    inputTokens: count,
    cacheInputTokens: count,
    /** ADR-0127: Cache-Schreib-Tokens. Fehlt das Feld (alte Datensätze),
     * steckt der Schreibanteil noch in `cacheInputTokens` — Parse ergänzt 0. */
    cacheWriteInputTokens: count.default(0),
    outputTokens: count,
    /** ADR-0128: abgebrochene Läufe dürfen 0 Züge und 0 Kosten haben. */
    costUsd: z.number().nonnegative(),
    turnErrors: count,
    toolErrors: count,
    turns: z.number().int().nonnegative(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
  })).min(1).max(2),
}).refine((result) => result.input.outcome !== "completed" ||
  result.phases.every((entry) => entry.turns > 0 && entry.costUsd > 0),
"Completed runs require positive turns and cost per phase");
export type EvalResult = z.infer<typeof EvalResult>;

export const EVAL_COMPLETE_EVENT = "evaluation.completed";
