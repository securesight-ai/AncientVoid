import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { failuresOf } from "./acceptance.mjs";
import { diagnoseSeries, diagnosisTable, journalFacts } from "./diagnose.mjs";
import { snapshotWorkspace } from "./workspace.mjs";

const at = (second) => new Date(Date.UTC(2026, 10, 26, 10, 0, second)).toISOString();
const event = (second, type, payload, summary = "") => ({ ts: at(second), type, payload, summary });
const call = (second, id, name, input = {}, kind) => event(second, "tool_use", { id, name, input, ...(kind ? { kind } : {}) });
const result = (second, id, extra = {}, summary = "ok") => event(second, "tool_result", { toolUseId: id, isError: false, ...extra }, summary);

const journal = (workspace) => [
  event(0, "system", { kind: "session.created", project: workspace }, "session.created"),
  event(1, "user", { kind: "session.prompt", text: "Aufgabe" }),
  call(2, "a", "Read", { file_path: `${workspace}/apps/a.ts` }),
  result(3, "a"),
  call(4, "b", "grep", {}, "search"),
  result(4, "b"),
  call(9, "c", "Bearbeiten", { files: [] }, "edit"),
  result(9, "c"),
  call(10, "d", "Shell", { command: "/usr/bin/bash -lc \"npx vitest run apps/a.test.ts && npm run -s typecheck\"" }),
  result(11, "d", { exitCode: 1 }, `FAIL ${workspace}/apps/a.test.ts`),
  call(12, "e", "bash", { command: "cat vitest.config.ts; ls node_modules/eslint" }, "execute"),
  result(13, "e"),
  call(14, "f", "shell", { command: "npm run lint" }, "execute"),
  result(15, "f", { isError: true }, "lint kaputt"),
  call(15, "h", "Write", { file_path: "x" }),
  result(15, "h", { isError: true }, "Auto mode is unavailable: its safety check does not run"),
  event(16, "assistant", { text: "Zwischenstand" }),
  call(17, "g", "Skill", { skill: "x" }),
  result(17, "g"),
  event(18, "assistant", { text: "Fertig: " }),
  event(19, "assistant", { text: `siehe ${workspace}/apps/a.ts` }),
  event(20, "system", { kind: "session.turn_end", code: 0 }),
];

describe("P84 run diagnosis", () => {
  const temporary = [];
  afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

  it("counts tools, own checks, failures and the final answer across harness names", () => {
    expect(journalFacts(journal("/w"))).toEqual({
      durationMs: 19_000,
      msToFirstEdit: 8_000,
      tools: { read: 1, search: 1, edit: 2, execute: 3, other: 1 },
      toolErrors: 3,
      deniedCalls: 1,
      checks: { test: 1, lint: 1, typecheck: 1 },
      providerErrors: [],
      errorSamples: ["Shell: FAIL <workspace>/apps/a.test.ts", "shell: lint kaputt", "Write: Auto mode is unavailable: its safety check does not run"],
      finalAnswer: "Fertig: siehe <workspace>/apps/a.ts",
    });
  });

  it("describes recorded and aborted runs with their changed files, also after an agent commit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p84-diagnose-"));
    temporary.push(dir);
    const sessions = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const workspace = join(dir, "build");
    mkdirSync(join(workspace, "apps"), { recursive: true });
    writeFileSync(join(workspace, "apps/a.ts"), "one\n");
    await snapshotWorkspace(workspace);
    writeFileSync(join(workspace, "apps/a.ts"), "two\nthree\n");
    await snapshotWorkspace(workspace);
    writeFileSync(join(workspace, "apps/extra.ts"), "new\n");
    writeFileSync(join(workspace, "apps/a.test.ts"), "test\n");
    const verdict = { type: "system", ts: at(30), summary: "evaluation.completed", payload: { kind: "evaluation.completed", result: { input: { acceptance: false, lint: true, typecheck: true }, phases: [{ turnErrors: 0 }] } } };
    for (const [index, id] of sessions.entries()) {
      mkdirSync(join(dir, "sessions", id), { recursive: true });
      const events = [...journal(workspace), ...(index ? [] : [verdict])];
      writeFileSync(join(dir, "sessions", id, "events.jsonl"), events.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    }
    const receipts = join(dir, "sessions.jsonl");
    writeFileSync(receipts, `${JSON.stringify({ key: "arm-plain/task/1", sessionId: sessions[0] })}\n`);
    writeFileSync(join(dir, "aborted.jsonl"), `${JSON.stringify({ key: "arm-plain/task/2", cause: "timeout", message: `P84 s at /x: ${sessions[1]}: timed out` })}\n`);
    const tasks = [{ id: "task", editable: ["apps/a.ts"] }];

    const rows = await diagnoseSeries({ receipts, data: dir, tasks });
    // Wie die Zusammenfassung der App: Ein Zug mit Fehler ist nie „bestanden“; ein Anbieterausfall heißt so.
    const cut = join(dir, "sessions", sessions[0], "events.jsonl");
    const outage = [{ type: "system", ts: at(29), summary: "Kontingent", payload: { kind: "provider.error", category: "quota" } },
      { ...verdict, payload: { ...verdict.payload, result: { input: { acceptance: true, lint: true, typecheck: true }, phases: [{ turnErrors: 1 }] } } }];
    appendFileSync(cut, outage.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const [interrupted] = await diagnoseSeries({ receipts, data: dir, tasks });
    expect(interrupted).toMatchObject({ outcome: "provider:quota", verdict: { acceptance: true, turnErrors: 1 }, journal: { providerErrors: ["quota"] } });
    expect(rows.map((row) => [row.key, row.outcome])).toEqual([["arm-plain/task/1", "fail"], ["arm-plain/task/2", "timeout"]]);
    expect(rows[0].workspace).toEqual({
      files: [
        { path: "apps/a.ts", added: 2, removed: 1, allowed: true },
        { path: "apps/a.test.ts", added: null, removed: null, allowed: false },
        { path: "apps/extra.ts", added: null, removed: null, allowed: false },
      ],
      testFiles: ["apps/a.test.ts"],
      outsideEditable: ["apps/extra.ts"],
    });
    expect(diagnosisTable(rows)).toContain("| arm-plain | 2 | 0 | 1 | 1 | 8 | 3 | 2 | 2/2 | 8 | 2 | 2 |");
  });

  it("fails loud when a journal is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p84-diagnose-"));
    temporary.push(dir);
    const receipts = join(dir, "sessions.jsonl");
    writeFileSync(receipts, `${JSON.stringify({ key: "a/task/1", sessionId: "33333333-3333-4333-8333-333333333333" })}\n`);
    await expect(diagnoseSeries({ receipts, data: dir, tasks: [{ id: "task", editable: [] }] })).rejects.toThrow("ENOENT");
  });
});

describe("P84 acceptance failures", () => {
  it("keeps failed cases and an unloadable test file, without the workspace path", () => {
    const report = { testResults: [
      { status: "failed", assertionResults: [
        { status: "passed", fullName: "ok" },
        { status: "failed", fullName: "suite broken", failureMessages: [`expected 1\n at /w/judge/a.ts ${"x".repeat(900)}`] },
      ] },
      { status: "failed", assertionResults: [], message: "Cannot find module /w/judge/missing.ts" },
      { status: "passed", assertionResults: [] },
    ] };
    const failures = failuresOf(report, "/w/judge");
    expect(failures.map((entry) => entry.name)).toEqual(["suite broken", "<testdatei>"]);
    expect(failures[0].message).toHaveLength(800);
    expect(failures[0].message).toContain("<workspace>/a.ts");
    expect(failures[1].message).toBe("Cannot find module <workspace>/missing.ts");
  });
});
