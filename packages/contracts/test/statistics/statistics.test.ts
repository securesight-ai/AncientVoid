import { describe, expect, it } from "vitest";
import { StatisticsDistribution, StatisticsReport, TurnStatistics, SessionAnomaly } from "@ancientvoid/contracts";

const distribution = { n: 2, missing: 1, p50: 10, p90: 18, p95: 19, smallSample: true };

describe("P56 Statistik-Vertrag", () => {
  it("unterscheidet fehlende Werte von einer gemeldeten Null", () => {
    expect(StatisticsDistribution.parse({ n: 0, missing: 3, p50: null, p90: null, p95: null, smallSample: true }).p50).toBeNull();
    expect(StatisticsDistribution.parse({ n: 1, missing: 0, p50: 0, p90: 0, p95: 0, smallSample: true }).p50).toBe(0);
  });

  it.each([
    { ...distribution, n: 0 },
    { ...distribution, p90: null },
    { ...distribution, p50: 20 },
    { ...distribution, p95: 17 },
    { ...distribution, missing: -1 },
    { ...distribution, n: 1.5 },
    { ...distribution, n: Number.MAX_SAFE_INTEGER + 1 },
    { ...distribution, p95: Infinity },
    { ...distribution, p50: NaN },
    { ...distribution, smallSample: false },
    { ...distribution, unit: "invented" },
  ])("weist widersprüchliche oder ungültige Verteilungen ab: %j", value => {
    expect(StatisticsDistribution.safeParse(value).success).toBe(false);
  });

  it("bindet Klein-n an die tatsächlich gemeldeten Werte", () => {
    expect(StatisticsDistribution.safeParse({ ...distribution, n: 10, missing: 100, smallSample: false }).success).toBe(true);
    expect(StatisticsDistribution.safeParse({ ...distribution, n: 10, smallSample: true }).success).toBe(false);
  });

  it("führt alle Züge und die Herkunft geschätzter Tokenwerte", () => {
    const value = { adapter: "codex", model: null, turns: 3, failedTurns: 1, durationMs: { ...distribution, n: 3, missing: 0 }, tokens: distribution, estimatedTokenTurns: 1 };
    expect(TurnStatistics.parse(value)).toEqual(value);
    for (const patch of [{ failedTurns: 4 }, { estimatedTokenTurns: 3 }, { turns: 0 }, { tokens: { ...distribution, missing: 0 } }, { durationMs: distribution }]) {
      expect(TurnStatistics.safeParse({ ...value, ...patch }).success).toBe(false);
    }
  });

  it("T56.3: StatisticsReport trägt Schnitt, Scheiben und Aggregate lückenlos", () => {
    const session = { adapter: "codex", model: "m1", sessions: 2, openSessions: 0, endReasons: { completed: 1, error: 1, interrupted: 0, stopped: 0 }, wallMs: { ...distribution, n: 2, missing: 0 }, activeMs: { ...distribution, n: 2, missing: 0 }, turnsPerSession: { ...distribution, n: 2, missing: 0 } };
    const report = StatisticsReport.parse({
      updatedAt: "2026-11-17T10:00:00.000Z",
      filter: { project: null, hostId: null, harness: null, since: null, until: null },
      slices: { projects: ["/repo"], hosts: ["host-a"], harnesses: ["cli"] },
      sessions: [session],
      turns: [],
      gateWait: null,
      tools: [],
      recovery: { n: 0, missing: 0, p50: null, p90: null, p95: null, smallSample: true },
      swarm: null,
      anomalies: [],
    });
    expect(report.sessions).toHaveLength(1);
    // Ungültige Aggregate und Scheiben-Drift werden abgewiesen, nicht gerundet.
    expect(StatisticsReport.safeParse({ ...report, sessions: [{ ...session, sessions: 0 }] }).success).toBe(false);
    expect(StatisticsReport.safeParse({ ...report, slices: { projects: ["/repo"], hosts: [], harnesses: [] }, extra: true }).success).toBe(false);
  });

  it("T56.4: SessionAnomaly verlangt ein belegtes Kriterium über dem Gruppen-p95", () => {
    const base = { sessionId: "s1", adapter: "codex", model: null, project: "/repo", createdAt: "2026-11-17T09:00:00.000Z" };
    expect(SessionAnomaly.parse({ ...base, wallMs: 900_000, wallP95: 478_500, turns: 4, turnsP95: 3.5 })).toBeTruthy();
    expect(SessionAnomaly.parse({ ...base, wallMs: null, wallP95: 478_500, turns: 4, turnsP95: 3.5 })).toBeTruthy();
    // Unter dem p95 in beiden Kriterien: keine Anomalie.
    expect(SessionAnomaly.safeParse({ ...base, wallMs: 100, wallP95: 478_500, turns: 1, turnsP95: 3.5 }).success).toBe(false);
    // Wall-Kriterium ohne Gruppen-p95 ist unbelegt — Züge unter p95 können es nicht ersetzen.
    expect(SessionAnomaly.safeParse({ ...base, wallMs: 900_000, wallP95: null, turns: 1, turnsP95: 3.5 }).success).toBe(false);
  });
});
