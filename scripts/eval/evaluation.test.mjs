import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSeries } from "./export.mjs";
import { renderPilotReport } from "./pilot-report.mjs";
import { snapshotWorkspace } from "./workspace.mjs";
import { execFileSync } from "node:child_process";
import { evaluationTable } from "@ancientvoid/contracts";
import { summariseSeries } from "@ancientvoid/core";
import { expect, it, vi } from "vitest";
import { readCorpus } from "./corpus.mjs";
import { BudgetGuard, isInfrastructureFailure, jobKey, planSeries, resumeJobs, runJobs } from "./protocol.mjs";
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

it("plans a complete balanced 840-run matrix (12 regressions + negative control) with the same four tasks in every split arm", () => {
  expect(plan.arms).toHaveLength(15);
  expect(plan.jobs).toHaveLength(840);
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

it("exports a complete series immutably with a hash manifest and marks partial series invalid", () => {
  const dir = mkdtempSync(join(tmpdir(), "p84-export-"));
  try {
    const rows = measured("serie-a");
    const receipts = join(dir, "sessions.jsonl");
    const invalid = join(dir, "invalid.jsonl");
    writeFileSync(receipts, "");
    writeFileSync(invalid, JSON.stringify({ key: "x", attempt: 1, cause: "infrastructure" }) + "\n");
    const meta = { date: "2026-11-26", commit: "fixture", runtime: "fixture" };
    const done = exportSeries({ rows, receipts, invalid, plan, meta, out: join(dir, "ok") });
    expect(done.manifest).toMatchObject({ lauf_id: "2026-11-26-serie-a", laeufe_erwartet: 840, laeufe_erfasst: 840, infrastruktur_versuche_verworfen: 1, messung_gueltig: true });
    expect(done.manifest.kosten_cloud_usd_je_provider.fixture).toBeGreaterThan(0);
    expect(readFileSync(join(dir, "ok", "manifest.sha256"), "utf8")).toContain("  lauf.yaml");
    expect(() => exportSeries({ rows, receipts, invalid, plan, meta, out: join(dir, "ok") })).toThrow(/EEXIST/);
    expect(() => exportSeries({ rows: rows.slice(1), receipts, plan, meta, out: join(dir, "teil") })).toThrow(/Incomplete/);
    writeFileSync(join(dir, "aborted.jsonl"), JSON.stringify({ key: "y", cause: "timeout" }) + "\n");
    const diagnosis = [{ arm: "a", outcome: "pass", journal: { tools: { read: 1 }, toolErrors: 0, deniedCalls: 0, checks: { test: 1 }, msToFirstEdit: null }, workspace: null }];
    const partial = exportSeries({ rows: rows.slice(1), receipts, plan, meta, out: join(dir, "teil2"), partial: true, diagnosis });
    expect(partial.manifest.laeufe_abgebrochen).toBe(1);
    expect(partial.files).toEqual(expect.arrayContaining(["aborted.jsonl", "diagnose.jsonl", "diagnose.md"]));
    expect(readFileSync(join(dir, "teil2", "manifest.sha256"), "utf8")).toContain("  diagnose.jsonl");
    expect(partial.manifest).toMatchObject({ messung_gueltig: false, laeufe_erfasst: 839 });
    expect(partial.manifest.grund_ungueltig).toMatch(/Incomplete/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("renders the pilot report from the same summary and table as the PWA tab", () => {
  const summary = summariseSeries("pilot", measured("pilot"));
  const meta = { date: "2026-11-26", commit: "fixture", runtime: "fixture", valid: true, invalidReason: "" };
  const markdown = renderPilotReport(summary, plan, meta);
  const table = evaluationTable(summary);
  expect(summary.runs).toBe(840);
  expect(markdown).toContain(`| ${table.columns.join(" | ")} |`);
  for (const row of table.rows) expect(markdown).toContain(`| ${row.join(" | ")} |`);
  expect(markdown).toContain("Pflichtangaben");
  expect(markdown).toContain("Was das nicht sagt");
  expect(markdown).toContain("```csv");
  expect(() => renderPilotReport({ ...summary, consistent: false }, plan, meta)).toThrow(/mixes/);
  expect(() => renderPilotReport({ ...summary, protocolHashes: ["f".repeat(64)] }, plan, meta)).toThrow(/different corpus or protocol/);
  expect(renderPilotReport(summary, plan, { ...meta, valid: false, invalidReason: "Engine ausgefallen" })).toContain("**ungültig** — Engine ausgefallen");
});

it("limits a pilot protocol to a task subset and rejects unknown task ids", () => {
  const ids = readCorpus().tasks.slice(0, 2).map((task) => task.id);
  const pilot = planSeries({ ...testProtocol, repetitions: 2, tasks: ids }, readCorpus());
  expect(new Set(pilot.jobs.map((job) => job.task.id))).toEqual(new Set(ids));
  expect(pilot.jobs.length).toBeLessThan(plan.jobs.length / 5);
  expect(() => planSeries({ ...testProtocol, tasks: ["gibt-es-nicht"] }, readCorpus())).toThrow(/Unknown task/);
});

it("makes every workspace its own clean git root, also inside a surrounding repository", async () => {
  const outer = mkdtempSync(join(tmpdir(), "p84-outer-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: outer });
    const inner = mkdtempSync(join(outer, "work-"));
    writeFileSync(join(inner, "a.txt"), "a");
    const git = (...args) => execFileSync("git", args, { cwd: inner, encoding: "utf8" }).trim();
    await snapshotWorkspace(inner);
    expect(git("rev-parse", "--show-toplevel").endsWith(inner.slice(outer.length))).toBe(true);
    writeFileSync(join(inner, "PLAN.md"), "plan");
    await snapshotWorkspace(inner);
    expect(git("status", "--porcelain")).toBe("");
    expect(git("log", "--format=%an %s")).toBe("bench start\nbench start");
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

it("resumes a series: skips recorded and aborted jobs and deferred providers, and keeps the spent budget", async () => {
  const [done, aborted] = plan.jobs;
  const rows = [{ key: jobKey(done), row: { input: { protocolHash: plan.protocolHash }, phases: [{ costUsd: 19.5 }, { costUsd: 19.5 }] } }];
  const budget = new BudgetGuard(plan.config.providerBudgetUsd);
  const open = resumeJobs(plan, { rows, aborted: [jobKey(aborted)], skipProviders: [], budget });
  expect(open).toHaveLength(plan.jobs.length - 2);
  expect(open.map(jobKey)).not.toContain(jobKey(done));
  const cloudSides = [done.arm.plan, done.arm.build].filter((side) => side?.billing.kind === "cloud");
  expect(budget.spent.fixture ?? 0).toBe(cloudSides.length * 19.5);
  const localOnly = resumeJobs(plan, { rows: [], aborted: [], skipProviders: ["fixture"], budget: new BudgetGuard({ fixture: 20 }) });
  expect(localOnly.length).toBeGreaterThan(0);
  expect(localOnly.every((job) => [job.arm.plan, job.arm.build].every((side) => side?.provider !== "fixture"))).toBe(true);
  const foreign = [{ key: jobKey(done), row: { input: { protocolHash: "f".repeat(64) }, phases: [] } }];
  expect(() => resumeJobs(plan, { rows: foreign, aborted: [], skipProviders: [], budget })).toThrow(/different protocol/);
  expect(() => resumeJobs(plan, { rows: [], aborted: [], skipProviders: ["tippfehler"], budget })).toThrow(/Unknown provider/);
});

it("counts a turn cut off by the provider as infrastructure, never as a task failure", async () => {
  const hub = (category) => vi.fn(async (path) => {
    if (path === "/api/sessions") return { id: "cut", model: "fixture/cloud", adapter: "pi" };
    if (path.endsWith("/turns")) return { turns: [{ turn: 1, outcome: "error" }] };
    if (path.endsWith("/stop")) return { ok: true };
    if (path.includes("/events")) return path.includes("afterSeq=0&") ? [{ seq: 7, payload: { kind: "provider.error", category } }] : [];
    return { status: "idle" };
  });
  const run = (api) => runPhase(api, "build", plan.arms.find((arm) => arm.id === "pi-cloud-plain").build, "/tmp/repo", "sample", 1000);
  const outage = await run(hub("quota")).catch((error) => error);
  expect(outage.message).toBe("cut: provider quota during turn");
  expect(isInfrastructureFailure(outage)).toBe(true);
  // Ein übergelaufener Kontext gehört zum Verhalten des Arms und bleibt ein erfasster Lauf.
  await expect(run(hub("context"))).resolves.toMatchObject({ sessionId: "cut" });
});
