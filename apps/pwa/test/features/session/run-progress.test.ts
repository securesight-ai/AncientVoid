import { describe, expect, it, vi } from "vitest";
// EPIC-P61: Sprache auf Deutsch fixiert — Intl-Format und Katalogtexte der Tests sind de.
vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "ancientvoid.language" ? "de" : null), setItem: () => {}, removeItem: () => {} });
import { estimateText, quotaSummary, runProgress } from "../../../src/features/session/run-progress.ts";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";

const at = (s: number) => new Date(Date.UTC(2026, 8, 23, 12, 0, s)).toISOString();
const ev = (seq: number, sec: number, type: string, payload: Record<string, unknown>, summary = ""): NormalizedEvent => ({
  seq, ts: at(sec), sessionId: "s", type, summary, payload, blobRef: null,
});
const todos = (statuses: string[], tool = "todowrite") =>
  ({ id: "t", tool, input: { todos: statuses.map((status, i) => ({ content: `Aufgabe ${i}`, status })) } });

describe("runProgress", () => {
  it("P27: native resume starts a fresh elapsed clock and never reuses the interrupted plan", () => {
    const events = [
      ev(1, 0, "user", { kind: "session.prompt" }),
      ev(2, 10, "tool_use", todos(["completed", "pending"])),
      ev(3, 20, "system", { kind: "session.turn_end", reason: "interrupted" }),
      ev(4, 100, "system", { kind: "session.resumed" }),
    ];
    expect(runProgress(events, "interrupted", Date.parse(at(110)))).toBeNull();
    expect(runProgress(events, "working", Date.parse(at(110)))).toMatchObject({ elapsedMs: 10_000, source: "none", turnCount: 0 });
  });

  it("counts the agent's own plan and estimates the rest from measured velocity", () => {
    const events = [
      ev(1, 0, "user", { kind: "session.prompt", text: "los" }),
      ev(2, 10, "tool_use", todos(["pending", "pending", "pending", "pending"])),
      ev(3, 60, "tool_use", todos(["completed", "in_progress", "pending", "pending"])),
    ];
    const p = runProgress(events, "working", Date.parse(at(60)))!;
    expect(p).toMatchObject({ done: 1, total: 4, percent: 25, source: "todos", elapsedMs: 60_000 });
    // 1 item in the 10s→60s window → 3 remaining ≈ 150s (BUG-0062:
    // velocity between snapshots, not elapsed·(1-r)/r from turn start).
    expect(p.etaMs).toBe(150_000);
  });

  it("BUG-0062: a stale plan no longer inflates the ETA while time passes", () => {
    // Real-turn shape (2026-10-21): plan last advanced long ago, the agent
    // kept working without rewriting it. The display must not climb from
    // 25 min to ~2 h just because `now` moves.
    const events = [
      ev(1, 0, "user", { kind: "session.prompt", text: "los" }),
      ev(2, 210, "tool_use", todos(["completed", "pending", "pending", "pending", "pending", "pending", "pending", "pending"])),
      ev(3, 660, "tool_use", todos(["completed", "completed", "pending", "pending", "pending", "pending", "pending", "pending"])),
    ];
    const early = runProgress(events, "working", Date.parse(at(700)))!;
    const muchLater = runProgress(events, "working", Date.parse(at(1600)))!;
    // 1 item per 450s, 6 remaining → 2700s, and it stays exactly there.
    expect(early.etaMs).toBe(2_700_000);
    expect(muchLater.etaMs).toBe(2_700_000);
    expect(muchLater.elapsedMs).toBeGreaterThan(early.elapsedMs);
  });

  it("has no ETA before two progress snapshots — no guess (BUG-0062)", () => {
    // Plan first written with 1 item already done (common) — no velocity
    // measurable. The old formula answered elapsed·7 ≈ "noch ca. 7× so
    // lang wie bisher"; honesty beats that guess.
    const events = [
      ev(1, 0, "user", { kind: "session.prompt", text: "los" }),
      ev(2, 60, "tool_use", todos(["completed", "pending", "pending", "pending", "pending", "pending", "pending", "pending"])),
    ];
    const p = runProgress(events, "working", Date.parse(at(60)))!;
    expect(p.done).toBe(1);
    expect(p.total).toBe(8);
    expect(p.percent).toBe(13);
    expect(p.etaMs).toBeNull();
  });

  it("reads Claude's TodoWrite and leaves cancelled items out", () => {
    const events = [ev(1, 0, "user", { kind: "session.prompt", text: "x" }), ev(2, 30, "tool_use", { id: "c", name: "TodoWrite", input: { todos: [{ status: "completed" }, { status: "cancelled" }, { status: "pending" }] } })];
    expect(runProgress(events, "working", Date.parse(at(30)))).toMatchObject({ done: 1, total: 2, percent: 50 });
  });

  it("has no percent without a plan, and nothing when not working", () => {
    const events = [ev(1, 0, "user", { kind: "session.prompt", text: "x" }), ev(2, 5, "assistant", { text: "hi" })];
    expect(runProgress(events, "working", Date.parse(at(90)))).toMatchObject({ source: "none", percent: null, etaMs: null, elapsedMs: 90_000 });
    expect(runProgress(events, "idle", Date.parse(at(90)))).toBeNull();
  });

  it("BUG-0238: keeps reported todos visible while awaiting a question answer", () => {
    const events = [
      ev(1, 0, "user", { kind: "session.prompt" }),
      ev(2, 5, "tool_use", todos(["completed", "in_progress"])),
      ev(3, 10, "gate", { kind: "tool.permission_requested", question: true }),
    ];
    expect(runProgress(events, "waiting_approval", Date.parse(at(30)))).toMatchObject({
      percent: 50,
      etaMs: null,
      todos: [{ text: "Aufgabe 0", status: "completed" }, { text: "Aufgabe 1", status: "in_progress" }],
    });
  });

  it("only counts the plan of the current turn", () => {
    const events = [
      ev(1, 0, "user", { kind: "session.prompt", text: "a" }),
      ev(2, 5, "tool_use", todos(["completed", "completed"])),
      ev(3, 20, "user", { kind: "session.prompt", text: "b" }),
    ];
    expect(runProgress(events, "working", Date.parse(at(30)))).toMatchObject({ source: "none", elapsedMs: 10_000 });
  });

  it("without a plan, estimates a typical turn from finished turns across the session", () => {
    // Two finished turns (30 s, 90 s) plus the running third one — the
    // strip can honestly say "Zug hier meist 1 min" instead of nothing.
    const events = [
      ev(1, 0, "user", { kind: "session.prompt", text: "a" }),
      ev(2, 30, "system", { kind: "session.turn_end" }),
      ev(3, 100, "user", { kind: "session.prompt", text: "b" }),
      ev(4, 190, "system", { kind: "session.turn_end" }),
      ev(5, 200, "user", { kind: "session.prompt", text: "c" }),
      ev(6, 205, "assistant", { text: "arbeitet…" }),
    ];
    expect(runProgress(events, "working", Date.parse(at(260)))).toMatchObject({
      source: "none",
      medianTurnMs: 60_000,
      turnCount: 2,
      elapsedMs: 60_000,
    });
  });

  it("keeps the turn estimate null with fewer than two finished turns", () => {
    // One duration is no statistics — same honesty rule as the plan ETA.
    const events = [
      ev(1, 0, "user", { kind: "session.prompt", text: "a" }),
      ev(2, 45, "system", { kind: "session.turn_end" }),
      ev(3, 60, "user", { kind: "session.prompt", text: "b" }),
    ];
    expect(runProgress(events, "working", Date.parse(at(80)))).toMatchObject({
      source: "none",
      medianTurnMs: null,
      turnCount: 1,
    });
  });
});

describe("quotaSummary", () => {
  it("names what is left per window, tightest first", () => {
    const usage = {
      supported: true,
      quota: { windows: [{ id: "seven_day", utilization: 0.2, resetsAt: "2026-09-28T00:00:00Z" }, { id: "five_hour", utilization: 0.62, resetsAt: "2026-09-23T14:00:00Z" }] },
    };
    const s = quotaSummary(usage, []);
    expect(s.level).toBe("ok");
    expect(s.text).toMatch(/^5h: 38 % frei · reset \d\d:\d\d · 7d: 80 % frei/);
  });

  it("warns when a window is nearly used up", () => {
    const usage = { supported: true, quota: { windows: [{ id: "five_hour", utilization: 0.93, resetsAt: "2026-09-23T14:00:00Z" }] } };
    expect(quotaSummary(usage, []).level).toBe("warn");
  });

  it("falls back to the provider's own limit error", () => {
    const events = [ev(1, 0, "system", { kind: "provider.error", category: "quota", window: "5 h", resetAt: "2026-09-23 15:00:00" })];
    expect(quotaSummary({ supported: false, quota: null }, events)).toEqual({ text: "5 h: erschöpft · frei ab 2026-09-23 15:00:00", level: "err" });
  });

  it("says so when nothing is known", () => {
    expect(quotaSummary(null, [])).toEqual({ text: "Kontingent: Provider meldet nichts", level: "none" });
  });
});

describe("estimateText (EPIC-P21 T21.3)", () => {
  const ok = { state: "ok" as const, n: 12, basis: "model" as const, medianMs: 300_000, p80Ms: 480_000, tokensPerSec: null };
  it("sagt ohne Daten nichts und nennt unter 5 Läufen den Grund statt einer Zahl", () => {
    expect(estimateText(null, 1000)).toBeNull();
    expect(estimateText({ ...ok, state: "no-data", n: 0, basis: "none", medianMs: null, p80Ms: null }, 1000)).toBeNull();
    expect(estimateText({ ...ok, state: "too-few", n: 2, medianMs: null, p80Ms: null }, 1000)).toBe("Schätzung ab 5 Läufen (bisher 2)");
  });
  it("Restzeit = Median − bisher, mit Streuung und Datenbasis", () => {
    expect(estimateText(ok, 60_000)).toBe("≈ noch 4 min · typisch 5 min, bis 8 min · 12 Läufe, dieses Modell");
    expect(estimateText({ ...ok, basis: "adapter" }, 60_000)).toContain("dieser Harness");
    expect(estimateText({ ...ok, basis: "session" }, 60_000)).toContain("12 Läufe, diese Session");
  });
  it("über dem P80 heißt es länger als üblich, nie eine negative Restzeit", () => {
    expect(estimateText(ok, 600_000)).toBe("länger als 80 % der Läufe (8 min) · 12 Läufe, dieses Modell");
    expect(estimateText(ok, 400_000)).toContain("≈ noch 0 min".replace("0 min", "< 1 min"));
  });
});
