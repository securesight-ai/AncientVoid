import { describe, expect, it } from "vitest";
import { renderFeedback, summariseFeedback } from "./optimizer-feedback.mjs";

/** EPIC-P90 T90.7: die Akzeptanzrate aus der Feedback-JSONL — Metrik (b) der Go-Regel. */
const entry = (over) => ({ ts: "2026-11-28T10:00:00.000Z", adapter: "pi", project: "/repo/a",
  original: "o", enhanced: "e", decision: "accepted", latencyMs: 400, ...over });

describe("summariseFeedback", () => {
  it("zählt Annahmen, Ablehnungen und Gruppen — unlesbare Zeilen zählen mit, crashen nicht", () => {
    const summary = summariseFeedback([
      entry({}),
      entry({ decision: "rejected", engine: "local", latencyMs: 200 }),
      entry({ decision: "accepted", engine: "local" }),
      entry({ decision: "accepted", project: "/repo/b", ts: "2026-11-28T12:00:00.000Z" }),
      null,
      { ts: "x", decision: "vielleicht" },
    ]);
    expect(summary).toMatchObject({ total: 4, accepted: 3, rejected: 1, rate: 0.75, malformed: 2 });
    expect(summary.window).toEqual({ first: "2026-11-28T10:00:00.000Z", last: "2026-11-28T12:00:00.000Z" });
    expect(summary.engines).toEqual([
      { name: "local", accepted: 1, total: 2, rate: 0.5 },
      { name: "unbekannt", accepted: 2, total: 2, rate: 1 },
    ]);
    expect(summary.projects).toEqual([
      { name: "/repo/a", accepted: 2, total: 3, rate: 2 / 3 },
      { name: "/repo/b", accepted: 1, total: 1, rate: 1 },
    ]);
    expect(summary.meanLatencyMs).toBe(350);
  });

  it("ohne Einträge bleibt die Rate offen statt null", () => {
    const summary = summariseFeedback([]);
    expect(summary.rate).toBeNull();
    expect(renderFeedback(summary)).toContain("noch nicht messbar");
  });

  it("der Bericht nennt die Rate und die stärkste Gruppe", () => {
    const text = renderFeedback(summariseFeedback([
      entry({ engine: "pi" }),
      entry({ engine: "pi" }),
      entry({ decision: "rejected", engine: "pi" }),
    ]));
    expect(text).toContain("2/3 angenommen (66.7 %)");
    expect(text).toContain("Engine pi: 2/3");
  });
});
