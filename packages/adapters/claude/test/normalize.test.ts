import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkFixture } from "@ancientvoid/adapter-testkit";
import { normalizeClaudeLine } from "../src/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

describe("normalizeClaudeLine — real captured stream-json (claude 2.1.263)", () => {
  it("BUG-0240: keeps the reported main model window and cached context", () => {
    const events = checkFixture(fixture("tool-use.jsonl"), normalizeClaudeLine);
    expect(events.findLast(e => e.payload?.kind === "claude.context")?.payload).toMatchObject({ contextInputTokens: 27_356 });
    expect(events.find(e => e.payload?.kind === "claude.result")?.payload).toMatchObject({
      model: "claude-sonnet-5",
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 64_000,
    });
  });
  it("maps every line of the trivial-text fixture to schema-valid events", () => {
    // checkFixture (T1.4, @ancientvoid/adapter-testkit) loads the fixture, runs
    // every line through the normalizer, and asserts schema-validity —
    // the generic half of this check; provider-specific assertions follow.
    const events = checkFixture(fixture("trivial-text.jsonl"), normalizeClaudeLine);
    // hook_started, hook_response, init -> 3 system events
    expect(events.filter((e) => e.type === "system" && e.summary.startsWith("claude: system/")).length).toBe(3);
    // the assistant text block "ok"
    const assistantEvents = events.filter((e) => e.type === "assistant");
    expect(assistantEvents).toHaveLength(1);
    expect(assistantEvents[0]!.summary).toBe("ok");
    // the result line, with real cost extracted
    const resultEvents = events.filter(
      (e) => e.type === "system" && (e.payload as { kind?: string }).kind === "claude.result",
    );
    expect(resultEvents).toHaveLength(1);
    // ADR-0003: cost is a first-class event field, not buried in payload.
    expect(resultEvents[0]!.costUsd).toBeCloseTo(0.0454606, 6);
    // ADR-0006: tokensEst = input_tokens (2) + output_tokens (4) from the
    // same result line's real usage object — not a guess, not the cache
    // token fields (which the fixture also carries but which don't count
    // toward the billed input/output split).
    expect(resultEvents[0]!.tokensEst).toBe(6);
    expect(resultEvents[0]!.payload.cacheInputTokens).toBe(27203);
    // ADR-0032: the input part is the context fill — it travels on the event.
    expect((resultEvents[0]!.payload as { usage?: { input?: number; output?: number } }).usage).toEqual({ input: 2, output: 4 });
  });

  it("maps the tool-use fixture to tool_use + tool_result + assistant events", () => {
    const events = checkFixture(fixture("tool-use.jsonl"), normalizeClaudeLine);

    const toolUse = events.filter((e) => e.type === "tool_use");
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0]!.payload).toMatchObject({ name: "Bash", input: { command: "echo hello-ancientvoid" } });

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0]!.payload).toMatchObject({ isError: false, content: "hello-ancientvoid" });

    const assistantText = events.filter((e) => e.type === "assistant");
    expect(assistantText.map((e) => e.summary)).toContain("done");
    // The fixture also contains a raw "rate_limit_event" line — checkFixture
    // already asserted every event's `type` is a valid EventType (via the
    // NormalizedEvent schema), so it can't have passed that name through.
  });

  it("ADR-0004: maps a real rate_limit_event into a structured usageQuota", () => {
    const events = checkFixture(fixture("trivial-text.jsonl"), normalizeClaudeLine);
    const rateLimitEvents = events.filter((e) => e.summary === "claude: rate-limit status update");
    expect(rateLimitEvents).toHaveLength(1);
    const quota = rateLimitEvents[0]!.usageQuota;
    expect(quota).toBeDefined();
    // Real fixture values (trivial-text.jsonl): five_hour 0.21, seven_day 0.14.
    const fiveHour = quota!.windows.find((w) => w.id === "five_hour");
    const sevenDay = quota!.windows.find((w) => w.id === "seven_day");
    expect(fiveHour?.utilization).toBeCloseTo(0.21, 6);
    expect(sevenDay?.utilization).toBeCloseTo(0.14, 6);
    expect(fiveHour?.resetsAt).toBe(new Date(1789435200 * 1000).toISOString());
    // Fixture's overageDisabledReason: "out_of_credits" -> not available.
    expect(quota!.overageAvailable).toBe(false);
    expect(quota!.overageBlockedReason).toBe("out_of_credits");
  });

  it("ADR-0004: no usageQuota when unifiedWindows is missing or malformed (never fabricated)", () => {
    const events = normalizeClaudeLine({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.usageQuota).toBeUndefined();
  });

  it("never drops an unrecognized top-level type silently (fail loud)", () => {
    const events = normalizeClaudeLine({ type: "some_future_event_type", weird: true });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled stream-json type");
  });

  it("tool_progress (CLI >=2.1.3xx Bash heartbeats) emits nothing — no event spam", () => {
    // Live fund 27.10.2026: claude 2.1.310 emits tool_progress every ~30s for
    // long-running Bash tools (tool_use_id + "-heartbeat-N"). Purely informational
    // progress of an already-reported tool call — emitting a system event per
    // heartbeat spammed the session log (4.4 MB in one hung turn).
    const events = normalizeClaudeLine({
      type: "tool_progress",
      tool_use_id: "toolu_014tcLJ89JYXNg5q5vVYCfM2-heartbeat-0",
      tool_name: "Bash",
      parent_tool_use_id: "toolu_014tcLJ89JYXNg5q5vVYCfM2",
    });
    expect(events).toHaveLength(0);
  });

  it("never drops an unrecognized content block silently (fail loud)", () => {
    const events = normalizeClaudeLine({
      type: "assistant",
      message: { content: [{ type: "some_future_block_type" }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled assistant content block");
  });

  it("handles a non-object line without throwing", () => {
    expect(() => normalizeClaudeLine("not an object")).not.toThrow();
    expect(normalizeClaudeLine(null)[0]!.type).toBe("system");
  });
});

describe("provider errors (ADR-0015)", () => {
  it("adds a readable provider.error to a failed result", () => {
    const events = normalizeClaudeLine({ type: "result", is_error: true, result: "Claude AI usage limit reached|1790200000", total_cost_usd: 0 });
    const error = events.find((e) => (e.payload as { kind?: string }).kind === "provider.error");
    expect(error?.summary).toBe("claude: Kontingent erschöpft");
  });
});

describe("neue Top-Level-Typen der Claude-CLI (BUG-0040)", () => {
  it("attachment wird als lesbares system-Event gemeldet, nicht als unbekannter Typ", () => {
    const events = normalizeClaudeLine({ type: "attachment", source: "prompt" });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toBe("claude: Anhang hinzugefügt");
    expect(events[0]!.payload).toMatchObject({ subtype: "attachment", source: "prompt" });
  });

  it("stream_event wird sichtbar gemeldet statt still verworfen", () => {
    const events = normalizeClaudeLine({ type: "stream_event", event: { type: "content_block_delta" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toContain("stream envelope");
    expect(events[0]!.payload).toMatchObject({ subtype: "stream_event" });
  });
});

describe("Buchhaltungszeilen des Transkripts (ADR-0040)", () => {
  it.each(["ai-title", "last-prompt", "mode", "permission-mode", "atis-latch", "pr-link", "cost-state", "queue-operation", "file-history-snapshot", "api-request", "api-request-blob", "api-request-shape"])(
    "%s ist bekannt und erzeugt kein Rausch-Event",
    (type) => {
      expect(normalizeClaudeLine({ type })).toEqual([]);
    },
  );

  it("Text der Person im importierten Transkript ist ein user-Event, kein assistant", () => {
    const events = normalizeClaudeLine({ type: "user", message: { role: "user", content: [{ type: "text", text: "Mach weiter" }] } });
    expect(events).toEqual([{ type: "user", summary: "Mach weiter", payload: { text: "Mach weiter" } }]);
    expect(normalizeClaudeLine({ type: "user", message: { role: "user", content: [{ type: "text", text: "  " }] } })).toEqual([]);
    expect(normalizeClaudeLine({ type: "assistant", message: { content: [{ type: "text", text: "Klar" }] } })[0]!.type).toBe("assistant");
  });

  it("ein wirklich unbekannter Typ bleibt laut", () => {
    const events = normalizeClaudeLine({ type: "etwas-neues" });
    expect(events[0]!.summary).toContain("unhandled stream-json type");
  });
});

describe("ADR-0033: Modus und Modell aus dem Init-Event", () => {
  it("nimmt model und permissionMode in die Nutzdaten des Init-Events auf", () => {
    const [event] = normalizeClaudeLine({ type: "system", subtype: "init", cwd: "/x", model: "claude-sonnet-5-5", permissionMode: "auto", tools: ["Bash"], claude_code_version: "2.1.288" });
    expect(event!.payload).toMatchObject({ subtype: "init", model: "claude-sonnet-5-5", permissionMode: "auto", toolCount: 1 });
  });

  it("lässt die Felder weg, wenn die CLI sie nicht meldet", () => {
    const [event] = normalizeClaudeLine({ type: "system", subtype: "init", cwd: "/x", tools: [] });
    expect(event!.payload).not.toHaveProperty("model");
    expect(event!.payload).not.toHaveProperty("permissionMode");
  });
});

describe("BUG-0046: leerer Denk-Block (der Anbieter redigiert den Text)", () => {
  const block = (thinking: string) => ({ type: "assistant", message: { content: [{ type: "thinking", thinking, signature: "sig" }] } });

  it("sagt, dass der Text nicht geliefert wird, statt einen leeren Block zu liefern", () => {
    const [event] = normalizeClaudeLine(block(""));
    expect(event!.type).toBe("thinking");
    expect(event!.summary).toBe("Claude hat nachgedacht — der Anbieter liefert den Text nicht");
    expect(event!.payload).toEqual({ text: "", redacted: true });
  });

  it("ein Denk-Block mit Text bleibt unverändert", () => {
    const [event] = normalizeClaudeLine(block("17*23 = 391"));
    expect(event!.summary).toBe("17*23 = 391");
    expect(event!.payload).toEqual({ text: "17*23 = 391" });
  });
});
