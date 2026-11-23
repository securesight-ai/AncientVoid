import type { EmittedEvent } from "@ancientvoid/contracts";

/**
 * ACP `session/update` → NormalizedEvents (schema: @agentclientprotocol/sdk
 * 1.5.0, PROTOCOL_VERSION 1). Text arrives in chunks; one chat message per
 * agent message, not one event per token (K8). Plans map onto the todo shape
 * the run strip already reads (`todowrite`).
 *
 * BUG-0247/0248: Shell-Tools liefern `command` oft erst in `tool_call_update`
 * (opencode ACP: erstes `tool_call` nur `{cwd}`, Update dann mit `command`).
 * Ohne Nachzug bleibt nur `cwd`/`title` im Eventstore — Kuratierung blind.
 * `title` wird nie zu `command` (PRD §8.5).
 */

interface ContentBlock {
  type?: string;
  text?: string;
}

interface ToolCallContent {
  type?: string;
  content?: ContentBlock;
  path?: string;
}

export interface SessionUpdate {
  _meta?: Readonly<Record<string, unknown>>;
  sessionUpdate?: string;
  content?: ContentBlock | ToolCallContent[];
  messageId?: string | null;
  toolCallId?: string;
  title?: string | null;
  name?: string | null;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  entries?: { content?: string; status?: string; priority?: string }[];
  message?: string;
  used?: unknown;
  size?: unknown;
}

type PendingTool = {
  name: string;
  kind: string | null;
  input: Record<string, unknown>;
  title: string | null;
  emitted: boolean;
};

function summarize(text: string, max = 200): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** dsh reports a failed command as "completed" with `[exit code: N]` at the end. */
const NONZERO_EXIT = /\[exit code: [1-9]\d*\]\s*$/;

/** ACP `rawInput` as object or JSON string — never invented from `title`. */
export function resolveRawInput(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    return undefined;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return undefined;
}

function inputHasCommand(input: Record<string, unknown>): boolean {
  return typeof input.command === "string" && input.command.trim().length > 0;
}

function isShellish(name: string, kind: string | null): boolean {
  const n = name.toLowerCase();
  // ACP `kind: execute` is the shell slot (opencode/maki/dsh); name alone covers non-kind agents.
  return n === "bash" || n === "shell" || kind === "execute";
}

function toolResultText(update: SessionUpdate): string {
  const parts: string[] = [];
  if (Array.isArray(update.content)) {
    for (const c of update.content) {
      if (c.type === "content" && c.content?.type === "text" && c.content.text) parts.push(c.content.text);
      else if (c.type === "diff" && c.path) parts.push(`Änderung: ${c.path}`);
      else if (c.type === "terminal") parts.push("(Terminal-Ausgabe)");
    }
  }
  if (parts.length === 0 && update.rawOutput !== undefined) {
    parts.push(typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput));
  }
  return parts.join("\n");
}

function toolUseEvent(id: string | undefined, pending: PendingTool): EmittedEvent {
  const { name, kind, input, title } = pending;
  return {
    type: "tool_use",
    summary: summarize(`${name}(${JSON.stringify(input).slice(0, 150)})`),
    payload: {
      id,
      name,
      input,
      kind,
      ...(title ? { title } : {}),
    },
  };
}

export class UpdateMapper {
  private text = "";
  private thought = "";
  private readonly toolNames = new Map<string, string>();
  private readonly pendingTools = new Map<string, PendingTool>();
  private readonly unknownSeen = new Set<string>();
  private readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  /** Buffered text as events — call before anything else is emitted and at turn end. */
  flush(): EmittedEvent[] {
    const out: EmittedEvent[] = [];
    if (this.thought) out.push({ type: "thinking", summary: summarize(this.thought) || "(denkt)", payload: { text: this.thought } });
    if (this.text) out.push({ type: "assistant", summary: summarize(this.text), payload: { text: this.text } });
    this.thought = "";
    this.text = "";
    return out;
  }

  map(update: SessionUpdate): EmittedEvent[] {
    const kind = update.sessionUpdate ?? "";
    const block = !Array.isArray(update.content) ? update.content : undefined;
    switch (kind) {
      case "agent_message_chunk":
        if (this.thought) {
          const out = this.flush();
          this.text += block?.text ?? "";
          return out;
        }
        this.text += block?.text ?? "";
        return [];
      case "agent_thought_chunk":
        if (this.text) {
          const out = this.flush();
          this.thought += block?.text ?? "";
          return out;
        }
        this.thought += block?.text ?? "";
        return [];
      case "tool_call":
        return this.onToolCall(update);
      case "tool_call_update":
        return this.onToolCallUpdate(update);
      case "plan":
        return [
          ...this.flush(),
          {
            type: "tool_use",
            summary: `Plan: ${(update.entries ?? []).filter((e) => e.status === "completed").length}/${(update.entries ?? []).length} erledigt`,
            payload: { name: "todowrite", input: { todos: (update.entries ?? []).map((e) => ({ content: e.content, status: e.status })) }, source: "acp.plan" },
          },
        ];
      case "notice":
        return [{ type: "system", summary: summarize(`${this.label}: ${update.message ?? "Hinweis"}`), payload: { kind: "acp.notice" } }];
      case "usage_update":
        if (typeof update.used === "number" && Number.isSafeInteger(update.used) && update.used >= 0 &&
          typeof update.size === "number" && Number.isSafeInteger(update.size) && update.size > 0) {
          return [{
            type: "system",
            summary: `${this.label}: gemeldeter Kontext`,
            payload: { kind: "acp.context", contextInputTokens: update.used, contextWindowTokens: update.size },
          }];
        }
        return [{ type: "system", summary: `${this.label}: ACP-Kontextmeldung ohne gültige Tokenzahlen`, payload: { kind: "acp.invalid_usage" } }];
      case "session_info_update": {
        // OpenCode ACP provider extension observed in BUG-0192.
        const compact = update._meta?.["opencode/compaction"] as { status?: unknown; reason?: unknown } | undefined;
        if (compact?.status !== "started" && compact?.status !== "completed") return [];
        return [{
          type: "system",
          summary: compact.status === "started" ? `${this.label}: Kontext wird komprimiert` : `${this.label}: Kontext komprimiert`,
          payload: {
            kind: compact.status === "started" ? "acp.compaction_start" : "acp.compaction_end",
            ...(typeof compact.reason === "string" ? { reason: compact.reason.slice(0, 60) } : {}),
          },
        }];
      }
      case "user_message_chunk":
      case "available_commands_update":
      case "current_mode_update":
      case "config_option_update":
      case "plan_update":
      case "plan_removed":
      case "compaction_update":
      case "compaction_summary_chunk":
        return [];
      default:
        // Fail loud, once per kind: a new update type is visible, not dropped.
        if (this.unknownSeen.has(kind)) return [];
        this.unknownSeen.add(kind);
        return [{ type: "system", summary: `${this.label}: unbekanntes ACP-Update "${kind.slice(0, 60)}"`, payload: { kind: "acp.unhandled_update", update: kind.slice(0, 60) } }];
    }
  }

  private onToolCall(update: SessionUpdate): EmittedEvent[] {
    const id = update.toolCallId;
    const name = update.name ?? update.title ?? update.kind ?? "tool";
    if (id) this.toolNames.set(id, name);
    const input = resolveRawInput(update.rawInput) ?? {};
    const pending: PendingTool = {
      name,
      kind: update.kind ?? null,
      input,
      title: typeof update.title === "string" ? update.title : null,
      emitted: false,
    };
    if (id) this.pendingTools.set(id, pending);
    // Shell ohne command: warten auf tool_call_update (BUG-0247/0248).
    if (isShellish(name, pending.kind) && !inputHasCommand(input)) {
      return this.flush();
    }
    pending.emitted = true;
    return [...this.flush(), toolUseEvent(id, pending)];
  }

  private onToolCallUpdate(update: SessionUpdate): EmittedEvent[] {
    const id = update.toolCallId;
    const known = id ? this.pendingTools.get(id) : undefined;
    const name = update.name ?? known?.name ?? (id ? this.toolNames.get(id) : undefined) ?? update.title ?? update.kind ?? "tool";
    if (id) this.toolNames.set(id, name);

    const patch = resolveRawInput(update.rawInput);
    const pending: PendingTool = known ?? {
      name,
      kind: update.kind ?? null,
      input: {},
      title: typeof update.title === "string" ? update.title : null,
      emitted: false,
    };
    if (update.name) pending.name = update.name;
    if (update.kind) pending.kind = update.kind;
    if (typeof update.title === "string") pending.title = update.title;
    if (patch) pending.input = { ...pending.input, ...patch };
    if (id && known) this.pendingTools.set(id, pending);

    const out: EmittedEvent[] = [...this.flush()];
    const terminal = update.status === "completed" || update.status === "failed";
    // Nur nachziehen, wenn wir ein tool_call gesehen haben — sonst nur tool_result
    // (dsh-Exit-Code-Test und andere orphan updates).
    if (known && !pending.emitted) {
      const ready = inputHasCommand(pending.input) || !isShellish(pending.name, pending.kind) || terminal;
      if (ready) {
        pending.emitted = true;
        out.push(toolUseEvent(id, pending));
      }
    } else if (known && pending.emitted && patch && inputHasCommand(pending.input)) {
      out.push(toolUseEvent(id, pending));
    }

    if (!terminal) return out;

    const content = toolResultText(update);
    out.push({
      type: "tool_result",
      summary: summarize(content) || (update.status === "failed" ? "Tool-Fehler" : "Tool fertig"),
      payload: {
        toolUseId: id,
        name: id ? this.toolNames.get(id) : undefined,
        isError: update.status === "failed" || NONZERO_EXIT.test(content),
        content,
      },
    });
    if (id) this.pendingTools.delete(id);
    return out;
  }
}
