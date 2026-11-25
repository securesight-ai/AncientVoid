import type { SwarmPlan} from "@ancientvoid/contracts";
import { type SwarmDelivery, type SwarmFrame, type SwarmGate, type Swarm, type SwarmTaskPlan } from "@ancientvoid/contracts";

/**
 * EPIC-P40 (ADR-0064 §2): deterministische Übergänge und Invarianten der Swarms (Run→Team→Swarm, ADR-0077/0123).
 * Pure Funktionen — Persistenz und Session-Seite leben in Store/Coordinator; jede Regel
 * hier ist mit Unit-Tests belegt (T40.2, Orca-Testvorlage auf AV umgesetzt).
 */

/** Fehler mit Code aus ORCHESTRATION_ERRORS (Hub mappt auf HTTP-Status). */
export type EngineError = { code: string; message: string };
export type EngineResult<T> = { ok: true; value: T } | { ok: false; error: EngineError };
/** DAG prüfen: unbekannte Abhängigkeiten, Zyklen (Kahn), Rahmen-Verstoß. */
export function validatePlan(plan: SwarmPlan, frame: SwarmFrame): EngineError | null {
  const tasks = plan.tasks;
  if (tasks.length === 0) return { code: "plan_invalid", message: "Plan ohne Aufgaben." };
  if (tasks.length > frame.maxTasks) return { code: "too_many_tasks", message: `Plan hat ${tasks.length} Aufgaben, Rahmen erlaubt ${frame.maxTasks}.` };
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) return { code: "plan_invalid", message: "Task-IDs sind im Swarm nicht eindeutig." };
  for (const t of plan.tasks) {
    if (!frame.adapters.includes(t.adapter)) {
      return { code: "adapter_not_allowed", message: `Adapter „${t.adapter}“ von Task ${t.id} ist im Rahmen nicht freigegeben.` };
    }
    // ADR-0077 (T60.8): Task-Modelle müssen in der Frame-Allowlist stehen (null = Adapter-Standard).
    if (t.model !== null && !frame.models.includes(t.model)) {
      return { code: "model_not_allowed", message: `Modell „${t.model}“ von Task ${t.id} ist im Rahmen nicht freigegeben${frame.models.length === 0 ? " (Allowlist leer — nur Adapter-Standardmodell)" : ` (erlaubt: ${frame.models.join(", ")})`}.` };
    }
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) return { code: "unknown_dependency", message: `Task ${t.id} hängt von unbekanntem „${dep}“ ab.` };
    }
  }
  // Kahn: Zyklen erkennen.
  const indeg = new Map<string, number>();
  const edges = new Map<string, string[]>();
  for (const t of tasks) {
    indeg.set(t.id, t.dependsOn.length);
    for (const dep of t.dependsOn) edges.set(dep, [...(edges.get(dep) ?? []), t.id]);
  }
  const queue = tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.id);
  let seen = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    seen++;
    for (const next of edges.get(id) ?? []) {
      const d = indeg.get(next)! - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (seen !== tasks.length) return { code: "cycle", message: "Aufgabenabhängigkeiten enthalten einen Zyklus." };
  return null;
}

/** Plan in Swarm-Tasks überführen (Status aus Abhängigkeiten abgeleitet). */
export function tasksFromPlan(plan: SwarmPlan): Swarm["tasks"] {
  return plan.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    prompt: t.prompt,
    adapter: t.adapter,
    model: t.model,
    dependsOn: [...t.dependsOn],
    status: t.dependsOn.length === 0 ? "ready" : "pending",
    dispatches: [],
    result: null,
  }));
}

const terminal = (s: string): boolean => s === "done" || s === "failed" || s === "unknown";

/** Frisch laufende Dispatches und offene Ready-Tasks im Rahmen-Limit zählen. */
function runningCount(run: Swarm): number {
  return run.tasks.reduce((n, t) => n + t.dispatches.filter((d) => d.status === "active").length, 0);
}

/**
 * Abschluss eines Versuchs: nur der AKTIVE Dispatch der HÖCHSTEN Generation darf seinen Task
 * abschließen — verspätete Ergebnisse alter Generationen werden `stale` verworfen (AC-P40-2).
 */
export function applyOutcome(run: Swarm, taskId: string, dispatchId: string, outcome: { ok: boolean; text: string; bytes?: number; blobRef?: string | null; note?: string }): EngineResult<Swarm> {
  const task = run.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, error: { code: "not_found", message: `Task ${taskId} unbekannt.` } };
  const dispatch = task.dispatches.find((d) => d.id === dispatchId);
  if (!dispatch) return { ok: false, error: { code: "not_found", message: `Dispatch ${dispatchId} unbekannt.` } };
  if (dispatch.status !== "active") {
    dispatch.status = "stale";
    return { ok: false, error: { code: "stale_delivery", message: `Dispatch ${dispatchId} ist nicht mehr aktiv (${dispatch.status}).` } };
  }
  const latestGen = Math.max(...task.dispatches.map((d) => d.generation));
  if (dispatch.generation < latestGen) {
    dispatch.status = "stale";
    return { ok: false, error: { code: "stale_delivery", message: `Ergebnis der Generation ${dispatch.generation} kam nach erneutem Versuch (aktuell ${latestGen}).` } };
  }
  const now = new Date().toISOString();
  dispatch.endedAt = now;
  if (outcome.ok) {
    dispatch.status = "done";
    const delivery: SwarmDelivery = {
      taskId,
      dispatchId,
      generation: dispatch.generation,
      text: outcome.text.slice(0, 4096),
      bytes: outcome.bytes ?? outcome.text.length,
      blobRef: outcome.blobRef ?? null,
      deliveredAt: now,
    };
    task.result = delivery;
    run.deliveries.push(delivery);
    task.status = "done";
  } else {
    dispatch.status = "failed";
    dispatch.note = outcome.note?.slice(0, 500) ?? null;
    // Retry im Rahmen, sonst Task failed.
    if (task.dispatches.filter((d) => d.status !== "cancelled" && d.status !== "stale").length < run.frame.maxDispatchesPerTask) {
      task.status = "ready";
    } else {
      task.status = "failed";
    }
  }
  run.updatedAt = now;
  updateDownstream(run);
  updateRunStatus(run);
  return { ok: true, value: run };
}

/** Abhängigkeiten nachziehen: erledigte Deps machen pending → ready; gescheiterte Deps sperren nicht still. */
function updateDownstream(run: Swarm): void {
  for (const t of run.tasks) {
    if (t.status !== "pending") continue;
    const deps = t.dependsOn.map((d) => run.tasks.find((x) => x.id === d)!);
    if (deps.every((d) => d.status === "done")) t.status = "ready";
    else if (deps.some((d) => d.status === "failed" || d.status === "unknown")) t.status = "unknown";
  }
}

/** Swarm-Ende: alle Tasks terminal → done/failed; sonst running. */
function updateRunStatus(run: Swarm): void {
  if (run.status === "awaiting_gate" || run.status === "cancelled") return;
  if (run.tasks.every((t) => terminal(t.status))) {
    run.status = run.tasks.some((t) => t.status === "failed" || t.status === "unknown") ? "failed" : "done";
    run.endedAt = new Date().toISOString();
  } else {
    run.status = "running";
  }
}

/** Nächste Dispatch-Kandidaten: ready Tasks, solange Parallelität im Rahmen bleibt. */
export function nextDispatches(run: Swarm): Swarm["tasks"] {
  if (run.status !== "running") return [];
  const free = run.frame.maxParallel - runningCount(run);
  if (free <= 0) return [];
  return run.tasks.filter((t) => t.status === "ready").slice(0, free);
}

/** Gate öffnen: Swarm pausiert (keine neuen Dispatches), Frage sichtbar. */
export function openGate(run: Swarm, gate: Omit<SwarmGate, "openedAt" | "answeredAt" | "answer">): SwarmGate {
  const g: SwarmGate = { ...gate, openedAt: new Date().toISOString(), answeredAt: null, answer: null };
  run.gates.push(g);
  run.status = "awaiting_gate";
  run.updatedAt = g.openedAt;
  return g;
}

/** Gate beantworten: nur einmal, Antwort wirkt je Aktion (ADR-0064 §6). */
export function answerGate(run: Swarm, gateId: string, label: string): EngineResult<Swarm> {
  const gate = run.gates.find((g) => g.id === gateId);
  if (!gate) return { ok: false, error: { code: "not_found", message: `Frage ${gateId} unbekannt.` } };
  if (gate.answeredAt !== null) return { ok: false, error: { code: "gate_closed", message: "Frage ist bereits beantwortet." } };
  const option = gate.options.find((o) => o.label === label);
  if (!option) return { ok: false, error: { code: "gate_closed", message: `„${label}“ ist keine Option der Frage.` } };
  gate.answeredAt = new Date().toISOString();
  gate.answer = label;
  run.updatedAt = gate.answeredAt;
  switch (option.action) {
    case "cancel":
      cancelRun(run, `Frage „${gate.question}“ → ${label}`);
      break;
    case "retry_plan":
    case "continue":
    case "retry_task":
      // Der Koordinator setzt den Zustand fort; Swarm zurück auf running, sofern nicht terminal.
      if (run.status === "awaiting_gate") {
        run.status = run.tasks.every((t) => terminal(t.status)) ? (run.tasks.some((t) => t.status !== "done") ? "failed" : "done") : "running";
      }
      break;
  }
  return { ok: true, value: run };
}

/** Stopp: keine neuen Dispatches; nur Swarm-eigene Dispatches werden markiert; Worktrees bleiben (AC-P40-6). */
export function cancelRun(run: Swarm, reason: string): Swarm {
  const now = new Date().toISOString();
  for (const t of run.tasks) {
    for (const d of t.dispatches) {
      if (d.status === "active") {
        d.status = "cancelled";
        d.endedAt = now;
        d.note = reason.slice(0, 500);
      }
    }
    if (t.status === "running" || t.status === "ready" || t.status === "pending") t.status = "unknown";
  }
  run.status = "cancelled";
  run.endedAt = now;
  run.updatedAt = now;
  return run;
}

/** Kontextpaket für einen Worker-Dispatch: Ziel + Teilaufgabe + Dep-Ergebnis-Vorschauen, nie Vollchat (ADR-0064 §3.5). */
export function contextPacket(run: Swarm, task: SwarmTaskPlan): string {
  const parts = [`# Swarm-Auftrag: ${run.title}`, "", `## Ziel`, run.goal, "", `## Deine Teilaufgabe (${task.id})`, task.prompt];
  const deps = task.dependsOn.map((d) => run.tasks.find((t) => t.id === d)?.result).filter((r): r is SwarmDelivery => r !== null && r !== undefined);
  if (deps.length > 0) {
    parts.push("", "## Ergebnisse vorheriger Aufgaben");
    for (const d of deps) parts.push(`### ${d.taskId} (Versuch ${d.generation})`, d.text.slice(0, 2048));
  }
  parts.push("", "Beende deine Arbeit mit einer kompakten Ergebnis-Zusammenfassung (dein letzter Assistent-Text wird als Ergebnis übernommen).");
  return parts.join("\n");
}
