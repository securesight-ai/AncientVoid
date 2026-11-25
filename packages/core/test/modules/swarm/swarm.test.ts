import { describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SwarmFrame, type SwarmDispatch, type SwarmPlan, type Swarm, type SwarmTaskPlan } from "@ancientvoid/contracts";
import { applyOutcome, cancelRun, contextPacket, nextDispatches, openGate, answerGate, tasksFromPlan, validatePlan } from "../../../src/modules/swarm/engine.ts";
import { SwarmStore } from "../../../src/modules/swarm/store.ts";
import { SwarmCoordinator, parsePlan, type SwarmSessionPort } from "../../../src/modules/swarm/coordinator.ts";

const frame = (over: Partial<SwarmFrame> = {}): SwarmFrame => ({
  adapters: ["codex"],
  coordinatorAdapter: "hermes",
  models: [],
  maxTasks: 8,
  maxDispatchesPerTask: 2,
  maxParallel: 2,
  ...over,
});

const taskPlan = (id: string, over: Partial<SwarmTaskPlan> = {}): SwarmTaskPlan => ({
  id,
  title: `Task ${id}`,
  prompt: `Prompt für ${id}`,
  adapter: "codex",
  model: null,
  dependsOn: [],
  ...over,
});

const dispatch = (id: string, generation: number, status: SwarmDispatch["status"] = "active"): SwarmDispatch => ({
  id,
  generation,
  sessionId: `s-${id}`,
  adapter: "codex",
  model: null,
  startedAt: new Date().toISOString(),
  endedAt: null,
  status,
  note: null,
});

const mkRun = (plan: SwarmPlan, fr: SwarmFrame = frame()): Swarm => ({
  id: "run-1",
  title: "Test-Run",
  goal: "Ein Ziel",
  project: "p",
  frame: fr,
  planSource: "given",
  coordinatorSessionId: null,
  origin: null,
  status: "running",
  tasks: tasksFromPlan(plan),
  gates: [],
  deliveries: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  endedAt: null,
});

describe("EPIC-P40 Orchestrierung — Engine", () => {
  it("validatePlan: unbekannte Abhängigkeit", () => {
    const err = validatePlan({ tasks: [taskPlan("T1", { dependsOn: ["TX"] })] }, frame());
    expect(err?.code).toBe("unknown_dependency");
  });

  it("validatePlan: Zyklus T1→T2→T1", () => {
    const err = validatePlan({ tasks: [taskPlan("T1", { dependsOn: ["T2"] }), taskPlan("T2", { dependsOn: ["T1"] })] }, frame());
    expect(err?.code).toBe("cycle");
  });

  it("validatePlan: Adapter außerhalb des Rahmens", () => {
    const err = validatePlan({ tasks: [taskPlan("T1", { adapter: "loop:evil" })] }, frame());
    expect(err?.code).toBe("adapter_not_allowed");
  });

  it("T60.8: Task-Modell außerhalb der Allowlist wird abgewiesen; null und erlaubte bleiben frei (ADR-0077)", () => {
    const withModels = frame({ models: ["grok-4", "glm-5"] });
    expect(validatePlan({ tasks: [taskPlan("T1", { model: "grok-4" })] }, withModels)).toBeNull();
    expect(validatePlan({ tasks: [taskPlan("T1", { model: null })] }, withModels)).toBeNull();
    const err = validatePlan({ tasks: [taskPlan("T1", { model: "unbekannt-9" })] }, withModels);
    expect(err?.code).toBe("model_not_allowed");
    expect(err?.message).toContain("unbekannt-9");
    // Leere Allowlist = nur Adapter-Standardmodell (null).
    expect(validatePlan({ tasks: [taskPlan("T1", { model: "etwas" })] }, frame())?.code).toBe("model_not_allowed");
  });

  it("T60.8: SwarmFrame liest die Altedform mit model toleriert (ADR-0077 §6)", () => {
    const base = { adapters: ["codex"], coordinatorAdapter: "hermes", maxTasks: 8, maxDispatchesPerTask: 2, maxParallel: 2 };
    expect(SwarmFrame.parse({ ...base, model: "grok-4" })).toMatchObject({ models: ["grok-4"] });
    expect(SwarmFrame.parse({ ...base, model: null })).toMatchObject({ models: [] });
    expect(SwarmFrame.parse({ ...base })).toMatchObject({ models: [] });
    expect(SwarmFrame.parse({ ...base, models: ["a", "b"], model: "c" })).toMatchObject({ models: ["a", "b"] });
  });

  it("validatePlan: zu viele Tasks", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => taskPlan(`T${i + 1}`));
    const err = validatePlan({ tasks }, frame({ maxTasks: 4 }));
    expect(err?.code).toBe("too_many_tasks");
  });

  it("validatePlan: valider Plan mit dependsOn passt", () => {
    const err = validatePlan({ tasks: [taskPlan("T1"), taskPlan("T2", { dependsOn: ["T1"] })] }, frame());
    expect(err).toBeNull();
  });

  it("applyOutcome: aktiver Dispatch schließt Task done, Delivery ≤4KB, Downstream wird ready", () => {
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2", { dependsOn: ["T1"] })] });
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1));
    const res = applyOutcome(run, "T1", "D1", { ok: true, text: "x".repeat(5000) });
    expect(res.ok).toBe(true);
    expect(t1.status).toBe("done");
    expect(t1.result?.text.length).toBeLessThanOrEqual(4096);
    expect(run.deliveries).toHaveLength(1);
    expect(run.tasks[1]?.status).toBe("ready");
  });

  it("applyOutcome: Ergebnis alter Generation nach neuem Versuch → stale_delivery, Task unverändert", () => {
    const run = mkRun({ tasks: [taskPlan("T1")] });
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1), dispatch("D2", 2));
    const res = applyOutcome(run, "T1", "D1", { ok: true, text: "alt" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("stale_delivery");
    expect(t1.status).toBe("running");
    expect(t1.result).toBeNull();
    expect(t1.dispatches.find((d) => d.id === "D1")?.status).toBe("stale");
    expect(run.deliveries).toHaveLength(0);
  });

  it("applyOutcome: aktiver Dispatch nach Retry-Ende → Task failed", () => {
    const run = mkRun({ tasks: [taskPlan("T1")] });
    const t1 = run.tasks[0]!;
    t1.dispatches.push(dispatch("D1", 1, "failed"));
    t1.dispatches.push(dispatch("D2", 2));
    t1.status = "running";
    const res = applyOutcome(run, "T1", "D2", { ok: false, text: "", note: "kaputt" });
    expect(res.ok).toBe(true);
    expect(t1.status).toBe("failed");
    expect(run.status).toBe("failed");
  });

  it("applyOutcome: Dispatch nicht aktiv → stale_delivery", () => {
    const run = mkRun({ tasks: [taskPlan("T1")] });
    const t1 = run.tasks[0]!;
    t1.dispatches.push(dispatch("D1", 1, "done"));
    const res = applyOutcome(run, "T1", "D1", { ok: true, text: "spät" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("stale_delivery");
    expect(t1.dispatches[0]?.status).toBe("stale");
  });

  it("nextDispatches: maxParallel begrenzt, nach Abschluss rückt nächster nach", () => {
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2"), taskPlan("T3")] });
    expect(nextDispatches(run).map((t) => t.id)).toEqual(["T1", "T2"]);
    // Ein aktiver Dispatch belegt einen Platz → nur noch ein Kandidat.
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1));
    expect(nextDispatches(run).map((t) => t.id)).toEqual(["T2"]);
    // Beide Plätze belegt → nichts frei; nach Abschluss von T2 rückt T3 nach.
    const t2 = run.tasks[1]!;
    t2.status = "running";
    t2.dispatches.push(dispatch("D2", 1));
    expect(nextDispatches(run)).toHaveLength(0);
    applyOutcome(run, "T2", "D2", { ok: true, text: "ok" });
    expect(nextDispatches(run).map((t) => t.id)).toEqual(["T3"]);
  });

  it("openGate/answerGate: Doppelte Antwort → gate_closed; cancel stoppt Run+Dispatches; continue resumed running", () => {
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2")] });
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1));
    const gate = openGate(run, {
      id: "G1",
      reason: "worker_question",
      question: "Weiter?",
      options: [
        { label: "Abbrechen", action: "cancel" },
        { label: "Fortsetzen", action: "continue" },
      ],
      taskId: "T1",
    });
    expect(run.status).toBe("awaiting_gate");

    const cancel = answerGate(run, gate.id, "Abbrechen");
    expect(cancel.ok).toBe(true);
    expect(run.status).toBe("cancelled");
    expect(t1.dispatches[0]?.status).toBe("cancelled");
    expect(run.tasks[1]?.status).toBe("unknown");

    // Zweite Antwort wird abgewiesen — Zustand bleibt cancelled.
    const second = answerGate(run, gate.id, "Fortsetzen");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("gate_closed");
    expect(run.status).toBe("cancelled");

    // continue auf frischem Gate: awaiting_gate → running.
    const run2 = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2")] });
    const g2 = openGate(run2, {
      id: "G2",
      reason: "plan_unreadable",
      question: "Nochmal?",
      options: [{ label: "Erneut versuchen", action: "retry_plan" }],
      taskId: null,
    });
    const cont = answerGate(run2, g2.id, "Erneut versuchen");
    expect(cont.ok).toBe(true);
    expect(run2.status).toBe("running");
  });

  it("cancelRun: nur aktive Dispatches, nicht-terminal Tasks → unknown", () => {
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2")] });
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1), dispatch("D0", 1, "done"));
    run.tasks[1]!.status = "pending";
    cancelRun(run, "Test-Stopp");
    expect(t1.dispatches.find((d) => d.id === "D1")?.status).toBe("cancelled");
    expect(t1.dispatches.find((d) => d.id === "D0")?.status).toBe("done");
    expect(t1.status).toBe("unknown");
    expect(run.tasks[1]?.status).toBe("unknown");
    expect(run.status).toBe("cancelled");
    expect(run.endedAt).not.toBeNull();
  });

  it("contextPacket: Titel, Teilaufgabe, Dep-Ergebnis-Vorschau — nicht das Ziel einer fremden Teilaufgabe", () => {
    const plan = {
      tasks: [
        taskPlan("T1", { prompt: "GEHEIM-ZIEL-VON-T1" }),
        taskPlan("T2", { dependsOn: ["T1"], prompt: "Arbeite weiter." }),
      ],
    };
    const run = mkRun(plan);
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1));
    applyOutcome(run, "T1", "D1", { ok: true, text: "Ergebnis von T1" });
    const packet = contextPacket(run, plan.tasks[1]!);
    expect(packet).toContain(run.title);
    expect(packet).toContain("Arbeite weiter.");
    expect(packet).toContain("Ergebnis von T1");
    expect(packet).not.toContain("GEHEIM-ZIEL-VON-T1");
  });
});

describe("EPIC-P40/P60/P83 Swarms — Store (K7)", () => {
  it("put+update persistiert; neuer Store auf gleichem dataDir stellt Swarm her; kaputte Journalzeile wird gezählt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-p83-"));
    const store = new SwarmStore(dir);
    await store.init();
    const run = mkRun({ tasks: [taskPlan("T1")] });
    await store.put(run);
    await store.update(run.id, (r) => {
      r.tasks[0]!.status = "running";
    });
    appendFileSync(join(dir, "swarm", "swarms.jsonl"), "{kaputt\n");
    const store2 = new SwarmStore(dir);
    const report = await store2.init();
    expect(report.skippedLines).toBe(1);
    expect(report.swarms).toBe(1);
    const restored = store2.get(run.id);
    expect(restored?.id).toBe(run.id);
    expect(restored?.tasks[0]?.status).toBe("running");
  });
});

describe("EPIC-P60 (ADR-0077) — Journal-Migration orchestration/ → swarm/", () => {
  /** Altdaten-Fixture: dataDir mit historischem Layout `orchestration/runs.jsonl` (+ snapshot). */
  function legacyDir(withSnapshot: boolean): { dir: string; run: Swarm } {
    const dir = mkdtempSync(join(tmpdir(), "av-p60-mig-"));
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2")] });
    run.id = "legacy-run-1";
    mkdirSync(join(dir, "orchestration"), { recursive: true });
    writeFileSync(join(dir, "orchestration", "runs.jsonl"), JSON.stringify({ seq: 1, at: run.createdAt, op: "put", run }) + "\n");
    if (withSnapshot) {
      writeFileSync(join(dir, "orchestration", "snapshot.json"), JSON.stringify({ appliedSeq: 0, runs: [] }));
    }
    return { dir, run };
  }

  it("migriert Altbestand einmalig nach swarm/swarms.jsonl; Altdaten bleiben liegen (K7)", async () => {
    const { dir, run } = legacyDir(true);
    const store = new SwarmStore(dir);
    const report = await store.init();
    expect(report.migratedSwarms).toBe(1);
    expect(report.swarms).toBe(1);
    expect(store.get(run.id)?.tasks.length).toBe(2);
    // Neues Journal + Snapshot existieren; alte Dateien unangetastet.
    expect(existsSync(join(dir, "swarm", "swarms.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "swarm", "snapshot.json"))).toBe(true);
    expect(existsSync(join(dir, "orchestration", "runs.jsonl"))).toBe(true);
    // Restore nach Migration: neuer Store auf gleichem dataDir findet alles im neuen Layout.
    const store2 = new SwarmStore(dir);
    const report2 = await store2.init();
    expect(report2.swarms).toBe(1);
    expect(report2.migratedSwarms).toBeUndefined();
  });

  it("migriert nicht erneut, wenn das neue Journal schon existiert (kein Doppelimport)", async () => {
    const { dir, run } = legacyDir(false);
    const first = new SwarmStore(dir);
    await first.init();
    // Zweiter Start nach zwischenzeitlichem Schreiben: Altbestand darf nicht doppelt zählen.
    const second = new SwarmStore(dir);
    const report = await second.init();
    expect(report.migratedSwarms).toBeUndefined();
    expect(report.swarms).toBe(1);
    expect(second.get(run.id)).toBeDefined();
  });

  it("zählt kaputte Altzeilen, versteckt sie aber nicht", async () => {
    const { dir, run } = legacyDir(false);
    appendFileSync(join(dir, "orchestration", "runs.jsonl"), "{kaputt\n");
    const store = new SwarmStore(dir);
    const report = await store.init();
    expect(report.migratedSwarms).toBe(1);
    expect(report.migratedSkippedLines).toBe(1);
    expect(store.get(run.id)).toBeDefined();
  });
});

describe("EPIC-P83 (ADR-0123) — Journal-Migration team/ → swarm/", () => {
  /** Altdaten-Fixture: dataDir mit P60/P83-Layout `team/teams.jsonl` (Journalschlüssel `run`) + Snapshot mit `runs`. */
  function legacyTeamDir(): { dir: string; run: Swarm } {
    const dir = mkdtempSync(join(tmpdir(), "av-p83-mig-"));
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2")] });
    run.id = "legacy-team-1";
    mkdirSync(join(dir, "team"), { recursive: true });
    writeFileSync(join(dir, "team", "teams.jsonl"), JSON.stringify({ seq: 1, at: run.createdAt, op: "put", run }) + "\n");
    writeFileSync(join(dir, "team", "snapshot.json"), JSON.stringify({ appliedSeq: 1, runs: [run] }));
    return { dir, run };
  }

  it("migriert Agenten-Team-Altbestand einmalig nach swarm/swarms.jsonl; Altdaten bleiben liegen (AC-P83-20)", async () => {
    const { dir, run } = legacyTeamDir();
    const store = new SwarmStore(dir);
    const report = await store.init();
    expect(report.migratedSwarms).toBe(1);
    expect(report.swarms).toBe(1);
    expect(store.get(run.id)?.tasks.length).toBe(2);
    // Neues Journal existiert; die Altdateien bleiben unangetastet (K7, kein Löschen).
    expect(existsSync(join(dir, "swarm", "swarms.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "swarm", "snapshot.json"))).toBe(true);
    expect(existsSync(join(dir, "team", "teams.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "team", "snapshot.json"))).toBe(true);
    // Zweiter Start: kein Doppelimport — der Altbestand zählt nur einmal.
    const store2 = new SwarmStore(dir);
    const report2 = await store2.init();
    expect(report2.migratedSwarms).toBeUndefined();
    expect(report2.swarms).toBe(1);
  });

  it("Journalzeilen mit altem Schlüssel `run` werden auch im Swarm-Verzeichnis tolerierend gelesen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-p83-tol-"));
    mkdirSync(join(dir, "swarm"), { recursive: true });
    const run = mkRun({ tasks: [taskPlan("T1")] });
    writeFileSync(join(dir, "swarm", "swarms.jsonl"), JSON.stringify({ seq: 1, at: run.createdAt, op: "put", run }) + "\n");
    const store = new SwarmStore(dir);
    const report = await store.init();
    expect(report.swarms).toBe(1);
    expect(store.get(run.id)).toBeDefined();
  });

  it("T60.8: Bestands-Swarms mit altem frame.model werden beim Laden auf models normalisiert (ADR-0077 §6)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-p60-frm-"));
    mkdirSync(join(dir, "swarm"), { recursive: true });
    const legacyFrame = { adapters: ["codex"], coordinatorAdapter: "hermes", model: "grok-4", maxTasks: 8, maxDispatchesPerTask: 2, maxParallel: 2 };
    const swarm = { ...mkRun({ tasks: [taskPlan("T1")] }), frame: legacyFrame };
    writeFileSync(join(dir, "swarm", "swarms.jsonl"), JSON.stringify({ seq: 1, at: swarm.createdAt, op: "put", swarm }) + "\n");
    const store = new SwarmStore(dir);
    await store.init();
    const loaded = store.get("run-1");
    expect(loaded?.frame).toMatchObject({ models: ["grok-4"] });
    expect((loaded?.frame as unknown as { model?: string }).model).toBeUndefined();
  });
});

/** Fake-Port: zählt Sessions, Status pro Session steuerbar, lastAssistant liefert Text. */
function fakePort() {
  let n = 0;
  const statuses = new Map<string, string>();
  const texts = new Map<string, string>();
  const created: string[] = [];
  const port: SwarmSessionPort = {
    async create() {
      const id = `sess-${++n}`;
      created.push(id);
      statuses.set(id, "working");
      return { id };
    },
    async steer() {
      return null;
    },
    async stop() {
      return null;
    },
    async status(sessionId: string) {
      return statuses.get(sessionId) ?? null;
    },
    async lastAssistant(sessionId: string) {
      const text = texts.get(sessionId);
      return text === undefined ? null : { text, bytes: text.length, blobRef: null };
    },
    async writeBlob() {
      return "blob:1";
    },
  };
  return { port, statuses, texts, created };
}

const startInput = (plan: SwarmPlan | null) => ({
  title: "Run",
  goal: "Ziel",
  project: "p",
  frame: frame(),
  plan,
});

async function setup(plan: SwarmPlan | null, pollMs = 3_600_000) {
  const dir = mkdtempSync(join(tmpdir(), "av-p40-"));
  const store = new SwarmStore(dir);
  await store.init();
  const fake = fakePort();
  const orch = new SwarmCoordinator(store, fake.port, { pollMs });
  const run = await orch.start(startInput(plan), "tester");
  return { dir, store, fake, orch, run };
}


describe("EPIC-P60 (ADR-0077, T60.7) — Parallelitäts-Deckel 8 im Contract", () => {
  it("maxParallel 8 ist erlaubt, 9 wird abgewiesen (Zod-Deckel)", () => {
    const base = { adapters: ["codex"], coordinatorAdapter: "hermes", models: [], maxTasks: 8, maxDispatchesPerTask: 2 };
    expect(SwarmFrame.parse({ ...base, maxParallel: 8 }).maxParallel).toBe(8);
    expect(SwarmFrame.safeParse({ ...base, maxParallel: 9 }).success).toBe(false);
  });
});

describe("EPIC-P40 Orchestrierung — SwarmCoordinator", () => {
  it("T60.7: N unabhängige Tasks mit maxParallel ≥ N laufen gleichzeitig; der Rahmen bleibt serverseitig erzwingt (K8)", async () => {
    // Drei unabhängige Tasks, Rahmen maxParallel 3 — der Fake-Port hält alle
    // Sessions in „working", sodass die Überlappung sichtbar bleibt.
    const dir = mkdtempSync(join(tmpdir(), "av-p60-par-"));
    const store = new SwarmStore(dir);
    await store.init();
    const fake = fakePort();
    const orch = new SwarmCoordinator(store, fake.port, { pollMs: 3_600_000 });
    const plan: SwarmPlan = {
      tasks: [taskPlan("T1"), taskPlan("T2"), taskPlan("T3"), taskPlan("T4")],
    };
    const run = await orch.start({ ...startInput(plan), frame: frame({ maxParallel: 3 }) }, "tester");
    await orch.tick();
    const stored = store.get(run.id)!;
    // Drei Sessions wurden GLEICHZEITIG erzeugt (nicht nacheinander abgeschlossen):
    expect(fake.created).toHaveLength(3);
    expect(stored.tasks.filter((t) => t.status === "running")).toHaveLength(3);
    expect(stored.tasks.filter((t) => t.dispatches.some((d) => d.status === "active"))).toHaveLength(3);
    // T4 wartet — der Rahmen wird bei jedem Dispatch geprüft.
    expect(stored.tasks.find((t) => t.id === "T4")?.status).toBe("ready");
    // Ein Worker-Ende rückt T4 nach.
    fake.statuses.set(fake.created[0]!, "idle");
    fake.texts.set(fake.created[0]!, "Ergebnis T1");
    await orch.tick();
    await orch.tick();
    const after = store.get(run.id)!;
    expect(after.tasks.find((t) => t.id === "T4")?.status).toBe("running");
    expect(fake.created).toHaveLength(4);
  });

  it("T60.8: Koordinator-Plan mit unzulässigem Modell ⇒ genau eine Rückfrage mit Erneut-Planen (ADR-0077)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-p60-mod-"));
    const store = new SwarmStore(dir);
    await store.init();
    const fake = fakePort();
    const orch = new SwarmCoordinator(store, fake.port, { pollMs: 3_600_000 });
    const run = await orch.start({ ...startInput(null), frame: frame({ models: ["erlaubt-1"] }) }, "tester");
    expect(run.coordinatorSessionId).toBe(fake.created[0]);
    fake.statuses.set(run.coordinatorSessionId!, "idle");
    fake.texts.set(run.coordinatorSessionId!, "```team\n" + JSON.stringify({ tasks: [taskPlan("T1", { model: "verboten-9" })] }) + "\n```");
    await orch.tick();
    const stored = store.get(run.id)!;
    expect(stored.status).toBe("awaiting_gate");
    expect(stored.tasks).toHaveLength(0); // nie Tasks mit ungeprüftem Modell
    const gate = stored.gates[0]!;
    expect(gate.question).toContain("verboten-9");
    expect(gate.options.map((o) => o.action)).toEqual(["retry_plan", "cancel"]);
    expect(gate.options).toHaveLength(2); // eine Rückfrage, nicht pro Task eines
  });

  it("Start mit given plan: dispatcht Ready-Tasks, working→idle ⇒ Delivery, Run done", async () => {
    const { store, fake, orch, run } = await setup({ tasks: [taskPlan("T1")] });
    expect(run.tasks[0]?.status).toBe("running");
    expect(fake.created).toHaveLength(1);
    const sessionId = fake.created[0]!;
    fake.statuses.set(sessionId, "working");
    await orch.tick(); // Dispatch als working gesehen.
    fake.statuses.set(sessionId, "idle");
    fake.texts.set(sessionId, "Fertiges Ergebnis");
    await orch.tick(); // Erstes idle ⇒ Ergebnisübernahme.
    const stored = store.get(run.id)!;
    expect(stored.tasks[0]?.status).toBe("done");
    expect(stored.tasks[0]?.result?.text).toBe("Fertiges Ergebnis");
    expect(stored.deliveries).toHaveLength(1);
    expect(stored.status).toBe("done");
  });

  it("Koordinator-Pfad: Plan-Session liefert ```swarm {…}``` ⇒ Tasks entstehen (ADR-0123)", async () => {
    const { store, fake, orch, run } = await setup(null);
    expect(run.status).toBe("planning");
    expect(run.coordinatorSessionId).toBe(fake.created[0]);
    fake.statuses.set(run.coordinatorSessionId!, "idle");
    fake.texts.set(run.coordinatorSessionId!, "```swarm\n" + JSON.stringify({ tasks: [taskPlan("T1")] }) + "\n```");
    await orch.tick();
    const stored = store.get(run.id)!;
    expect(stored.status).toBe("running");
    expect(stored.tasks.map((t) => t.id)).toEqual(["T1"]);
    expect(stored.planSource).toBe("coordinator");
    // Alt-Fence ```team bleibt lesbar (ADR-0123 §3).
    const run2 = await orch.start(startInput(null), "tester");
    fake.statuses.set(run2.coordinatorSessionId!, "idle");
    fake.texts.set(run2.coordinatorSessionId!, "```team\n" + JSON.stringify({ tasks: [taskPlan("T2")] }) + "\n```");
    await orch.tick();
    expect(store.get(run2.id)?.tasks.map((t) => t.id)).toEqual(["T2"]);
  });

  it("unlesbarer Plan → Gate plan_unreadable", async () => {
    const { store, fake, orch, run } = await setup(null);
    fake.statuses.set(run.coordinatorSessionId!, "idle");
    fake.texts.set(run.coordinatorSessionId!, "Ich habe leider keinen Plan.");
    await orch.tick();
    const stored = store.get(run.id)!;
    expect(stored.status).toBe("awaiting_gate");
    expect(stored.gates).toHaveLength(1);
    expect(stored.gates[0]?.reason).toBe("plan_unreadable");
    expect(stored.tasks).toHaveLength(0);
  });

  it("recover(): aktive Dispatches → unknown, Task/Run failed, kein neuer Dispatch beim tick", async () => {
    const { dir, run, fake } = await setup({ tasks: [taskPlan("T1")] });
    expect(run.tasks[0]?.dispatches).toHaveLength(1);
    // „Crash“: neuer Store+SwarmCoordinator ohne seen-Set auf gleichem dataDir.
    const store2 = new SwarmStore(dir);
    await store2.init();
    const orch2 = new SwarmCoordinator(store2, fake.port, { pollMs: 3_600_000 });
    await orch2.recover();
    const rec = store2.get(run.id)!;
    expect(rec.tasks[0]?.dispatches[0]?.status).toBe("unknown");
    expect(rec.tasks[0]?.status).toBe("unknown");
    expect(rec.status).toBe("failed");
    const before = fake.created.length;
    await orch2.tick();
    expect(fake.created.length).toBe(before); // kein blindes Retry
    expect(store2.get(run.id)?.tasks[0]?.dispatches).toHaveLength(1);
  });
});

describe("EPIC-P40 Orchestrierung — parsePlan", () => {
  const plan = { tasks: [taskPlan("T1")] };

  it("Fence-Block — neu ```swarm, Alt ```team und ```orchestration bleiben lesbar (ADR-0123 §3)", () => {
    expect(parsePlan("Vorher\n```swarm\n" + JSON.stringify(plan) + "\n```\nNachher")).toEqual(plan);
    expect(parsePlan("Vorher\n```team\n" + JSON.stringify(plan) + "\n```\nNachher")).toEqual(plan);
    expect(parsePlan("Vorher\n```orchestration\n" + JSON.stringify(plan) + "\n```\nNachher")).toEqual(plan);
  });

  it("nacktes JSON", () => {
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
  });

  it("Unsinn → null", () => {
    expect(parsePlan("kein Plan")).toBeNull();
    expect(parsePlan("```team\n{nicht json}\n```")).toBeNull();
  });
});
