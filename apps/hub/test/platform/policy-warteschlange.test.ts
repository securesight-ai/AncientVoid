import { describe, expect, it } from "vitest";
import { policyFor } from "@ancientvoid/contracts";
import { operationOf } from "../../src/platform/policy.ts";

/**
 * Nutzerfund 23.11.2026: in einer Sitzung, die auf dem anderen Rechner läuft,
 * ließen sich vorgemerkte Meldungen weder ändern noch streichen. Die
 * /queue-Routen hatten kein Policy-Mapping und fielen unter den Fail-closed-
 * Fallback (nur wer `tokens.manage` darf, kommt durch) — die Flotte war draußen.
 */
describe("policy: Warteschlange einer Sitzung (Nutzerfund 23.11.2026)", () => {
  it("Text ändern, umhängen, streichen und sofort senden sind eine eigene Operation", () => {
    expect(operationOf("PATCH", "/api/sessions/s1/queue/q1", { text: "neu" })).toBe("sessions.queue");
    expect(operationOf("PATCH", "/api/sessions/s1/queue/q1", { move: "front" })).toBe("sessions.queue");
    expect(operationOf("DELETE", "/api/sessions/s1/queue/q1", undefined)).toBe("sessions.queue");
    expect(operationOf("POST", "/api/sessions/s1/queue/q1/send", {})).toBe("sessions.queue");
  });

  it("die Liste lesen bleibt gewöhnliches Lesen", () => {
    expect(operationOf("GET", "/api/sessions/s1/queue", undefined)).toBe("read");
  });

  it("Mensch und Flotte dürfen die Warteschlange bedienen, ein Agent nicht", () => {
    expect(policyFor("sessions.queue", "handy")).toBe("allow");
    expect(policyFor("sessions.queue", "fleet:cachyos-ai")).toBe("allow");
    expect(policyFor("sessions.queue", "agent:pi")).toBe("deny");
    expect(policyFor("sessions.queue", "display:flur")).toBe("deny");
  });

  it("andere Sitzungs-Wege bleiben bei ihrer eigenen Operation (kein Überlappen)", () => {
    expect(operationOf("POST", "/api/sessions/s1/steer", { kind: "prompt", text: "x" })).toBe("sessions.prompt");
    expect(operationOf("DELETE", "/api/sessions/s1", undefined)).toBe("sessions.archive");
    expect(operationOf("GET", "/api/sessions/s1/queue/q1/content", undefined)).toBe("read");
  });
});
