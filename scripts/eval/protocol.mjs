import { createHash } from "node:crypto";
import { z } from "zod";
import { EvalCloudPrice } from "@ancientvoid/contracts";

const name = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const label = z.string().min(1).max(200);
const local = z.strictObject({
  kind: z.literal("local"),
  date: z.iso.date(),
  host: label,
  usdPerKwh: z.number().positive(),
  eurPerKwh: z.number().positive().optional(),
  usdPerEur: z.number().positive().optional(),
  fxDate: z.iso.date().optional(),
});
const cell = z.strictObject({
  id: name,
  harness: name,
  adapter: name,
  version: label,
  configurationFingerprint: label,
  model: label,
  fingerprint: label,
  provider: name,
  billing: z.discriminatedUnion("kind", [local, EvalCloudPrice]),
  budgetUsd: z.number().positive().optional(),
  skillsAb: z.boolean().default(true),
  healthUrl: z.url().optional(),
});
const protocol = z.strictObject({
  version: z.literal(2),
  fixturePolicy: z.literal("isolated-hub"),
  repetitions: z.number().int().min(2).max(50),
  // Pilot: Teilkorpus. Ohne Angabe läuft der ganze Korpus.
  tasks: z.array(name).min(1).optional(),
  timeoutMs: z.number().int().min(1000).max(3_600_000),
  parallelCloudRuns: z.number().int().min(1).max(20),
  maxInfraRetries: z.number().int().min(0).max(5).default(2),
  setup: label,
  providerBudgetUsd: z.record(name, z.number().positive()),
  cells: z.array(cell).min(2),
  splits: z.array(z.strictObject({ id: name, plan: name, build: name })).default([]),
});

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function planSeries(raw, corpus) {
  const config = protocol.parse(raw);
  const protocolHash = sha256(JSON.stringify(config));
  const cells = new Map();
  for (const entry of config.cells) {
    if (cells.has(entry.id)) throw new Error(`Duplicate cell ${entry.id}`);
    if (entry.billing.kind === "cloud" && !entry.budgetUsd) throw new Error(`${entry.id}: cloud cells need budgetUsd`);
    if (entry.billing.kind === "cloud" && !(entry.provider in config.providerBudgetUsd)) throw new Error(`${entry.id}: no providerBudgetUsd for ${entry.provider}`);
    cells.set(entry.id, entry);
  }
  const byFingerprint = new Map();
  for (const entry of cells.values()) {
    const known = byFingerprint.get(entry.fingerprint);
    if (known && known.model !== entry.model) throw new Error(`Fingerprint ${entry.fingerprint} is shared by different models`);
    byFingerprint.set(entry.fingerprint, entry);
  }
  const candidate = (entry) => ({
    cellId: entry.id, harnessId: entry.harness, adapter: entry.adapter, harnessVersion: entry.version, model: entry.model,
    fingerprint: entry.fingerprint, provider: entry.provider, billing: entry.billing,
    ...(entry.budgetUsd ? { budgetUsd: entry.budgetUsd } : {}), ...(entry.healthUrl ? { healthUrl: entry.healthUrl } : {}),
  });
  const arms = [];
  for (const entry of cells.values()) {
    for (const skills of entry.skillsAb ? [false, true] : [false]) {
      arms.push({ id: `${entry.id}-${skills ? "skills" : "plain"}`, group: "core", skills, build: candidate(entry) });
    }
  }
  for (const split of config.splits) {
    const planCell = cells.get(split.plan);
    const buildCell = cells.get(split.build);
    if (!planCell || !buildCell) throw new Error(`Split ${split.id} references an unknown cell`);
    if (planCell.harness !== buildCell.harness) throw new Error(`Split ${split.id} must stay inside one harness`);
    arms.push({ id: split.id, group: "split", skills: false, plan: candidate(planCell), build: candidate(buildCell) });
  }
  const core = arms.filter((arm) => arm.group === "core");
  if (!core.some((a) => core.some((b) => a.build.harnessId !== b.build.harnessId && a.build.fingerprint === b.build.fingerprint &&
    a.build.billing.kind === b.build.billing.kind))) {
    throw new Error("The matrix needs an identical model fingerprint across two harnesses");
  }
  const known = new Set(corpus.tasks.map((task) => task.id));
  for (const id of config.tasks ?? []) if (!known.has(id)) throw new Error(`Unknown task ${id} in protocol`);
  const tasks = config.tasks ? corpus.tasks.filter((task) => config.tasks.includes(task.id)) : corpus.tasks;
  const jobs = [];
  for (let repetition = 1; repetition <= config.repetitions; repetition++) {
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index];
      const rotation = (repetition + index) % arms.length;
      for (const arm of [...arms.slice(rotation), ...arms.slice(0, rotation)]) {
        if (arm.group === "split" && !task.split) continue;
        jobs.push({ repetition, task, arm });
      }
    }
  }
  return { config, protocolHash, corpus, arms, jobs };
}

export class BudgetGuard {
  constructor(limits) {
    this.limits = limits;
    this.spent = {};
  }

  assertOpen(job) {
    for (const side of [job.arm.plan, job.arm.build]) {
      if (side?.billing.kind !== "cloud") continue;
      const spent = this.spent[side.provider] ?? 0;
      if (spent >= this.limits[side.provider]) {
        throw new Error(`Provider budget exhausted for ${side.provider}: ${spent.toFixed(2)} of ${this.limits[side.provider]} USD`);
      }
    }
  }

  record(job, result) {
    [job.arm.plan, job.arm.build].filter(Boolean).forEach((side, index) => {
      if (side.billing.kind === "cloud") this.spent[side.provider] = (this.spent[side.provider] ?? 0) + result.phases[index].costUsd;
    });
  }
}

/** Fehlerarten des Anbieters, die nichts über den Arm aussagen; `context` und `unknown` zählen mit. */
export const OUTAGES = ["quota", "rate_limit", "auth", "network", "server"];
const INFRA = /HTTP 5\d\d|ECONN|fetch failed|before completed turn telemetry|no positive token usage|did not confirm stop|health|provider [a-z_]+ during turn/i;
export const isInfrastructureFailure = (error) => INFRA.test(String(error?.message ?? error));

export const jobKey = ({ arm, task, repetition }) => `${arm.id}/${task.id}/${repetition}`;

/** Offene Läufe beim Fortsetzen: Erfasstes und Abgebrochenes entfällt, zurückgestellte Provider warten. */
export function resumeJobs(plan, { rows, aborted, skipProviders, budget }) {
  const providers = new Set(plan.config.cells.map((entry) => entry.provider));
  for (const name of skipProviders) if (!providers.has(name)) throw new Error(`Unknown provider ${name}`);
  const byKey = new Map(plan.jobs.map((job) => [jobKey(job), job]));
  for (const { key, row } of rows) {
    const job = byKey.get(key);
    if (!job || row.input.protocolHash !== plan.protocolHash) throw new Error(`${key} was recorded under a different protocol; start a new series`);
    budget.record(job, row);
  }
  const closed = new Set([...rows.map((entry) => entry.key), ...aborted]);
  return plan.jobs.filter((job) => !closed.has(jobKey(job)) &&
    ![job.arm.plan, job.arm.build].some((side) => side && skipProviders.includes(side.provider)));
}

export async function runJobs(jobs, parallelCloudRuns, run) {
  let cloud = [];
  const settle = async () => {
    const results = await Promise.allSettled(cloud);
    cloud = [];
    const failed = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failed.length) throw new AggregateError(failed, "P84 batch failed");
  };
  for (const job of jobs) {
    const local = job.arm.build.billing.kind === "local" || job.arm.plan?.billing.kind === "local";
    if (local) {
      await settle();
      await run(job);
    } else {
      cloud.push(run(job));
      if (cloud.length >= parallelCloudRuns) await settle();
    }
  }
  await settle();
}
