import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { readCorpus } from "./corpus.mjs";
import { BudgetGuard, isInfrastructureFailure, planSeries, runJobs } from "./protocol.mjs";
import { integrateEnergy } from "./energy.mjs";
import { renderReport, summarise, validateSeries } from "./report.mjs";
import { awaitHealthy, connectHub, preflight, runPhase } from "./hub.mjs";
import { testProtocol } from "./protocol.fixture.mjs";

const plan = planSeries(testProtocol, readCorpus());

function measured(series) {
  return plan.jobs.map(({ task, arm, repetition }) => {
    const candidates = arm.plan ? [arm.plan, arm.build] : [arm.build];
    const input = {
      series, arm: arm.id, task: task.id, repetition,
      corpusHash: plan.corpus.hash, protocolHash: plan.protocolHash,
      attempt: 1, rulesHash: "a".repeat(64), skillHash: arm.skills ? "b".repeat(64) : null, skills: arm.skills,
      baseline: 1, acceptance: true, lint: true, typecheck: true,
      phases: candidates.map((candidate, idx) => ({
        sessionId: randomUUID(), phase: idx === 0 && arm.plan ? "plan" : "build",
        harnessVersion: candidate.harnessVersion, modelFingerprint: candidate.fingerprint, wallMs: 100,
        billing: candidate.billing.kind === "local" ? { ...candidate.billing, source: "p81:power:components", kwh: 0.001 } : candidate.billing,
      })),
    };
    return {
      input, recordedAt: "2026-11-25T13:00:00.000Z",
      phases: candidates.map((candidate) => ({
        adapter: candidate.adapter, model: candidate.model, adapterVersion: "0.1.0", inputTokens: 1000, cacheInputTokens: candidate.billing.kind === "cloud" ? 400 : 0, outputTokens: 100,
        costUsd: 0.15, turnErrors: 0, toolErrors: 0, turns: 1,
        startedAt: "2026-11-25T12:59:59.000Z", endedAt: "2026-11-25T13:00:00.000Z",
      })),
    };
  });
}

it("plans a complete balanced 780-run matrix with the same four tasks in every split arm", () => {
  expect(plan.arms).toHaveLength(15);
  expect(plan.jobs).toHaveLength(780);
  const split = plan.arms.filter((arm) => arm.group === "split");
  const ids = split.map((arm) => [...new Set(plan.jobs.filter((job) => job.arm === arm).map((job) => job.task.id))]);
  expect(ids[0]).toHaveLength(4);
  expect(ids.every((group) => group.join() === ids[0].join())).toBe(true);
});

it("waits for in-flight parallel records, reports failures and keeps local runs exclusive", async () => {
  const cloud = plan.jobs.find(({ arm }) => arm.build.billing.kind === "cloud" && !arm.plan);
  const local = plan.jobs.find(({ arm }) => arm.build.billing.kind === "local" && !arm.plan);
  let concurrent = 0;
  let high = 0;
  const run = vi.fn(async (job) => {
    if (job === local) expect(concurrent).toBe(0);
    concurrent++;
    high = Math.max(concurrent, high);
    await Promise.resolve();
    concurrent--;
  });
  await runJobs([cloud, cloud, local, cloud], 2, run);
  expect(high).toBe(2);
  expect(run).toHaveBeenCalledTimes(4);
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  const committed = vi.fn();
  const failing = runJobs([cloud, cloud, local], 2, async () => {
    if (concurrent++ === 0) throw new Error("lost run");
    await waiting;
    committed();
  });
  finish();
  await expect(failing).rejects.toThrow("P84 batch failed");
  expect(committed).toHaveBeenCalledOnce();
});

it("integrates the covered components and rejects missing samples", () => {
  const history = { stepSec: 60, points: [[0, 60], [60_000, 120]] };
  expect(integrateEnergy(history, 30_000, 90_000)).toBeCloseTo(0.0015, 8);
  expect(() => integrateEnergy(history, 30_000, 130_000)).toThrow(/complete phase/);
  expect(() => integrateEnergy({ ...history, points: [[0, 0]] }, 0, 1000)).toThrow(/positive/);
});

it("reports only complete independent series with means, medians and dispersion", () => {
  const first = measured("first");
  const second = measured("second");
  const meta = { date: "2026-11-25", commit: "fixture", runtime: "fixture" };
  expect(summarise([2, 10, 3, 0, 4])).toEqual({ n: 5, median: 3, mean: 3.8, min: 0, max: 10 });
  expect(() => summarise([1, 2])).toThrow(/Three/);
  expect(() => validateSeries(first.slice(1), plan)).toThrow(/Incomplete/);
  expect(() => validateSeries([...first, first[0]], plan)).toThrow(/duplicate/);
  expect(() => renderReport(first, first, plan, meta)).toThrow(/independent/);
  const report = renderReport(first, second, plan, meta);
  expect(report.reproduced).toBe(true);
  expect(report.markdown).toContain("Skills nicht messbar getrennt vom Rauschen");
  expect(report.markdown).toContain("1000 (1000; 1000–1000)");
  for (const row of second.filter(({ input }) => input.arm === "pi-local-plain")) row.input.acceptance = false;
  expect(renderReport(first, second, plan, meta).reproduced).toBe(false);
});

it("rejects a missing catalogue before any provider session is started", async () => {
  expect(() => connectHub(undefined, "")).toThrow("ANCIENTVOID_TOKEN");
  const api = vi.fn(async (path) => path === "/api/adapters" ? [{ id: "pi" }] : { models: [] });
  await expect(preflight(api, testProtocol)).rejects.toThrow(/before any session/);
  expect(api.mock.calls.every(([path]) => !path.startsWith("/api/sessions"))).toBe(true);
});

it("uses turn completion and a stop acknowledgement before returning stage evidence", async () => {
  const api = vi.fn(async (path) => {
    if (path === "/api/sessions") return { id: "completed", model: "fixture/cloud", adapter: "pi" };
    if (path.endsWith("/turns")) return { turns: [{ turn: 1 }] };
    if (path.endsWith("/stop")) return { ok: true };
    return { status: "idle" };
  });
  const stage = await runPhase(api, "build", plan.arms.find((arm) => arm.id === "pi-cloud-plain").build, "/tmp/repo", "sample", 1000);
  expect(stage).toMatchObject({ phase: "build", sessionId: "completed", billing: testProtocol.cells.find((cell) => cell.id === "pi-cloud").billing });
  expect(api).toHaveBeenLastCalledWith("/api/sessions/completed/stop", {});
});

const corpus = readCorpus();
const withCells = (mutate) => planSeries(mutate(JSON.parse(JSON.stringify(testProtocol))), corpus);

it("rejects protocols that would confound or leave a provider unbudgeted", () => {
  expect(() => withCells((p) => { delete p.providerBudgetUsd.fixture; return p; })).toThrow(/providerBudgetUsd/);
  expect(() => withCells((p) => { p.cells[1].fingerprint = "shared-local"; return p; })).toThrow(/different models/);
  expect(() => withCells((p) => { p.splits[0].build = "claude-cloud"; return p; })).toThrow(/one harness/);
  expect(() => withCells((p) => { p.cells.push({ ...p.cells[0] }); return p; })).toThrow(/Duplicate/);
  expect(() => withCells((p) => { p.cells = p.cells.filter((c) => c.harness === "pi"); return p; })).toThrow(/two harnesses/);
});

it("supports several cloud models per harness and a cell without Skills-A/B", () => {
  const extended = withCells((p) => {
    p.providerBudgetUsd.other = 5;
    p.cells.push({ ...p.cells[3], id: "claude-opus", model: "fixture/opus", fingerprint: "opus", provider: "other", skillsAb: false });
    return p;
  });
  expect(extended.arms.map((arm) => arm.id)).toContain("claude-opus-plain");
  expect(extended.arms.map((arm) => arm.id)).not.toContain("claude-opus-skills");
});

it("stops a provider at its budget cap and counts only cloud phases", () => {
  const guard = new BudgetGuard({ fixture: 0.3 });
  const cloud = plan.jobs.find(({ arm }) => arm.build.billing.kind === "cloud" && !arm.plan);
  const local = plan.jobs.find(({ arm }) => arm.build.billing.kind === "local" && !arm.plan);
  guard.record(local, { phases: [{ costUsd: 9 }] });
  guard.assertOpen(cloud);
  guard.record(cloud, { phases: [{ costUsd: 0.2 }] });
  guard.assertOpen(cloud);
  guard.record(cloud, { phases: [{ costUsd: 0.2 }] });
  expect(() => guard.assertOpen(cloud)).toThrow(/budget exhausted for fixture/);
});

it("separates dead infrastructure from task failures", async () => {
  expect(isInfrastructureFailure(new Error("x: HTTP 504 upstream"))).toBe(true);
  expect(isInfrastructureFailure(new Error("session: error before completed turn telemetry"))).toBe(true);
  expect(isInfrastructureFailure(new Error("acceptance failed"))).toBe(false);
  const down = vi.fn(async () => ({ ok: false, status: 504 }));
  await expect(awaitHealthy("http://127.0.0.1:1/health", { fetcher: down, waitMs: 0, stepMs: 1 })).rejects.toThrow(/health check failed/);
  await expect(awaitHealthy("http://127.0.0.1:1/health", { fetcher: async () => ({ ok: true }) })).resolves.toBeUndefined();
});

it("shows cache tokens and cache cost and flags adapters that do not split the cache", () => {
  const first = measured("first");
  const second = measured("second");
  const meta = { date: "2026-11-25", commit: "fixture", runtime: "fixture" };
  const report = renderReport(first, second, plan, meta).markdown;
  expect(report).toContain("davon Cache-Tokens");
  expect(report).toContain("davon Cache USD");
  expect(report).not.toContain("obere Schranke");
  for (const row of first.filter(({ input }) => input.arm === "pi-cloud-plain")) for (const phase of row.phases) phase.cacheInputTokens = 0;
  expect(renderReport(first, second, plan, meta).markdown).toContain("first/pi-cloud-plain · Cache-Tokens nicht getrennt gemeldet");
});
