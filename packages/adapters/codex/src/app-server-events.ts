import type { EmittedEvent, UsageQuota } from "@ancientvoid/contracts";
import { summarize } from "./summary.ts";

/**
 * `codex app-server` (v2 protocol, codex-cli 0.156.1 / 0.164.0, schema generated with
 * `codex app-server generate-json-schema`) → NormalizedEvents. Pure
 * functions; the adapter owns the connection.
 */

export interface CodexItem {
  agentThreadId?: string;
  kind?: string;
  type?: string;
  id?: string;
  text?: string;
  summary?: string[];
  content?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  exitCode?: number | null;
  aggregatedOutput?: string | null;
  changes?: { path: string; kind?: unknown; diff?: string }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  query?: string;
  namespace?: string | null;
  success?: boolean | null;
  contentItems?: { type?: string; text?: string }[] | null;
  agentsStates?: Record<string, unknown>;
  prompt?: string | null;
  path?: string;
  savedPath?: string | null;
  revisedPrompt?: string | null;
  failure?: unknown;
  durationMs?: number;
}

/** Tool label on the approval card and in the history. */
export function toolOf(item: CodexItem): { name: string; input: Record<string, unknown> } | null {
  switch (item.type) {
    case "commandExecution":
      return { name: "Shell", input: { command: item.command ?? "", ...(item.cwd ? { cwd: item.cwd } : {}) } };
    case "fileChange":
      return { name: "Bearbeiten", input: { files: (item.changes ?? []).map((c) => c.path) } };
    case "mcpToolCall":
      return { name: `${item.server ?? "mcp"}.${item.tool ?? "tool"}`, input: item.arguments && typeof item.arguments === "object" ? (item.arguments as Record<string, unknown>) : {} };
    case "dynamicToolCall":
      return { name: [item.namespace, item.tool ?? "tool"].filter(Boolean).join("."), input: item.arguments && typeof item.arguments === "object" ? item.arguments as Record<string, unknown> : { value: item.arguments } };
    case "collabAgentToolCall":
      return { name: item.tool ?? "agent", input: { prompt: item.prompt ?? "" } };
    case "imageView":
      return { name: "view_image", input: { path: item.path ?? "" } };
    case "imageGeneration":
      return { name: "imagegen", input: { prompt: item.revisedPrompt ?? "" } };
    case "sleep":
      return { name: "sleep", input: { durationMs: item.durationMs } };
    case "webSearch":
      return { name: "Web-Suche", input: { query: item.query ?? "" } };
    default:
      return null;
  }
}

export function itemStarted(item: CodexItem): EmittedEvent[] {
  if (item.type === "contextCompaction") {
    return [{ type: "system", summary: "codex: Kontext wird komprimiert", payload: { kind: "codex.compaction_start" } }];
  }
  const tool = toolOf(item);
  if (!tool) return [];
  return [{ type: "tool_use", summary: summarize(`${tool.name}(${JSON.stringify(tool.input).slice(0, 150)})`), payload: { id: item.id, name: tool.name, input: tool.input, ...(item.type === "fileChange" ? { kind: "edit" } : item.type === "webSearch" ? { kind: "fetch" } : {}) } }];
}

export function itemCompleted(item: CodexItem): EmittedEvent[] {
  switch (item.type) {
    case "agentMessage":
      return item.text ? [{ type: "assistant", summary: summarize(item.text), payload: { text: item.text } }] : [];
    case "reasoning": {
      const text = [...(item.summary ?? []), ...(item.content ?? [])].join("\n").trim();
      return text ? [{ type: "thinking", summary: summarize(text), payload: { text } }] : [];
    }
    case "commandExecution": {
      const failed = item.status !== "completed" || (item.exitCode !== null && item.exitCode !== undefined && item.exitCode !== 0);
      const content = item.status === "declined" ? "abgelehnt — nicht ausgeführt" : (item.aggregatedOutput ?? "");
      return [{ type: "tool_result", summary: summarize(content) || (failed ? "Befehl fehlgeschlagen" : "Befehl fertig"), payload: { toolUseId: item.id, isError: failed, content, exitCode: item.exitCode ?? null } }];
    }
    case "fileChange": {
      const paths = (item.changes ?? []).map((c) => c.path);
      const content = item.status === "declined" ? "abgelehnt — nicht geändert" : `geändert: ${paths.join(", ")}`;
      return [{ type: "tool_result", summary: summarize(content), payload: { toolUseId: item.id, isError: item.status !== "completed", content } }];
    }
    case "mcpToolCall":
    case "webSearch": {
      const content = JSON.stringify(item.result ?? item.error ?? {}).slice(0, 100_000);
      return [{ type: "tool_result", summary: summarize(content), payload: { toolUseId: item.id, isError: Boolean(item.error) || item.status === "failed", content } }];
    }
    case "dynamicToolCall": {
      const content = (item.contentItems ?? []).map((part) => part.text ?? `[${part.type ?? "Inhalt"}]`).join("\n");
      return [{ type: "tool_result", summary: summarize(content) || "Werkzeug beendet", payload: { toolUseId: item.id, name: toolOf(item)?.name, isError: item.success === false || item.status === "failed", content } }];
    }
    case "collabAgentToolCall": {
      const content = JSON.stringify(item.agentsStates ?? {});
      return [{ type: "tool_result", summary: summarize(content), payload: { toolUseId: item.id, name: item.tool, isError: item.status === "failed" || item.status === "interrupted", content } }];
    }
    case "imageView":
    case "imageGeneration":
    case "sleep": {
      const content = item.savedPath ?? item.path ?? (item.failure ? JSON.stringify(item.failure) : "fertig");
      return [{ type: "tool_result", summary: summarize(content), payload: { toolUseId: item.id, isError: Boolean(item.failure) || item.status === "failed", content } }];
    }
    case "plan":
      return item.text ? [{ type: "thinking", summary: summarize(item.text), payload: { text: item.text } }] : [];
    case "contextCompaction":
      return [{ type: "system", summary: "codex: Kontext komprimiert", payload: { kind: "codex.compaction_end" } }];
    case "userMessage":
    case "hookPrompt":
    case "subAgentActivity":
    case "enteredReviewMode":
    case "exitedReviewMode":
      return [];
    default:
      return [{ type: "system", summary: summarize(`codex: unbekannter Item-Typ „${item.type ?? "(ohne Typ)"}“`), payload: { kind: "codex.unknown_item", itemType: item.type ?? null } }];
  }
}

/** turn/plan/updated → the todo shape the run strip reads. */
export function planEvent(plan: { step: string; status: string }[]): EmittedEvent {
  const status = (s: string) => (s === "inProgress" ? "in_progress" : s);
  return {
    type: "tool_use",
    summary: `Plan: ${plan.filter((p) => p.status === "completed").length}/${plan.length} erledigt`,
    payload: { name: "todowrite", input: { todos: plan.map((p) => ({ content: p.step, status: status(p.status) })) }, source: "codex.plan" },
  };
}

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

/** account rate limits → ADR-0004 quota (5-h and 7-day windows). */
export function quotaOf(rateLimits: { primary?: RateLimitWindow | null; secondary?: RateLimitWindow | null } | undefined): UsageQuota | undefined {
  const windows: UsageQuota["windows"] = [];
  for (const w of [rateLimits?.primary, rateLimits?.secondary]) {
    if (!w || typeof w.usedPercent !== "number" || typeof w.resetsAt !== "number") continue;
    const id = w.windowDurationMins === 300 ? "five_hour" : w.windowDurationMins === 10080 ? "seven_day" : `${w.windowDurationMins ?? "?"}min`;
    windows.push({ id, utilization: Math.min(1, Math.max(0, w.usedPercent / 100)), resetsAt: new Date(w.resetsAt * 1000).toISOString() });
  }
  return windows.length > 0 ? { windows } : undefined;
}
