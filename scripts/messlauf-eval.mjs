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
import { extractRuns } from "./skill-runs.mjs";

const { positionals: [mode], values: options } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(["protocol", "series", "scratch", "first", "repeat", "report", "data"].map((key) => [key, { type: "string" }])),
});
const root = resolve(import.meta.dirname, "..");
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
  if (!["plan", "check", "run", "report"].includes(mode)) {
    console.log("Usage: npm run messlauf:eval -- <plan|check|run|report> --protocol <file>\n" +
      "run: --scratch <hub project root> --series <name>\n" +
      "report: --first <sessions.jsonl> --repeat <sessions.jsonl> --data <hub data dir> --report <dated markdown path>");
    if (mode) process.exitCode = 2;
    return;
  }
  const plan = planSeries(JSON.parse(readFileSync(required("protocol"), "utf8")), readCorpus());
  if (mode === "plan") {
    console.log(JSON.stringify({ protocolHash: plan.protocolHash, corpusHash: plan.corpus.hash, arms: plan.arms, runs: plan.jobs.length }, null, 2));
    return;
  }
  const api = connectHub(process.env.ANCIENTVOID_URL, process.env.ANCIENTVOID_TOKEN);
  if (mode === "check") {
    await preflight(api, plan.config);
    console.log("P84 preflight passed");
    return;
  }
  if (mode === "run") {
    const scratch = await realpath(required("scratch"));
    if (!(await stat(scratch)).isDirectory() || scratch === root) throw new Error("Use a separate scratch project root");
    const series = required("series");
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(series)) throw new Error("Invalid series name");
    const receipts = await runSeries(api, root, scratch, series, plan);
    console.log(`P84 ${series}: ${plan.jobs.length} results recorded in the hub. Session references: ${receipts}`);
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
});
