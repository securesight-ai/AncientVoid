import { describe, expect, it } from "vitest";
import { readCorpus } from "./corpus.mjs";

describe("P84 frozen corpus", () => {
  it("pins twelve distinct historical regressions and a shared split subset", () => {
    const { tasks, hash } = readCorpus();
    expect(tasks).toHaveLength(12);
    expect(new Set(tasks.map((task) => task.start)).size).toBe(12);
    expect(tasks.filter((task) => task.split)).toHaveLength(4);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
