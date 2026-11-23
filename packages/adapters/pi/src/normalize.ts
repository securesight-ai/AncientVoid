import { providerErrorEvent, type EmittedEvent } from "@ancientvoid/contracts";
import type { LivePump } from "@ancientvoid/contracts"; // ADR-0083

/**
 * BUG-0065: maps `pi -p --mode json` (pi 1.4.0, docs/json.md) to events.
 * Ground truth: test/fixtures/tool-use.jsonl, a real capture.
 *
 * Granularity matches the other adapters: one event per finished content
 * block (`*_end`), not per token delta — live during the turn, without
 * flooding the store. Large tool output is K5-offloaded by the EventStore.
 */

interface Record_ {
  type?: unknown;
  [key: string]: unknown;
}

/** Known records that carry nothing the history needs (deltas, lifecycle,
 * echoes the hub already has). Anything else unknown is reported. */
const IGNORED = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "tool_execution_start",
  "tool_execution_update",
  "queue_update",
  "session_info_changed",
  "thinking_level_changed",
  "entry_appended",
]);

const IGNORED_UPDATES = new Set([
  "start",
  "toolcall_start",
  "toolcall_delta",
  "done",
]);

function summarize(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? flat.slice(0, 199) + "…" : flat;
}

function asString(v: unknown, max = 4000): string {
  if (typeof v === "string") return v;
  try {
    return (JSON.stringify(v) ?? "").slice(0, max);
  } catch {
    return String(v).slice(0, max);
  }
}

/** Tool results are `{content: [{type:"text", text}]}`; join the text parts. */
function resultText(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => ((part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : `[${asString((part as { type?: unknown }).type, 40)}]`))
      .join("");
  }
  return asString(result, 100_000);
}

function unknown(what: string): EmittedEvent {
  return { type: "system", summary: summarize(`pi: unbekannter Stream-Typ "${what}"`), payload: { kind: "pi.unknown", what: what.slice(0, 80) } };
}

function normalizeUpdate(update: Record_, live?: LivePump): EmittedEvent[] {
  const kind = String(update.type ?? "");
  if (IGNORED_UPDATES.has(kind)) return [];
  switch (kind) {
    // ADR-0083: Deltas sind keine dauerhaften Ereignisse, aber sie speisen die
    // Live-Frames. Der Block (`*_end`) bleibt das einzige persistierte Ereignis.
    case "text_start":
      live?.begin("assistant");
      return [];
    case "thinking_start":
      live?.begin("thinking");
      return [];
    case "text_delta":
      live?.delta("assistant", String(update.delta ?? ""));
      return [];
    case "thinking_delta":
      live?.delta("thinking", String(update.delta ?? ""));
      return [];
    case "text_end": {
      const text = String(update.content ?? "");
      live?.end("assistant");
      return text.trim() ? [{ type: "assistant", summary: summarize(text), payload: { text } }] : [];
    }
    case "thinking_end": {
      live?.end("thinking");
      const text = String(update.content ?? "");
      if (!text.trim()) return [{ type: "thinking", summary: "pi hat nachgedacht — der Anbieter liefert den Text nicht", payload: { text: "", redacted: true } }];
      return [{ type: "thinking", summary: summarize(text), payload: { text } }];
    }
    case "toolcall_end": {
      const call = (update.toolCall ?? {}) as { id?: unknown; name?: unknown; arguments?: unknown };
      const name = String(call.name ?? "tool");
      return [{ type: "tool_use", summary: summarize(`${name}(${asString(call.arguments, 150)})`), payload: { id: call.id, name, input: call.arguments } }];
    }
    case "error":
      return [providerErrorEvent("pi", asString(update.error ?? update.reason, 1000))];
    default:
      return [unknown(`message_update/${kind}`)];
  }
}

function normalize(rec: Record_, live?: LivePump): EmittedEvent[] {
  const type = String(rec.type ?? "");
  if (IGNORED.has(type)) return [];
  switch (type) {
    case "session":
      return [{ type: "system", summary: "pi: Session gestartet", payload: { kind: "pi.session", piSessionId: rec.id, ...(typeof rec.id === "string" && rec.id ? { nativeSessionId: rec.id } : {}) } }];
    case "message_update":
      return normalizeUpdate((rec.assistantMessageEvent ?? {}) as Record_, live);
    case "message_end": {
      const msg = (rec.message ?? {}) as { role?: unknown; stopReason?: unknown; errorMessage?: unknown; usage?: unknown };
      if (msg.role !== "assistant") return [];
      if (msg.stopReason === "error") return [providerErrorEvent("pi", asString(msg.errorMessage ?? "unknown error", 1000))];
      return usageEvent(msg.usage);
    }
    case "tool_execution_end": {
      const content = resultText(rec.result);
      const isError = rec.isError === true;
      return [{ type: "tool_result", summary: summarize(content) || (isError ? "tool error" : "tool result"), payload: { toolUseId: rec.toolCallId, isError, content } }];
    }
    case "auto_retry_start":
    case "auto_retry_end":
    case "compact_worker_error":
      return [providerErrorEvent("pi", asString(rec.errorMessage, 500))];
    case "auto_compaction_start":
    case "auto_compaction_end":
    case "compaction_start":
    case "compaction_end":
      return [{ type: "system", summary: `pi: ${type}`, payload: { kind: `pi.${type}`, ...pick(rec, ["attempt", "maxAttempts", "success", "reason", "aborted"]), ...(typeof rec.errorMessage === "string" ? { errorMessage: rec.errorMessage.slice(0, 300) } : {}), ...(typeof rec.finalError === "string" ? { finalError: rec.finalError.slice(0, 300) } : {}) } }];
    default:
      return [unknown(type || "(ohne type)")];
  }
}

/** ADR-0032: one event per model reply. The fill is what the request
 * carried — pi splits it into fresh input and cache reads/writes, so all
 * three count (real capture: round 2 = 53 input + 1057 cacheRead). */
function usageEvent(raw: unknown): EmittedEvent[] {
  const u = (raw ?? {}) as { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; totalTokens?: unknown };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (typeof u.input !== "number" && typeof u.output !== "number") return [];
  const input = n(u.input) + n(u.cacheRead) + n(u.cacheWrite);
  const output = n(u.output);
  const total = typeof u.totalTokens === "number" ? u.totalTokens : input + output;
  return [{ type: "system", summary: `pi: ${total} Tokens`, payload: { kind: "pi.usage", usage: { input, output } }, tokensEst: total }];
}

function pick(rec: Record_, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (rec[k] !== undefined) out[k] = typeof rec[k] === "string" ? (rec[k] as string).slice(0, 500) : rec[k];
  return out;
}

/** Line-buffered parser. Splits on LF only — pi's docs warn that readline
 * also breaks on U+2028/U+2029, which are legal inside JSON strings.
 * `live` (ADR-0083) nimmt Deltas als transiente Frames ab; ohne Pumpe bleibt
 * alles bei den Block-Ereignissen — dann wird nichts gestreamt, aber auch nichts
 * vorgetäuscht. */
export function createPiStream(live?: LivePump): { push(chunk: string): EmittedEvent[]; end(): EmittedEvent[] } {
  let buf = "";
  const line = (raw: string): EmittedEvent[] => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!text.trim()) return [];
    let rec: unknown;
    try {
      rec = JSON.parse(text);
    } catch {
      return [{ type: "system", summary: "pi: Zeile ist kein JSON", payload: { kind: "pi.unparsed", raw: text.slice(0, 500) } }];
    }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return [unknown("(kein Objekt)")];
    return normalize(rec as Record_, live);
  };
  return {
    push(chunk) {
      buf += chunk;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      return parts.flatMap(line);
    },
    end() {
      const rest = buf;
      buf = "";
      return line(rest);
    },
  };
}
