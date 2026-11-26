import { describe, expect, it } from "vitest";
import { Swarm, SwarmTaskStatistics, type SwarmDispatch } from "@ancientvoid/contracts";
import { aggregateSwarmTaskStatistics } from "../../../src/modules/statistics/index.ts";

const dispatch = (generation: number, status: SwarmDispatch["status"] = "done"): SwarmDispatch => ({
  id: `d${generation}`, generation, sessionId: "s1", adapter: "dummy", model: null,
  startedAt: "2026-11-15T10:00:00.000Z", endedAt: null, status, note: null,
});
const swarm = (tasks: Array<Partial<Swarm["tasks"][number]>> = []) => Swarm.parse({
  id: "team1", title: "T", goal: "G", project: "p",
  frame: { adapters: ["dummy"], coordinatorAdapter: null },
  planSource: "given", status: "done",
  tasks: tasks.map((t, i) => ({
    id: `T${i + 1}`, title: `t${i + 1}`, prompt: "p", adapter: "dummy", model: null,
    dependsOn: [], status: "done", dispatches: [], result: null, ...t,
  })),
  gates: [], deliveries: [],
  createdAt: "2026-11-15T10:00:00.000Z", updatedAt: "2026-11-15T10:00:00.000Z",
});

describe("P56 T56.1b Swarm-Fakten", () => {
  it("zählt Task-Enden ehrlich: worker_done ist kein bestandenes Gate (P40-Regel)", () => {
    const stats = aggregateSwarmTaskStatistics([
      swarm([{ status: "done" }, { status: "done" }, { status: "failed" }, { status: "unknown" }, { status: "running" }]),
      swarm([{ status: "pending" }, { status: "ready" }]),
    ]);
    expect(stats).toMatchObject({
      swarms: 2, tasks: 7, open: 3, unknown: 1, done: 2, failed: 1,
      workerEndRate: 2 / 3, retryTasks: 0, retryRate: null, dispatches: 0, staleDispatches: 0,
    });
    expect(SwarmTaskStatistics.parse(stats)).toBeTruthy();
  });

  it("erkennt Retries nur über belegte Dispatch-Generationen, nie über Session-Fortsetzungen", () => {
    const stats = aggregateSwarmTaskStatistics([
      swarm([
        { status: "failed", dispatches: [dispatch(1, "failed"), dispatch(2, "stale")] },
        { status: "done", dispatches: [dispatch(1)] },
        { status: "done", dispatches: [] },
      ]),
    ]);
    expect(stats).toMatchObject({
      tasksWithDispatches: 2, retryTasks: 1, retryRate: 0.5,
      dispatches: 3, staleDispatches: 1,
    });
  });

  it("lehnt leere Eingaben und widersprüchliche Quoten im Contract ab", () => {
    expect(() => aggregateSwarmTaskStatistics([])).toThrow(/Keine Swarms/i);
    const valid = aggregateSwarmTaskStatistics([swarm([{ status: "done" }])]);
    expect(() => SwarmTaskStatistics.parse({ ...valid, workerEndRate: 0 })).toThrow();
  });
});
