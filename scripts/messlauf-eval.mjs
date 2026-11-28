#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { execFile } from "node:child_process";
import { hostname, platform } from "node:os";
import { readCorpus } from "./eval/corpus.mjs";
import { connectHub, preflight } from "./eval/hub.mjs";
import { planSeries } from "./eval/protocol.mjs";
import { runSeries } from "./eval/run-series.mjs";
import { renderReport } from "./eval/report.mjs";
import { exportSeries } from "./eval/export.mjs";
import { diagnoseSeries, diagnosisTable } from "./eval/diagnose.mjs";
import { renderPilotReport } from "./eval/pilot-report.mjs";
import { extractRuns } from "./skill-runs.mjs";

const { positionals: [mode], values: options } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries([...["protocol", "corpus", "series", "scratch", "first", "repeat", "report", "data", "out", "invalid", "invalid-reason", "skip-provider"].map((key) => [key, { type: "string" }]), ["partial", { type: "boolean" }], ["resume", { type: "boolean" }]]),
});
const root = resolve(import.meta.dirname, "..");
const stopWhenDetached = () => process.exit(1);
if (process.connected) process.once("disconnect", stopWhenDetached);
const required = (key) => {
  if (!options[key]) throw new Error(`--${key} is required`);
  return options[key];
};

async function readSeries(api, path) {
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const { sessionId, key } = JSON.parse(line);
    if (typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error(`Invalid session reference in ${path}`);
    const row = await api(`/api/sessions/${sessionId}/evaluation`);
    const { arm, task, repetition, phases } = row.input;
    if (key !== `${arm}/${task}/${repetition}` || phases.at(-1)?.sessionId !== sessionId) throw new Error(`Receipt mismatch in ${path} for ${sessionId}`);
    rows.push(row);
  }
  return rows;
}

async function main() {
  if (!["plan", "check", "run", "report", "export", "pilot-report", "diagnose"].includes(mode)) {
    console.log("Usage: npm run messlauf:eval -- <plan|check|run|report|export|pilot-report|diagnose> --protocol <file>\n" +
      "diagnose (ohne --protocol): --first <sessions.jsonl> --data <hub data dir> [--out <neue .jsonl>]\n" +
      "pilot-report: --series <name> --report docs/JJJJ-MM-TT_p84-pilotserie.md [--invalid-reason <text>]\n" +
      "export: --first <sessions.jsonl> --out <neuer Ordner im Benchmark-Repo> [--invalid <invalid.jsonl>] [--partial] [--data <hub data dir>]\n" +
      "run: --scratch <hub project root> --series <name> [--corpus <repo fixture manifest>] [--resume] [--skip-provider <name,…>]\n" +
      "report: --first <sessions.jsonl> --repeat <sessions.jsonl> --data <hub data dir> --report <dated markdown path>");
    if (mode) process.exitCode = 2;
    return;
  }
  // Ohne Protokoll und Hub: liest nur Belege, Journale und Arbeitskopien, auch von Serien eines älteren Korpus.
  const corpus = readCorpus(options.corpus);
  const diagnose = async () => diagnoseSeries({ receipts: required("first"), data: await realpath(required("data")), tasks: corpus.tasks });
  if (mode === "diagnose") {
    const rows = await diagnose();
    if (options.out) writeFileSync(options.out, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { flag: "wx" });
    console.log(diagnosisTable(rows));
    return;
  }
  const plan = planSeries(JSON.parse(readFileSync(required("protocol"), "utf8")), corpus);
  if (options.corpus && !plan.config.repoScan) throw new Error("A repository corpus requires a repoScan protocol with a source repo");
  if (mode === "plan") {
    console.log(JSON.stringify({ protocolHash: plan.protocolHash, corpusHash: plan.corpus.hash, arms: plan.arms, runs: plan.jobs.length }, null, 2));
    return;
  }
  const api = connectHub(process.env.ANCIENTVOID_URL, process.env.ANCIENTVOID_TOKEN);
  const energyApi = process.env.ANCIENTVOID_EVAL_ENERGY_URL
    ? connectHub(process.env.ANCIENTVOID_EVAL_ENERGY_URL, process.env.ANCIENTVOID_EVAL_ENERGY_TOKEN)
    : api;
  // Git, npm and the benchmark's test processes do not need operator credentials.
  delete process.env.ANCIENTVOID_TOKEN;
  delete process.env.ANCIENTVOID_EVAL_ENERGY_TOKEN;
  if (mode === "check") {
    await preflight(api, plan.config, undefined, energyApi);
    console.log("P84 preflight passed");
    return;
  }
  if (mode === "run") {
    const scratch = await realpath(required("scratch"));
    const source = options.corpus ? await realpath(plan.config.repoScan.repo) : root;
    if (!(await stat(scratch)).isDirectory() || scratch === source) throw new Error("Use a separate scratch project root");
    const series = required("series");
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(series)) throw new Error("Invalid series name");
    const receipts = await runSeries(api, source, scratch, series, plan, {
      resume: options.resume === true, skipProviders: options["skip-provider"]?.split(",") ?? [], energyApi,
    });
    console.log(`P84 ${series}: run finished. Session references: ${receipts}`);
    return;
  }
  if (mode === "pilot-report") {
    const destination = required("report");
    const date = /(?:^|\/)(\d{4}-\d{2}-\d{2})_p84-[a-z0-9-]+\.md$/.exec(destination)?.[1];
    if (!date) throw new Error("Use docs/JJJJ-MM-TT_p84-<name>.md");
    const { stdout: sha } = await promisify(execFile)("git", ["rev-parse", "--short", "HEAD"], { cwd: root });
    const repo = plan.config.repoScan?.repo;
    const suffix = repo === undefined ? "" : `?repo=${encodeURIComponent(repo)}`;
    const markdown = renderPilotReport(await api(`/api/evaluation/series/${encodeURIComponent(required("series"))}${suffix}`), plan, {
      date, commit: sha.trim(), runtime: `${hostname()} / ${platform()} / Node ${process.version}`,
      valid: !options["invalid-reason"], invalidReason: options["invalid-reason"] ?? "",
    });
    writeFileSync(destination, markdown, { flag: "wx" });
    console.log(`P84 pilot report ${destination}`);
    return;
  }
  if (mode === "export") {
    const { stdout: sha } = await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root });
    const out = resolve(required("out"));
    const { manifest, files } = exportSeries({
      rows: await readSeries(api, required("first")), receipts: required("first"), invalid: options.invalid, plan, out,
      partial: options.partial === true, diagnosis: options.data ? await diagnose() : undefined,
      meta: { date: new Date().toISOString().slice(0, 10), commit: sha.trim(), runtime: `${hostname()} / ${platform()} / Node ${process.version}` },
    });
    console.log(`P84 export ${out}: ${files.join(", ")} · messung_gueltig=${manifest.messung_gueltig}`);
    return;
  }
  const destination = required("report");
  const date = /(?:^|\/)(\d{4}-\d{2}-\d{2})-p83-eval-kernserie\.md$/.exec(destination)?.[1];
  if (!date) throw new Error("Use JJJJ-MM-DD-p83-eval-kernserie.md");
  const data = await realpath(required("data"));
  const [first, repeat, { stdout: commit }] = await Promise.all([
    readSeries(api, required("first")),
    readSeries(api, required("repeat")),
    promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root }),
  ]);
  const sessionIds = new Set([...first, ...repeat].flatMap((row) => row.input.phases.map((phase) => phase.sessionId)));
  const skillRuns = extractRuns(data, { sessionIds });
  if (skillRuns.length !== sessionIds.size) throw new Error("Missing session journals for P72 skill extraction");
  const { markdown, reproduced } = renderReport(first, repeat, plan, {
    date, commit: commit.trim(), runtime: `${hostname()} / ${platform()} / Node ${process.version}`, skillRuns,
  });
  writeFileSync(destination, markdown, { flag: "wx" });
  if (!reproduced) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  process.off("disconnect", stopWhenDetached);
  if (process.connected) process.disconnect();
});
