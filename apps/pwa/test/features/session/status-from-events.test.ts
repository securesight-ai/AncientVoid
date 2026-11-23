import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";
import { statusHintFromBatch, statusHintFromEvent } from "../../../src/features/session/status-from-events.ts";
import { turnsOf } from "../../../src/features/session/turns.ts";

function ev(type: string, payload: Record<string, unknown> = {}, seq = 1): NormalizedEvent {
  return {
    seq,
    ts: "2026-11-23T12:00:00.000Z",
    type,
    sessionId: "s",
    summary: type,
    payload,
  } as NormalizedEvent;
}

describe("statusHintFromEvent — WS setzt Status ohne 3s-Poll", () => {
  it("turn_end → idle (Antwort ist fertig, Session bereit)", () => {
    expect(statusHintFromEvent(ev("system", { kind: "session.turn_end", code: 0 }))).toBe("idle");
  });

  it("turn_end mit reason error/interrupted bleibt ehrlich", () => {
    expect(statusHintFromEvent(ev("system", { kind: "session.turn_end", reason: "error" }))).toBe("error");
    expect(statusHintFromEvent(ev("system", { kind: "session.turn_end", reason: "interrupted" }))).toBe("interrupted");
  });

  it("prompt/resumed → working; start_failed → error", () => {
    expect(statusHintFromEvent(ev("system", { kind: "session.prompt" }))).toBe("working");
    expect(statusHintFromEvent(ev("system", { kind: "session.resumed" }))).toBe("working");
    expect(statusHintFromEvent(ev("system", { kind: "session.start_failed" }))).toBe("error");
  });

  it("assistant/tool_use ändern den Status nicht", () => {
    expect(statusHintFromEvent(ev("assistant", { text: "hi" }))).toBeNull();
    expect(statusHintFromEvent(ev("tool_use", { id: "a", name: "Read" }))).toBeNull();
  });

  it("Batch: späteres Ereignis gewinnt (prompt dann turn_end → idle)", () => {
    expect(
      statusHintFromBatch([
        ev("system", { kind: "session.prompt" }, 1),
        ev("assistant", { text: "fertig" }, 2),
        ev("system", { kind: "session.turn_end", code: 0 }, 3),
      ]),
    ).toBe("idle");
  });
});

describe("turn_end + idle: letzte Antwort steht als Bubble, nicht im laufenden Zug", () => {
  it("ohne Status-Hinweis (live=true) bleibt die Antwort in der Arbeit — genau der sichtbare Bug", () => {
    const events = [
      ev("user", { kind: "session.prompt" }, 1),
      ev("tool_use", { id: "a", name: "Read", input: { file_path: "a.ts" } }, 2),
      ev("tool_result", { toolUseId: "a", content: "x" }, 3),
      ev("assistant", { text: "hier die Antwort" }, 4),
    ];
    const live = turnsOf(events, true);
    const work = live.find((i) => i.kind === "work");
    expect(work && work.kind === "work" && work.running).toBe(true);
    expect(live.some((i) => i.kind === "event" && i.event.type === "assistant")).toBe(false);
  });

  it("mit turn_end (wie nach statusHint → idle) ist die Antwort eine eigene Bubble und nichts läuft", () => {
    const events = [
      ev("user", { kind: "session.prompt" }, 1),
      ev("tool_use", { id: "a", name: "Read", input: { file_path: "a.ts" } }, 2),
      ev("tool_result", { toolUseId: "a", content: "x" }, 3),
      ev("assistant", { text: "hier die Antwort" }, 4),
      ev("system", { kind: "session.turn_end", code: 0 }, 5),
    ];
    // live=true wäre der 3s-Poll-Lag — turn_end schließt trotzdem.
    const items = turnsOf(events, true);
    expect(items.some((i) => i.kind === "work" && i.running)).toBe(false);
    const answer = items.find((i) => i.kind === "event" && i.event.type === "assistant");
    expect(answer && answer.kind === "event" && answer.event.payload.text).toBe("hier die Antwort");
    expect(statusHintFromBatch(events)).toBe("idle");
  });
});
