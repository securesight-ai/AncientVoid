import { describe, expect, it } from "vitest";
import { classifyProviderError, currentProviderFailureFromEvents, providerErrorEvent } from "../../src/harness/provider-error.ts";

describe("classifyProviderError (ADR-0015)", () => {
  it.each(["You've hit your weekly limit", "You've hit your daily limit", "You’ve hit your usage limit"])("keeps %s out of automatic technical recovery", text => {
    expect(classifyProviderError(text).category).toBe("quota");
  });
  it("reads Cursor's Opus usage-limit text, including the cycle date", () => {
    const info = classifyProviderError(
      "ActionRequiredError: You've hit your usage limit for Opus You've saved $76 on API model usage this month with Pro. Your usage limits will reset when your monthly cycle ends on 12/5/2026.",
    );
    expect(info).toMatchObject({ category: "quota", title: "Kontingent erschöpft (Opus)", resetAt: "12/5/2026" });
    expect(info.detail).toContain("wieder frei ab 12/5/2026");
    expect(info.detail).toContain("andere Session");
  });

  it("keeps a usage-limit visible after a promptless resume", () => {
    const failure = currentProviderFailureFromEvents([
      { type: "system", summary: "cursor: Usage-Limit", payload: { kind: "cursor.usage_limit", line: "ActionRequiredError: You're out of usage." } },
      { type: "system", summary: "session.resumed", payload: { kind: "session.resumed" } },
      { type: "system", summary: "cursor · opus", payload: { kind: "cursor.model" } },
    ]);
    expect(failure).toMatchObject({ category: "quota", title: "Kontingent erschöpft" });
  });

  it("erkennt Claudes Session-Limit als Kontingent (Nutzerfund 2026-11-15, Presentation-Session)", () => {
    const info = classifyProviderError("You've hit your session limit · resets 2:20am (Europe/Berlin)");
    expect(info.category).toBe("quota");
    expect(info.title).toBe("Kontingent erschöpft (session)");
  });

  it("reads z.ai's usage-limit text with window and reset time", () => {
    const info = classifyProviderError("AI_APICallError: Usage limit reached for 5 hour. Your limit will reset at 2026-09-09 11:57:58");
    expect(info).toMatchObject({ category: "quota", window: "5 h", resetAt: "2026-09-09 11:57:58" });
    expect(info.title).toBe("Kontingent erschöpft (5 h)");
    expect(info.detail).toContain("wieder frei ab 2026-09-09 11:57:58");
  });

  it("BUG-0241: reads the localized quota window and reset reported by z.ai", () => {
    expect(classifyProviderError("429 已达到 5 小时的使用上限。您的限额将在 2026-11-21 06:34:19 重置。 (type=1308)")).toMatchObject({
      category: "quota",
      window: "5 h",
      resetAt: "2026-11-21 06:34:19",
    });
  });

  it("names rate limits, auth, network and server errors", () => {
    expect(classifyProviderError("API Error: 429 Too Many Requests").category).toBe("rate_limit");
    expect(classifyProviderError("rate_limit_error: slow down").category).toBe("rate_limit");
    expect(classifyProviderError("Claude AI usage limit reached|1790200000").category).toBe("quota");
    expect(classifyProviderError("401 Unauthorized: invalid x-api-key").category).toBe("auth");
    expect(classifyProviderError("fetch failed: getaddrinfo ENOTFOUND api.z.ai").category).toBe("network");
    expect(classifyProviderError("API Error: 529 Overloaded").category).toBe("server");
  });

  it("is honest about an opaque server error", () => {
    const info = classifyProviderError("Unexpected server error. Check server logs for details.", "err_9508ce50");
    expect(info.category).toBe("server");
    expect(info.title).toBe("Serverfehler beim Provider");
    expect(info.detail).toContain("keine Ursache");
    expect(info.detail).toContain("err_9508ce50");
    expect(info.detail).toMatch(/Kontingent|Rate-Limit/);
  });

  it("keeps unknown text unknown and shows it", () => {
    const info = classifyProviderError("something odd");
    expect(info).toMatchObject({ category: "unknown", title: "Fehler beim Provider" });
    expect(info.detail).toContain("something odd");
  });

  it("builds one chat-visible system event", () => {
    const event = providerErrorEvent("opencode", "Usage limit reached for 5 hour. Your limit will reset at 2026-09-09 11:57:58");
    expect(event).toMatchObject({ type: "system", payload: { kind: "provider.error", category: "quota", provider: "opencode" } });
    expect(event.summary).toBe("opencode: Kontingent erschöpft (5 h)");
  });
});

describe("BUG-0102 maki-Verbindungsfehler", () => {
  it("klassifiziert „could not connect“ als Netzwerk", () => {
    expect(classifyProviderError("Internal error: could not connect, check the server is running and the base URL is correct").category).toBe("network");
  });
});

describe("BUG-0265 Kontextüberlauf ist keine Anmeldefrage", () => {
  const roh = [
    '400: {"type":"invalid_request_error","message":"request exceeds the context window: prompt (237428 tokens) leaves no room to answer in the context (204800); requests are never truncated"}',
    '400: {"error":{"code":"context_length_exceeded","message":"This model maximum context length is 204800 tokens. However, your messages resulted in 237428 tokens."}}',
    "prompt is too long: 237428 tokens > 204800 maximum",
    "Der Kontext dieses Modells ist erschöpft — input is too long for the model",
  ];
  it.each(roh)("klassifiziert Kontextüberlauf als Kontext, nicht als Anmeldung: %s", (raw) => {
    const info = classifyProviderError(raw);
    expect(info.category).toBe("context");
    expect(info.title).toContain("Kontext");
    expect(info.detail).not.toMatch(/angemeldet|Schlüssel/);
  });

  it("nenennt die Tokenzahlen der Meldung", () => {
    const info = classifyProviderError(
      '400: {"type":"invalid_request_error","message":"request exceeds the context window: prompt (237428 tokens) leaves no room to answer in the context (204800); requests are never truncated"}',
    );
    expect(info.detail).toContain("237428");
    expect(info.detail).toContain("204800");
    expect(info.detail).toContain("Übergabe");
  });

  it.each(["401 Unauthorized", "invalid api key provided", "Not logged in · Please run /login", "authentication failure", "403 forbidden"])(
    "laesst echte Anmeldefehler bei auth: %s",
    (raw) => expect(classifyProviderError(raw).category).toBe("auth"),
  );

  it("liefert die Kontext-Pleite als handlungsfähige failure", () => {
    const failure = currentProviderFailureFromEvents([
      {
        type: "system",
        summary: "pi: Kontext des Modells reicht nicht",
        payload: { kind: "provider.error", category: "context", title: "Kontext des Modells reicht nicht", detail: "x" },
      },
    ]);
    expect(failure?.category).toBe("context");
  });
});
