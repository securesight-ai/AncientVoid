import type { NormalizedEvent } from "../../shared/ws.ts";
import { isEmptyThinking, showInChat, toolIdOf } from "./event-filter.ts";

/**
 * EPIC-P43 T43.4 (Epic §3.5): der Chat in Zügen. Eine reine Funktion über den Ereignisstrom:
 * Nutzernachricht → Arbeit (Werkzeugaufrufe als Schritte mit Verb, Ziel, Ergebnis-Kurzform) → Antwort.
 *
 * - Text des Agenten **vor** dem ersten Schritt und **nach** dem letzten steht offen im Chat; Text
 *   zwischen Schritten gehört zur Arbeit und faltet mit ihr.
 * - Systemereignisse erscheinen nicht (wie bisher: `showInChat`); sie bleiben vollständig im Verlauf.
 * - Unbekannte Ereignistypen werden gezählt und als eine Zeile gezeigt (fail loud), nie verschluckt.
 * - Nichts hier ist Zustand: auf/zu entscheidet die Ansicht (Gerätezustand, K7).
 */
type StepState = "running" | "ok" | "error" | "open";

export interface Step {
  key: number;
  use: NormalizedEvent | null;
  result: NormalizedEvent | null;
  /** „Liest“, „Bearbeitet“, „Führt aus“ … oder der Werkzeugname, wenn er unbekannt ist. */
  verb: string;
  kind: StepKind;
  target: string;
  state: StepState;
  /** Erste Zeile des Ergebnisses bzw. des Fehlers, gekürzt. */
  short: string;
}

type StepKind = "read" | "edit" | "run" | "search" | "fetch" | "plan" | "delegate" | "other";

type WorkEntry = { kind: "step"; step: Step } | { kind: "note"; event: NormalizedEvent };

export interface Work {
  kind: "work";
  key: string;
  entries: WorkEntry[];
  /** Läuft noch: der Zug ist nicht beendet und die Session arbeitet. */
  running: boolean;
  startTs: string;
  endTs: string;
}

export type ChatItem = { kind: "event"; event: NormalizedEvent } | Work | { kind: "unknown"; key: string; count: number; firstSeq: number };

/** Zeitstempel eines Chat-Eintrags — für den Tages-Trenner (Sammelzeile ohne Zeit: undefined). */
export function itemTs(item: ChatItem): string | undefined {
  if (item.kind === "event") return item.event.ts;
  if (item.kind === "work") return item.startTs;
  return undefined;
}


const KNOWN_TYPES: ReadonlySet<string> = new Set(["user", "assistant", "thinking", "tool_use", "tool_result", "gate", "error", "system"]);

/**
 * Systemzeilen, die der Chat zeigt: nur, was der Mensch wissen muss (Anbieterfehler, abgeschnittene
 * Antwort, nicht zugestellte Nachricht, Warteschlange, Skill-Kette). „OpenCode denkt…“ und die
 * Modellmeldung entfallen — das sagen der laufende Schritt und die Statuszeile.
 */
const QUIET_SYSTEM: ReadonlySet<unknown> = new Set(["opencode.step_start", "opencode.model", "acp.model"]);

function inChat(e: NormalizedEvent): boolean {
  return showInChat(e) && !(e.type === "system" && QUIET_SYSTEM.has(e.payload.kind));
}

function isTurnStart(e: NormalizedEvent): boolean {
  const kind = e.payload.kind;
  return e.type === "user" || kind === "session.prompt" || kind === "session.resumed";
}

function isTurnEnd(e: NormalizedEvent): boolean {
  return e.payload.kind === "session.turn_end";
}

/** Text des Agenten, der zur Arbeit gehören kann (Zwischentext, Denken). */
function isAgentText(e: NormalizedEvent): boolean {
  return (e.type === "assistant" || e.type === "thinking") && !isEmptyThinking(e);
}

export function turnsOf(events: readonly NormalizedEvent[], live: boolean): ChatItem[] {
  const items: ChatItem[] = [];
  let work: Work | null = null;
  // Agententext nach dem letzten Schritt: Zwischentext, falls noch ein Schritt kommt, sonst Antwort.
  let pending: NormalizedEvent[] = [];
  const byTool = new Map<string, Step>();

  const flushAsAnswer = () => {
    for (const e of pending) items.push({ kind: "event", event: e });
    pending = [];
  };
  const closeTurn = (ended: NormalizedEvent | null) => {
    if (work) {
      work.running = false;
      if (ended) work.endTs = ended.ts;
      for (const entry of work.entries) if (entry.kind === "step" && entry.step.state === "running") entry.step.state = "open";
    }
    flushAsAnswer();
    work = null;
    byTool.clear();
  };

  for (const e of events) {
    if (!KNOWN_TYPES.has(e.type)) {
      const last = items.at(-1);
      if (last?.kind === "unknown") last.count += 1;
      else items.push({ kind: "unknown", key: `unknown-${e.seq}`, count: 1, firstSeq: e.seq });
      continue;
    }
    if (isTurnStart(e)) {
      closeTurn(null);
      if (inChat(e)) items.push({ kind: "event", event: e });
      continue;
    }
    if (isTurnEnd(e)) {
      closeTurn(e);
      continue;
    }
    if (e.type === "tool_use" || e.type === "tool_result") {
      if (!work) {
        work = { kind: "work", key: `work-${e.seq}`, entries: [], running: true, startTs: e.ts, endTs: e.ts };
        // Text vor dem ersten Schritt steht offen davor.
        flushAsAnswer();
        items.push(work);
      } else {
        for (const note of pending) work.entries.push({ kind: "note", event: note });
        pending = [];
      }
      work.endTs = e.ts;
      const id = toolIdOf(e);
      if (e.type === "tool_use") {
        const step = describe(e, null);
        if (id) byTool.set(id, step);
        work.entries.push({ kind: "step", step });
      } else {
        const step = id ? byTool.get(id) : undefined;
        if (step) settle(step, e);
        else work.entries.push({ kind: "step", step: describe(null, e) });
      }
      continue;
    }
    if (isAgentText(e)) {
      if (work) {
        pending.push(e);
        work.endTs = e.ts;
      } else items.push({ kind: "event", event: e });
      continue;
    }
    // Fehler und die wenigen Systemzeilen, die der Chat schon heute zeigt, stehen offen.
    if (e.type === "error" || inChat(e)) {
      if (work) {
        for (const note of pending) work.entries.push({ kind: "note", event: note });
        pending = [];
      }
      items.push({ kind: "event", event: e });
    }
  }
  // Stromende: läuft die Session noch, bleibt die Arbeit offen und der Text darin.
  if (work !== null) {
    const current = work as Work;
    if (live) {
      for (const note of pending) current.entries.push({ kind: "note", event: note });
      pending = [];
    } else closeTurn(null);
  }
  flushAsAnswer();
  return items;
}

/** Die Schritte einer Arbeit. */
export function stepsOf(work: Work): Step[] {
  return work.entries.flatMap((entry) => (entry.kind === "step" ? [entry.step] : []));
}

const KIND_RULES: readonly [RegExp, StepKind, string][] = [
  [/^(bash|shell|exec|exec_command|run|run_command|command|terminal|local_shell)$/i, "run", "Führt aus"],
  [/^(read|view|cat|open|read_file|readfile|notebookread|view_image)$/i, "read", "Liest"],
  [/^(write|create|create_file|write_file)$/i, "edit", "Schreibt"],
  [/^(edit|multiedit|str_replace|str_replace_editor|apply_patch|patch|replace|notebookedit|update_file)$/i, "edit", "Bearbeitet"],
  [/^(grep|glob|search|find|list|ls|list_dir|codebase_search|file_search|rg)$/i, "search", "Sucht"],
  [/^(webfetch|fetch|web_fetch|websearch|web_search|http)$/i, "fetch", "Ruft ab"],
  [/^(todo[_-]?write|todo[_-]?update|update[_-]?todos?|update_plan|plan)$/i, "plan", "Plant"],
  [/^(task|agent|subagent|delegate|spawn_?agent|send_?input|send_?message|followup_?task|resume_?agent|close_?agent|interrupt_?agent|list_?agents)$/i, "delegate", "Beauftragt"],
];

function toolName(use: NormalizedEvent): string {
  const p = use.payload as { name?: unknown; tool?: unknown; command?: unknown };
  if (typeof p.name === "string" && p.name) return p.name;
  if (typeof p.tool === "string" && p.tool) return p.tool;
  if (typeof p.command === "string") return "exec";
  return "Werkzeug";
}

function inputOf(use: NormalizedEvent): Record<string, unknown> {
  const raw = (use.payload as { input?: unknown }).input;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { value: raw };
    }
  }
  return {};
}

const TARGET_KEYS = ["command", "cmd", "file_path", "filePath", "path", "files", "pattern", "query", "url", "description", "prompt"] as const;

function targetOf(use: NormalizedEvent, kind: StepKind): string {
  const input = inputOf(use);
  const direct = (use.payload as { command?: unknown }).command;
  if (kind === "run" && typeof direct === "string") return oneLine(direct);
  if (kind === "plan") {
    const todos = input.todos;
    if (Array.isArray(todos)) return `${todos.length} Punkte`;
  }
  for (const key of TARGET_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return oneLine(value);
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) return oneLine(value.join(" "));
  }
  const first = Object.values(input).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? oneLine(first) : "";
}

function oneLine(text: string, max = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function resultShort(result: NormalizedEvent): string {
  const p = result.payload as { error?: unknown; output?: unknown; content?: unknown; exitCode?: unknown };
  const text = [p.error, p.output, p.content].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const first = (text ?? result.summary ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return first ? oneLine(first, 90) : "";
}

function isError(result: NormalizedEvent): boolean {
  const p = result.payload as { isError?: unknown; exitCode?: unknown };
  return p.isError === true || (typeof p.exitCode === "number" && p.exitCode !== 0);
}

function describe(use: NormalizedEvent | null, result: NormalizedEvent | null): Step {
  const event = (use ?? result)!;
  const name = toolName(event);
  const localName = name.split(/\.|__|\//).at(-1) ?? name;
  // ACP liefert Kategorien auch dann, wenn der Titel eine freie Beschreibung ist.
  const category = typeof event.payload.kind === "string" ? event.payload.kind : "";
  const aliases: Record<string, string> = { execute: "exec", delete: "edit", move: "edit", think: "plan" };
  const rule = KIND_RULES.find(([re]) => re.test(localName)) ?? KIND_RULES.find(([re]) => re.test(aliases[category] ?? category));
  const kind = rule?.[1] ?? "other";
  const step: Step = {
    key: (use ?? result)!.seq,
    use,
    result: null,
    verb: rule?.[2] ?? name,
    kind,
    target: use ? targetOf(use, kind) : "",
    state: "running",
    short: "",
  };
  if (result) settle(step, result);
  return step;
}

function settle(step: Step, result: NormalizedEvent): void {
  step.result = result;
  step.state = isError(result) ? "error" : "ok";
  step.short = resultShort(result);
}

const COUNT_WORDS: Partial<Record<StepKind, [string, string]>> = {
  read: ["gelesen", "gelesen"],
  edit: ["bearbeitet", "bearbeitet"],
  run: ["ausgeführt", "ausgeführt"],
  search: ["Suche", "Suchen"],
  fetch: ["Abruf", "Abrufe"],
};

/** Die gefaltete Zeile: „4 Schritte · 2 gelesen · 1 bearbeitet · 1 Fehler · 38 s“. */
export function workSummary(work: Work): string {
  const steps = stepsOf(work);
  const parts = [`${steps.length} ${steps.length === 1 ? "Schritt" : "Schritte"}`];
  const counts = new Map<StepKind, number>();
  for (const s of steps) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  for (const [kind, words] of Object.entries(COUNT_WORDS) as [StepKind, [string, string]][]) {
    const n = counts.get(kind) ?? 0;
    if (n > 0) parts.push(`${n} ${n === 1 ? words[0] : words[1]}`);
  }
  const errors = steps.filter((s) => s.state === "error").length;
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? "Fehler" : "Fehler"}`);
  const ms = Date.parse(work.endTs) - Date.parse(work.startTs);
  if (Number.isFinite(ms) && ms >= 1000) parts.push(durationText(ms));
  return parts.join(" · ");
}

function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Der laufende Schritt (Schimmer): der letzte ohne Ergebnis, solange die Arbeit läuft. */
export function currentStep(work: Work): Step | null {
  if (!work.running) return null;
  const steps = stepsOf(work);
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]!.state === "running") return steps[i]!;
  return null;
}
