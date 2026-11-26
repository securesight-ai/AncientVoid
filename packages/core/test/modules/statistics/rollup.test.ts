import { describe, expect, it } from "vitest";
import { NormalizedEvent, Swarm } from "@ancientvoid/contracts";
import { HubDatabase } from "../../../src/platform/db.ts";
import {
  StatisticsRollup,
  aggregateSessionStatistics,
  deriveSessionFacts,
  type RollupSource,
} from "../../../src/modules/statistics/index.ts";

const T0 = Date.parse("2026-11-17T10:00:00.000Z");
const event = (seq: number, ms: number, patch: Record<string, unknown> = {}) => NormalizedEvent.parse({
  seq, ts: new Date(T0 + ms).toISOString(),
  sessionId: "s1", type: "system", summary: "fixture", payload: {}, ...patch,
});

/** Journal einer Session mit Zug, Gate, Tool, Interrupt und Recovery. */
const journal = (sessionId: string): NormalizedEvent[] => [
  event(1, 0, { sessionId, type: "user" }),
  event(2, 100, { sessionId, type: "tool_use", payload: { id: "t1", name: "Bash" } }),
  event(3, 200, { sessionId, type: "tool_result", payload: { toolUseId: "t1", isError: true } }),
  event(4, 300, { sessionId, type: "gate", payload: { kind: "tool.permission_requested", approvalId: "a1", toolName: "Bash" } }),
  event(5, 1300, { sessionId, type: "gate", payload: { kind: "tool.permission_answered", approvalId: "a1", behavior: "allow", status: "answered" } }),
  event(6, 1400, { sessionId, payload: { kind: "session.turn_end", code: 0 } }),
  event(7, 1500, { sessionId, payload: { kind: "session.interrupted", reason: "hub_restart" } }),
  event(8, 1600, { sessionId, payload: { kind: "session.turn_end", code: null, reason: "interrupted" } }),
  event(9, 2000, { sessionId, type: "user" }),
  event(10, 3000, { sessionId, payload: { kind: "session.turn_end", code: 0 } }),
];

const swarm = (id: string, updatedAt: string, status: Swarm["status"] = "done"): Swarm => Swarm.parse({
  id, title: "T", goal: "G", project: "p",
  frame: { adapters: ["dummy"], coordinatorAdapter: null },
  planSource: "given", status,
  tasks: [{ id: "T1", title: "t", prompt: "p", adapter: "dummy", model: null, dependsOn: [], status: "done", dispatches: [{ id: "d1", generation: 1, sessionId: "s1", adapter: "dummy", model: null, startedAt: updatedAt, endedAt: null, status: "done", note: null }], result: null }],
  gates: [], deliveries: [], createdAt: updatedAt, updatedAt,
});

/** T56.3: Quellen-Referenz mit Schnitt-Dimensionen. */
const ref = (id: string, lastSeq: number, dims: { adapter?: string; model?: string | null; project?: string; hostId?: string; harness?: string; createdAt?: string } = {}) => ({
  id,
  adapter: dims.adapter ?? "codex",
  model: dims.model !== undefined ? dims.model : "m1",
  lastSeq,
  project: dims.project ?? "/repo/p",
  hostId: dims.hostId ?? "host-a",
  harness: dims.harness ?? "cli",
  createdAt: dims.createdAt ?? "2026-11-17T09:00:00.000Z",
});

const openDb = () => new HubDatabase(":memory:");

/** Eine Zug-Messung in den turn_metrics-Cache schreiben (Quelle bleibt das Journal). */
function seedTurn(db: HubDatabase, sessionId: string, turn: number, patch: { adapter?: string; model?: string | null; tokens?: number | null; tokensSource?: "native" | "estimated" | null; outcome?: "ok" | "error"; durationMs?: number } = {}): void {
  db.prepare(
    "INSERT INTO turn_metrics (session_id, turn, adapter, model, started_at, ended_at, duration_ms, tokens, tokens_source, cost_usd, events, tool_calls, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    sessionId,
    turn,
    patch.adapter ?? "codex",
    patch.model !== undefined ? patch.model : "m1",
    new Date(T0 + turn * 1000).toISOString(),
    new Date(T0 + turn * 1000 + (patch.durationMs ?? 800)).toISOString(),
    patch.durationMs ?? 800,
    patch.tokens !== undefined ? patch.tokens : 120,
    patch.tokensSource !== undefined ? patch.tokensSource : "native",
    null,
    2,
    0,
    patch.outcome ?? "ok",
  );
}

describe("P56 T56.2 Statistik-Rollup", () => {
  it("schreibt Fakten in den Cache und liefert dieselben Aggregate wie die direkte Ableitung (AC-P56-2)", async () => {
    const db = new HubDatabase(":memory:");
    const events = journal("s1");
    const rollup = new StatisticsRollup(db, {
      records: () => [ref("s1", events.length)],
      events: async () => events,
      swarms: () => [swarm("team1", "2026-11-17T10:00:00.000Z")],
    });
    const result = await rollup.run();
    expect(result).toEqual({ sessionsUpdated: 1, sessionsRemoved: 0, swarmsUpdated: 1 });

    const direct = aggregateSessionStatistics([deriveSessionFacts(events, { sessionId: "s1", adapter: "codex", model: "m1" })!]);
    expect(rollup.sessionStatistics()).toEqual(direct);
    expect(rollup.gateWaitStatistics()).toMatchObject({ gates: 1, answered: 1, waitMs: { n: 1, p50: 1000 } });
    expect(rollup.toolStatistics()).toEqual([
      { tool: "Bash", calls: 1, results: 1, failed: 1, ok: 0, errorStatusUnknown: 0, unanswered: 0, failureRate: 1 },
    ]);
    expect(rollup.recoveryDistribution()).toMatchObject({ n: 1, missing: 0, p50: 1500 });
    expect(rollup.swarmTaskStatistics()).toMatchObject({ swarms: 1, tasks: 1, done: 1, workerEndRate: 1 });
    db.close();
  });

  it("führt nur veränderte Quellen nach und räumt weggefallene Sessions ab", async () => {
    const db = new HubDatabase(":memory:");
    let s1 = journal("s1");
    const s2 = journal("s2");
    const source: RollupSource = {
      records: () => [
        ref("s1", s1.length, { model: null }),
        ref("s2", s2.length, { model: null }),
      ],
      events: async id => (id === "s1" ? s1 : s2),
      swarms: () => [],
    };
    const rollup = new StatisticsRollup(db, source);
    expect(await rollup.run()).toMatchObject({ sessionsUpdated: 2 });

    // Nichts verändert: kein Update.
    expect(await rollup.run()).toEqual({ sessionsUpdated: 0, sessionsRemoved: 0, swarmsUpdated: 0 });

    // Journal wächst (lastSeq steigt): genau diese Session wird neu abgeleitet.
    s1 = [...s1, event(11, 4000, { sessionId: "s1", type: "user" }), event(12, 4500, { sessionId: "s1", payload: { kind: "session.turn_end", code: 0 } })];
    const changed = source.records().map(r => r.id === "s1" ? { ...r, lastSeq: s1.length } : r);
    (source as { records: () => typeof changed }).records = () => changed;
    expect(await rollup.run()).toEqual({ sessionsUpdated: 1, sessionsRemoved: 0, swarmsUpdated: 0 });
    expect(rollup.sessionStatistics()[0]).toMatchObject({ sessions: 2, turnsPerSession: { p50: 3.5 } });

    // Quelle verschwindet: Cache-Zeilen werden entfernt, nicht erfunden.
    const only2 = changed.filter(r => r.id === "s2");
    (source as { records: () => typeof only2 }).records = () => only2;
    expect(await rollup.run()).toEqual({ sessionsUpdated: 0, sessionsRemoved: 1, swarmsUpdated: 0 });
    expect(rollup.sessionStatistics()[0]).toMatchObject({ sessions: 1 });
    db.close();
  });

  it("ist deterministisch: rebuild liefert dieselben Zahlen wie der inkrementelle Lauf", async () => {
    const db = new HubDatabase(":memory:");
    const events = journal("s1");
    const rollup = new StatisticsRollup(db, {
      records: () => [ref("s1", events.length, { model: null })],
      events: async () => events,
      swarms: () => [swarm("team1", "2026-11-17T10:00:00.000Z")],
    });
    await rollup.run();
    const before = [rollup.sessionStatistics(), rollup.toolStatistics(), rollup.recoveryDistribution(), rollup.swarmTaskStatistics()];
    await rollup.rebuild();
    expect([rollup.sessionStatistics(), rollup.toolStatistics(), rollup.recoveryDistribution(), rollup.swarmTaskStatistics()]).toEqual(before);
    expect(rollup.gateWaitStatistics()).not.toBeNull();
    db.close();
  });

  it("bleibt ehrlich ohne jede Quelle: leere Leseseite statt erfundener Zahlen", async () => {
    const db = new HubDatabase(":memory:");
    const rollup = new StatisticsRollup(db, { records: () => [], events: async () => [], swarms: () => [] });
    expect(await rollup.run()).toEqual({ sessionsUpdated: 0, sessionsRemoved: 0, swarmsUpdated: 0 });
    expect(rollup.sessionStatistics()).toEqual([]);
    expect(rollup.gateWaitStatistics()).toBeNull();
    expect(rollup.toolStatistics()).toEqual([]);
    expect(rollup.recoveryDistribution()).toMatchObject({ n: 0, missing: 0, p50: null });
    expect(rollup.swarmTaskStatistics()).toBeNull();
    db.close();
  });

  it("T56.3: schneidet Sessions nach Projekt, Host, Harness und Zeitraum", async () => {
    const db = openDb();
    const a = journal("s1");
    // s2 ohne Gate-Events — so unterscheidet der Gate-Schnitt die Projekte.
    const b = journal("s2").filter(e => e.type !== "gate");
    const rollup = new StatisticsRollup(db, {
      records: () => [
        ref("s1", a.length, { project: "/repo/eins", hostId: "host-a", createdAt: "2026-11-10T09:00:00.000Z" }),
        ref("s2", b.length, { project: "/repo/zwei", hostId: "host-b", createdAt: "2026-11-16T09:00:00.000Z" }),
      ],
      events: async id => (id === "s1" ? a : b),
      swarms: () => [],
    });
    await rollup.run();

    expect(rollup.sliceValues()).toEqual({
      projects: ["/repo/eins", "/repo/zwei"],
      hosts: ["host-a", "host-b"],
      harnesses: ["cli"],
    });

    // Projektschnitt: nur s2 bleibt.
    expect(rollup.sessionStatistics({ project: "/repo/zwei" })[0]).toMatchObject({ sessions: 1 });
    expect(rollup.toolStatistics({ project: "/repo/zwei" })).toHaveLength(1);
    expect(rollup.gateWaitStatistics({ project: "/repo/eins" })).toMatchObject({ gates: 1 });
    expect(rollup.gateWaitStatistics({ project: "/repo/zwei" })).toBeNull();

    // Zeitschnitt: seit dem 15.11. liegt nur s2 (created_at ist der Anker).
    expect(rollup.sessionStatistics({ since: "2026-11-15T00:00:00.000Z" })[0]).toMatchObject({ sessions: 1 });
    expect(rollup.sessionStatistics({ until: "2026-11-15T00:00:00.000Z" })[0]).toMatchObject({ sessions: 1 });
    expect(rollup.sessionStatistics({ hostId: "host-a" })[0]).toMatchObject({ sessions: 1 });
    expect(rollup.sessionStatistics({ harness: "ide" })).toEqual([]);

    // Turn-Schnitte folgen derselben Auswahl (Join über die Fakten).
    seedTurn(db, "s1", 1);
    seedTurn(db, "s2", 1);
    seedTurn(db, "s2", 2);
    expect(rollup.turnStatistics()).toHaveLength(1);
    expect(rollup.turnStatistics()[0]).toMatchObject({ turns: 3, tokens: { n: 3 } });
    expect(rollup.turnStatistics({ project: "/repo/zwei" })[0]).toMatchObject({ turns: 2 });
    expect(rollup.turnStatistics({ since: "2026-11-15T00:00:00.000Z" })[0]).toMatchObject({ turns: 2 });
    db.close();
  });

  it("T56.3: Swarm-Zahlen folgen dem Projekt-/Zeitraum-Schnitt, nicht Host/Harness", async () => {
    const db = openDb();
    const eins = swarm("team1", "2026-11-17T10:00:00.000Z");
    const zwei = { ...swarm("team2", "2026-11-17T10:00:00.000Z"), project: "/repo/zwei", createdAt: "2026-11-16T08:00:00.000Z" };
    const rollup = new StatisticsRollup(db, { records: () => [], events: async () => [], swarms: () => [eins, zwei] });
    await rollup.run();
    expect(rollup.swarmTaskStatistics()).toMatchObject({ swarms: 2, tasks: 2 });
    expect(rollup.swarmTaskStatistics({ project: "p" })).toMatchObject({ swarms: 1, tasks: 1 });
    expect(rollup.swarmTaskStatistics({ since: "2026-11-17T00:00:00.000Z" })).toMatchObject({ swarms: 1 });
    // Host-/Harness-Schnitt wirkt auf Swarms bewusst nicht.
    expect(rollup.swarmTaskStatistics({ hostId: "irgendwo" })).toMatchObject({ swarms: 2 });
    db.close();
  });

  it("T56.3: Zeilen ohne Dimensionen (Stand vor Migration 37) werden einmal neu abgeleitet", async () => {
    const db = openDb();
    const events = journal("s1");
    const rollup = new StatisticsRollup(db, {
      records: () => [ref("s1", events.length, { project: "/repo/neu" })],
      events: async () => events,
      swarms: () => [],
    });
    await rollup.run();
    // Simuliere den alten Stand: Dimensionen geleert, Basis bleibt frisch.
    db.exec("UPDATE session_stat_facts SET project = '', host_id = '', harness = '', created_at = ''");
    expect(await rollup.run()).toMatchObject({ sessionsUpdated: 1 });
    const row = db.prepare("SELECT project FROM session_stat_facts WHERE session_id = 's1'").get() as { project: string };
    expect(row.project).toBe("/repo/neu");
    // Konvergiert: der zweite Lauf tut nichts mehr.
    expect(await rollup.run()).toEqual({ sessionsUpdated: 0, sessionsRemoved: 0, swarmsUpdated: 0 });
    db.close();
  });

  it("T56.3: updatedAt meldet das Rollup-Alter aus den Fakten", async () => {
    const db = openDb();
    const events = journal("s1");
    const rollup = new StatisticsRollup(db, {
      records: () => [ref("s1", events.length)],
      events: async () => events,
      swarms: () => [],
    });
    expect(rollup.updatedAt()).toBeNull();
    await rollup.run();
    expect(rollup.updatedAt()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    db.close();
  });

  it("T56.4: markiert Sessions über dem Gruppen-p95, Klein-n-Gruppen keine", async () => {
    const db = openDb();
    // 10 kurze Sessions (je 2 Züge) + 1 Ausreißer (12 Züge, lange Wall) —
    // Gruppe ist mit 11 Sessions groß genug für eine Anomalie-Aussage.
    const short = journal("short");
    const long = [...journal("s-long"), event(11, 900_000, { sessionId: "s-long", type: "user" }), event(12, 950_000, { sessionId: "s-long", payload: { kind: "session.turn_end", code: 0 } })];
    const records = Array.from({ length: 10 }, (_, i) => ref(`short-${i}`, short.length, { model: null }));
    records.push(ref("s-long", long.length, { model: null }));
    const journals = new Map(records.map((r, i) => [r.id, i === 10 ? long : short] as const));
    const rollup = new StatisticsRollup(db, {
      records: () => records,
      events: async id => journals.get(id)!,
      swarms: () => [],
    });
    await rollup.run();

    const anomalies = rollup.sessionAnomalies();
    expect(anomalies).toHaveLength(1);
    // shorts: 3 Züge (inkl. Unterbrechungs-Zug), Ausreißer: 4 — p95 (n=11,
    // interpoliert) liegt bei 3,5 Zügen; Wall-p95 bei ~478 s.
    expect(anomalies[0]).toMatchObject({ sessionId: "s-long", turns: 4, turnsP95: 3.5 });
    expect(anomalies[0]!.wallMs).toBeGreaterThan(anomalies[0]!.wallP95!);

    // Zeitraum-Schnitt nimmt die Ausreißer-Session heraus: keine Anomalie.
    expect(rollup.sessionAnomalies({ since: "2030-01-01T00:00:00.000Z" })).toEqual([]);

    // Klein-n: 3 Sessions der Gruppe reichen für keine Anomalie-Aussage.
    const three = records.slice(0, 3);
    const rollup2 = new StatisticsRollup(db, {
      records: () => three,
      events: async id => journals.get(id as string)!,
      swarms: () => [],
    });
    await rollup2.run();
    expect(rollup2.sessionAnomalies()).toEqual([]);
    db.close();
  });
});
