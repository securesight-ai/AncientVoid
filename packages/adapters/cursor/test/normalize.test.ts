import { describe, expect, it } from "vitest";
import { normalizeCursorLine } from "../src/normalize.ts";

const line = (o: object, state = { thinking: "" }) => normalizeCursorLine(o as Parameters<typeof normalizeCursorLine>[0], state);

describe("normalizeCursorLine — echte cursor-agent-Formen (live 2026-09-29)", () => {
  it("init kündigt die native Session an", () => {
    const [e] = line({ type: "system", subtype: "init", session_id: "chat_123456789", cwd: "/p", tools: ["Bash", "Edit"] });
    expect(e?.payload).toMatchObject({ kind: "cursor.native_session", nativeSessionId: "chat_123456789", toolCount: 2 });
  });

  it("thinking kommt als Top-Level-Deltas und wird erst bei completed ein Event", () => {
    const state = { thinking: "" };
    expect(line({ type: "thinking", subtype: "delta", text: "Die Antwort " }, state)).toEqual([]);
    expect(line({ type: "thinking", subtype: "delta", text: "ist kurz." }, state)).toEqual([]);
    const [e] = line({ type: "thinking", subtype: "completed" }, state);
    expect(e).toMatchObject({ type: "thinking" });
    expect(e?.payload).toMatchObject({ text: "Die Antwort ist kurz." });
  });

  it("assistant text/tool_use und user tool_result; der Prompt-Echo bleibt draußen", () => {
    expect(line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Alles klar" }] } })[0]).toMatchObject({ type: "assistant" });
    const [use] = line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });
    expect(use?.payload).toMatchObject({ id: "t1", name: "Bash" });
    const [res] = line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "datei.txt", is_error: false }] } });
    expect(res?.payload).toMatchObject({ toolUseId: "t1", isError: false, content: "datei.txt" });
    expect(line({ type: "user", message: { role: "user", content: [{ type: "text", text: "eigener Prompt" }] } })).toEqual([]);
  });

  it("result nutzt camelCase-Usage (inputTokens/outputTokens); Kosten optional", () => {
    const [e] = line({ type: "result", subtype: "success", usage: { inputTokens: 15694, outputTokens: 28, cacheReadTokens: 2688 }, result: "cursor ok" });
    expect(e?.tokensEst).toBe(15722);
    expect(e?.costUsd).toBeUndefined();
    expect(e?.payload).toMatchObject({ usage: { input: 15694, output: 28 }, cacheInputTokens: 2688 });
    // EPIC-P84 (live 2026-11-26): inputTokens enthält den Cache nicht; Denken steckt schon in outputTokens.
    expect(e?.payload).not.toHaveProperty("cacheIncluded");
    const [ohne] = line({ type: "result", subtype: "success", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(ohne?.payload).not.toHaveProperty("cacheInputTokens");
    const [withCost] = line({ type: "result", subtype: "success", total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } });
    expect(withCost?.costUsd).toBeCloseTo(0.01, 5);
    expect(withCost?.tokensEst).toBe(15);
  });

  it("unbekannte Typen bleiben sichtbar, nie gedroppt", () => {
    expect(line({ type: "hologram" })[0]?.payload).toMatchObject({ kind: "cursor.unhandled", type: "hologram" });
    expect(line({})).toEqual([]);
  });
});

describe("normalizeCursorLine — BUG-0202 stream-json tool_call + interaction_query", () => {
  it("tool_call started/completed → tool_use/tool_result (docs-Shape readToolCall)", () => {
    const [use] = line({
      type: "tool_call",
      subtype: "started",
      call_id: "call_1",
      tool_call: { readToolCall: { args: { path: "a.txt" } } },
    });
    expect(use).toMatchObject({ type: "tool_use" });
    expect(use?.payload).toMatchObject({ id: "call_1", name: "Read", input: { path: "a.txt" } });

    const [res] = line({
      type: "tool_call",
      subtype: "completed",
      call_id: "call_1",
      tool_call: {
        readToolCall: {
          args: { path: "a.txt" },
          result: { success: { content: "hello\n", totalLines: 1 } },
        },
      },
    });
    expect(res).toMatchObject({ type: "tool_result" });
    expect(res?.payload).toMatchObject({ toolUseId: "call_1", isError: false, content: "hello\n" });
  });

  it("tool_call shellToolCall und generisches function-Feld", () => {
    const [bash] = line({
      type: "tool_call",
      subtype: "started",
      call_id: "c2",
      tool_call: { shellToolCall: { args: { command: "npm test" } } },
    });
    expect(bash?.payload).toMatchObject({ name: "Bash", input: { command: "npm test" } });

    const [fn] = line({
      type: "tool_call",
      subtype: "started",
      call_id: "c3",
      tool_call: { function: { name: "custom_tool", arguments: "{\"x\":1}" } },
    });
    expect(fn?.payload).toMatchObject({ name: "custom_tool", input: { x: 1 } });
  });

  it("interaction_query request landet als assistant im Chat (nicht cursor.unhandled)", () => {
    const [e] = line({
      type: "interaction_query",
      subtype: "request",
      query_type: "askQuestionRequestQuery",
      query: {
        id: 1,
        askQuestionRequestQuery: {
          question: "Eine Entscheidung verändert den Plan stark:",
          options: [
            { label: "Variante A", description: "schnell" },
            { label: "Variante B", description: "robust" },
          ],
        },
      },
    });
    expect(e?.type).toBe("assistant");
    expect(e?.payload).toMatchObject({ kind: "cursor.interaction_query", queryType: "askQuestionRequestQuery" });
    const text = (e?.payload as { text?: string }).text ?? "";
    expect(text).toContain("Eine Entscheidung verändert den Plan stark:");
    expect(text).toContain("Variante A");
    expect(text).toContain("Variante B");
    expect(e?.payload).not.toMatchObject({ kind: "cursor.unhandled" });
  });

  it("interaction_query webSearch-Request (harbor#1586) und Response", () => {
    const [req] = line({
      type: "interaction_query",
      subtype: "request",
      query_type: "webSearchRequestQuery",
      query: {
        id: 0,
        webSearchRequestQuery: { args: { searchTerm: "Pave API webhook", toolCallId: "tool_x" } },
      },
    });
    expect(req?.type).toBe("assistant");
    expect((req?.payload as { text?: string }).text).toContain("Pave API webhook");

    const [res] = line({
      type: "interaction_query",
      subtype: "response",
      query_type: "webSearchRequestQuery",
      response: { id: 0, webSearchRequestResponse: { approved: {} } },
    });
    expect(res?.type).toBe("system");
    expect(res?.payload).toMatchObject({ kind: "cursor.interaction_response" });
  });
});
