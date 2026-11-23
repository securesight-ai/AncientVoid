import { describe, expect, it } from "vitest";
import type { NormalizedEvent, TurnMetric } from "@ancientvoid/contracts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { deriveTurnMetrics, estimateRun, TurnMetricStore } from "../../../src/modules/runs/index.ts";

const T0 = Date.parse("2026-10-27T10:00:00.000Z");
let seq = 0;
function ev(offsetS: number, type: NormalizedEvent["type"], extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { seq: ++seq, ts: new Date(T0 + offsetS * 1000).toISOString(), sessionId: "s1", type, summary: type, payload: {}, blobRef: null, ...extra };
}
const turnEnd = (offsetS: number, code = 0) => ev(offsetS, "system", { payload: { kind: "session.turn_end", code } });
const who = { sessionId: "s1", adapter: "claude", model: "opus" };

describe("deriveTurnMetrics", () => {
  it("misst Dauer, Tokens (Quelle), Kosten und Werkzeuge je Zug", () => {
    seq = 0;
    const events = [
      ev(0, "user"),
      ev(2, "tool_use"),
      ev(5, "assistant", { tokensEst: 100, tokensSource: "native", costUsd: 0.01 }),
      ev(8, "assistant", { tokensEst: 50, tokensSource: "estimated" }),
      turnEnd(10),
      ev(20, "user"),
      ev(25, "assistant"),
      turnEnd(30),
    ];
    const turns = deriveTurnMetrics(events, who);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turn: 1, durationMs: 10_000, tokens: 150, tokensSource: "estimated", costUsd: 0.01, toolCalls: 1, events: 4, outcome: "ok" });
    // nichts gemeldet ist null, nie 0 (R9.7)
    expect(turns[1]).toMatchObject({ turn: 2, durationMs: 10_000, tokens: null, tokensSource: null, costUsd: null });
  });

  it("zählt Fehler-Events und Exit-Code ≠ 0 als error und ist reihenfolgeunabhängig", () => {
    seq = 0;
    const a = [ev(0, "user"), ev(3, "error"), turnEnd(4)];
    const b = [ev(0, "user"), ev(3, "assistant"), turnEnd(4, 1)];
    expect(deriveTurnMetrics(a, who)[0]!.outcome).toBe("error");
    expect(deriveTurnMetrics(b, who)[0]!.outcome).toBe("error");
    expect(deriveTurnMetrics([...a].reverse(), who)).toEqual(deriveTurnMetrics(a, who));
  });

  it("überspringt ein turn_end ohne vorherige Events", () => {
    seq = 0;
    expect(deriveTurnMetrics([turnEnd(1)], who)).toEqual([]);
  });
});

describe("estimateRun", () => {
  const turn = (durationMs: number, outcome: "ok" | "error" = "ok", tokens: number | null = null) => ({ durationMs, tokens, outcome });
  it("gibt unter 5 Zügen keine Zahl aus", () => {
    expect(estimateRun([], "adapter").state).toBe("no-data");
    expect(estimateRun([turn(1000), turn(2000)], "adapter")).toMatchObject({ state: "too-few", n: 2, medianMs: null, p80Ms: null });
  });
  it("Median und P80 über erfolgreiche Züge; Fehlerzüge zählen nicht", () => {
    const est = estimateRun([turn(10_000), turn(20_000), turn(30_000), turn(40_000), turn(50_000), turn(1, "error")], "model");
    expect(est).toMatchObject({ state: "ok", n: 5, basis: "model", medianMs: 30_000, p80Ms: 42_000 });
  });
  it("Tokens pro Sekunde nur mit genug Messwerten", () => {
    const withTokens = [1, 2, 3, 4, 5].map((i) => turn(10_000, "ok", 100 * i));
    expect(estimateRun(withTokens, "adapter").tokensPerSec).toBe(30);
    expect(estimateRun([...withTokens.slice(0, 3), turn(10_000), turn(10_000)], "adapter").tokensPerSec).toBeNull();
  });
});

describe("TurnMetricStore", () => {
  const row = (n: number, durationMs: number, adapter = "claude", model: string | null = "opus", sessionId = "s1"): TurnMetric => ({
    sessionId, turn: n, adapter, model, startedAt: "2026-10-27T10:00:00.000Z", endedAt: `2026-10-27T10:0${n}:00.000Z`,
    durationMs, tokens: null, tokensSource: null, costUsd: null, events: 1, toolCalls: 0, outcome: "ok",
  });

  it("ersetzt eine Session idempotent und schätzt nach Modell, sonst nach Adapter", () => {
    const store = new TurnMetricStore(new HubDatabase(":memory:"));
    store.replaceSession("s1", [1, 2, 3, 4, 5].map((n) => row(n, n * 1000)));
    store.replaceSession("s1", [1, 2, 3, 4, 5].map((n) => row(n, n * 1000)));
    expect(store.listBySession("s1")).toHaveLength(5);
    expect(store.hasSession("s1")).toBe(true);
    expect(store.hasSession("nope")).toBe(false);
    expect(store.estimate("claude", "opus")).toMatchObject({ state: "ok", basis: "model", n: 5 });
    // anderes Modell ohne Daten → Rückfall auf den Adapter
    expect(store.estimate("claude", "haiku")).toMatchObject({ state: "ok", basis: "adapter", n: 5 });
    expect(store.estimate("codex", null)).toMatchObject({ state: "no-data" });
    expect(store.summary()).toEqual([{ adapter: "claude", model: "opus", turns: 5, medianMs: 3000 }]);
    // Eigene Züge der Session haben Vorrang, aber erst ab 5 — sonst gilt weiter Modell/Adapter.
    store.replaceSession("s2", [1, 2, 3, 4, 5].map((n) => row(n, n * 10_000, "claude", "opus", "s2")));
    expect(store.estimate("claude", "opus", "s2")).toMatchObject({ state: "ok", basis: "session", n: 5, medianMs: 30_000 });
    store.replaceSession("s3", [1, 2].map((n) => row(n, 99_000, "claude", "opus", "s3")));
    expect(store.estimate("claude", "opus", "s3")).toMatchObject({ basis: "model" });
  });

  it("BUG-0167: eigene Züge der Session unabhängig von MIN_TURNS mitgeben — der Client-Reload kennt sein Fenster nicht", () => {
    const store = new TurnMetricStore(new HubDatabase(":memory:"));
    store.replaceSession("a1", [1, 2].map((n) => row(n, n * 1000, "claude", "opus", "a1")));
    // Fallback-Kette bleibt wie sie ist (a1 selbst zu klein → Modell/Adapter),
    // aber Median und Zahl der eigenen Züge stehen mit dabei.
    expect(store.estimate("claude", "opus", "a1")).toMatchObject({ state: "too-few", sessionTurns: 2, sessionMedianMs: 1500 });
    // Ohne Session-ID (Status-Seite) bleiben die Felder weg.
    expect(store.estimate("claude", "opus")).not.toHaveProperty("sessionTurns");
    // Ein einziger Zug ist keine Statistik — auch serverseitig nicht.
    store.replaceSession("a3", [row(1, 4000, "claude", "haiku3", "a3")]);
    expect(store.estimate("claude", "haiku3", "a3")).toMatchObject({ sessionTurns: 1, sessionMedianMs: null });
  });
});
