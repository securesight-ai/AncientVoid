import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService, WorktreeManager } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../../../src/app.ts";
import { createHubSwarm, type HubSwarm } from "../../../src/modules/swarm/index.ts";
import { createHubAutomationService } from "../../../src/modules/automations/automations-service.ts";
import type { AutomationDefinition, SwarmStart } from "@ancientvoid/contracts";

const prompt = "Ermittle das Ergebnis.";
const sha = createHash("sha256").update(prompt).digest("hex");

describe("P41 real execution owners", () => {
  let root: string;
  let project: string;
  let sessions: SessionManager;
  let db: HubDatabase;
  let app: Awaited<ReturnType<typeof createHubApp>>;
  let automations: ReturnType<typeof createHubAutomationService>;
  let runtime: HubSwarm;
  let token: string;
  const auth = () => ({ authorization: `Bearer ${token}` });
  const def = (target?: AutomationDefinition["target"]): AutomationDefinition => ({ id: randomUUID(), label: "Integration", generation: 1, enabled: false, hostId: "host",
    schedule: { kind: "cron", cron: "* * * * *", timezone: "UTC" }, target: target ?? { kind: "session", harness: "dummy", project, workdir: "worktree", promptBlobSha256: sha },
    grant: { maxParallel: 1, missedGraceMs: 0 }, precheckDeadlineMs: 1000, createdAtUtc: new Date().toISOString(),
  });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "av-p41-real-"));
    project = join(root, "project");
    await mkdir(project); await writeFile(join(project, "README.md"), "test\n");
    execFileSync("git", ["init", "-q", project]);
    execFileSync("git", ["-C", project, "add", "."]);
    execFileSync("git", ["-C", project, "-c", "user.name=P41 test", "-c", "user.email=test@example.invalid", "commit", "-qm", "test"]);
    db = new HubDatabase(":memory:");
    const store = new EventStore(root);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 100, autoStopAfterEvents: 2, cycleTypes: false });
    sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, new WorktreeManager(join(root, "worktrees")));
    const tokens = new TokenService(db); token = tokens.issue("test-device").token;
    runtime = createHubSwarm({ sessions, dataDir: root }); await runtime.ready;
    automations = createHubAutomationService({ dataDir: root, hostId: "host", sessions, swarm: runtime, projectRoots: [root] });
    app = await createHubApp({ sessions, tokens, registry, dataDir: root, store, hostId: "host", automations, swarm: runtime, auth: { tokens, enforceTailnetIdentity: false } });
    await app.ready();
  });
  afterAll(async () => {
    automations.stop(); await app.close();
    for (const s of sessions.list()) await sessions.stop(s.id).catch(() => undefined);
    await sessions.shutdown();
    db.close(); await rm(root, { recursive: true, force: true });
  });

  it("reads actual turn-end evidence and permits a second manual operation", async () => {
    const definition = def();
    expect((await app.inject({ method: "POST", url: "/api/automations", headers: auth(), payload: { definition, promptText: prompt } })).statusCode).toBe(201);
    const first = await app.inject({ method: "POST", url: `/api/automations/${definition.id}/run-now`, headers: auth(), payload: { generation: 1 } });
    expect(first.statusCode).toBe(202);
    await expect.poll(async () => { await automations.tick(); return automations.history(definition.id)[0]?.outcome; }).toBe("succeeded");
    const second = await app.inject({ method: "POST", url: `/api/automations/${definition.id}/run-now`, headers: auth(), payload: { generation: 1 } });
    expect(second.statusCode).toBe(202);
    expect(second.json().operationId).not.toBe(first.json().operationId);
    // Run-now antwortet sofort (K1); die Sitzungsreferenz steht erst nach dem Dispatch im Journal.
    await expect.poll(async () => { await automations.tick(); return automations.history(definition.id).filter(h => h.sessionId).length; }).toBe(2);
    const sessionIds = new Set(automations.history(definition.id).map(h => h.sessionId));
    expect(sessionIds.size).toBe(2);
  });

  it("freezes a P40 plan and starts runs through the shared orchestrator", async () => {
    const spec: SwarmStart = { title: "Vorlage", goal: "Kleine Aufgabe", project,
      frame: { adapters: ["dummy"], coordinatorAdapter: null, models: [], maxTasks: 1, maxParallel: 1, maxDispatchesPerTask: 1 },
      plan: { tasks: [{ id: "T1", title: "Prüfen", prompt, adapter: "dummy", model: null, dependsOn: [] }] },
    };
    const source = await runtime.coordinator.start(spec, "human");
    const definition = def({ kind: "swarm", templateId: source.id });
    const created = await app.inject({ method: "POST", url: "/api/automations", headers: auth(), payload: { definition } });
    expect(created.statusCode).toBe(201);
    expect(created.json().target.templateBlobSha256).toMatch(/^[a-f0-9]{64}$/);
    source.tasks[0]!.prompt = "Dieser spätere Text ist nicht freigegeben";
    const started = await app.inject({ method: "POST", url: `/api/automations/${definition.id}/run-now`, headers: auth(), payload: { generation: 1 } });
    expect(started.statusCode).toBe(202);
    let runId = "";
    await expect.poll(async () => { runId = automations.history(definition.id)[0]?.swarmId ?? ""; return runId; }).toBeTruthy();
    expect(runtime.store.get(runId)?.tasks[0]?.prompt).toBe(prompt);
    await expect.poll(async () => { await runtime.coordinator.tick(); await automations.tick(); return automations.history(definition.id)[0]?.outcome; }).toBe("succeeded");
    const apiRun = await app.inject({ method: "GET", url: `/api/swarms/${runId}`, headers: auth() });
    expect(apiRun.json().status).toBe("done");
  });
  it("starts exactly one dispatch per task when automations launch concurrently", async () => {
    const source = runtime.store.list().find(r => r.title === "Vorlage")!;
    const definitions = [def({ kind: "swarm", templateId: source.id }), def({ kind: "swarm", templateId: source.id })];
    for (const definition of definitions) {
      expect((await app.inject({ method: "POST", url: "/api/automations", headers: auth(), payload: { definition } })).statusCode).toBe(201);
    }
    const starts = await Promise.all(definitions.map(definition => app.inject({ method: "POST", url: `/api/automations/${definition.id}/run-now`, headers: auth(), payload: { generation: 1 } })));
    for (const started of starts) expect(started.statusCode).toBe(202);
    for (const definition of definitions) {
      let runId = "";
      await expect.poll(async () => { runId = automations.history(definition.id)[0]?.swarmId ?? ""; return runId; }).toBeTruthy();
      expect(runtime.store.get(runId)!.tasks[0]!.dispatches).toHaveLength(1);
    }
  });

});
