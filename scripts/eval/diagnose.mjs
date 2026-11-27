// P84: erklärt je Lauf, wie sein Ergebnis zustande kam — nachträglich aus Sitzungsjournal und
// Arbeitskopie, ohne LLM. Die Zahlen beschreiben Verhalten; sie belegen keine Ursache.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const jsonLines = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const UUID = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;
// Werkzeugnamen der Harnesses, wenn das Ereignis keine ACP-Art mitbringt.
const CATEGORY = { read: "read", grep: "search", glob: "search", search: "search", edit: "edit", write: "edit", bearbeiten: "edit", bash: "execute", shell: "execute", eval: "execute" };
// Nur Aufrufe zählen, nicht Dateinamen: Das Programm steht am Befehlsanfang oder hinter einem Starter.
const invoked = (program) => `(?:^|[;&|("']\\s*|\\bnpx\\s+(?:--\\S+\\s+)*|node_modules/(?:\\.bin/|${program}/(?:bin/)?))${program}(?:\\.mjs|\\.js)?(?=[\\s;&|)"']|$)`;
const npmScript = (name) => `\\bnpm\\s+(?:(?:-w|--workspace)[\\s=]\\S+\\s+|-s\\s+)*(?:run\\s+(?:-s\\s+)?)?${name}(?::[\\w-]+)?(?=[\\s;&|)"']|$)`;
const CHECKS = {
  test: new RegExp(`${invoked("vitest")}|${invoked("playwright")}|${npmScript("test")}`, "m"),
  lint: new RegExp(`${invoked("eslint")}|${npmScript("lint")}`, "m"),
  typecheck: new RegExp(`${invoked("tsc")}|${npmScript("typecheck")}`, "m"),
};

// Vom Harness abgelehnt, nicht an der Aufgabe gescheitert: verfälscht den Vergleich und muss sichtbar sein.
const DENIED = /Auto mode is unavailable|Permission to use \S+ has been denied|requires approval/i;
const TEST_FILE = /(?:^|\/)(?:test|tests|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

const category = (name = "", kind) => (kind && kind !== "other" ? kind : CATEGORY[name.toLowerCase()]) ?? "other";

export function journalFacts(events) {
  const workspace = events.find((event) => event.payload?.kind === "session.created")?.payload.project;
  const clean = (text) => (workspace ? text.replaceAll(workspace, "<workspace>") : text).replaceAll(homedir(), "~");
  const time = (event) => Date.parse(event.ts);
  const start = events.find((event) => event.type === "user");
  const end = events.findLast((event) => event.payload?.kind === "session.turn_end") ?? events.at(-1);
  const tools = { read: 0, search: 0, edit: 0, execute: 0, other: 0 };
  const checks = { test: 0, lint: 0, typecheck: 0 };
  const names = new Map();
  const errorSamples = [];
  let toolErrors = 0;
  let deniedCalls = 0;
  let firstEdit = null;
  let answer = [];
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "assistant") answer.push(payload.text ?? event.summary);
    if (event.type === "tool_use") {
      answer = [];
      const kind = category(payload.name, payload.kind);
      tools[kind] = (tools[kind] ?? 0) + 1;
      names.set(payload.id, payload.name);
      if (kind === "edit") firstEdit ??= time(event);
      const command = payload.input?.command;
      if (typeof command === "string") for (const [check, pattern] of Object.entries(CHECKS)) if (pattern.test(command)) checks[check]++;
    }
    if (event.type === "tool_result" && (payload.isError || payload.exitCode > 0)) {
      toolErrors++;
      if (DENIED.test(event.summary)) deniedCalls++;
      if (errorSamples.length < 5) errorSamples.push(clean(`${names.get(payload.toolUseId) ?? "?"}: ${event.summary}`).slice(0, 240));
    }
  }
  return {
    durationMs: start && end ? time(end) - time(start) : null,
    msToFirstEdit: start && firstEdit !== null ? firstEdit - time(start) : null,
    tools, toolErrors, deniedCalls, checks,
    providerErrors: events.filter((event) => event.payload?.kind === "provider.error").length,
    errorSamples,
    finalAnswer: clean(answer.join("")).slice(-1500),
  };
}

export async function workspaceFacts(directory, editable) {
  if (!existsSync(join(directory, ".git"))) return null;
  const git = async (...args) => (await run("git", ["-c", "core.quotepath=off", ...args], { cwd: directory, maxBuffer: 1 << 26 })).stdout.split("\n").filter(Boolean);
  // Gegen den ersten Commit: Auch was der Agent selbst committet hat, zählt als Änderung.
  const [start] = await git("rev-list", "--max-parents=0", "HEAD");
  const files = (await git("diff", "--numstat", "--no-renames", start)).map((line) => {
    const [added, removed, path] = line.split("\t");
    return { path, added: added === "-" ? null : Number(added), removed: removed === "-" ? null : Number(removed) };
  });
  for (const path of await git("ls-files", "--others", "--exclude-standard")) files.push({ path, added: null, removed: null });
  const marked = files.filter((file) => !file.path.startsWith(".p84-")).map((file) => ({ ...file, allowed: editable.includes(file.path) }));
  const outside = marked.filter((file) => !file.allowed).map((file) => file.path);
  return { files: marked, testFiles: outside.filter((path) => TEST_FILE.test(path)), outsideEditable: outside.filter((path) => !TEST_FILE.test(path)) };
}

/** Alle erfassten und abgebrochenen Läufe einer Serie. Fehlende Journale brechen laut ab. */
export async function diagnoseSeries({ receipts, data, tasks }) {
  const abortedPath = join(dirname(receipts), "aborted.jsonl");
  const aborted = (existsSync(abortedPath) ? jsonLines(abortedPath) : []).map(({ key, cause, message }) => {
    const sessionId = message.split(": ").find((part) => UUID.test(part) && part.length === 36);
    if (!sessionId) throw new Error(`Aborted run ${key} names no session`);
    return { key, sessionId, cause };
  });
  const rows = [];
  for (const { key, sessionId, cause } of [...jsonLines(receipts), ...aborted]) {
    const [arm, taskId, repetition] = key.split("/");
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || !UUID.test(sessionId)) throw new Error(`Unknown run: ${key}`);
    const events = jsonLines(join(data, "sessions", sessionId, "events.jsonl"));
    const input = events.findLast((event) => event.payload?.kind === "evaluation.completed")?.payload.result.input;
    if (!cause && !input) throw new Error(`Run ${key} has no recorded verdict`);
    const outcome = cause ?? (input.acceptance && input.lint && input.typecheck ? "pass" : "fail");
    const project = events.find((event) => event.payload?.kind === "session.created")?.payload.project;
    rows.push({
      key, arm, task: taskId, repetition: Number(repetition), sessionId, outcome,
      verdict: input ? { acceptance: input.acceptance, lint: input.lint, typecheck: input.typecheck } : null,
      journal: journalFacts(events),
      workspace: project ? await workspaceFacts(project, task.editable) : null,
    });
  }
  return rows;
}

const median = (values) => {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return "–";
  const value = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  return String(Math.round(value * 10) / 10);
};

export function diagnosisTable(rows) {
  const arms = [...new Set(rows.map((row) => row.arm))].sort();
  const lines = arms.map((arm) => {
    const own = rows.filter((row) => row.arm === arm);
    const count = (test) => own.filter(test).length;
    const of = (pick) => median(own.map(pick));
    return `| ${[arm, own.length, count((row) => row.outcome === "pass"), count((row) => row.outcome === "fail"), count((row) => !["pass", "fail"].includes(row.outcome)),
      of((row) => Object.values(row.journal.tools).reduce((sum, value) => sum + value, 0)), of((row) => row.journal.toolErrors), count((row) => row.journal.deniedCalls > 0),
      `${count((row) => row.journal.checks.test > 0)}/${own.length}`, of((row) => (row.journal.msToFirstEdit === null ? null : row.journal.msToFirstEdit / 1000)),
      count((row) => row.workspace?.testFiles.length), count((row) => row.workspace?.outsideEditable.length)].join(" | ")} |`;
  });
  return [
    "| Arm | Läufe | bestanden | gescheitert | abgebrochen | Werkzeugaufrufe (Median) | Werkzeugfehler (Median) | Läufe mit abgelehnten Aufrufen | selbst getestet | s bis zur ersten Änderung (Median) | Läufe mit eigener Testdatei | Läufe mit Quelländerung außerhalb |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...lines,
  ].join("\n");
}
