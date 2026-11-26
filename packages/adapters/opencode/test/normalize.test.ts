import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkFixture } from "@ancientvoid/adapter-testkit";
import { normalizeOpencodeLine } from "../src/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

describe("normalizeOpencodeLine — real captured `opencode run --format json` (1.18.29)", () => {
  it("maps a trivial real-file-read turn to schema-valid events with real cost/tokens", () => {
    const events = checkFixture(fixture("trivial-read.jsonl"), normalizeOpencodeLine);

    const toolUse = events.filter((e) => e.type === "tool_use");
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0]!.payload).toMatchObject({ tool: "read" });

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0]!.payload).toMatchObject({ toolUseId: toolUse[0]!.payload.id, isError: false });

    const assistant = events.filter((e) => e.type === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.summary).toContain("hello");

    // Two step_finish lines in this fixture — both real, both forwarded;
    // SessionManager (not this adapter) is what sums them (ADR-0003/0006).
    const finishes = events.filter(
      (e) => e.type === "system" && (e.payload as { kind?: string }).kind === "opencode.step_finish",
    );
    expect(finishes).toHaveLength(2);
    // T7.7: the real capture says cost 0 (subscription plan) — not a confirmed $0.
    expect(finishes[0]!.costUsd).toBeUndefined();
    expect(finishes[0]!.tokensEst).toBe(7450);
    expect(finishes[0]!.payload.usage).toEqual({ input: 7411, output: 39 });
    expect(finishes[1]!.tokensEst).toBe(7505);
  });

  it("keeps the cache visible next to the aggregated input (P84 cost split)", () => {
    const [event] = normalizeOpencodeLine({
      type: "step_finish",
      part: { type: "step-finish", reason: "stop", tokens: { total: 130, input: 20, output: 10, cache: { read: 100, write: 0 } }, cost: 0 },
    });
    expect(event?.payload).toMatchObject({ usage: { input: 120, output: 10 }, cacheInputTokens: 100, cacheIncluded: true });
  });

  it("says when a step hit the length limit after a thinking-only turn", () => {
    const events = normalizeOpencodeLine({
      type: "step_finish",
      part: { type: "step-finish", reason: "length", tokens: { total: 39853, reasoning: 31929 }, cost: 0 },
    });
    expect(events[0]?.summary).toContain("Längenlimit");
    expect(events[0]?.summary).toContain("31929");
    expect(events[0]?.payload).toMatchObject({ kind: "opencode.step_finish", reason: "length" });
  });

  it("maps a real tool error to tool_result with isError:true, not a swallowed failure", () => {
    const events = checkFixture(fixture("tool-error.jsonl"), normalizeOpencodeLine);
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.payload).toMatchObject({ isError: true });
    expect((toolResult!.payload as { error?: string }).error).toContain("File not found");
    // the model's own follow-up text explaining the failure is still a
    // normal assistant event, not swallowed either
    const assistant = events.find((e) => e.type === "assistant");
    expect(assistant?.summary).toContain("failed");
  });

  it("maps a finished reasoning part to a thinking event", () => {
    const events = normalizeOpencodeLine({
      type: "reasoning",
      part: { type: "reasoning", text: "Erst die Datei lesen, dann den Rahmen neon färben." },
    });
    expect(events[0]?.type).toBe("thinking");
    expect(events[0]?.payload).toMatchObject({ text: "Erst die Datei lesen, dann den Rahmen neon färben." });
  });

  it("fails loud on an unrecognized event type instead of dropping it", () => {
    const events = normalizeOpencodeLine({ type: "some_future_event", part: {} });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled event type");
  });

  it("fails loud on a non-object line instead of throwing", () => {
    const events = normalizeOpencodeLine("not an object");
    expect(events[0]!.summary).toContain("non-object");
  });
});

describe("provider errors (ADR-0015)", () => {
  it("turns the real UnknownError line into a readable provider.error", () => {
    const lines = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "server-error.jsonl"), "utf8").trim().split("\n");
    const events = lines.flatMap((line) => normalizeOpencodeLine(JSON.parse(line)));
    const error = events.find((e) => (e.payload as { kind?: string }).kind === "provider.error");
    expect(error?.summary).toBe("opencode: Serverfehler beim Provider");
    expect(error?.payload).toMatchObject({ category: "server", ref: "err_9508ce50" });
    expect(events.some((e) => e.summary.includes("unhandled"))).toBe(false);
  });

  it("names a usage limit with its reset time", () => {
    const [event] = normalizeOpencodeLine({
      type: "error",
      error: { name: "APIError", data: { message: "Usage limit reached for 5 hour. Your limit will reset at 2026-09-23 15:00:00" } },
    });
    expect(event?.summary).toBe("opencode: Kontingent erschöpft (5 h)");
    expect(event?.payload).toMatchObject({ category: "quota", resetAt: "2026-09-23 15:00:00" });
  });
});
