import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readCorpus } from "./corpus.mjs";
import { selectedSource, testNames, unnamed } from "./solvability.mjs";

describe("P84 frozen corpus", () => {
  it("pins fifteen distinct historical changes, one negative control and a shared split subset", () => {
    const { tasks, hash } = readCorpus();
    expect(tasks).toHaveLength(16);
    expect(new Set(tasks.map((task) => task.start)).size).toBe(16);
    expect(tasks.filter((task) => task.split)).toHaveLength(4);
    const negative = tasks.filter((task) => task.negative);
    expect(negative).toHaveLength(1);
    expect(negative[0]).toMatchObject({ split: false });
    expect(negative[0].start).toBe(negative[0].reference);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("names every identifier a hidden check needs that the start revision does not have", () => {
    const root = resolve(import.meta.dirname, "../..");
    const missing = readCorpus().tasks.filter((task) => !task.negative)
      .flatMap((task) => unnamed(root, task).map((name) => `${task.id}: ${name}`));
    expect(missing).toEqual([]);
  }, 60_000);

  it("P90 binds a repo-specific task corpus to its digest and rejects metadata paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "p90-corpus-"));
    const file = join(dir, "tasks.json");
    const entry = { ...readCorpus().tasks[0], test: "test/format.test.ts", editable: ["src/format.ts"] };
    const freeze = () => {
      const data = JSON.stringify({ version: 1, tasks: [entry] });
      writeFileSync(file, data);
      writeFileSync(`${file}.sha256`, createHash("sha256").update(data).digest("hex"));
    };
    try {
      freeze();
      expect(readCorpus(file).tasks).toEqual([entry]);
      writeFileSync(file, "changed");
      expect(() => readCorpus(file)).toThrow("corpus hash mismatch");
      entry.editable = [".git/config"];
      freeze();
      expect(() => readCorpus(file)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("P84 solvability scan", () => {
  const source = [
    'describe("x", () => {',
    "  const helperName = 1; // commentName",
    '  it("chosen case", () => {',
    '    expect(chosenCall("plain-text word:key_name", "other words")).toBe(1);',
    "  });",
    '  it("other case", () => {',
    "    skippedCall();",
    "  });",
    "});",
  ].join("\n");

  it("reads the selected cases and shared setup, but no comments or prose", () => {
    const names = testNames(selectedSource(source, "chosen"));
    expect([...names]).toEqual(expect.arrayContaining(["helperName", "chosenCall", "word:key_name"]));
    for (const name of ["commentName", "skippedCall", "plain", "other"]) expect(names).not.toContain(name);
  });

  it("fails when the selector matches no case", () => {
    expect(() => selectedSource(source, "missing")).toThrow("matches no test case");
  });
});
