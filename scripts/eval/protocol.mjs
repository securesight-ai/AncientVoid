import { createHash } from "node:crypto";
import { z } from "zod";
import { EvalCloudPrice } from "@ancientvoid/contracts";

const name = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const label = z.string().min(1).max(200);
const cloud = z.strictObject({ model: label, fingerprint: label, billing: EvalCloudPrice, budgetUsd: z.number().positive() });
const local = z.strictObject({
  model: label,
  fingerprint: label,
  billing: z.strictObject({
    kind: z.literal("local"),
    date: z.iso.date(),
    host: label,
    usdPerKwh: z.number().positive(),
  }),
});
const harness = z.strictObject({ adapter: name, version: label, configurationFingerprint: label, local, cloud });
const protocol = z.strictObject({
  version: z.literal(1),
  fixturePolicy: z.literal("isolated-hub"),
  repetitions: z.number().int().min(5).max(50),
  timeoutMs: z.number().int().min(1000).max(3_600_000),
  parallelCloudRuns: z.number().int().min(1).max(20),
  setup: label,
  splitHarness: z.enum(["pi", "claude", "opencode"]),
  harnesses: z.strictObject({ pi: harness, claude: harness, opencode: harness }),
});

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function planSeries(raw, corpus) {
  const config = protocol.parse(raw);
  const protocolHash = sha256(JSON.stringify(config));
  const candidate = (harnessId, kind) => {
    const source = config.harnesses[harnessId];
    return { harnessId, adapter: source.adapter, harnessVersion: source.version, ...source[kind] };
  };
  const arms = [];
  const adapters = Object.values(config.harnesses).map((source) => source.adapter);
  if (new Set(adapters).size !== adapters.length) throw new Error("Core harnesses must use distinct adapter registrations");
  for (const id of Object.keys(config.harnesses)) {
    if (candidate(id, "local").fingerprint === candidate(id, "cloud").fingerprint) throw new Error(`${id}: local and cloud fingerprints must differ`);
    for (const kind of ["local", "cloud"]) {
      for (const skills of [false, true]) {
        arms.push({ id: `${id}-${kind}-${skills ? "skills" : "plain"}`, group: "core", skills, build: candidate(id, kind) });
      }
    }
  }
  const localModel = candidate(config.splitHarness, "local");
  const cloudModel = candidate(config.splitHarness, "cloud");
  arms.push(
    { id: "split-local-cloud", group: "split", skills: false, plan: localModel, build: cloudModel },
    { id: "split-cloud-local", group: "split", skills: false, plan: cloudModel, build: localModel },
    { id: "split-cloud-cloud", group: "split", skills: false, plan: cloudModel, build: cloudModel },
  );
  if (!arms.some((a) => arms.some((b) => a.group === "core" && b.group === "core" &&
    a.build.harnessId !== b.build.harnessId && a.build.fingerprint === b.build.fingerprint &&
    a.build.billing.kind === b.build.billing.kind))) {
    throw new Error("The matrix needs an identical model fingerprint across two harnesses");
  }
  const jobs = [];
  for (let repetition = 1; repetition <= config.repetitions; repetition++) {
    for (let index = 0; index < corpus.tasks.length; index++) {
      const task = corpus.tasks[index];
      const rotation = (repetition + index) % arms.length;
      for (const arm of [...arms.slice(rotation), ...arms.slice(0, rotation)]) {
        if (arm.group === "split" && !task.split) continue;
        jobs.push({ repetition, task, arm });
      }
    }
  }
  return { config, protocolHash, corpus, arms, jobs };
}

export const jobKey = ({ arm, task, repetition }) => `${arm.id}/${task.id}/${repetition}`;

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
