import type { TurnMetric, RunEstimate } from "@ancientvoid/contracts";
import { MIN_TURNS_FOR_ESTIMATE } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/db.ts";
import { estimateRun } from "./estimate.ts";

interface Row {
  session_id: string;
  turn: number;
  adapter: string;
  model: string | null;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  tokens: number | null;
  tokens_source: "native" | "estimated" | null;
  cost_usd: number | null;
  events: number;
  tool_calls: number;
  outcome: "ok" | "error";
}

const toMetric = (r: Row): TurnMetric => ({
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
});

/** SQLite cache of turn measurements; the JSONL stays the source (K7), see `deriveTurnMetrics`. */
export class TurnMetricStore {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  /** Replaces a session's rows (idempotent: same events → same rows). */
  replaceSession(sessionId: string, turns: readonly TurnMetric[]): void {
    this.db.prepare("DELETE FROM turn_metrics WHERE session_id = ?").run(sessionId);
    const insert = this.db.prepare(
      "INSERT INTO turn_metrics (session_id, turn, adapter, model, started_at, ended_at, duration_ms, tokens, tokens_source, cost_usd, events, tool_calls, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const t of turns) {
      insert.run(t.sessionId, t.turn, t.adapter, t.model, t.startedAt, t.endedAt, t.durationMs, t.tokens, t.tokensSource, t.costUsd, t.events, t.toolCalls, t.outcome);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.db.prepare("SELECT 1 AS x FROM turn_metrics WHERE session_id = ? LIMIT 1").get(sessionId) !== undefined;
  }

  listBySession(sessionId: string): TurnMetric[] {
    return (this.db.prepare("SELECT * FROM turn_metrics WHERE session_id = ? ORDER BY turn").all(sessionId) as unknown as Row[]).map(toMetric);
  }

  /**
   * The newest comparable turns, most specific first: this session's own turns (same task, same rhythm),
   * then same adapter+model, else the adapter alone. Each step needs enough turns of its own (R9.7).
   */
  estimate(adapter: string, model: string | null, sessionId?: string): RunEstimate {
    // BUG-0167: Median/Zahl der eigenen Züge immer mitgeben — der Client
    // rechnete sie aus seinem gekappten Ereignisfenster und verlor sie beim Reload.
    const own = sessionId
      ? this.listBySession(sessionId).filter((t) => t.outcome === "ok" && t.durationMs > 0).map((t) => t.durationMs).sort((a, b) => a - b)
      : null;
    const ownMedian = own && own.length >= 2 ? Math.round((own[Math.floor((own.length - 1) / 2)]! + own[Math.floor(own.length / 2)]!) / 2) : null;
    const ownFields = own ? { sessionTurns: own.length, sessionMedianMs: ownMedian } : {};
    if (sessionId) {
      const sessionEstimate = estimateRun(this.listBySession(sessionId), "session");
      if (sessionEstimate.state === "ok") return { ...sessionEstimate, ...ownFields };
    }
    if (model) {
      const rows = this.db
        .prepare("SELECT * FROM turn_metrics WHERE adapter = ? AND model = ? ORDER BY ended_at DESC LIMIT 200")
        .all(adapter, model) as unknown as Row[];
      const byModel = estimateRun(rows.map(toMetric), "model");
      if (byModel.state === "ok") return { ...byModel, ...ownFields };
    }
    const rows = this.db.prepare("SELECT * FROM turn_metrics WHERE adapter = ? ORDER BY ended_at DESC LIMIT 200").all(adapter) as unknown as Row[];
    return { ...estimateRun(rows.map(toMetric), "adapter"), ...ownFields };
  }

  /** Per adapter+model: counts and typical duration, for the status/report views. */
  summary(): { adapter: string; model: string | null; turns: number; medianMs: number | null }[] {
    const rows = this.db.prepare("SELECT adapter, model, duration_ms FROM turn_metrics WHERE outcome = 'ok' ORDER BY adapter, model, duration_ms").all() as unknown as {
      adapter: string;
      model: string | null;
      duration_ms: number;
    }[];
    const groups = new Map<string, { adapter: string; model: string | null; d: number[] }>();
    for (const r of rows) {
      const key = `${r.adapter}\u0000${r.model ?? ""}`;
      const g = groups.get(key) ?? { adapter: r.adapter, model: r.model, d: [] };
      g.d.push(r.duration_ms);
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({ adapter: g.adapter, model: g.model, turns: g.d.length, medianMs: g.d.length >= MIN_TURNS_FOR_ESTIMATE ? g.d[Math.floor((g.d.length - 1) / 2)]! : null }));
  }
}
