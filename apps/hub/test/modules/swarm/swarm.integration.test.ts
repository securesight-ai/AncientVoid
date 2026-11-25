import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService, WorktreeManager } from "@ancientvoid/core";
import { createAdapter as createDummyAdapter } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

const execAsync = promisify(execFile);

const FRAME = { adapters: ["dummy", "zweit"], coordinatorAdapter: null, models: [], maxTasks: 4, maxDispatchesPerTask: 2, maxParallel: 2 };
const PLAN = {
  tasks: [
    { id: "T1", title: "Erste Recherche", prompt: "Recherchiere A.", adapter: "dummy", model: null, dependsOn: [] },
    { id: "T2", title: "Zweite Ausarbeitung", prompt: "Arbeite B aus.", adapter: "zweit", model: null, dependsOn: ["T1"] },
  ],
};

describe("swarm routes (integration, EPIC-P40/P60/P83)", () => {
  let base: string;
  let app: FastifyInstance;
  let human: { authorization: string };
  let agent: { authorization: string };

  async function buildApp(dbPath: string): Promise<FastifyInstance> {
    const hubDir = join(base, "hub");
    const db = new HubDatabase(dbPath);
    const store = new EventStore(join(hubDir, "sessions"));
    const registry = new AdapterRegistry();
    // Zwei „verschiedene Harnesses“: echte Adapter-Instanzen (dummy-Familie mit
    // unterschiedlichen Konfigurationen) — sie beenden Züge korrekt via ctx.turn
    // (BUG-0092-Muster), was die Ergebnisübernahme des Koordinators braucht.
    registry.register("dummy", () => createDummyAdapter({ autoStopAfterEvents: 2, cycleTypes: false }));
    registry.register("zweit", () => createDummyAdapter({ autoStopAfterEvents: 2, cycleTypes: false }));
    const sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, new WorktreeManager(join(hubDir, "worktrees")));
    await sessions.recoverAll();
    const tokens = new TokenService(db);
    const built = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
      projectRoots: [base],
      dataDir: hubDir,
    });
    await built.listen({ port: 0, host: "127.0.0.1" });
    return built;
  }

  const startRun = () => ({
    title: "Demo-Run",
    goal: "Ziel des Runs.",
    project: join(base, "proj"),
    frame: FRAME,
    plan: PLAN,
  });

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "av-orch-int-"));
    const proj = join(base, "proj");
    await mkdir(join(base, "hub"), { recursive: true });
    await execAsync("git", ["init", "-q", "-b", "main", proj]);
    await execAsync("git", ["-C", proj, "config", "user.email", "t@t"]);
    await execAsync("git", ["-C", proj, "config", "user.name", "t"]);
    await writeFile(join(proj, "README.md"), "# P\n");
    await execAsync("git", ["-C", proj, "add", "."]);
    await execAsync("git", ["-C", proj, "commit", "-q", "-m", "init"]);
    app = await buildApp(join(base, "hub", "hub.db"));
    const db = new HubDatabase(join(base, "hub", "hub.db"));
    const tokens = new TokenService(db);
    human = { authorization: `Bearer ${tokens.issue("mensch").token}` };
    agent = { authorization: `Bearer ${tokens.issue("agent:e2e").token}` };
  });

  afterAll(async () => {
    await app.close();
    await rm(base, { recursive: true, force: true });
  });

  it("Run mit gegebenem Plan: zwei Adapter, DAG, Ergebnisse — bis done (AC-P40-1/2)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/swarms", headers: human, payload: startRun() });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    // Beide Tasks nacheinander über zwei verschiedene Adapter ausführen; Ergebnisse landen als Delivery.
    await expect
      .poll(async () => (await app.inject({ method: "GET", url: `/api/swarms/${id}`, headers: human })).json().status, { timeout: 30_000 })
      .toBe("done");
    const run = (await app.inject({ method: "GET", url: `/api/swarms/${id}`, headers: human })).json();
    expect(run.tasks.map((t: { id: string }) => t.id)).toEqual(["T1", "T2"]);
    expect(run.tasks[0].dispatches[0].adapter).toBe("dummy");
    expect(run.tasks[1].dispatches[0].adapter).toBe("zweit");
    expect(run.tasks[1].status).toBe("done");
    expect(run.deliveries.length).toBe(2);
    expect(run.deliveries.find((d: { taskId: string }) => d.taskId === "T1").text.length).toBeGreaterThan(0);
  });

  it("Agenten dürfen lesen, aber keine Runs starten/stoppen (AC-P40-3/4)", async () => {
    const list = await app.inject({ method: "GET", url: "/api/swarms", headers: agent });
    expect(list.statusCode).toBe(200);
    const start = await app.inject({ method: "POST", url: "/api/swarms", headers: agent, payload: startRun() });
    expect(start.statusCode).toBe(403);
    const runs = list.json() as { id: string }[];
    const cancel = await app.inject({ method: "POST", url: `/api/swarms/${runs[0]!.id}/cancel`, headers: agent, payload: { reason: "x" } });
    expect(cancel.statusCode).toBe(403);
  });

  it("Loop-Adapter als Worker abgewiesen; unbekannte Abhängigkeit 422", async () => {
    const loopFrame = { ...FRAME, adapters: ["loop:securesight-factory"] };
    const res = await app.inject({ method: "POST", url: "/api/swarms", headers: human, payload: { ...startRun(), frame: loopFrame, plan: { tasks: [{ ...PLAN.tasks[0]!, adapter: "loop:securesight-factory" }] } } });
    expect(res.statusCode).toBe(422);
    const badDeps = await app.inject({ method: "POST", url: "/api/swarms", headers: human, payload: { ...startRun(), plan: { tasks: [{ ...PLAN.tasks[0]!, dependsOn: ["gibtsnicht"] }] } } });
    expect(badDeps.statusCode).toBe(422);
    // T60.8 (ADR-0077): Task-Modell außerhalb der Frame-Allowlist → 422, nie ungeprüft durch.
    const badModel = await app.inject({
      method: "POST",
      url: "/api/swarms",
      headers: human,
      payload: { ...startRun(), frame: { ...FRAME, models: ["erlaubt-1"] }, plan: { tasks: [{ ...PLAN.tasks[0]!, model: "verboten-9" }] } },
    });
    expect(badModel.statusCode).toBe(422);
    expect(badModel.json().code).toBe("model_not_allowed");
    const cycle = await app.inject({
      method: "POST",
      url: "/api/swarms",
      headers: human,
      payload: { ...startRun(), plan: { tasks: [PLAN.tasks[0]!, { ...PLAN.tasks[1]!, dependsOn: ["T2"] }] } },
    });
    expect(cycle.statusCode).toBe(422);
  });

  it("Cancel stoppt nur eigene Dispatches und erhält den Run nachvollziehbar (AC-P40-6)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/swarms", headers: human, payload: startRun() });
    const id = res.json().id;
    const cancel = await app.inject({ method: "POST", url: `/api/swarms/${id}/cancel`, headers: human, payload: { reason: "Teststopp" } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("cancelled");
    for (const t of cancel.json().tasks) {
      for (const d of t.dispatches) expect(["cancelled", "done", "stale", "unknown"]).toContain(d.status);
    }
  });

  it("Hub-Neustart: aktive Dispatches werden unknown, kein blindes Retry (AC-P40-5)", async () => {
    // Neuer Hub auf gleichem dataDir: Recovery aus Journal+Snapshot. Poll auf das
    // Recovery-Signal (keine aktiven Dispatches mehr) — kein Uhrzeit-Sleep.
    const res = await app.inject({ method: "POST", url: "/api/swarms", headers: human, payload: startRun() });
    const id = res.json().id;
    await app.close();
    app = await buildApp(join(base, "hub", "hub.db"));
    await expect
      .poll(
        async () => {
          const r = (await app.inject({ method: "GET", url: `/api/swarms/${id}`, headers: human })).json();
          return r.status !== "planning" && r.tasks.flatMap((t: { dispatches: { status: string }[] }) => t.dispatches).every((d: { status: string }) => d.status !== "active");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    // Fortsetzung ist erlaubt (ready Tasks dürfen neu dispatchen), blindes Retry nicht:
    // kein Task erhält mehr Versuche als der Rahmen erlaubt, unknown bleibt unknown.
    const run = (await app.inject({ method: "GET", url: `/api/swarms/${id}`, headers: human })).json();
    for (const t of run.tasks) {
      expect(t.dispatches.length, `Task ${t.id} Versuche`).toBeLessThanOrEqual(2);
      for (const d of t.dispatches) if (d.status === "unknown") expect(t.status).toBe("unknown");
    }
    expect(["done", "failed", "cancelled", "running"]).toContain(run.status);
  });

  it("ADR-0123 §5: /api/teams existiert nicht mehr — 404, kein stiller Alias", async () => {
    const res = await app.inject({ method: "GET", url: "/api/teams", headers: human });
    expect(res.statusCode).toBe(404);
  });
});
