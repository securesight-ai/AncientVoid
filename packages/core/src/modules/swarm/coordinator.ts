import { randomUUID } from "node:crypto";
import { SwarmPlan, type SwarmDispatch, type Swarm, type SwarmStart, type SwarmOrigin } from "@ancientvoid/contracts";
import { answerGate as engineAnswer, applyOutcome, cancelRun, contextPacket, nextDispatches, openGate, tasksFromPlan, validatePlan } from "./engine.ts";
import type { SwarmStore } from "./store.ts";

/**
 * EPIC-P40 (ADR-0064): Session-Seite als Ports — der Hub injiziert den echten
 * SessionManager; das Core-Modul kennt keine Adapter und keinen Server.
 */
export interface SwarmSessionPort {
  create(spec: { adapter: string; project: string; prompt: string; model?: string | null; workspaceMode?: "worktree" | "direct"; title?: string }, actor: string): Promise<{ id: string }>;
  steer(sessionId: string, prompt: string, actor: string): Promise<unknown>;
  stop(sessionId: string, actor: string): Promise<unknown>;
  status(sessionId: string): Promise<string | null>;
  /** Letzte Assistent-Nachricht (max. 64 KiB Text) — Grundlage der Ergebnisübernahme. */
  lastAssistant(sessionId: string): Promise<{ text: string; bytes: number; blobRef: string | null } | null>;
  /** Blob für Ergebnisse > 4 KB Metadaten (K5): Textvorschau + Referenz in der Worker-Session. */
  writeBlob(sessionId: string, text: string): Promise<string>;
}

export interface SwarmOptions {
  /** Poll-Intervall des tick-Loops (Tests: klein). */
  pollMs?: number;
}

/** Koordinator: Swarm-Lifecycle über Ports — Planerkennung, Dispatch, Ende-Erkennung, Gates, Cancel (ADR-0064 §3/§5). */
export class SwarmCoordinator {
  private readonly store: SwarmStore;
  private readonly port: SwarmSessionPort;
  private readonly opts: Required<SwarmOptions>;
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeTick: Promise<void> | null = null;
  private tickRequested = false;
  /** Laufzeitbeobachtung: welche Dispatches schon working/starting gesehen wurden (Erste-idle-Erkennung). */
  private readonly seen = new Set<string>();

  constructor(store: SwarmStore, port: SwarmSessionPort, opts: SwarmOptions = {}) {
    this.store = store;
    this.port = port;
    this.opts = { pollMs: opts.pollMs ?? 2000 };
  }

  async start(input: SwarmStart, actor: string): Promise<Swarm> {
    const id = randomUUID();
    const now = new Date().toISOString();
    let run: Swarm = {
      id,
      title: input.title,
      goal: input.goal,
      project: input.project,
      frame: input.frame,
      planSource: input.plan ? "given" : "coordinator",
      coordinatorSessionId: null,
      /** ADR-0119 §9: Auftraggeber — der Dispatch trägt ihn statt des festen Literals "team". */
      origin: { teamTaskRef: null, actor } satisfies SwarmOrigin,
      status: "planning",
      tasks: [],
      gates: [],
      deliveries: [],
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    if (input.plan) {
      const err = validatePlan(input.plan, input.frame);
      if (err) throw new SwarmError(err.message, err.code);
      run.tasks = tasksFromPlan(input.plan);
      run.status = "running";
      run = await this.store.put(run);
    } else {
      run = await this.store.put(run);
      const prompt = [
        `# Swarm-Auftrag: ${input.title}`,
        "",
        input.goal,
        "",
        `Erlaubte Worker-Adapter: ${input.frame.adapters.join(", ")}.`,
        `Bis zu ${input.frame.maxParallel} Aufgaben dürfen gleichzeitig laufen (Parallelität des Rahmens: ${input.frame.maxParallel}).`,
        input.frame.models.length > 0
          ? `Erlaubte Modelle für Aufgaben (model-Feld): ${input.frame.models.join(", ")} — null oder ein anderes Modell ist nicht freigegeben.`
          : "Für Aufgaben ist nur das Standardmodell des jeweiligen Adapters freigegeben (model: null).",
        "Gliedere den Auftrag so breit wie möglich, so tief wie nötig: Unabhängige Teilaufgaben gehören NEBENEINANDER (ohne dependsOn), damit sie parallel arbeiten; dependsOn nur bei echtem Informationsbedarf.",
        `Erzeuge einen Aufgabenplan mit höchstens ${input.frame.maxTasks} Aufgaben als JSON — z. B. zwei parallele Tasks:`,
        "```swarm",
        JSON.stringify({ tasks: [
          { id: "T1", title: "…", prompt: "…", adapter: input.frame.adapters[0], model: null, dependsOn: [] },
          { id: "T2", title: "…", prompt: "…", adapter: input.frame.adapters[1] ?? input.frame.adapters[0], model: null, dependsOn: [] },
        ] }),
        "```",
        "Antworte ausschließlich mit diesem JSON-Block (kein weiterer Text).",
      ].join("\n");
      const session = await this.port.create({ adapter: input.frame.coordinatorAdapter ?? "hermes", project: input.project, prompt, model: input.frame.models[0] ?? null, workspaceMode: "worktree", title: `Plan: ${input.title}` }, actor);
      run.coordinatorSessionId = session.id;
      await this.store.update(run.id, () => undefined);
    }
    await this.tick();
    return run;
  }

  /** Ein Zyklus: Planerkennung, Worker-Enden, neue Dispatches im Rahmen. Idempotent; vom Hub-Timer und nach Aktionen gerufen. */
  tick(): Promise<void> {
    if (this.activeTick) { this.tickRequested = true; return this.activeTick; }
    const work = (async () => {
      do { this.tickRequested = false; await this.processTick(); } while (this.tickRequested);
    })();
    this.activeTick = work;
    void work.finally(() => { if (this.activeTick === work) this.activeTick = null; }).catch(() => undefined);
    return work;
  }

  private async processTick(): Promise<void> {
    for (const run of this.store.list()) {
      if (run.status === "planning" && run.coordinatorSessionId) await this.readPlan(run.id);
      if (run.status === "running") {
        await this.collectOutcomes(run.id);
        await this.dispatchReady(run.id);
      }
    }
  }

  private async readPlan(runId: string): Promise<void> {
    const run = this.store.get(runId);
    if (!run?.coordinatorSessionId) return;
    const status = await this.port.status(run.coordinatorSessionId);
    if (status !== "idle") return;
    const last = await this.port.lastAssistant(run.coordinatorSessionId);
    const text = last?.text ?? "";
    const parsed = parsePlan(text);
    if (!parsed) {
      const gate = openGate(run, {
        id: randomUUID(),
        reason: "plan_unreadable",
        question: `Der Koordinator lieferte keinen lesbaren Aufgabenplan. Letzte Antwort: ${text.slice(0, 300) || "(leer)"}`,
        options: [
          { label: "Erneut versuchen", action: "retry_plan" },
          { label: "Swarm abbrechen", action: "cancel" },
        ],
        taskId: null,
      });
      await this.store.update(runId, () => undefined);
      void gate;
      return;
    }
    const err = validatePlan(parsed, run.frame);
    if (err) {
      // ADR-0077 (T60.8): Modell-Verstoß ⇒ genau eine Rückfrage mit Erneut-Planen
      // (retry_plan), kein Gate pro Task; Adapter-Verstoß bleibt die harte Absage.
      const modelIssue = err.code === "model_not_allowed";
      openGate(run, {
        id: randomUUID(),
        reason: err.code === "adapter_not_allowed" ? "adapter_not_allowed" : "plan_unreadable",
        question: `Aufgabenplan verletzt den Rahmen: ${err.message}`,
        options: modelIssue
          ? [
              { label: "Erneut planen", action: "retry_plan" },
              { label: "Swarm abbrechen", action: "cancel" },
            ]
          : [
              { label: "Swarm abbrechen", action: "cancel" },
              { label: "Trotzdem weiter (nach Korrektur)", action: "continue" },
            ],
        taskId: null,
      });
      await this.store.update(runId, () => undefined);
      return;
    }
    run.tasks = tasksFromPlan(parsed);
    run.status = "running";
    run.updatedAt = new Date().toISOString();
    await this.store.update(runId, () => undefined);
  }

  private async collectOutcomes(runId: string): Promise<void> {
    const run = this.store.get(runId);
    if (!run) return;
    for (const task of run.tasks) {
      if (task.status !== "running") continue;
      const dispatch = task.dispatches.find((d) => d.status === "active");
      if (!dispatch) continue;
      const status = await this.port.status(dispatch.sessionId);
      if (status === null) continue;
      // idle UND waiting bedeuten „Zug beendet“ — waiting wartet nur auf Folgeeingaben (AC-P40-2).
      if ((status === "idle" || status === "waiting") && (await this.port.lastAssistant(dispatch.sessionId)) !== null) {
        // Erstes idle nach gesehenem running = Zug beendet.
        const last = await this.port.lastAssistant(dispatch.sessionId);
        const text = last?.text ?? "(keine Assistent-Antwort)";
        let blobRef: string | null = null;
        if ((last?.bytes ?? text.length) > 4096) blobRef = await this.port.writeBlob(dispatch.sessionId, text);
        const res = applyOutcome(run, task.id, dispatch.id, { ok: true, text, bytes: last?.bytes ?? text.length, blobRef });
        if (!res.ok) dispatch.status = "stale";
      } else if (status === "error" || status === "interrupted") {
        const res = applyOutcome(run, task.id, dispatch.id, { ok: false, text: "", note: `Worker endete mit Status ${status}.` });
        if (!res.ok) dispatch.status = "stale";
      } else if (status === "working" || status === "starting") {
        this.seen.add(dispatch.id);
      }
    }
    await this.store.update(runId, () => undefined);
  }

  private async dispatchReady(runId: string): Promise<void> {
    const run = this.store.get(runId);
    if (!run || run.status !== "running") return;
    for (const task of nextDispatches(run)) {
      const generation = task.dispatches.length + 1;
      const plan = { id: task.id, title: task.title, prompt: task.prompt, adapter: task.adapter, model: task.model, dependsOn: task.dependsOn };
      const prompt = contextPacket(run, plan);
      let session: { id: string };
      try {
        session = await this.port.create({ adapter: task.adapter, project: run.project, prompt, model: task.model, workspaceMode: "worktree", title: `${run.title} · ${task.id}` }, run.origin?.actor ?? "human");
      } catch (err) {
        openGate(run, {
          id: randomUUID(),
          reason: "unknown_outcome",
          question: `Worker für ${task.id} konnte nicht gestartet werden: ${err instanceof Error ? err.message : String(err)}`,
          options: [{ label: "Swarm abbrechen", action: "cancel" }],
          taskId: task.id,
        });
        continue;
      }
      const dispatch: SwarmDispatch = {
        id: randomUUID(),
        generation,
        sessionId: session.id,
        adapter: task.adapter,
        model: task.model,
        startedAt: new Date().toISOString(),
        endedAt: null,
        status: "active",
        note: null,
      };
      task.dispatches.push(dispatch);
      task.status = "running";
    }
    await this.store.update(runId, () => undefined);
  }

  async answer(runId: string, gateId: string, label: string, actor: string): Promise<Swarm | null> {
    const run = this.store.get(runId);
    if (!run) return null;
    const gate = run.gates.find((g) => g.id === gateId);
    const res = engineAnswer(run, gateId, label);
    if (!res.ok) throw new SwarmError(res.error.message, res.error.code);
    if (gate?.options.find((o) => o.label === label)?.action === "retry_plan" && run.coordinatorSessionId) {
      await this.port.steer(run.coordinatorSessionId, "Dein letzter Plan war nicht lesbar. Antworte ausschließlich mit dem ```swarm JSON-Block.", actor);
    }
    await this.store.update(runId, () => undefined);
    await this.tick();
    return run;
  }

  async cancel(runId: string, reason: string, actor: string): Promise<Swarm | null> {
    const run = this.store.get(runId);
    if (!run) return null;
    cancelRun(run, reason);
    // Nur Swarm-eigene Sessions stoppen (Koordinator + aktive Dispatches); Worktrees bleiben (AC-P40-6).
    for (const t of run.tasks) {
      for (const d of t.dispatches) {
        if (d.status === "cancelled") await this.port.stop(d.sessionId, actor).catch(() => undefined);
      }
    }
    if (run.coordinatorSessionId) await this.port.stop(run.coordinatorSessionId, actor).catch(() => undefined);
    await this.store.update(runId, () => undefined);
    return run;
  }

  /** Recovery nach Hub-Neustart (K7): aktive Dispatches mit unklarem Ausgang → unknown, kein blindes Retry (AC-P40-5). */
  async recover(): Promise<void> {
    for (const run of this.store.list()) {
      let changed = false;
      for (const t of run.tasks) {
        for (const d of t.dispatches) {
          if (d.status === "active") {
            d.status = "unknown";
            d.note = "Hub-Neustart — Ausgang unklar, kein automatisches Retry.";
            changed = true;
          }
        }
        if (t.dispatches.some((d) => d.status === "unknown") && (t.status === "running" || t.status === "ready")) t.status = "unknown";
      }
      if (run.status === "running" || run.status === "planning" || run.status === "awaiting_gate") {
        run.status = run.tasks.some((t) => t.status === "unknown") ? "failed" : run.tasks.every((t) => t.status === "done") && run.tasks.length > 0 ? "done" : "running";
        changed = true;
      }
      if (changed) await this.store.update(run.id, () => undefined);
    }
  }

  startLoop(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => undefined), this.opts.pollMs);
    this.timer.unref?.();
  }

  stopLoop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

export class SwarmError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** JSON-Plan aus einer Koordinator-Antwort lesen: ```swarm …``` Block (Alt-Fences `team`/`orchestration` bleiben lesbar, ADR-0123), sonst erstes {tasks:…}-Objekt. */
export function parsePlan(text: string): SwarmPlan | null {
  const fence = /```(?:swarm|team|orchestration)\s*([\s\S]*?)```/.exec(text);
  const candidates: string[] = [];
  if (fence?.[1]) candidates.push(fence[1]);
  const brace = /\{[\s\S]*"tasks"[\s\S]*\}/.exec(text);
  if (brace?.[0]) candidates.push(brace[0]);
  for (const c of candidates) {
    try {
      const parsed = SwarmPlan.safeParse(JSON.parse(c));
      if (parsed.success) return parsed.data;
    } catch {
      // nächster Kandidat
    }
  }
  return null;
}
