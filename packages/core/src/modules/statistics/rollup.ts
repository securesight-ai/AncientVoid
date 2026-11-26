import {
  type GateWaitStatistics,
  type NormalizedEvent,
  type SessionAnomaly,
  type SessionEndReason,
  type SessionStatistics,
  STATISTICS_MIN_SAMPLE,
  type StatisticsDistribution,
  type Swarm,
  type SwarmTaskStatistics,
  type ToolStatistics,
  type TurnStatistics,
} from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/db.ts";
import { statisticsDistribution } from "./distribution.ts";
import { type GateWaitInterval, aggregateGateWaitStatistics, deriveGateWaitIntervals } from "./gate-wait.ts";
import { deriveRecoveryIntervals, type RecoveryInterval } from "./session-facts.ts";
import { type SessionFacts, deriveSessionFacts } from "./session-facts.ts";
import { aggregateSessionStatistics } from "./session-statistics.ts";
import { aggregateTurnStatistics } from "./turn-statistics.ts";
import { type SwarmTaskCounts, sumSwarmTaskCounts, swarmTaskCounts } from "./swarm-statistics.ts";
import { type ToolCallFact, deriveToolCallFacts, toolStatisticsOf } from "./tool-statistics.ts";

interface SessionRecordRef {
  id: string;
  adapter: string;
  model: string | null;
  lastSeq: number;
  /** T56.3: Schnitte — Quelle ist der SessionRecord, nie das Journal. */
  project: string;
  hostId: string;
  harness: string;
  createdAt: string;
}

/** T56.3: Schnitt der Leseseite — ISO-Zeitstempel grenzen über created_at ein. */
export interface StatisticsFilter {
  project?: string;
  hostId?: string;
  harness?: string;
  since?: string;
  until?: string;
}

/** Was der Rollup an Quellen braucht — Journal und Swarm-Record bleiben Wahrheit (K7). */
export interface RollupSource {
  records(): SessionRecordRef[];
  events(id: string): Promise<readonly NormalizedEvent[]>;
  swarms(): readonly Swarm[];
}

export interface RollupResult {
  sessionsUpdated: number;
  sessionsRemoved: number;
  swarmsUpdated: number;
}

/**
 * P56 T56.2: schreibt abgeleitete Statistik-Fakten in SQLite-Caches und macht
 * sie nachführbar — basis_last_seq bzw. basis_updated_at entscheiden, ob eine
 * Quelle neu abgeleitet wird. Alles ist per rebuild() aus den Quellen
 * rekonstruierbar; die Caches sind keine zweite Wahrheit.
 */
export class StatisticsRollup {
  private readonly db: HubDatabase;
  private readonly source: RollupSource;

  constructor(db: HubDatabase, source: RollupSource) {
    this.db = db;
    this.source = source;
  }

  /** Inkrementeller Lauf: nur veränderte Sessions/Swarms werden neu abgeleitet. */
  async run(): Promise<RollupResult> {
    const now = new Date().toISOString();
    const sessionBasis = this.db.prepare("SELECT basis_last_seq, project, created_at FROM session_stat_facts WHERE session_id = ?");
    let sessionsUpdated = 0;
    for (const record of this.source.records()) {
      const cached = sessionBasis.get(record.id) as { basis_last_seq: number; project: string; created_at: string } | undefined;
      // Zeilen ohne Dimensionen stammen von vor Migration 37 — einmal neu
      // ableiten, damit die Schnitte lückenlos sind (dann konvergiert es).
      if (cached !== undefined && cached.basis_last_seq >= record.lastSeq && cached.project !== "" && cached.created_at !== "") continue;
      const events = await this.source.events(record.id);
      this.writeSession(record, now, deriveSessionFacts(events, { sessionId: record.id, adapter: record.adapter, model: record.model }), deriveGateWaitIntervals(events), deriveToolCallFacts(events, { sessionId: record.id }), deriveRecoveryIntervals(events, record.id));
      sessionsUpdated++;
    }
    const swarmBasis = this.db.prepare("SELECT basis_updated_at, project, created_at FROM team_stat_facts WHERE team_id = ?");
    let swarmsUpdated = 0;
    for (const swarm of this.source.swarms()) {
      const cached = swarmBasis.get(swarm.id) as { basis_updated_at: string; project: string; created_at: string } | undefined;
      if (cached !== undefined && cached.basis_updated_at === swarm.updatedAt && cached.project !== "" && cached.created_at !== "") continue;
      this.writeSwarm(swarm, swarmTaskCounts(swarm), now);
      swarmsUpdated++;
    }
    const sessionsRemoved = this.prune();
    return { sessionsUpdated, sessionsRemoved, swarmsUpdated };
  }

  /** Vollständiger Neuaufbau aus den Quellen — deterministisch, gleiche Eingabe ⇒ gleiche Fakten. */
  async rebuild(): Promise<RollupResult> {
    this.db.exec("DELETE FROM session_stat_facts; DELETE FROM gate_wait_facts; DELETE FROM tool_stat_facts; DELETE FROM recovery_facts; DELETE FROM team_stat_facts;");
    return this.run();
  }

  private writeSession(record: SessionRecordRef, now: string, facts: SessionFacts | null, gates: readonly GateWaitInterval[], tools: readonly ToolCallFact[], recoveries: readonly RecoveryInterval[]): void {
    const sessionId = record.id;
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM session_stat_facts WHERE session_id = ?").run(sessionId);
      this.db.prepare(
        "INSERT INTO session_stat_facts (session_id, adapter, model, wall_ms, active_ms, turns, open_turn, end_reason, basis_last_seq, updated_at, project, host_id, harness, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(sessionId, record.adapter, record.model, facts?.wallMs ?? null, facts?.activeMs ?? 0, facts?.turns ?? 0, facts?.openTurn ? 1 : 0, facts?.endReason ?? null, record.lastSeq, now, record.project, record.hostId, record.harness, record.createdAt);
      this.db.prepare("DELETE FROM gate_wait_facts WHERE session_id = ?").run(sessionId);
      const gate = this.db.prepare("INSERT INTO gate_wait_facts (session_id, gate_id, tool_name, wait_ms, status) VALUES (?, ?, ?, ?, ?)");
      for (const g of gates) gate.run(sessionId, g.gateId, g.toolName, g.waitMs, g.status);
      this.db.prepare("DELETE FROM tool_stat_facts WHERE session_id = ?").run(sessionId);
      const tool = this.db.prepare("INSERT INTO tool_stat_facts (session_id, tool, calls, failed, ok, error_status_unknown, unanswered) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const entry of toolCounts(tools)) tool.run(sessionId, entry.tool ?? "", entry.calls, entry.failed, entry.ok, entry.errorStatusUnknown, entry.unanswered);
      this.db.prepare("DELETE FROM recovery_facts WHERE session_id = ?").run(sessionId);
      const recovery = this.db.prepare("INSERT INTO recovery_facts (session_id, interrupted_at, recovered_at, recovery_ms) VALUES (?, ?, ?, ?)");
      for (const r of recoveries) recovery.run(sessionId, r.interruptedAt, r.recoveredAt, r.recoveryMs);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private writeSwarm(swarm: Swarm, counts: SwarmTaskCounts, now: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO team_stat_facts (team_id, tasks, open_tasks, unknown_tasks, done_tasks, failed_tasks, tasks_with_dispatches, retry_tasks, dispatches, stale_dispatches, basis_updated_at, updated_at, project, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(swarm.id, counts.tasks, counts.openTasks, counts.unknownTasks, counts.doneTasks, counts.failedTasks, counts.tasksWithDispatches, counts.retryTasks, counts.dispatches, counts.staleDispatches, swarm.updatedAt, now, swarm.project, swarm.createdAt);
  }

  /** Räumt Zeilen weg, deren Quelle nicht mehr existiert — der Cache erfindet keine Sessions. */
  private prune(): number {
    const ids = this.source.records().map(r => r.id);
    if (ids.length === 0) {
      const before = (this.db.prepare("SELECT COUNT(*) AS n FROM session_stat_facts").get() as { n: number }).n;
      this.db.exec("DELETE FROM session_stat_facts; DELETE FROM gate_wait_facts; DELETE FROM tool_stat_facts; DELETE FROM recovery_facts;");
      return before;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const notIn = "NOT IN (" + placeholders + ")";
    const before = (this.db.prepare("SELECT COUNT(*) AS n FROM session_stat_facts WHERE session_id " + notIn).get(...ids) as { n: number }).n;
    if (before > 0) {
      for (const table of ["session_stat_facts", "gate_wait_facts", "tool_stat_facts", "recovery_facts"]) {
        this.db.prepare("DELETE FROM " + table + " WHERE session_id " + notIn).run(...ids);
      }
    }
    return before;
  }

  // — Leseseite: T56.3 liest nur diese Aggregate, nie die Journals direkt —

  /** Frischeste Fakten-Zeile — Rollup-Alter für die Seite (null: noch kein Lauf). */
  updatedAt(): string | null {
    const row = this.db.prepare("SELECT MAX(updated_at) AS newest FROM session_stat_facts").get() as { newest: string | null };
    return row.newest;
  }

  /** Verfügbare Schnittwerte für die Filterauswahl — aus dem Cache, nicht aus den Quellen. */
  sliceValues(): { projects: string[]; hosts: string[]; harnesses: string[] } {
    // SQL identifiers must come from the fixed column allowlist just below.
    const distinct = (column: string): string[] =>
      (this.db.prepare(`SELECT DISTINCT ${column} AS v FROM session_stat_facts WHERE ${column} != '' ORDER BY v`).all() as unknown as { v: string }[]).map(r => r.v);
    return { projects: distinct("project"), hosts: distinct("host_id"), harnesses: distinct("harness") };
  }

  sessionStatistics(filter: StatisticsFilter = {}): SessionStatistics[] {
    const rows = this.db.prepare(
      `SELECT session_id, adapter, model, wall_ms, active_ms, turns, open_turn, end_reason FROM session_stat_facts ${this.sessionWhere(filter)}`,
    ).all(...this.sessionParams(filter)) as unknown as {
      session_id: string; adapter: string; model: string | null; wall_ms: number | null; active_ms: number; turns: number; open_turn: number; end_reason: SessionEndReason | null;
    }[];
    return aggregateSessionStatistics(rows.map(r => ({
      sessionId: r.session_id,
      adapter: r.adapter,
      model: r.model,
      wallMs: r.wall_ms,
      activeMs: r.active_ms,
      turns: r.turns,
      openTurn: r.open_turn === 1,
      endReason: r.end_reason,
    })));
  }

  /** Zug-/Token-Statistik über den turn_metrics-Cache, geschnitten wie die Session-Fakten. */
  turnStatistics(filter: StatisticsFilter = {}): TurnStatistics[] {
    const rows = this.db.prepare(
      `SELECT t.session_id, t.turn, t.adapter, t.model, t.started_at, t.ended_at, t.duration_ms, t.tokens, t.tokens_source, t.cost_usd, t.events, t.tool_calls, t.outcome
       FROM turn_metrics t JOIN session_stat_facts f ON f.session_id = t.session_id ${this.sessionWhere(filter, "f")}`,
    ).all(...this.sessionParams(filter)) as unknown as {
      session_id: string; turn: number; adapter: string; model: string | null; started_at: string; ended_at: string;
      duration_ms: number; tokens: number | null; tokens_source: "native" | "estimated" | null; cost_usd: number | null;
      events: number; tool_calls: number; outcome: "ok" | "error";
    }[];
    return aggregateTurnStatistics(rows.map(r => ({
      sessionId: r.session_id,
      turn: r.turn,
      adapter: r.adapter,
      model: r.model,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationMs: r.duration_ms,
      tokens: r.tokens,
      tokensSource: r.tokens_source,
      costUsd: r.cost_usd,
      events: r.events,
      toolCalls: r.tool_calls,
      outcome: r.outcome,
    })));
  }

  gateWaitStatistics(filter: StatisticsFilter = {}): GateWaitStatistics | null {
    const rows = this.db.prepare(
      `SELECT gate_id, tool_name, wait_ms, status FROM gate_wait_facts WHERE session_id IN (SELECT session_id FROM session_stat_facts ${this.sessionWhere(filter)})`,
    ).all(...this.sessionParams(filter)) as unknown as { gate_id: string; tool_name: string | null; wait_ms: number | null; status: GateWaitInterval["status"] }[];
    if (rows.length === 0) return null;
    return aggregateGateWaitStatistics(rows.map(r => ({ gateId: r.gate_id, toolName: r.tool_name, waitMs: r.wait_ms, status: r.status })));
  }

  toolStatistics(filter: StatisticsFilter = {}): ToolStatistics[] {
    const rows = this.db.prepare(
      `SELECT tool, SUM(calls) AS calls, SUM(failed) AS failed, SUM(ok) AS ok, SUM(error_status_unknown) AS unknown, SUM(unanswered) AS unanswered
       FROM tool_stat_facts WHERE session_id IN (SELECT session_id FROM session_stat_facts ${this.sessionWhere(filter)}) GROUP BY tool ORDER BY tool`,
    ).all(...this.sessionParams(filter)) as unknown as { tool: string; calls: number; failed: number; ok: number; unknown: number; unanswered: number }[];
    return rows.map(r => toolStatisticsOf(r.tool === "" ? null : r.tool, { calls: r.calls, failed: r.failed, ok: r.ok, errorStatusUnknown: r.unknown, unanswered: r.unanswered }));
  }

  recoveryDistribution(filter: StatisticsFilter = {}): StatisticsDistribution {
    const rows = this.db.prepare(
      `SELECT recovery_ms FROM recovery_facts WHERE session_id IN (SELECT session_id FROM session_stat_facts ${this.sessionWhere(filter)})`,
    ).all(...this.sessionParams(filter)) as unknown as { recovery_ms: number | null }[];
    return statisticsDistribution(rows.map(r => r.recovery_ms));
  }

  /**
   * T56.4: Sessions über dem p95 ihrer Adapter-/Modell-Gruppe (Wallzeit oder
   * Zugzahl) — Klein-n-Gruppen melden keine Anomalien; das Gruppen-p95
   * schließt die Session selbst ein. Kandidaten für Runaway-Analyse, kein Urteil.
   */
  sessionAnomalies(filter: StatisticsFilter = {}): SessionAnomaly[] {
    const rows = this.db.prepare(
      `SELECT session_id, adapter, model, project, created_at, wall_ms, turns FROM session_stat_facts ${this.sessionWhere(filter)}`,
    ).all(...this.sessionParams(filter)) as unknown as {
      session_id: string; adapter: string; model: string | null; project: string; created_at: string; wall_ms: number | null; turns: number;
    }[];
    interface GroupP95 {
      p95Wall: number | null;
      p95Turns: number;
      small: boolean;
    }
    const groups = new Map<string, { adapter: string; model: string | null; rows: typeof rows }>();
    for (const r of rows) {
      const key = `${r.adapter}\u0000${r.model ?? ""}`;
      const group = groups.get(key) ?? { adapter: r.adapter, model: r.model, rows: [] as typeof rows };
      group.rows.push(r);
      groups.set(key, group);
    }
    const p95s = new Map<string, GroupP95>();
    for (const [key, group] of groups) {
      const wall = statisticsDistribution(group.rows.map(r => r.wall_ms));
      const turns = statisticsDistribution(group.rows.map(r => r.turns));
      p95s.set(key, { p95Wall: wall.p95, p95Turns: turns.p95 ?? 0, small: wall.n + wall.missing < STATISTICS_MIN_SAMPLE });
    }
    const anomalies: SessionAnomaly[] = [];
    for (const [key, group] of groups) {
      const p95 = p95s.get(key)!;
      if (p95.small) continue;
      for (const r of group.rows) {
        if ((r.wall_ms !== null && p95.p95Wall !== null && r.wall_ms > p95.p95Wall) || r.turns > p95.p95Turns) {
          anomalies.push({
            sessionId: r.session_id,
            adapter: r.adapter,
            model: r.model,
            project: r.project,
            createdAt: r.created_at,
            wallMs: r.wall_ms,
            wallP95: p95.p95Wall,
            turns: r.turns,
            turnsP95: p95.p95Turns,
          });
        }
      }
    }
    return anomalies.sort((a, b) => (b.wallMs ?? 0) - (a.wallMs ?? 0));
  }

  /**
   * Swarm-Zahlen folgen dem Projekt-/Zeitraum-Schnitt. Host und Harness sind
   * keine Swarm-Dimensionen (ein Swarm gehört zum Hub, nicht zu einem Harness) —
   * solche Filter wirken hier bewusst nicht.
   */  swarmTaskStatistics(filter: StatisticsFilter = {}): SwarmTaskStatistics | null {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.project !== undefined) {
      conditions.push("project = ?");
      params.push(filter.project);
    }
    if (filter.since !== undefined) {
      conditions.push("created_at >= ?");
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      conditions.push("created_at <= ?");
      params.push(filter.until);
    }
    const where = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
    const rows = this.db.prepare(
      `SELECT team_id, tasks, open_tasks, unknown_tasks, done_tasks, failed_tasks, tasks_with_dispatches, retry_tasks, dispatches, stale_dispatches FROM team_stat_facts${where}`,
    ).all(...params) as unknown as {
      team_id: string; tasks: number; open_tasks: number; unknown_tasks: number; done_tasks: number; failed_tasks: number;
      tasks_with_dispatches: number; retry_tasks: number; dispatches: number; stale_dispatches: number;
    }[];
    if (rows.length === 0) return null;
    return sumSwarmTaskCounts(rows.length, rows.map(r => ({
      tasks: r.tasks,
      openTasks: r.open_tasks,
      unknownTasks: r.unknown_tasks,
      doneTasks: r.done_tasks,
      failedTasks: r.failed_tasks,
      tasksWithDispatches: r.tasks_with_dispatches,
      retryTasks: r.retry_tasks,
      dispatches: r.dispatches,
      staleDispatches: r.stale_dispatches,
    })));
  }

  /** WHERE-Klausel über die Session-Dimensionen; alias für Joins auf die Fakten-Tabelle. */
  private sessionWhere(filter: StatisticsFilter, alias = ""): string {
    const column = (name: string): string => (alias === "" ? name : `${alias}.${name}`);
    const conditions: string[] = [];
    if (filter.project !== undefined) conditions.push(`${column("project")} = ?`);
    if (filter.hostId !== undefined) conditions.push(`${column("host_id")} = ?`);
    if (filter.harness !== undefined) conditions.push(`${column("harness")} = ?`);
    if (filter.since !== undefined) conditions.push(`${column("created_at")} >= ?`);
    if (filter.until !== undefined) conditions.push(`${column("created_at")} <= ?`);
    return conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  }

  private sessionParams(filter: StatisticsFilter): string[] {
    const params: string[] = [];
    if (filter.project !== undefined) params.push(filter.project);
    if (filter.hostId !== undefined) params.push(filter.hostId);
    if (filter.harness !== undefined) params.push(filter.harness);
    if (filter.since !== undefined) params.push(filter.since);
    if (filter.until !== undefined) params.push(filter.until);
    return params;
  }
}

/** Additive Zählung je Tool für eine Session (Cache-Zeile je Name, '' = unbelegt). */
function toolCounts(facts: readonly ToolCallFact[]): { tool: string | null; calls: number; failed: number; ok: number; errorStatusUnknown: number; unanswered: number }[] {
  const perTool = new Map<string, { tool: string | null; calls: number; failed: number; ok: number; errorStatusUnknown: number; unanswered: number }>();
  for (const fact of facts) {
    const key = fact.tool ?? "\u0000null";
    const entry = perTool.get(key) ?? { tool: fact.tool, calls: 0, failed: 0, ok: 0, errorStatusUnknown: 0, unanswered: 0 };
    entry.calls++;
    if (fact.result === "failed") entry.failed++;
    else if (fact.result === "ok") entry.ok++;
    else if (fact.result === "unknown") entry.errorStatusUnknown++;
    else entry.unanswered++;
    perTool.set(key, entry);
  }
  return [...perTool.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, entry]) => entry);
}
