import type { EmittedEvent } from "@ancientvoid/contracts";

/**
 * cursor-agent stream-json (one JSON object per line, claude-code shape —
 * the CLI mirrors Claude Code's event model; verified against the
 * stand-in until a logged-in run confirms the last details, anything
 * unknown stays visible as a system event, never dropped).
 */
export interface CursorLine {
  type?: unknown;
  subtype?: unknown;
  session_id?: unknown;
  chatId?: unknown;
  call_id?: unknown;
  /** Top-level thinking deltas (real cursor-agent, verified live 2026-09-29). */
  text?: unknown;
  message?: { role?: unknown; content?: unknown } | null;
  result?: unknown;
  is_error?: unknown;
  total_cost_usd?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown; inputTokens?: unknown; outputTokens?: unknown; cacheReadTokens?: unknown; cacheWriteTokens?: unknown } | null;
  cwd?: unknown;
  tools?: unknown;
  /** BUG-0202: stream-json tool lifecycle (`started`/`completed`). */
  tool_call?: Record<string, unknown> | null;
  /** BUG-0202: permission / plan / AskQuestion prompts. */
  query_type?: unknown;
  query?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
}

function summarize(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  id?: unknown;
  tool_use_id?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  is_error?: unknown;
}

/** Maps one parsed stdout line to hub events (empty for progress noise).
 * Stateful: top-level thinking deltas buffer until their "completed". */
export function normalizeCursorLine(line: CursorLine, state: { thinking: string } = { thinking: "" }): EmittedEvent[] {
  const type = asString(line.type);
  const session = asString(line.session_id) ?? asString(line.chatId) ?? null;
  const out: EmittedEvent[] = [];
  if (type === "system") {
    const subtype = asString(line.subtype) ?? "unknown";
    if (subtype === "init" && session) {
      out.push({
        type: "system",
        summary: `cursor · Session ${session.slice(0, 12)}`,
        payload: { kind: "cursor.native_session", nativeSessionId: session, cwd: asString(line.cwd) ?? null, toolCount: Array.isArray(line.tools) ? line.tools.length : null },
      });
    } else {
      out.push({ type: "system", summary: `cursor: system/${subtype}`, payload: { kind: "cursor.system", subtype } });
    }
    return out;
  }
  if (type === "thinking") {
    // real shape (live 2026-09-29): {"type":"thinking","subtype":"delta","text":"…"}
    // deltas stream individually, "completed" closes the thought.
    if (asString(line.subtype) === "delta" && typeof line.text === "string") {
      state.thinking += line.text;
    } else if (asString(line.subtype) === "completed") {
      const text = state.thinking;
      state.thinking = "";
      if (text) out.push({ type: "thinking", summary: summarize(text), payload: { text } });
    }
    return out;
  }
  if (type === "assistant" && line.message && Array.isArray(line.message.content)) {
    for (const block of line.message.content as ContentBlock[]) {
      if (block.type === "text" && typeof block.text === "string") {
        out.push({ type: "assistant", summary: summarize(block.text), payload: { text: block.text } });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        out.push({ type: "thinking", summary: summarize(block.thinking), payload: { text: block.thinking } });
      } else if (block.type === "tool_use") {
        out.push({
          type: "tool_use",
          summary: summarize(`${asString(block.name) ?? "tool"}(${JSON.stringify(block.input ?? {}).slice(0, 150)})`),
          payload: { id: asString(block.id), name: asString(block.name), input: block.input ?? {} },
        });
      }
    }
    return out;
  }
  if (type === "user" && line.message && Array.isArray(line.message.content)) {
    for (const block of line.message.content as ContentBlock[]) {
      // the CLI echoes the prompt as a user text block — the hub already
      // has it as its own session.prompt event; only tool_results matter.
      if (block.type === "tool_result") {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        out.push({
          type: "tool_result",
          summary: summarize(text) || "Tool fertig",
          payload: { toolUseId: asString(block.id) ?? asString(block.tool_use_id), isError: block.is_error === true, content: text },
        });
      }
    }
    return out;
  }
  if (type === "result") {
    // real shape (live 2026-09-29): camelCase usage, no cost reported
    const usage = line.usage ?? null;
    const input = typeof usage?.inputTokens === "number" ? usage.inputTokens : typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
    const output = typeof usage?.outputTokens === "number" ? usage.outputTokens : typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
    // EPIC-P84: der Cache steht neben inputTokens, nicht darin.
    const cached = [usage?.cacheReadTokens, usage?.cacheWriteTokens].reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
    const cost = typeof line.total_cost_usd === "number" ? line.total_cost_usd : undefined;
    const tokens = input !== undefined && output !== undefined ? input + output : undefined;
    out.push({
      type: "system",
      summary: `cursor: Zug beendet (${asString(line.subtype) ?? "?"})`,
      payload: {
        kind: "cursor.result",
        isError: line.is_error === true,
        result: typeof line.result === "string" ? line.result.slice(0, 500) : undefined,
        ...(input !== undefined || output !== undefined ? { usage: { ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}) } } : {}),
        ...(cached > 0 ? { cacheInputTokens: cached } : {}),
      },
      ...(cost !== undefined ? { costUsd: cost } : {}),
      ...(tokens !== undefined ? { tokensEst: tokens } : {}),
    });
    return out;
  }
  // BUG-0202: cursor-agent stream-json tool lifecycle (docs + live 2026-11-17).
  // Shape: { type:"tool_call", subtype:"started"|"completed", call_id, tool_call:{ readToolCall:{ args, result? } } }
  if (type === "tool_call") {
    const subtype = asString(line.subtype);
    const callId = asString(line.call_id) ?? "";
    const parsed = parseCursorToolCall(line.tool_call);
    if (!parsed) {
      out.push({ type: "system", summary: "cursor: tool_call ohne erkennbares Werkzeug", payload: { kind: "cursor.unhandled", type: "tool_call", subtype } });
      return out;
    }
    if (subtype === "started" || subtype === undefined) {
      out.push({
        type: "tool_use",
        summary: summarize(`${parsed.name}(${JSON.stringify(parsed.args).slice(0, 150)})`),
        payload: { id: callId || parsed.name, name: parsed.name, input: parsed.args },
      });
      return out;
    }
    if (subtype === "completed") {
      const text = toolResultText(parsed.result);
      const isError = parsed.resultIsError;
      out.push({
        type: "tool_result",
        summary: summarize(text) || (isError ? "Tool-Fehler" : "Tool fertig"),
        payload: { toolUseId: callId || parsed.name, isError, content: text },
      });
      return out;
    }
    out.push({ type: "system", summary: `cursor: tool_call/${subtype ?? "?"}`, payload: { kind: "cursor.unhandled", type: "tool_call", subtype } });
    return out;
  }
  // BUG-0202: Plan-/Auswahl-/Freigabe-Fragen. Request → Chat (assistant), Response → Verlauf.
  // Ground truth: harbor#1586 + cursor docs (webSearchRequestQuery); AskQuestion/Plan analog.
  if (type === "interaction_query") {
    const subtype = asString(line.subtype);
    const queryType = asString(line.query_type) ?? "query";
    if (subtype === "request") {
      const text = formatInteractionRequest(queryType, line.query);
      out.push({ type: "assistant", summary: summarize(text), payload: { text, kind: "cursor.interaction_query", queryType } });
      return out;
    }
    if (subtype === "response") {
      out.push({
        type: "system",
        summary: `cursor: Freigabe ${queryType}`,
        payload: { kind: "cursor.interaction_response", queryType, response: line.response ?? null },
      });
      return out;
    }
    out.push({ type: "system", summary: `cursor: interaction_query/${subtype ?? "?"}`, payload: { kind: "cursor.unhandled", type: "interaction_query", subtype } });
    return out;
  }
  if (type !== undefined) {
    // fail loud, once per type would be nicer — visible is the bar
    out.push({ type: "system", summary: `cursor: unbehandelter stream-json-Typ "${type}"`, payload: { kind: "cursor.unhandled", type } });
  }
  return out;
}

/** Known camelCase wrappers from cursor-agent stream-json (docs + community parsers). */
const TOOL_CALL_KEYS: ReadonlyArray<{ key: string; name: string }> = [
  { key: "shellToolCall", name: "Bash" },
  { key: "readToolCall", name: "Read" },
  { key: "editToolCall", name: "Edit" },
  { key: "writeToolCall", name: "Write" },
  { key: "grepToolCall", name: "Grep" },
  { key: "globToolCall", name: "Glob" },
  { key: "searchToolCall", name: "Search" },
  { key: "listToolCall", name: "List" },
  { key: "webFetchToolCall", name: "WebFetch" },
  { key: "webSearchToolCall", name: "WebSearch" },
];

function parseCursorToolCall(raw: unknown): { name: string; args: unknown; result: unknown; resultIsError: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const tc = raw as Record<string, unknown>;
  for (const { key, name } of TOOL_CALL_KEYS) {
    const call = tc[key];
    if (!call || typeof call !== "object" || Array.isArray(call)) continue;
    const body = call as { args?: unknown; result?: unknown };
    return { name, args: body.args ?? {}, result: body.result, resultIsError: isToolResultError(body.result) };
  }
  const fn = tc.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn)) {
    const f = fn as { name?: unknown; arguments?: unknown; result?: unknown };
    const name = asString(f.name) ?? "tool";
    let args: unknown = f.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = { raw: args };
      }
    }
    return { name, args, result: f.result, resultIsError: isToolResultError(f.result) };
  }
  return null;
}

function isToolResultError(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const r = result as Record<string, unknown>;
  if ("error" in r || "failure" in r) return true;
  if (r.success === false) return true;
  return false;
}

function toolResultText(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  if (typeof result !== "object" || Array.isArray(result)) return JSON.stringify(result);
  const r = result as Record<string, unknown>;
  const success = r.success;
  if (success && typeof success === "object" && !Array.isArray(success)) {
    const s = success as Record<string, unknown>;
    if (typeof s.content === "string") return s.content;
    if (typeof s.path === "string") return s.path;
  }
  if (typeof r.error === "string") return r.error;
  if (r.error && typeof r.error === "object") return JSON.stringify(r.error);
  return JSON.stringify(result);
}

/** Render a permission/plan prompt so the Chat-Tab shows the options (BUG-0202). */
function formatInteractionRequest(queryType: string, query: unknown): string {
  const label = queryType.replace(/RequestQuery$/, "").replace(/Query$/, "") || queryType;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return `Cursor fragt nach Freigabe: ${label}`;
  }
  const q = query as Record<string, unknown>;
  const inner = (q[queryType] ?? q[`${label}RequestQuery`] ?? q[label]) as Record<string, unknown> | undefined;
  const args = (inner && typeof inner === "object" ? (inner.args as Record<string, unknown> | undefined) : undefined) ?? undefined;
  const lines: string[] = [`Cursor · ${label}`];
  if (args && typeof args === "object") {
    for (const [k, v] of Object.entries(args)) {
      if (k === "toolCallId" || k === "id") continue;
      if (typeof v === "string" && v.trim()) lines.push(`${k}: ${v}`);
      else if (Array.isArray(v) && v.every((x) => typeof x === "string")) lines.push(`${k}:\n- ${v.join("\n- ")}`);
      else if (v !== undefined && v !== null) lines.push(`${k}: ${JSON.stringify(v).slice(0, 400)}`);
    }
  }
  // AskQuestion / Plan shapes often put options next to args.
  const options = (inner?.options ?? q.options) as unknown;
  if (Array.isArray(options) && options.length > 0) {
    lines.push("Optionen:");
    for (const opt of options) {
      if (typeof opt === "string") lines.push(`- ${opt}`);
      else if (opt && typeof opt === "object") {
        const o = opt as { label?: unknown; title?: unknown; value?: unknown; description?: unknown };
        const head = asString(o.label) ?? asString(o.title) ?? asString(o.value) ?? JSON.stringify(opt).slice(0, 120);
        lines.push(asString(o.description) ? `- ${head} — ${o.description}` : `- ${head}`);
      }
    }
  }
  const question = asString(inner?.question) ?? asString(q.question) ?? asString(inner?.prompt) ?? asString(q.prompt);
  if (question) lines.splice(1, 0, question);
  return lines.join("\n");
}
