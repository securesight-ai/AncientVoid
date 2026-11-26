import { describe, expect, it } from "vitest";
import { GateWaitStatistics, NormalizedEvent } from "@ancientvoid/contracts";
import { aggregateGateWaitStatistics, deriveGateWaitIntervals } from "../../../src/modules/statistics/index.ts";

const event = (seq: number, ms: number, patch: Record<string, unknown> = {}) => NormalizedEvent.parse({
  seq, ts: new Date(Date.parse("2026-11-15T10:00:00.000Z") + ms).toISOString(),
  sessionId: "s1", type: "gate", summary: "fixture", payload: {}, ...patch,
});
const requested = (seq: number, ms: number, approvalId: string, toolName: string) =>
  event(seq, ms, { payload: { kind: "tool.permission_requested", approvalId, toolName } });
const answered = (seq: number, ms: number, approvalId: string, status = "answered") =>
  event(seq, ms, { payload: { kind: "tool.permission_answered", approvalId, toolName: "Bash", behavior: "allow", status } });

describe("P56 T56.1b Gate-Wartezeiten", () => {
  it("koppelt Öffnen und Antworten über die approvalId", () => {
    const intervals = deriveGateWaitIntervals([requested(1, 0, "a1", "Bash"), answered(2, 5000, "a1")]);
    expect(intervals).toEqual([{ gateId: "a1", toolName: "Bash", waitMs: 5000, status: "answered" }]);
  });

  it("führt Timeout, offene und automatisch erlaubte Gates getrennt — ohne Warteintervall zu erfinden", () => {
    const intervals = deriveGateWaitIntervals([
      requested(1, 0, "a1", "Bash"),
      answered(2, 1000, "a1", "timed_out"),
      requested(3, 2000, "a2", "Read"),
      event(4, 2500, { payload: { kind: "tool.auto_approved", toolName: "Grep" } }),
    ]);
    expect(intervals).toEqual([
      { gateId: "a1", toolName: "Bash", waitMs: 1000, status: "timed_out" },
      { gateId: "a2", toolName: "Read", waitMs: null, status: "open" },
      { gateId: "auto:4", toolName: "Grep", waitMs: null, status: "auto_approved" },
    ]);
    expect(aggregateGateWaitStatistics(intervals)).toMatchObject({
      gates: 3, answered: 0, timedOut: 1, open: 1, autoApproved: 1,
      waitMs: { n: 1, missing: 0, p50: 1000, p90: 1000, p95: 1000, smallSample: true },
    });
  });

  it("nimmt auch Swarm-Gate-Intervalle an und verwirft nichts still", () => {
    const swarmIntervals = [
      { gateId: "g1", toolName: null, waitMs: 4000, status: "answered" as const },
      { gateId: "g2", toolName: null, waitMs: null, status: "open" as const },
    ];
    const stats = aggregateGateWaitStatistics(swarmIntervals);
    expect(GateWaitStatistics.parse(stats)).toBeTruthy();
    expect(() => deriveGateWaitIntervals([answered(1, 0, "orphans")])).toThrow(/zusammengehöriges Öffnen/i);
    expect(() => deriveGateWaitIntervals([requested(1, 0, "a1", "Bash"), requested(2, 1, "a1", "Bash")])).toThrow(/Doppeltes/i);
    expect(() => aggregateGateWaitStatistics([])).toThrow();
  });
});
