import { describe, expect, it } from "vitest";
import { readCorpus } from "./corpus.mjs";

describe("P84 frozen corpus", () => {
  it("pins twelve distinct historical regressions, one negative control and a shared split subset", () => {
    const { tasks, hash } = readCorpus();
    expect(tasks).toHaveLength(13);
    expect(new Set(tasks.map((task) => task.start)).size).toBe(13);
    expect(tasks.filter((task) => task.split)).toHaveLength(4);
    const negative = tasks.filter((task) => task.negative);
    expect(negative).toHaveLength(1);
    expect(negative[0]).toMatchObject({ split: false });
    expect(negative[0].start).toBe(negative[0].reference);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
