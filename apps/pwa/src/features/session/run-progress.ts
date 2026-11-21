import { fmtNumber, fmtTime, fmtDateTime } from "../../shared/i18n/format.ts";
import type { AdapterUsage, RunEstimate, UsageQuota } from "../../shared/api.ts";
import type { NormalizedEvent } from "../../shared/ws.ts";

/**
 * How far the current turn is — only from the agent's own plan. An LLM turn
 * reports no percentage; the todo list it writes (OpenCode `todowrite`,
 * Claude `TodoWrite`, input `{ todos: [{ status }] }` per their docs) is the
 * one honest signal. Without a plan there is no percent, only elapsed time.
 */
interface TodoItem {
  text: string;
  status: string;
}

export interface RunProgress {
  source: "todos" | "none";
  done: number;
  total: number;
  percent: number | null;
  elapsedMs: number;
  /** BUG-0062: measured plan velocity — remaining items over the rate of
   * the last two snapshots with different done counts. Independent of
   * `now`, so a stale plan cannot inflate it; null without two progress
   * snapshots (no guess) or when everything is done. */
  etaMs: number | null;
  /** 2026-10-26: without a plan there is no honest total ETA — the honest
   * fallback is how long a turn takes in THIS session, so the strip can
   * say "Zug meist ~N min" instead of nothing. Null with fewer than two
   * finished turns (one duration is no statistics). */
  medianTurnMs: number | null;
  turnCount: number;
  /** 2026-10-25: the plan's own entries — transparency, click-to-expand. */
  todos: TodoItem[];
}

// 2026-10-25: broadened — Claude (TodoWrite), OpenCode (todowrite), and the
// common snake/kevel variants (todo_write, todo-write, todoUpdate) all carry
// the same { todos: [{ status, content }] } shape.
const TODO_TOOL = /^(todo[_-]?write|todo[_-]?update|update[_-]?todos?)$/i;

function todosOf(event: NormalizedEvent): { status?: unknown; content?: unknown }[] | null {
  if (event.type !== "tool_use") return null;
  const payload = event.payload as { tool?: unknown; name?: unknown; input?: { todos?: unknown } };
  const tool = typeof payload.tool === "string" ? payload.tool : typeof payload.name === "string" ? payload.name : "";
  if (!TODO_TOOL.test(tool) || !Array.isArray(payload.input?.todos)) return null;
  return payload.input.todos as { status?: unknown }[];
}

/** Finished-turn durations across the WHOLE session (prompt → turn_end),
 * not just the running one — the "how long does a turn take here" signal
 * for turns without a plan. Sub-second durations are startup noise. */
function turnDurationsMs(events: readonly NormalizedEvent[]): number[] {
  const durations: number[] = [];
  let promptTs: number | null = null;
  for (const e of events) {
    const kind = (e.payload as { kind?: unknown }).kind;
    if (kind === "session.prompt" || kind === "session.resumed") promptTs = Date.parse(e.ts);
    else if (kind === "session.turn_end" && promptTs !== null) {
      const span = Date.parse(e.ts) - promptTs;
      if (span >= 1000 && e.payload.reason !== "interrupted" && e.payload.reason !== "error") durations.push(span);
      promptTs = null;
    }
  }
  return durations;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function runProgress(events: readonly NormalizedEvent[], status: string, now = Date.now()): RunProgress | null {
  if (status !== "working" && status !== "waiting_approval") return null;
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (["session.prompt", "session.resumed"].includes(String(events[i]!.payload.kind))) {
      start = i;
      break;
    }
  }
  const turn = events.slice(start);
  const startedAt = turn[0] ? Date.parse(turn[0].ts) : now;
  const elapsedMs = Math.max(0, now - startedAt);
  // Every todo snapshot with its own timestamp — the ETA below measures
  // plan velocity from these pairs, never from `now` (BUG-0062).
  const todoEvents = turn.filter(todosOf);
  const snapshots = todoEvents
    .map((e) => {
      const counted = todosOf(e)!.filter((t) => t.status !== "cancelled");
      return {
        ts: Date.parse(e.ts),
        done: counted.filter((t) => t.status === "completed").length,
        total: counted.length,
      };
    })
    .filter((s) => s.total > 0);
  const last = snapshots.at(-1);
  const lastTodos = todoEvents.at(-1) ? todosOf(todoEvents.at(-1)!) : null;
  if (status === "waiting_approval" && !lastTodos?.length) return null;
  const turnDurations = turnDurationsMs(events);
  if (!last)
    return {
      source: "none",
      done: 0,
      total: 0,
      percent: null,
      elapsedMs,
      etaMs: null,
      medianTurnMs: turnDurations.length >= 2 ? median(turnDurations) : null,
      turnCount: turnDurations.length,
      todos: [],
    };
  const done = last.done;
  const total = last.total;
  const ratio = done / total;
  // BUG-0062: the old `elapsed·(1-r)/r` grew whenever the agent didn't
  // rewrite its plan for a while (r frozen, elapsed climbing — 25 min
  // became "noch ca. 2 h" on a real turn). The honest signal is how fast
  // completed-items actually accumulated between snapshots: velocity
  // from the last pair with different done counts, ETA = remaining /
  // velocity. Fewer than two progress snapshots → no ETA at all, rather
  // than a guess that pretends to know.
  let etaMs: number | null = null;
  if (status === "working" && done < total) {
    for (let i = snapshots.length - 1; i > 0 && etaMs === null; i--) {
      const prev = snapshots[i - 1]!;
      const cur = snapshots[i]!;
      const gained = cur.done - prev.done;
      const span = cur.ts - prev.ts;
      // Sub-second spans (two snapshots emitted back to back) say nothing
      // about real per-item duration — keep looking for an older pair.
      if (gained > 0 && span >= 1000) etaMs = Math.round(((total - done) * span) / gained);
    }
  }
  return {
    source: "todos",
    done,
    total,
    percent: Math.round(ratio * 100),
    elapsedMs,
    etaMs,
    medianTurnMs: turnDurations.length >= 2 ? median(turnDurations) : null,
    turnCount: turnDurations.length,
    // 2026-10-25: full plan entries for the click-to-expand detail — the agent's
    // own words, not just counts (transparency request).
    todos: (lastTodos ?? []).map((t) => ({
      text: typeof t.content === "string" && t.content ? t.content : "(ohne Beschreibung)",
      status: typeof t.status === "string" ? t.status : "unknown",
    })),
  };
}

export function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * T21.3: the hub's estimate from measured turns of the same adapter/model, as one honest sentence.
 * Never a number without data (R9.7): too few finished turns say so, an overrun says "länger als üblich".
 */
export function estimateText(est: RunEstimate | null, elapsedMs: number): string | null {
  if (!est || est.state === "no-data") return null;
  if (est.state === "too-few" || est.medianMs === null || est.p80Ms === null) return `Schätzung ab 5 Läufen (bisher ${est.n})`;
  const basis = `${est.n} Läufe${est.basis === "session" ? ", diese Session" : est.basis === "adapter" ? ", dieser Harness" : ", dieses Modell"}`;
  if (elapsedMs > est.p80Ms) return `länger als 80 % der Läufe (${formatMinutes(est.p80Ms)}) · ${basis}`;
  const remaining = Math.max(0, est.medianMs - elapsedMs);
  return `≈ noch ${formatMinutes(remaining)} · typisch ${formatMinutes(est.medianMs)}, bis ${formatMinutes(est.p80Ms)} · ${basis}`;
}

const WINDOW_LABELS: Record<string, string> = { five_hour: "5h", seven_day: "7d" };

export interface QuotaSummary {
  text: string;
  level: "ok" | "warn" | "err" | "none";
}

/**
 * What is left of the provider's quota, tightest window first. Sources, in
 * order: the adapter's own usage report (ADR-0004), else the provider's
 * limit error in this session (ADR-0015). Nothing known is said as such.
 */
export function quotaSummary(usage: Pick<AdapterUsage, "supported" | "quota"> | null, events: readonly NormalizedEvent[]): QuotaSummary {
  const quota: UsageQuota | null = usage?.supported ? usage.quota : null;
  if (quota && quota.windows.length > 0) {
    const windows = [...quota.windows].sort((a, b) => b.utilization - a.utilization);
    const text = windows
      .map((w) => {
        const left = Math.max(0, Math.round((1 - w.utilization) * 100));
        const reset = fmtTime(w.resetsAt);
        return `${WINDOW_LABELS[w.id] ?? w.id}: ${left} % frei · reset ${reset}`;
      })
      .join(" · ");
    const worst = windows[0]!.utilization;
    return { text, level: worst >= 1 ? "err" : worst >= 0.9 ? "warn" : "ok" };
  }
  const limit = [...events].reverse().find((e) => {
    const p = e.payload as { kind?: unknown; category?: unknown };
    return p.kind === "provider.error" && p.category === "quota";
  });
  if (limit) {
    const p = limit.payload as { window?: unknown; resetAt?: unknown };
    const window = typeof p.window === "string" ? p.window : "Kontingent";
    const reset = typeof p.resetAt === "string" ? ` · frei ab ${p.resetAt}` : "";
    return { text: `${window}: erschöpft${reset}`, level: "err" };
  }
  return { text: "Kontingent: Provider meldet nichts", level: "none" };
}
