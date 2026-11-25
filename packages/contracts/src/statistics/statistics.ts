import { z } from "zod";

/** P56 / ADR-0079: fehlende Messung ist keine Null; n zählt nur belegte Werte. */
export const STATISTICS_MIN_SAMPLE = 10;
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const quantile = z.number().nonnegative().nullable();

export const StatisticsDistribution = z.object({
  n: count,
  missing: count,
  p50: quantile,
  p90: quantile,
  p95: quantile,
  smallSample: z.boolean(),
}).strict().refine(d => {
  if (d.smallSample !== (d.n < STATISTICS_MIN_SAMPLE)) return false;
  if (d.n === 0) return d.p50 === null && d.p90 === null && d.p95 === null;
  return d.p50 !== null && d.p90 !== null && d.p95 !== null && d.p50 <= d.p90 && d.p90 <= d.p95;
}, "Quantile, Stichprobe und Klein-n-Kennzeichnung widersprechen sich.");
export type StatisticsDistribution = z.infer<typeof StatisticsDistribution>;

/** Belegte Zugzahlen, kein Session-Endurteil und kein Qualitätsranking. */
export const TurnStatistics = z.object({
  adapter: z.string().min(1),
  model: z.string().nullable(),
  turns: count.refine(n => n > 0),
  failedTurns: count,
  durationMs: StatisticsDistribution,
  tokens: StatisticsDistribution,
  estimatedTokenTurns: count,
}).strict().refine(g =>
  g.failedTurns <= g.turns && g.durationMs.n === g.turns && g.durationMs.missing === 0 &&
  g.tokens.n + g.tokens.missing === g.turns && g.estimatedTokenTurns <= g.tokens.n,
"Zugzahlen, Datenabdeckung oder Token-Herkunft widersprechen sich.");
export type TurnStatistics = z.infer<typeof TurnStatistics>;

/**
 * P56 T56.1b: belegte Session-Endgründe aus dem Journal — Klassifikation des
 * letzten terminalen Markers (`session.turn_end` bzw. `session.stopped`).
 * `stalled`/`context_exhausted` sind nicht belegt und bleiben unbekannt;
 * ob eine Session überhaupt beendet war, entscheidet die Rollup-Auswahl
 * (T56.2) anhand SessionRecord.status, nicht das Journal allein.
 */
export const SESSION_END_REASONS = ["completed", "error", "interrupted", "stopped"] as const;
export const SessionEndReason = z.enum(SESSION_END_REASONS);
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

/** Sessions je belegter Adapter-/Modell-ID; Wallzeit fehlt nur ohne jedes Event. */
export const SessionStatistics = z.object({
  adapter: z.string().min(1),
  model: z.string().nullable(),
  sessions: count.refine(n => n > 0),
  /** Sessions ohne terminalen Marker im Journal (kein Endgrund belegt). */
  openSessions: count,
  endReasons: z.object({
    completed: count,
    error: count,
    interrupted: count,
    stopped: count,
  }).strict(),
  wallMs: StatisticsDistribution,
  /** Summe beendeter Zug-Intervalle — immer belegt, 0 ist ein Wert. */
  activeMs: StatisticsDistribution,
  turnsPerSession: StatisticsDistribution,
}).strict().refine(g =>
  g.openSessions <= g.sessions &&
  g.endReasons.completed + g.endReasons.error + g.endReasons.interrupted + g.endReasons.stopped + g.openSessions === g.sessions &&
  g.wallMs.n + g.wallMs.missing === g.sessions &&
  g.activeMs.n === g.sessions && g.activeMs.missing === 0 &&
  g.turnsPerSession.n === g.sessions && g.turnsPerSession.missing === 0,
"Sessionzahlen oder Datenabdeckung widersprechen sich.");
export type SessionStatistics = z.infer<typeof SessionStatistics>;

/** P56 T56.1b: Wartezeiten zusammengehöriger Gates (Öffnen→Antworten). */
export const GateWaitStatistics = z.object({
  gates: count.refine(n => n > 0),
  answered: count,
  timedOut: count,
  /** Angefragt, nie beantwortet — kein Intervall raten. */
  open: count,
  /** Sofort erlaubt ohne Warteintervall (tool.auto_approved) — zählt nicht in waitMs. */
  autoApproved: count,
  waitMs: StatisticsDistribution,
}).strict().refine(g =>
  g.answered + g.timedOut + g.open + g.autoApproved === g.gates &&
  g.waitMs.n + g.waitMs.missing === g.answered + g.timedOut,
"Gate-Zahlen oder Wartezeit-Abdeckung widersprechen sich.");
export type GateWaitStatistics = z.infer<typeof GateWaitStatistics>;

/** P56 T56.1b: Tool-Nutzung je belegtem Namen; null = Name nicht belegt. */
export const ToolStatistics = z.object({
  tool: z.string().min(1).nullable(),
  calls: count.refine(n => n > 0),
  /** Aufrufe mit korreliertem tool_result. */
  results: count,
  failed: count,
  ok: count,
  /** Ergebnis korreliert, aber isError fehlt — weder Fehler noch Erfolg. */
  errorStatusUnknown: count,
  /** Kein korreliertes Ergebnis — kein Erfolg, nur getrennt gezählt. */
  unanswered: count,
  /** belegte Fehler / belegte Ergebnisse (failed + ok); Nenner 0 → null. */
  failureRate: z.number().min(0).max(1).nullable(),
}).strict().refine(t =>
  t.failed + t.ok + t.errorStatusUnknown === t.results &&
  t.results + t.unanswered === t.calls &&
  (t.failed + t.ok === 0 ? t.failureRate === null : t.failureRate === t.failed / (t.failed + t.ok)),
"Tool-Zahlen oder Fehlerquote widersprechen sich.");
export type ToolStatistics = z.infer<typeof ToolStatistics>;

/**
 * P56 T56.1b: Swarm-Fakten über alle Swarms. `done` ist worker_done und kein
 * bestandenes Gate (P40-Regel); eine Gate-Erfolgsquote ist nicht belegt.
 */
export const SwarmTaskStatistics = z.object({
  swarms: count.refine(n => n > 0),
  tasks: count,
  /** pending/ready/running — noch kein auswertbares Ende. */
  open: count,
  /** Status explizit unknown — eigener Ausweis, kein Raten. */
  unknown: count,
  done: count,
  failed: count,
  tasksWithDispatches: count,
  /** Höchste Dispatch-Generation > 1 (belegter Wiederholungsversuch). */
  retryTasks: count,
  retryRate: z.number().min(0).max(1).nullable(),
  dispatches: count,
  staleDispatches: count,
  /** done / (done + failed) — Worker-Ende-Quote, keine Gate-Erfolgsquote. */
  workerEndRate: z.number().min(0).max(1).nullable(),
}).strict().refine(t =>
  t.open + t.unknown + t.done + t.failed === t.tasks &&
  t.retryTasks <= t.tasksWithDispatches && t.tasksWithDispatches <= t.tasks &&
  t.staleDispatches <= t.dispatches &&
  (t.tasksWithDispatches === 0 ? t.retryRate === null : t.retryRate === t.retryTasks / t.tasksWithDispatches) &&
  (t.done + t.failed === 0 ? t.workerEndRate === null : t.workerEndRate === t.done / (t.done + t.failed)),
"Swarm-Zahlen oder Quoten widersprechen sich.");
export type SwarmTaskStatistics = z.infer<typeof SwarmTaskStatistics>;

/**
 * P56 T56.4: eine Session, die in Wallzeit oder Zugzahl über dem p95 ihrer
 * Adapter-/Modell-Gruppe liegt — Kandidat für Runaway-Analyse, kein Urteil.
 * Klein-n-Gruppen (n < STATISTICS_MIN_SAMPLE) melden keine Anomalien; das
 * Gruppen-p95 schließt die Session selbst ein (deterministisch, dokumentiert).
 * Tokens/Fehler je Session sind nicht belegt und bleiben Kriterien offen.
 */
export const SessionAnomaly = z.object({
  sessionId: z.string().min(1),
  adapter: z.string().min(1),
  model: z.string().nullable(),
  project: z.string().min(1),
  createdAt: z.string().min(1),
  wallMs: quantile,
  wallP95: quantile,
  turns: count,
  /** Züge sind immer belegt — das p95 dazu ebenfalls. */
  turnsP95: z.number().nonnegative(),
}).strict().refine(a =>
  (a.wallMs !== null && a.wallP95 !== null && a.wallMs > a.wallP95) || a.turns > a.turnsP95,
"Anomalie ohne über dem Gruppen-p95 liegendes belegtes Kriterium.");
export type SessionAnomaly = z.infer<typeof SessionAnomaly>;

/**
 * P56 T56.3: Lesevertrag der Statistik-Seite. Alle Aggregate stammen aus dem
 * Rollup-Cache (nie direkt aus Journals); `filter` ist der wirksame Schnitt,
 * `slices` die belegten Werte der Schnitt-Dimensionen. `updatedAt` ist das
 * Rollup-Alter (frischeste Fakten-Zeile), kein "Jetzt".
 */
export const StatisticsReport = z.object({
  updatedAt: z.string().nullable(),
  filter: z.object({
    project: z.string().nullable(),
    hostId: z.string().nullable(),
    harness: z.string().nullable(),
    since: z.string().nullable(),
    until: z.string().nullable(),
  }).strict(),
  slices: z.object({
    projects: z.array(z.string()),
    hosts: z.array(z.string()),
    harnesses: z.array(z.string()),
  }).strict(),
  sessions: z.array(SessionStatistics),
  turns: z.array(TurnStatistics),
  gateWait: GateWaitStatistics.nullable(),
  tools: z.array(ToolStatistics),
  recovery: StatisticsDistribution,
  swarm: SwarmTaskStatistics.nullable(),
  /** T56.4: über dem Gruppen-p95 liegende Sessions (Klein-n-Gruppen melden keine). */
  anomalies: z.array(SessionAnomaly),
}).strict();
export type StatisticsReport = z.infer<typeof StatisticsReport>;
