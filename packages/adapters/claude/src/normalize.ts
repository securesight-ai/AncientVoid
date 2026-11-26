import { providerErrorEvent, type EmittedEvent, type UsageQuota } from "@ancientvoid/contracts";

/**
 * Maps one parsed line of `claude --output-format stream-json` output to
 * zero or more EmittedEvents.
 *
 * Ground truth: two real `claude -p <prompt> --output-format stream-json
 * --verbose` captures (CLI 2.1.263, 2026-09-14) — see `test/fixtures/`, not
 * the simplified table in `epics/EPIC-P1-claude-codex-monitor.md` §3, which
 * undersold the real shape (no `hook_started`/`hook_response`/
 * `rate_limit_event`; `assistant`/`user` carry content-block arrays, not
 * flat `tool_use`/`tool_result` top-level types). `thinking` content blocks
 * were NOT observed in either capture (no extended-thinking run) at T1.2
 * time — since confirmed against a real extended-thinking capture
 * (2026-09-15 live session): the block arrives with `thinking: ""` and an
 * opaque `signature` (Anthropic redacts the reasoning text itself), so an
 * empty `payload.text` there is correct real behavior, not a mapping gap.
 */

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function asString(v: unknown, max = 4000): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v).slice(0, max);
  } catch {
    return String(v).slice(0, max);
  }
}

function summarize(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/** Unix seconds -> ISO-8601. Real `resetsAt` values are seconds, not ms
 * (verified against real captures: 1789435200 is a 2026 date in seconds,
 * not milliseconds). Falls back to passing a string through unchanged, in
 * case a future CLI version switches to sending ISO directly. */
function toIsoTimestamp(v: unknown): string | undefined {
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

/**
 * Maps claude's real `rate_limit_info.unifiedWindows` (ADR-0004) into the
 * provider-neutral `UsageQuota` contract shape. Ground truth:
 * `test/fixtures/*.jsonl` and a live 2026-09-15 capture — real shape is
 * `{status, resetsAt, rateLimitType, overageStatus, overageDisabledReason,
 * isUsingOverage, unifiedWindows: {<id>: {utilization, resetsAt}}}`.
 * Returns undefined rather than a partial/guessed quota when the windows
 * are missing or malformed — never fabricate a window.
 */
function normalizeUsageQuota(info: Record<string, unknown> | undefined): UsageQuota | undefined {
  if (!info) return undefined;
  const rawWindows = info.unifiedWindows;
  if (typeof rawWindows !== "object" || rawWindows === null) return undefined;

  const windows: UsageQuota["windows"] = [];
  for (const [id, value] of Object.entries(rawWindows as Record<string, unknown>)) {
    const w = value as Record<string, unknown>;
    const utilization = w.utilization;
    const resetsAt = toIsoTimestamp(w.resetsAt);
    if (typeof utilization !== "number" || resetsAt === undefined) continue;
    windows.push({ id, utilization, resetsAt });
  }
  if (windows.length === 0) return undefined;

  const overageBlockedReason = typeof info.overageDisabledReason === "string" ? info.overageDisabledReason : undefined;
  // overageDisabledReason present -> explicitly not available (matches the
  // real observed "out_of_credits" case). isUsingOverage:true -> available
  // (an account actively using it clearly has it). Neither signal ->
  // undefined, never guessed.
  const overageAvailable =
    overageBlockedReason !== undefined ? false : info.isUsingOverage === true ? true : undefined;

  return {
    windows,
    ...(overageAvailable !== undefined ? { overageAvailable } : {}),
    ...(overageBlockedReason !== undefined ? { overageBlockedReason } : {}),
  };
}

export function normalizeClaudeLine(raw: unknown, mainModel?: string): EmittedEvent[] {
  if (typeof raw !== "object" || raw === null) {
    return [
      { type: "system", summary: "claude: non-object stream-json line", payload: { raw: asString(raw) } },
    ];
  }
  const line = raw as Record<string, unknown>;

  switch (line.type) {
    case "system":
      return [normalizeSystem(line)];
    case "rate_limit_event": {
      const info = line.rate_limit_info as Record<string, unknown> | undefined;
      const quota = normalizeUsageQuota(info);
      return [
        {
          type: "system",
          summary: "claude: rate-limit status update",
          payload: { info },
          ...(quota ? { usageQuota: quota } : {}),
        },
      ];
    }
    case "result":
      // ADR-0015: a failed turn also says why, in words.
      return line.is_error === true && typeof line.result === "string"
        ? [normalizeResult(line, mainModel), providerErrorEvent("claude", line.result)]
        : [normalizeResult(line, mainModel)];
    case "assistant":
    case "user": {
      const message = line.message as { content?: ContentBlock[]; usage?: Record<string, unknown> } | undefined;
      const blocks = Array.isArray(message?.content) ? message!.content! : [];
      if (blocks.length === 0) {
        return [
          {
            type: "system",
            summary: `claude: ${line.type} message without content blocks`,
            payload: { role: line.type },
          },
        ];
      }
      const events = blocks.flatMap((block) => normalizeContentBlock(block, line.type as "assistant" | "user"));
      const usage = message?.usage;
      if (line.type === "assistant" && typeof line.parent_tool_use_id !== "string" && usage && typeof usage.input_tokens === "number") {
        const contextInputTokens = usage.input_tokens + (typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0) +
          (typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0);
        events.push({ type: "system", summary: "Claude · gemeldeter Kontext", payload: { kind: "claude.context", contextInputTokens } });
      }
      return events;
    }
    case "attachment":
      // Claude Code >= 2.1.28x emits top-level `attachment` events (files the
      // CLI attaches itself, e.g. images/PDFs from the prompt). Informational —
      // the follow-up tool_use/user events carry the actual content.
      return [
        {
          type: "system",
          summary: "claude: Anhang hinzugefügt",
          payload: { subtype: "attachment", source: asString((line as Record<string, unknown>).source, 60) },
        },
      ];
    case "ai-title":
    case "last-prompt":
    case "mode":
    case "permission-mode":
    case "atis-latch":
    case "pr-link":
    case "cost-state":
    case "queue-operation":
    case "file-history-snapshot":
    case "api-request":
    case "api-request-blob":
    case "api-request-shape":
      // ADR-0040: bookkeeping rows of Claude's own transcript file (titles, modes,
      // request shapes). They appear only when a transcript is imported on
      // adoption, never in a live stream — a named list, not a silent catch-all:
      // everything else still fails loud below.
      return [];
    case "tool_progress":
      // Claude Code >= 2.1.3xx: informational heartbeat progress of an
      // already-reported tool call (tool_use_id carries "-heartbeat-N").
      // Emits nothing — one system event per ~30s heartbeat turned into
      // event spam during long-running tools (live 27.10.2026).
      // NOT a silent drop of an unknown type: this case is explicit and
      // tested; anything else still fails loud in the default branch.
      return [];
    case "stream_event":
      // SDK-style streaming envelope. `claude -p stream-json` flattens these
      // today; we only report the envelope (fail loud, rule 6) and do not
      // unwrap the inner event.
      // ADR-0083: `content_block_*` carries the provider's real deltas — they go to
      // the live pump (index.ts), not the event store. Anything else in a stream
      // envelope (message_start/…, usage) is still reported as before (fail loud).
      if (claudeStreamDelta(line)) return [];
      return [
        {
          type: "system",
          summary: "claude: stream envelope (ignoriert, Inhalte kommen als separate Events)",
          payload: { subtype: "stream_event" },
        },
      ];
    default:
      // Fail loud (AGENTS.md rule 6): an unrecognized stream-json type
      // becomes a visible system event, never a silent drop.
      return [
        {
          type: "system",
          summary: `claude: unhandled stream-json type "${asString(line.type, 60)}"`,
          payload: { unhandledType: asString(line.type, 60) },
        },
      ];
  }
}

/**
 * ADR-0083: claude's stream-json carries the provider's deltas inside
 * `stream_event` envelopes. Recognising them here (and returning `null` for
 * everything else) keeps the fail-loud envelope report for unknown shapes while
 * the adapter pumps the real text to `ctx.stream`.
 */
type ClaudeStreamKind = "assistant" | "thinking";
export interface ClaudeStreamPart {
  inner: "start" | "delta" | "stop";
  index: number;
  stream: ClaudeStreamKind;
  text: string;
}

export function claudeStreamDelta(line: Record<string, unknown>): ClaudeStreamPart | null {
  if (line.type !== "stream_event") return null;
  const ev = line.event as Record<string, unknown> | undefined;
  if (!ev || typeof ev.type !== "string") return null;
  const index = typeof ev.index === "number" ? ev.index : 0;
  if (ev.type === "content_block_start") {
    const block = ev.content_block as Record<string, unknown> | undefined;
    const bt = typeof block?.type === "string" ? block.type : "";
    if (bt !== "text" && bt !== "thinking") return null; // tool_use & co streamen hier nichts
    return { inner: "start", index, stream: bt === "thinking" ? "thinking" : "assistant", text: "" };
  }
  if (ev.type === "content_block_delta") {
    const d = ev.delta as Record<string, unknown> | undefined;
    const dt = typeof d?.type === "string" ? d.type : "";
    if (dt !== "text_delta" && dt !== "thinking_delta") return null; // input_json_delta: Werkzeug-Argumente
    const raw = dt === "thinking_delta" ? d!.thinking : d!.text;
    if (typeof raw !== "string" || raw === "") return null; // unbekannte Form: Hülle bleibt sichtbar
    return { inner: "delta", index, stream: dt === "thinking_delta" ? "thinking" : "assistant", text: raw };
  }
  if (ev.type === "content_block_stop") return { inner: "stop", index, stream: "assistant", text: "" };
  return null; // message_start / message_delta / message_stop: Usage, kein Text
}

function normalizeSystem(line: Record<string, unknown>): EmittedEvent {
  const subtype = typeof line.subtype === "string" ? line.subtype : "unknown";
  const payload: Record<string, unknown> = { subtype };
  if (subtype === "init") {
    payload.cwd = line.cwd;
    payload.claudeCodeVersion = line.claude_code_version;
    payload.toolCount = Array.isArray(line.tools) ? line.tools.length : undefined;
    // ADR-0033: what the CLI really runs with — a mode or model that differs
    // from what was asked shows up in the history instead of staying silent.
    if (typeof line.model === "string") payload.model = line.model;
    if (typeof line.permissionMode === "string") payload.permissionMode = line.permissionMode;
  } else {
    for (const key of ["hook_name", "hook_event", "outcome", "exit_code"] as const) {
      if (key in line) payload[key] = line[key];
    }
  }
  return { type: "system", summary: `claude: system/${subtype}`, payload };
}

function normalizeResult(line: Record<string, unknown>, mainModel?: string): EmittedEvent {
  const costUsd = typeof line.total_cost_usd === "number" ? line.total_cost_usd : undefined;
  const isError = line.is_error === true;
  const costSuffix = costUsd !== undefined ? ` — $${costUsd.toFixed(4)}` : "";
  // ADR-0006: the same result line already carries a cumulative `usage`
  // object (input_tokens/output_tokens) right next to total_cost_usd —
  // one combined number, not a second in/out split field.
  const usage = line.usage as Record<string, unknown> | undefined;
  const inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
  const cacheInput = [usage?.cache_read_input_tokens, usage?.cache_creation_input_tokens]
    .reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
  const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
  const tokensEst = inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined;
  const models = line.modelUsage && typeof line.modelUsage === "object"
    ? Object.entries(line.modelUsage as Record<string, { contextWindow?: unknown; maxOutputTokens?: unknown } | null>)
    : [];
  const modelDetails = mainModel ? models.find(([name]) => name === mainModel) : models.length === 1 ? models[0] : undefined;
  return {
    type: "system",
    summary: `claude: turn complete${isError ? " (error)" : ""}${costSuffix}`,
    payload: {
      kind: "claude.result",
      isError,
      numTurns: line.num_turns,
      durationMs: line.duration_ms,
      result: typeof line.result === "string" ? line.result.slice(0, 500) : undefined,
      ...(modelDetails ? {
        model: modelDetails[0],
        ...(typeof modelDetails[1]?.contextWindow === "number" && modelDetails[1].contextWindow > 0 ? { contextWindowTokens: modelDetails[1].contextWindow } : {}),
        ...(typeof modelDetails[1]?.maxOutputTokens === "number" && modelDetails[1].maxOutputTokens > 0 ? { maxOutputTokens: modelDetails[1].maxOutputTokens } : {}),
      } : {}),
      ...(cacheInput > 0 ? { cacheInputTokens: cacheInput } : {}),
      ...(inputTokens !== undefined || outputTokens !== undefined
        ? { usage: { ...(inputTokens !== undefined ? { input: inputTokens } : {}), ...(outputTokens !== undefined ? { output: outputTokens } : {}) } }
        : {}),
    },
    // ADR-0003: costUsd is a first-class, provider-neutral contract field
    // now — no longer duplicated into payload.totalCostUsd.
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(tokensEst !== undefined ? { tokensEst } : {}),
  };
}

/** BUG-0046: Anthropic liefert den Denk-Text teils nicht (leerer Block mit Signatur). */
const THINKING_WITHHELD = "Claude hat nachgedacht — der Anbieter liefert den Text nicht";

function normalizeContentBlock(block: ContentBlock, role: "assistant" | "user"): EmittedEvent[] {
  switch (block.type) {
    case "text":
      // ADR-0041: in an imported transcript the person's own turns are text blocks of role user.
      if (role === "user") return (block.text ?? "").trim() ? [{ type: "user", summary: summarize(block.text ?? ""), payload: { text: block.text ?? "" } }] : [];
      return [{ type: "assistant", summary: summarize(block.text ?? ""), payload: { text: block.text ?? "" } }];
    case "thinking":
      if (!block.thinking?.trim()) return [{ type: "thinking", summary: THINKING_WITHHELD, payload: { text: "", redacted: true } }];
      return [{ type: "thinking", summary: summarize(block.thinking), payload: { text: block.thinking } }];
    case "tool_use":
      return [
        {
          type: "tool_use",
          summary: summarize(`${block.name ?? "tool"}(${asString(block.input, 150)})`),
          payload: { id: block.id, name: block.name, input: block.input },
        },
      ];
    case "tool_result": {
      // K5 (payload <= 4 KB) is enforced by EventStore.append() itself —
      // the adapter emits the full content and lets the hub offload it to
      // a blob if needed, rather than duplicating that policy here.
      const content = asString(block.content, 100_000);
      return [
        {
          type: "tool_result",
          summary: summarize(content) || (block.is_error ? "tool error" : "tool result"),
          payload: { toolUseId: block.tool_use_id, isError: block.is_error === true, content },
        },
      ];
    }
    default:
      return [
        {
          type: "system",
          summary: `claude: unhandled ${role} content block "${asString(block.type, 40)}"`,
          payload: { role, blockType: asString(block.type, 40) },
        },
      ];
  }
}
