import { basicFeatures, type Adapter, type AdapterContext, type SessionSpec } from "@ancientvoid/contracts";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { WorktreeManager } from "../../../src/modules/workspace/worktree.ts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";

const execFileAsync = promisify(execFile);

function makeManager(dir: string, dummyConfig?: Record<string, unknown>, dbFile?: string) {
  const db = new HubDatabase(dbFile ? join(dir, dbFile) : ":memory:");
  const store = new EventStore(dir);
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, dummyConfig);
  const manager = new SessionManager(db, store, registry, new ProcessRunner());
  return { manager, store, db };
}

/**
 * Poll instead of a fixed sleep: the dummy adapter's setInterval firing is
 * wall-clock-real, and under load its actual cadence can fall well behind
 * the nominal `1000 / eventsPerSecond` rate. A fixed sleep races that
 * drift; polling with a generous ceiling doesn't.
 */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 12_000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  if (!(await check())) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe("SessionManager", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("2026-10-26: ohne Modellauswahl trägt die Session das Default-Modell der Registration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-defaultmodel-"));
    // dummy verbietet Modellauswahl (modelChoice "none") — dieser Inline-
    // Adapter erlaubt sie, wie es pi/opencode/claude tun.
    const choosy: Adapter = {
      id: "choosy",
      version: "0.0.1",
      capabilities: () => ({
        reasoning: false,
        tools: false,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ modelChoice: "start" }),
      }),
      async start() {
        return { sessionId: "s" };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    try {
      const withDefault = new AdapterRegistry();
      withDefault.register("choosy", () => choosy, { model: "gpubox/halogen-qwen3.8-flash-next-uncensored-iq4xs" });
      const manager = new SessionManager(new HubDatabase(":memory:"), new EventStore(dir), withDefault, new ProcessRunner());
      const record = await manager.create({ adapter: "choosy", project: dir, prompt: "x" });
      expect(record.model).toBe("gpubox/halogen-qwen3.8-flash-next-uncensored-iq4xs");
      const explicit = await manager.create({ adapter: "choosy", project: dir, prompt: "y", model: "other/mini" });
      expect(explicit.model).toBe("other/mini");
      const bare = new AdapterRegistry();
      bare.register("choosy", () => choosy); // keine Config → null, nie geraten
      const without = await new SessionManager(new HubDatabase(":memory:"), new EventStore(dir), bare, new ProcessRunner()).create({
        adapter: "choosy",
        project: dir,
        prompt: "z",
      });
      expect(without.model).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates a session, persists it and emits lifecycle events", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 5 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      expect(record.id).toBeTruthy();
      expect(record.status).toBe("working");
      await waitFor(async () => {
        const events = await manager.tail(record.id, 0);
        return events.filter((e) => e.type !== "system").length >= 5;
      });
      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).toContain("session.created");
      expect(kinds).toContain("session.started");
      expect(events.filter((e) => e.type !== "system").length).toBeGreaterThanOrEqual(5);
    } finally {
      // BUG-0002: a thrown assertion above must never skip this. The dummy
      // adapter's generator is a real setInterval — an un-stopped one keeps
      // firing (and, once its temp dir is gone, keeps failing) for the rest
      // of the process, since vitest runs this whole suite in one fork.
      await manager.shutdown();
    }
  });

  it("ADR-0098: promptloser Start eines promptlessStartIdle-Adapters öffnet idle — ohne hängendes working", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 20, autoStopAfterEvents: 3 });
    const idleAdapter: Adapter = {
      id: "idle-adapter",
      version: "0.0.1",
      capabilities: () => ({ promptDelivery: "next-turn", promptlessStartIdle: true, reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures() }),
      start: async (_spec: SessionSpec, ctx: AdapterContext) => ({ sessionId: ctx.sessionId }),
      steer: async () => ({ ok: true }),
      status: async () => ({ state: "healthy", lastSeen: new Date().toISOString() }),
      stop: async () => undefined,
    };
    registry.register("idle-adapter", () => idleAdapter);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "idle-adapter", project: dir });
      expect(record.status).toBe("idle");
      // Mit Prompt bleibt das bisherige Verhalten: der erste Zug läuft.
      const prompted = await manager.create({ adapter: "idle-adapter", project: dir, prompt: "los" });
      expect(prompted.status).toBe("working");
      // Und ein Adapter OHNE die Zusicherung bleibt wie bisher working (dummy generiert ja los).
      const plain = await manager.create({ adapter: "dummy", project: dir });
      expect(plain.status).toBe("working");
    } finally {
      await manager.shutdown();
    }
  });


  it("BUG-0235: drains queued input after the main turn while a background task remains active", async () => {
    const registry = new AdapterRegistry();
    let context: AdapterContext | undefined;
    const received: string[] = [];
    registry.register("streaming", () => ({
      id: "streaming",
      version: "0.0.1",
      capabilities: () => ({ ...createDummy().capabilities(), promptDelivery: "next-turn", midTurnInput: true }),
      start: async (_spec, ctx) => {
        context = ctx;
        return { sessionId: ctx.sessionId };
      },
      steer: async (_handle, input, ctx) => {
        if (input.kind === "prompt") {
          received.push(input.text);
          ctx.turn?.("working");
        }
        return { ok: true };
      },
      status: async () => ({ state: "healthy", lastSeen: new Date().toISOString() }),
      stop: async () => undefined,
    }));
    const manager = new SessionManager(new HubDatabase(":memory:"), new EventStore(dir), registry, new ProcessRunner());
    try {
      const { id } = await manager.create({ adapter: "streaming", project: dir, prompt: "start" });
      context!.activity?.({ id: "task:long", kind: "agent", state: "running" });
      expect(await manager.steer(id, { kind: "prompt", text: "second" })).toMatchObject({ detail: "queued" });
      expect(await manager.steer(id, { kind: "prompt", text: "third" })).toMatchObject({ detail: "queued" });
      expect(received).toEqual([]);
      context!.turn?.("idle");
      await waitFor(async () => manager.queued(id).length === 1);
      expect(received).toEqual(["second"]);
      expect(manager.get(id)?.status).toBe("working");
      context!.turn?.("idle");
      await waitFor(async () => manager.queued(id).length === 0);
      expect(received).toEqual(["second", "third"]);
    } finally {
      await manager.shutdown();
    }
  });

  it("rejects unknown adapters loudly", async () => {
    const { manager } = makeManager(dir);
    await expect(manager.create({ adapter: "nope", project: dir })).rejects.toThrow(/unknown adapter/);
  });

  it("stops a session cleanly (status stopped, events persisted)", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await new Promise((r) => setTimeout(r, 200));
      const ack = await manager.stop(record.id);
      expect(ack.ok).toBe(true);
      expect(manager.get(record.id)!.status).toBe("stopped");
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.8: threads the calling device's identity ('actor') onto session.created/session.steer/session.stopped", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir }, "pixel-9");
      await manager.steer(record.id, { kind: "resume" }, "pixel-9"); // dummy handles "resume" itself; still audited
      const ack = await manager.stop(record.id, "pixel-9");
      expect(ack.ok).toBe(true);
      const events = await manager.tail(record.id, 0);
      const created = events.find((e) => (e.payload as { kind?: string }).kind === "session.created");
      const steered = events.find((e) => (e.payload as { kind?: string }).kind === "session.steer");
      const stopped = events.find((e) => (e.payload as { kind?: string }).kind === "session.stopped");
      expect((created!.payload as { actor?: string }).actor).toBe("pixel-9");
      expect((steered!.payload as { actor?: string }).actor).toBe("pixel-9");
      expect((stopped!.payload as { actor?: string }).actor).toBe("pixel-9");
    } finally {
      await manager.shutdown();
    }
  });

  it("an error session stays continuable — the way back in is a new prompt (openStopped)", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 10, autoStopAfterEvents: 1 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await manager.stop(record.id);
      // a dead run: crashed worker, hub restart — status error
      manager.get(record.id)!.status = "error";
      const ack = await manager.steer(record.id, { kind: "prompt", text: "Und weiter" });
      expect(ack.ok).toBe(true);
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.continued")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("delete removes a stopped session for good — events, row — and refuses a running one", async () => {
    const { manager, store } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await manager.stop(record.id);
      expect((await manager.tail(record.id, 0)).length).toBeGreaterThan(0);
      const ack = await manager.delete(record.id);
      expect(ack.ok).toBe(true);
      expect(manager.get(record.id)).toBeUndefined();
      expect(await store.replay(record.id)).toEqual([]);
      expect((await manager.delete(record.id)).ok).toBe(true);
      const running = await manager.create({ adapter: "dummy", project: dir, prompt: "läuft" });
      const refused = await manager.delete(running.id);
      expect(refused.ok).toBe(false);
      expect(refused.detail).toContain("stoppen");
      await manager.stop(running.id);
    } finally {
      await manager.shutdown();
    }
  });

  it("BUG-0246: delete räumt Notifications und Drafts der Session mit auf", async () => {
    const { manager, db } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await manager.stop(record.id);
      db.prepare("INSERT INTO notifications (session_id, level, title, detail, kind, created_at) VALUES (?, 'info', 't', null, 'test', ?)").run(record.id, new Date().toISOString());
      db.prepare("INSERT INTO drafts (session_id, text, attachment_ids, revision, updated_at) VALUES (?, 'x', '[]', 1, ?)").run(record.id, new Date().toISOString());
      expect((db.prepare("SELECT count(*) AS n FROM notifications WHERE session_id = ?").get(record.id) as { n: number }).n).toBe(1);
      expect((await manager.delete(record.id)).ok).toBe(true);
      expect((db.prepare("SELECT count(*) AS n FROM notifications WHERE session_id = ?").get(record.id) as { n: number }).n).toBe(0);
      expect((db.prepare("SELECT count(*) AS n FROM drafts WHERE session_id = ?").get(record.id) as { n: number }).n).toBe(0);
    } finally {
      await manager.shutdown();
    }
  });

  it("BUG-0226: notifications() liefert nichts jenseits des Horizonts und kappt Altzeilen", async () => {
    const { manager, db } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await manager.stop(record.id);
      const alt = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
      const frisch = new Date().toISOString();
      db.prepare("INSERT INTO notifications (session_id, level, title, detail, kind, created_at) VALUES (?, 'info', 'uralt', null, 'test', ?)").run(record.id, alt);
      db.prepare("INSERT INTO notifications (session_id, level, title, detail, kind, created_at) VALUES (?, 'info', 'frisch', null, 'test', ?)").run(record.id, frisch);

      // Erste Frage der Glocke: nur Zeilen im Horizont, nie der Tabellenanfang.
      const page = manager.notifications(0);
      expect(page.items.map((n) => n.title)).toEqual(["frisch"]);

      // Retention: das Lesen kappt Zeilen jenseits des Horizonts.
      const uralt = db.prepare("SELECT count(*) AS n FROM notifications WHERE title = 'uralt'").get() as { n: number };
      const nochDa = db.prepare("SELECT count(*) AS n FROM notifications WHERE title = 'frisch'").get() as { n: number };
      expect(uralt.n).toBe(0);
      expect(nochDa.n).toBe(1);
    } finally {
      await manager.shutdown();
    }
  });

  it("BUG-0033: a refused steer says why in its session.steer event — the chat can show it", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const refuser: Adapter = {
      id: "refuser",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none" as const, nativeResume: "none" as const, features: basicFeatures({}) }),
      start: async (_spec: SessionSpec, ctx: AdapterContext) => {
        ctx.turn?.("working");
        return { sessionId: "x" };
      },
      steer: async () => ({ ok: false, detail: "refuser: der Zug läuft noch — erst anhalten oder abwarten" }),
      status: async () => ({ state: "healthy" as const }),
      stop: async () => {},
    };
    registry.register("refuser", () => refuser);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "refuser", project: dir });
      const ack = await manager.steer(record.id, { kind: "prompt", text: "Wo hängst du?" });
      expect(ack.ok).toBe(false);
      const events = await manager.tail(record.id, 0);
      const steered = events.find((e) => (e.payload as { kind?: string }).kind === "session.steer");
      expect((steered!.payload as { ok?: boolean }).ok).toBe(false);
      expect((steered!.payload as { detail?: string }).detail).toContain("läuft noch");
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.8: actor is null when the caller omits it — every pre-T2.8 call site, honestly, not guessed", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const events = await manager.tail(record.id, 0);
      const created = events.find((e) => (e.payload as { kind?: string }).kind === "session.created");
      expect((created!.payload as { actor?: string | null }).actor).toBeNull();
    } finally {
      await manager.shutdown();
    }
  });

  it("steer prompts flow through the adapter", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 5 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const ack = await manager.steer(record.id, { kind: "prompt", text: "hallo" });
      expect(ack.ok).toBe(true);
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => e.type === "user" && e.summary.includes("hallo"))).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("records start failures as session.start_failed + status error", async () => {
    const { manager } = makeManager(dir, { failStart: true });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      expect(record.status).toBe("error");
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.start_failed")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("BUG-0126: repair drops a stale native binding and continues with a context draft from the tail", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "ancientvoid-sm-repair-"));
    let lost = false;
    const specs: SessionSpec[] = [];
    const flaky: Adapter = {
      id: "flaky",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true }) }),
      async start(spec, ctx) {
        specs.push(spec);
        const resume = ((spec.args ?? {}) as { resumeSessionId?: unknown }).resumeSessionId;
        // maki live 2026-11-11: the agent no longer knows the old id —
        // every start that carries it dies, the session bricked.
        if (lost && resume === "native_weg") throw new Error("Resource not found: not found: native_weg");
        // phase 1 (original run) binds native_weg; the repaired run binds a fresh id
        const fresh = lost && resume === undefined;
        ctx.emit({ type: "system", summary: `flaky · Session ${fresh ? "native_neu" : "native_weg"}`, payload: { kind: "acp.native_session", nativeSessionId: fresh ? "native_neu" : "native_weg" } });
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir2);
    const registry = new AdapterRegistry();
    registry.register("flaky", () => flaky);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "flaky", project: dir2, prompt: "Fenster-Drag reparieren" });
      await manager.stop(record.id, "tester");
      // the agent's store lost the session — a prompt now loops on start_failed
      lost = true;
      const bricked = await manager.steer(record.id, { kind: "prompt", text: "Bitte setze die unterbrochene Arbeit fort." }, "jan-pixel");
      expect(bricked.ok).toBe(false);
      const tail = await manager.tail(record.id, 0);
      expect(tail.some((e) => (e.payload as { kind?: string }).kind === "session.start_failed")).toBe(true);

      // the draft names the real reason — not a generic provider hiccup
      const draft = await manager.handoverDraft(record.id);
      expect(draft.reason).toMatchObject({ category: "session", title: "Provider-Session verloren" });

      // only humans repair
      expect((await manager.repair(record.id, "agent:mpi")).ok).toBe(false);

      const repaired = await manager.repair(record.id, "jan-pixel");
      expect(repaired.ok).toBe(true);
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.native_binding_dropped" && (e.payload as { staleNativeId?: string }).staleNativeId === "native_weg")).toBe(true);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.resume_without_native_id")).toBe(true);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.continued")).toBe(true);
      // the repaired run started WITHOUT the dead id and with the handover text
      const last = specs.at(-1)!;
      expect((last.args ?? {}).resumeSessionId).toBeUndefined();
      expect(last.prompt).toContain("Übergabe");
      expect(last.prompt).toContain("Fenster-Drag reparieren");
      // the fresh binding follows the new announce (K7 fold)
      expect(manager.get(record.id)?.nativeSessionId).toBe("native_neu");
      expect(manager.get(record.id)?.status).toBe("working");
    } finally {
      await manager.shutdown();
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it("AI-P0-5: a transient append failure sets status error AND surfaces a visible error event", async () => {
    const { manager, store } = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 2 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      // Fail exactly the NEXT append (the dummy's first generated event),
      // then behave normally — simulates a one-off I/O hiccup rather than
      // a permanently broken store.
      const realAppend = store.append.bind(store);
      let failedOnce = false;
      store.append = (sessionId, events) => {
        if (!failedOnce) {
          failedOnce = true;
          return Promise.reject(new Error("simulated transient append failure"));
        }
        return realAppend(sessionId, events);
      };

      await waitFor(async () => {
        const events = await manager.tail(record.id, 0);
        return events.some((e) => e.type === "error");
      });

      const events = await manager.tail(record.id, 0);
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent?.summary).toContain("simulated transient append failure");
      expect(manager.get(record.id)!.status).toBe("error");
    } finally {
      await manager.shutdown();
    }
  });

  it("AI-P0-5: a permanent append failure still persists status error without crashing", async () => {
    const { manager, store } = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 2 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await waitFor(async () => (await manager.tail(record.id, 0)).length > 0);
      // Every append fails from here on (e.g. disk gone) — both the
      // original emit AND handleEmitFailure's own follow-up event fail.
      // Must not throw/crash the adapter's fire-and-forget emit() caller.
      store.append = () => Promise.reject(new Error("simulated permanent append failure"));

      await waitFor(async () => manager.get(record.id)!.status === "error");
      expect(manager.get(record.id)!.status).toBe("error");
    } finally {
      await manager.shutdown();
    }
  });

  it("subscribers receive live event batches", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 30 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const seen: number[] = [];
      manager.subscribe(record.id, (events) => seen.push(...events.map((e) => e.seq)));
      await new Promise((r) => setTimeout(r, 500));
      expect(seen.length).toBeGreaterThan(3);
    } finally {
      await manager.shutdown();
    }
  });

  it("BUG-0092: nach Recovery läuft für beendete Züge keine Generation mehr", async () => {
    const kdir = await mkdtemp(join(tmpdir(), "ancientvoid-k7-idle-"));
    let second: ReturnType<typeof makeManager> | undefined;
    let first: ReturnType<typeof makeManager> | undefined;
    try {
      first = makeManager(kdir, { eventsPerSecond: 100, autoStopAfterEvents: 3 }, "k7-idle.db");
      const firstManager = first.manager;
      const ids = await Promise.all(
        Array.from({ length: 3 }, (_, i) => firstManager.create({ adapter: "dummy", project: kdir, prompt: `job ${i}` })),
      );
      // Zug-Ende abwarten: auto-stop UND der damit gemeldete Status idle
      // (ctx.turn("idle") — BUG-0092) müssen persistiert sein.
      await waitFor(async () => {
        for (const r of ids) if (firstManager.get(r.id)?.status !== "idle") return false;
        return true;
      });
      await first.store.flush();
      const before = new Map<string, number>(ids.map((r) => [r.id, 0]));
      for (const r of ids) before.set(r.id, (await firstManager.tail(r.id, 0)).length);

      // Hohe Event-Rate: Falls die Recovery fälschlich eine Generation
      // startet (10-ms-Intervall bei 100/s), hat sie im Fenster unten sicher
      // emittiert.
      second = makeManager(kdir, { eventsPerSecond: 100 }, "k7-idle.db");
      await second.manager.recoverAll();
      // Bewusstes Zeitfenster: beweist, dass NICHTS läuft (Abwesenheit über
      // Zeit, kein Rennen um einen frühen Lesezeitpunkt).
      await new Promise((r) => setTimeout(r, 300));
      for (const r of ids) {
        const after = await second!.manager.tail(r.id, 0);
        expect(after.slice(before.get(r.id)!).every((e) => e.type === "system"), `non-system events after recovery in ${r.id}`).toBe(true);
        expect(after.some((e) => e.summary === "dummy: generation restarted after recovery"), `generator restarted in ${r.id}`).toBe(false);
        expect(second!.manager.get(r.id)?.status).toBe("idle");
      }
    } finally {
      await second?.manager.shutdown().catch(() => undefined);
      await first?.manager.shutdown().catch(() => undefined);
      await rm(kdir, { recursive: true, force: true });
    }
  });

  it("K7 (AC-P0-1): recovers 5 concurrent sessions, byte-identical, restore < 3s", async () => {
    const SESSION_COUNT = 5;
    const first = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 10 }, "k7-5.db");
    let secondManager: SessionManager | undefined;
    try {
      const records = await Promise.all(
        Array.from({ length: SESSION_COUNT }, () => first.manager.create({ adapter: "dummy", project: dir })),
      );

      // Wait for every session's own stop signal instead of a fixed sleep —
      // see BUG-0001: a sleep-then-snapshot race lets a straggling event
      // land between the "before" read below and the hard cut.
      await waitFor(async () => {
        for (const record of records) {
          const events = await first.manager.tail(record.id, 0);
          if (!events.some((e) => e.type === "system" && e.summary === "dummy: auto-stop reached")) return false;
        }
        return true;
      });
      await first.store.flush();

      const eventsBefore = new Map<string, number>();
      for (const record of records) {
        const count = (await first.manager.tail(record.id, 0)).length;
        expect(count).toBeGreaterThan(5);
        eventsBefore.set(record.id, count);
      }

      // Hard cut: no graceful shutdown of `first` — new manager instance
      // must restore state from the SAME on-disk artifacts (sqlite + jsonl
      // + snapshot) for all 5 sessions at once. Each session's generator
      // already self-stopped above (autoStopAfterEvents), so none needs
      // cleanup here.
      const second = makeManager(dir, { eventsPerSecond: 20 }, "k7-5.db");
      secondManager = second.manager;
      const t0 = performance.now();
      const { recovered } = await second.manager.recoverAll();
      const elapsedMs = performance.now() - t0;

      // AC-P0-1 as a real assertion, not the console.warn session-manager.ts
      // itself falls back to — a restore that's merely logged as slow was
      // never actually gated on the "< 3 s" requirement.
      expect(recovered).toBeGreaterThanOrEqual(SESSION_COUNT);
      expect(elapsedMs).toBeLessThan(3000);

      for (const record of records) {
        const before = eventsBefore.get(record.id)!;
        const eventsAfter = await second.manager.tail(record.id, 0);
        // Pre-crash stream is preserved byte-identically …
        expect(eventsAfter.slice(0, before).map((e) => e.seq)).toEqual(
          Array.from({ length: before }, (_, i) => i + 1),
        );
        // … and recovery may only append audit events after it.
        expect(eventsAfter.length).toBeGreaterThanOrEqual(before);
        expect(eventsAfter.slice(before).every((e) => e.type === "system")).toBe(true);
      }
    } finally {
      // BUG-0002: `recover()` restarts each dummy generator with
      // `autoStopAfterEvents` defaulting to 0 (endless). If any expect()
      // above throws, this used to be skipped, leaving up to 5 infinite,
      // unref'd setIntervals running for the rest of the whole test
      // process (all files share one fork).
      await secondManager?.shutdown();
    }
  });

  it("T1.5/ADR-0003: accumulates costUsd across events and bumps updatedAt on activity", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    // Minimal inline adapter — the dummy adapter has no costUsd capability,
    // and this needs a controlled costUsd-bearing EmittedEvent per turn.
    registry.register("cost-test", () => ({
      id: "cost-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        ctx.emit({ type: "system", summary: "turn 1", payload: {}, costUsd: 0.01 });
        return { sessionId: ctx.sessionId };
      },
      async steer(handle, input, ctx) {
        if (input.kind === "prompt") ctx.emit({ type: "system", summary: "turn 2", payload: {}, costUsd: 0.02 });
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "cost-test", project: dir });
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => e.costUsd === 0.01));
      const createdAt = manager.get(record.id)!.updatedAt;

      await new Promise((r) => setTimeout(r, 5)); // ensure a distinguishable later timestamp
      await manager.steer(record.id, { kind: "prompt", text: "go" });
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => e.costUsd === 0.02));

      const after = manager.get(record.id)!;
      expect(after.costUsd).toBeCloseTo(0.03, 6); // 0.01 + 0.02, summed not overwritten
      expect(after.updatedAt >= createdAt).toBe(true); // ISO-8601 sorts lexicographically
    } finally {
      await manager.shutdown();
    }
  });

  it("ADR-0006: accumulates tokensEst across events, same summed-not-overwritten pattern as costUsd", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("tokens-test", () => ({
      id: "tokens-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        ctx.emit({ type: "system", summary: "turn 1", payload: {}, tokensEst: 10 });
        return { sessionId: ctx.sessionId };
      },
      async steer(handle, input, ctx) {
        if (input.kind === "prompt") ctx.emit({ type: "system", summary: "turn 2", payload: {}, tokensEst: 25 });
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "tokens-test", project: dir });
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => e.tokensEst === 10));
      await manager.steer(record.id, { kind: "prompt", text: "go" });
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => e.tokensEst === 25));

      const after = manager.get(record.id)!;
      expect(after.tokensEst).toBe(35); // 10 + 25, summed not overwritten
    } finally {
      await manager.shutdown();
    }
  });

  it("ADR-0004: getAdapterUsage is account-level (per adapter id, never summed, never on SessionRecord)", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const quota1 = { windows: [{ id: "five_hour", utilization: 0.2, resetsAt: "2026-09-15T20:00:00.000Z" }] };
    const quota2 = { windows: [{ id: "five_hour", utilization: 0.5, resetsAt: "2026-09-15T20:00:00.000Z" }] };
    registry.register("usage-test", () => ({
      id: "usage-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: true, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        ctx.emit({ type: "system", summary: "quota update", payload: {}, usageQuota: quota1 });
        return { sessionId: ctx.sessionId };
      },
      async steer(_handle, _input, ctx) {
        ctx.emit({ type: "system", summary: "quota update", payload: {}, usageQuota: quota2 });
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      expect(manager.getAdapterUsage("usage-test")).toBeNull(); // no observation yet -> null, never 0

      const record = await manager.create({ adapter: "usage-test", project: dir });
      await waitFor(async () => manager.getAdapterUsage("usage-test") !== null);
      expect(manager.getAdapterUsage("usage-test")!.quota).toEqual(quota1);
      // Not a per-session field on SessionRecord — the snapshot lives only
      // in the adapter-keyed cache.
      expect((manager.get(record.id) as unknown as { usageQuota?: unknown }).usageQuota).toBeUndefined();

      // A later observation on the SAME account (same adapter id) replaces
      // the snapshot — it neither sums nor averages with the earlier one.
      await manager.steer(record.id, { kind: "prompt", text: "go" });
      await waitFor(async () => manager.getAdapterUsage("usage-test")!.quota.windows[0]!.utilization === 0.5);
      expect(manager.getAdapterUsage("usage-test")!.quota).toEqual(quota2);
    } finally {
      await manager.shutdown();
    }
  });

  it("T1.9/AC-P1-5: heartbeat detects a down adapter (status=interrupted, visible adapter.down event)", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    let healthy = true;
    registry.register("heartbeat-test", () => ({
      id: "heartbeat-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: false, interrupt: false }) }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return healthy ? { state: "healthy" as const } : { state: "down" as const, detail: "simulated crash" };
      },
      async stop() {},
    }));
    // A real-scale interval — the test drives runHeartbeat() directly
    // instead of waiting out 30s.
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), 3_600_000);
    try {
      const record = await manager.create({ adapter: "heartbeat-test", project: dir });
      await manager.runHeartbeat();
      expect(manager.get(record.id)!.status).toBe("working"); // healthy — untouched

      healthy = false;
      await manager.runHeartbeat();

      const after = manager.get(record.id)!;
      expect(after.status).toBe("interrupted");
      const events = await manager.tail(record.id, 0);
      const downEvent = events.find((e) => (e.payload as { kind?: string }).kind === "adapter.down");
      expect(downEvent).toBeDefined();
      expect((downEvent!.payload as { detail?: string }).detail).toBe("simulated crash");

      // Once terminal, later ticks must not re-fire (no duplicate events,
      // no illegal transition out of "error").
      await manager.runHeartbeat();
      const eventsAfter2 = await manager.tail(record.id, 0);
      expect(eventsAfter2.filter((e) => (e.payload as { kind?: string }).kind === "adapter.down")).toHaveLength(1);
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.1: a git-repo project gets real worktree isolation — commits land off the main checkout, cleaned up on stop", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-wtrepo-"));
    const worktreesOut = await mkdtemp(join(tmpdir(), "ancientvoid-sm-wtout-"));
    await execFileAsync("git", ["-C", repoDir, "init", "-q", "-b", "main"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.email", "t@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.name", "ancientvoid test"]);
    await writeFile(join(repoDir, "a.txt"), "hi\n");
    await execFileAsync("git", ["-C", repoDir, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repoDir, "commit", "-q", "-m", "initial"]);
    const { stdout: headSha } = await execFileAsync("git", ["-C", repoDir, "rev-parse", "HEAD"]);

    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    let seenWorkdir = "";
    registry.register("wt-test", () => ({
      id: "wt-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: false, interrupt: false }) }),
      async start(_spec, ctx) {
        seenWorkdir = ctx.workdir;
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const worktrees = new WorktreeManager(worktreesOut);
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, worktrees);
    try {
      const record = await manager.create({ adapter: "wt-test", project: repoDir });
      const wtPath = worktrees.pathFor(record.id);
      expect(seenWorkdir).toBe(wtPath); // adapter really saw the worktree, not repoDir
      expect(existsSync(wtPath)).toBe(true);
      expect(manager.get(record.id)!.worktreeSha).toBe(headSha.trim());

      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).not.toContain("session.no_worktree_isolation");

      await manager.stop(record.id);
      expect(existsSync(wtPath)).toBe(false); // real cleanup, not just marked stopped
    } finally {
      await manager.shutdown();
      await rm(repoDir, { recursive: true, force: true });
      await rm(worktreesOut, { recursive: true, force: true });
    }
  });

  it("ADR-0041: die Übernahme der Originalsession läuft im Projekt, die Kopie im Worktree", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-adoptrepo-"));
    const worktreesOut = await mkdtemp(join(tmpdir(), "ancientvoid-sm-adoptout-"));
    await execFileAsync("git", ["-C", repoDir, "init", "-q", "-b", "main"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.email", "t@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.name", "ancientvoid test"]);
    await writeFile(join(repoDir, "a.txt"), "hi\n");
    await execFileAsync("git", ["-C", repoDir, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repoDir, "commit", "-q", "-m", "initial"]);
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const seen: string[] = [];
    registry.register("adopt-test", () => ({
      id: "adopt-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: false, interrupt: false }) }),
      async start(_spec, ctx) {
        seen.push(ctx.workdir);
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const worktrees = new WorktreeManager(worktreesOut);
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, worktrees);
    try {
      const inPlace = await manager.create({ adapter: "adopt-test", project: repoDir, adoptNativeSessionId: "native-1" });
      const copy = await manager.create({ adapter: "adopt-test", project: repoDir, adoptNativeSessionId: "native-2", adoptFork: true });
      expect(seen[0]).toBe(repoDir);
      expect(seen[1]).toBe(worktrees.pathFor(copy.id));
      expect(inPlace.worktreeSha).toBeNull();
    } finally {
      await manager.shutdown();
      await rm(repoDir, { recursive: true, force: true });
      await rm(worktreesOut, { recursive: true, force: true });
    }
  });

  it("BUG-0027: stop keeps a worktree that holds work, and Weiter continues in it", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-keep-"));
    const worktreesOut = await mkdtemp(join(tmpdir(), "ancientvoid-sm-keepout-"));
    await execFileAsync("git", ["-C", repoDir, "init", "-q", "-b", "main"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.email", "t@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.name", "ancientvoid test"]);
    await writeFile(join(repoDir, "a.txt"), "hi\n");
    await execFileAsync("git", ["-C", repoDir, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repoDir, "commit", "-q", "-m", "initial"]);

    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const workdirs: string[] = [];
    registry.register("wt-keep", () => ({
      id: "wt-keep",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        workdirs.push(ctx.workdir);
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const worktrees = new WorktreeManager(worktreesOut);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner(), undefined, worktrees);
    try {
      // Uncommitted work (what an agent leaves behind).
      const dirty = await manager.create({ adapter: "wt-keep", project: repoDir });
      const dirtyPath = worktrees.pathFor(dirty.id);
      await writeFile(join(dirtyPath, "index.html"), "<h1>Tetris</h1>\n");
      await manager.stop(dirty.id);
      expect(existsSync(join(dirtyPath, "index.html"))).toBe(true);
      const kept = (await manager.tail(dirty.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "session.worktree_kept");
      expect(kept?.payload).toMatchObject({ path: dirtyPath, branch: `ancientvoid/${dirty.id}` });
      expect((await manager.steer(dirty.id, { kind: "prompt", text: "weiter" })).ok).toBe(true);
      expect(workdirs.at(-1)).toBe(dirtyPath);
      expect(existsSync(join(dirtyPath, "index.html"))).toBe(true);

      // A commit on the session branch counts as work, too.
      const committed = await manager.create({ adapter: "wt-keep", project: repoDir });
      const committedPath = worktrees.pathFor(committed.id);
      await writeFile(join(committedPath, "b.txt"), "b\n");
      await execFileAsync("git", ["-C", committedPath, "add", "b.txt"]);
      await execFileAsync("git", ["-C", committedPath, "-c", "user.email=t@u", "-c", "user.name=t", "commit", "-q", "-m", "work"]);
      await manager.stop(committed.id);
      expect(existsSync(committedPath)).toBe(true);
      const { stdout: branches } = await execFileAsync("git", ["-C", repoDir, "branch", "--list", `ancientvoid/${committed.id}`]);
      expect(branches.trim()).not.toBe("");

      // A clean worktree still goes away (disk hygiene, T2.1).
      const clean = await manager.create({ adapter: "wt-keep", project: repoDir });
      await manager.stop(clean.id);
      expect(existsSync(worktrees.pathFor(clean.id))).toBe(false);
    } finally {
      await manager.shutdown();
      await rm(repoDir, { recursive: true, force: true });
      await rm(worktreesOut, { recursive: true, force: true });
    }
  });


  it("EPIC-P14 T14.1: archive removes a clean worktree, keeps one with work, and a later prompt brings it back", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-arch-"));
    const worktreesOut = await mkdtemp(join(tmpdir(), "ancientvoid-sm-archout-"));
    await execFileAsync("git", ["-C", repoDir, "init", "-q", "-b", "main"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.email", "t@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.name", "ancientvoid test"]);
    await writeFile(join(repoDir, "a.txt"), "hi\n");
    await execFileAsync("git", ["-C", repoDir, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repoDir, "commit", "-q", "-m", "initial"]);

    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const workdirs: string[] = [];
    registry.register("wt-arch", () => ({
      id: "wt-arch",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        workdirs.push(ctx.workdir);
        setTimeout(() => ctx.turn?.("idle"), 30); // the turn ends after start() returned
        return { sessionId: ctx.sessionId };
      },
      async steer(_handle, _input, ctx) {
        workdirs.push(ctx.workdir);
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const worktrees = new WorktreeManager(worktreesOut);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner(), undefined, worktrees);
    const idle = async (id: string) => waitFor(async () => manager.get(id)?.status === "idle");
    try {
      // Clean worktree, session idle between turns: archiving frees the disk.
      const clean = await manager.create({ adapter: "wt-arch", project: repoDir });
      await idle(clean.id);
      const cleanPath = worktrees.pathFor(clean.id);
      expect(existsSync(cleanPath)).toBe(true);
      expect((await manager.archive(clean.id, true)).archived).toBe(true);
      expect(existsSync(cleanPath)).toBe(false);
      // Un-archive and continue: the worktree is back under the same path.
      await manager.archive(clean.id, false);
      expect((await manager.steer(clean.id, { kind: "prompt", text: "weiter" })).ok).toBe(true);
      expect(existsSync(cleanPath)).toBe(true);
      expect(workdirs.at(-1)).toBe(cleanPath);

      // Uncommitted work: worktree and branch stay, the session says so.
      const dirty = await manager.create({ adapter: "wt-arch", project: repoDir });
      await idle(dirty.id);
      const dirtyPath = worktrees.pathFor(dirty.id);
      await writeFile(join(dirtyPath, "index.html"), "<h1>Arbeit</h1>\n");
      await manager.archive(dirty.id, true);
      expect(existsSync(join(dirtyPath, "index.html"))).toBe(true);
      const kept = (await manager.tail(dirty.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "session.worktree_kept");
      expect(kept?.payload).toMatchObject({ path: dirtyPath, branch: `ancientvoid/${dirty.id}`, reason: "work" });

      // A commit on the session branch counts as work, too.
      const committed = await manager.create({ adapter: "wt-arch", project: repoDir });
      await idle(committed.id);
      const committedPath = worktrees.pathFor(committed.id);
      await writeFile(join(committedPath, "b.txt"), "b\n");
      await execFileAsync("git", ["-C", committedPath, "add", "b.txt"]);
      await execFileAsync("git", ["-C", committedPath, "-c", "user.email=t@ancientvoid.local", "-c", "user.name=t", "commit", "-q", "-m", "agent"]);
      await manager.archive(committed.id, true);
      expect(existsSync(join(committedPath, "b.txt"))).toBe(true);

      // Archiving never touches a worktree while a turn is running.
      const running = await manager.create({ adapter: "wt-arch", project: repoDir });
      await idle(running.id);
      const runningPath = worktrees.pathFor(running.id);
      (manager as unknown as { live: Map<string, { record: { status: string } }> }).live.get(running.id)!.record.status = "working";
      await manager.archive(running.id, true);
      expect(existsSync(runningPath)).toBe(true);

      // BUG-0246: endgültiges Löschen entriegelt und entfernt auch gesperrte Worktrees.
      await manager.stop(dirty.id);
      await execFileAsync("git", ["-C", repoDir, "worktree", "lock", dirtyPath]);
      expect((await manager.delete(dirty.id)).ok).toBe(true);
      expect(existsSync(dirtyPath)).toBe(false);
      expect(manager.get(dirty.id)).toBeUndefined();
    } finally {
      await manager.shutdown().catch(() => undefined);
      await rm(repoDir, { recursive: true, force: true });
      await rm(worktreesOut, { recursive: true, force: true });
    }
  });

  it("EPIC-P14 T14.1: archive keeps the worktree of a session whose long-lived worker has it as cwd", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-arch2-"));
    const worktreesOut = await mkdtemp(join(tmpdir(), "ancientvoid-sm-arch2out-"));
    await execFileAsync("git", ["-C", repoDir, "init", "-q", "-b", "main"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.email", "t@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.name", "ancientvoid test"]);
    await writeFile(join(repoDir, "a.txt"), "hi\n");
    await execFileAsync("git", ["-C", repoDir, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repoDir, "commit", "-q", "-m", "initial"]);

    const registry = new AdapterRegistry();
    registry.register("wt-persist", () => ({
      id: "wt-persist",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        await ctx.spawnWorker(["sleep", "30"], { persistent: true });
        ctx.turn?.("working");
        setTimeout(() => ctx.turn?.("idle"), 30);
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const worktrees = new WorktreeManager(worktreesOut);
    const manager = new SessionManager(new HubDatabase(":memory:"), new EventStore(dir), registry, new ProcessRunner(), undefined, worktrees);
    try {
      const created = await manager.create({ adapter: "wt-persist", project: repoDir });
      await waitFor(async () => manager.get(created.id)?.status === "idle");
      await manager.archive(created.id, true);
      expect(existsSync(worktrees.pathFor(created.id))).toBe(true);
      const kept = (await manager.tail(created.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "session.worktree_kept");
      expect(kept?.payload).toMatchObject({ reason: "worker" });
    } finally {
      await manager.shutdown().catch(() => undefined);
      await rm(repoDir, { recursive: true, force: true });
      await rm(worktreesOut, { recursive: true, force: true });
    }
  });
  it("T2.1: a non-git project honestly falls back — no isolation, no crash, event says why", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 1 });
    const worktreesOut = await mkdtemp(join(tmpdir(), "ancientvoid-sm-wtout-nongit-"));
    const worktrees = new WorktreeManager(worktreesOut);
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, worktrees);
    try {
      const record = await manager.create({ adapter: "dummy", project: dir }); // `dir` is not a git repo
      expect(manager.get(record.id)!.worktreeSha).toBeNull();
      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).toContain("session.no_worktree_isolation");
    } finally {
      await manager.shutdown();
      await rm(worktreesOut, { recursive: true, force: true });
    }
  });

  // T2.7 (EPIC-P2 §3 BudgetState): a controllable costUsd-bearing adapter,
  // same reasoning as the ADR-0003/0006 tests above — the dummy adapter
  // has no cost capability. `steer(prompt)` emits whatever amount the
  // prompt text parses to as a number, letting each test drive the
  // session's costUsd to an exact figure.
  function registerBudgetAdapter(registry: AdapterRegistry) {
    registry.register("budget-test", () => ({
      id: "budget-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer(_handle, input, ctx) {
        if (input.kind === "prompt") ctx.emit({ type: "system", summary: "spend", payload: {}, costUsd: Number(input.text) });
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
  }

  it("T2.7: warns once at 80% of budget, never re-fires on later events", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registerBudgetAdapter(registry);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "budget-test", project: dir, budgetUsd: 1.0 });
      await manager.steer(record.id, { kind: "prompt", text: "0.85" }); // crosses 80%
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => (e.payload as { kind?: string }).kind === "session.budget_warning"));
      await manager.steer(record.id, { kind: "prompt", text: "0.01" }); // another cost-bearing event, still under 100%
      await waitFor(async () => manager.get(record.id)!.costUsd >= 0.86);
      const events = await manager.tail(record.id, 0);
      const warnings = events.filter((e) => (e.payload as { kind?: string }).kind === "session.budget_warning");
      expect(warnings).toHaveLength(1); // fired once, not again on the second event
      expect(manager.get(record.id)!.status).toBe("working"); // not parked yet
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.7: auto-parks at 100% of budget, fail-closed — records why via parkReason", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registerBudgetAdapter(registry);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "budget-test", project: dir, budgetUsd: 1.0 });
      await manager.steer(record.id, { kind: "prompt", text: "1.0" });
      // ctx.emit() is fire-and-forget (documented SessionManager behavior) —
      // the cost event, and the budget check it triggers, can still be
      // in flight after steer() itself resolves. Poll instead of asserting
      // immediately after the await, same reasoning as this file's other
      // adapter-driven async tests.
      await waitFor(async () => manager.get(record.id)!.status === "parked");
      const after = manager.get(record.id)!;
      expect(after.status).toBe("parked");
      expect(after.parkReason).toBe("budget");
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.budget_exceeded")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.7: budget top-up resumes a session parked FOR BUDGET, but never one parked manually", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registerBudgetAdapter(registry);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const budgetParked = await manager.create({ adapter: "budget-test", project: dir, budgetUsd: 1.0 });
      await manager.steer(budgetParked.id, { kind: "prompt", text: "1.0" });
      await waitFor(async () => manager.get(budgetParked.id)!.status === "parked");

      const topUp = await manager.applyBudgetTopUp(budgetParked.id, 5.0);
      expect(topUp.ok).toBe(true);
      const resumed = manager.get(budgetParked.id)!;
      expect(resumed.status).toBe("working");
      expect(resumed.parkReason).toBeNull();
      expect(resumed.budgetUsd).toBe(5.0);

      const manuallyParked = await manager.create({ adapter: "budget-test", project: dir, budgetUsd: 1.0 });
      await manager.park(manuallyParked.id);
      expect(manager.get(manuallyParked.id)!.parkReason).toBe("manual");
      await manager.applyBudgetTopUp(manuallyParked.id, 5.0);
      // still parked — a manual park is never auto-resumed by a top-up
      expect(manager.get(manuallyParked.id)!.status).toBe("parked");
      expect(manager.get(manuallyParked.id)!.parkReason).toBe("manual");
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.7: a hub-wide daily cap parks every live session, not just the one that crossed it", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registerBudgetAdapter(registry);
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, 1.0);
    try {
      const a = await manager.create({ adapter: "budget-test", project: dir });
      const b = await manager.create({ adapter: "budget-test", project: dir });
      await manager.steer(a.id, { kind: "prompt", text: "1.0" }); // a alone crosses the hub-wide 1.0 daily cap
      // checkDailyCap parks one session after the other — wait for both.
      await waitFor(async () => manager.get(a.id)!.status === "parked" && manager.get(b.id)!.status === "parked");
      expect(manager.get(a.id)!.status).toBe("parked");
      expect(manager.get(a.id)!.parkReason).toBe("daily_cap");
      expect(manager.get(b.id)!.status).toBe("parked"); // b never spent anything, still parked
      expect(manager.get(b.id)!.parkReason).toBe("daily_cap");
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.7 fail-closed regression: a budget park real-signals a free-running adapter to stop, not just the hub's own status label", async () => {
    // Real bug found live-testing T2.7 (see parkFor()'s own doc comment):
    // an adapter with an internal generator loop (a real CLI process
    // still streaming, or adapter-dummy's own setInterval) kept right on
    // running and right on costing money after a budget park, because
    // nothing ever told IT to stop — only the hub's own status label
    // changed. This adapter free-runs a costUsd-emitting timer exactly
    // like that, and only stops when its own steer(park) is actually
    // called.
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    let paused = false;
    registry.register("free-running-budget-test", () => ({
      id: "free-running-budget-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        const timer = setInterval(() => {
          if (!paused) ctx.emit({ type: "system", summary: "tick", payload: {}, costUsd: 0.5 });
        }, 30);
        ctx.signal.addEventListener("abort", () => clearInterval(timer));
        return { sessionId: ctx.sessionId };
      },
      async steer(_handle, input) {
        if (input.kind === "park") paused = true;
        if (input.kind === "resume") paused = false;
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "free-running-budget-test", project: dir, budgetUsd: 1.0 });
      await waitFor(async () => manager.get(record.id)!.status === "parked");
      const costAtPark = manager.get(record.id)!.costUsd;
      await new Promise((r) => setTimeout(r, 200)); // several more timer ticks would have fired by now
      expect(manager.get(record.id)!.costUsd).toBe(costAtPark); // real proof the adapter actually stopped, not just relabeled
      expect(paused).toBe(true);

      await manager.applyBudgetTopUp(record.id, 5.0);
      expect(paused).toBe(false); // resume signal really reached the adapter too
    } finally {
      await manager.shutdown();
    }
  });
});

/** T4.1/ADR-0009: reportingSinks wiring. Separate describe block — these
 * tests care about stop()'s digest dispatch, not general lifecycle. */
describe("SessionManager — reporting sink dispatch (T4.1, ADR-0009)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-digest-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stop() calls every configured sink with a real, quote-grounded SessionSummary", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const received: unknown[] = [];
    const sink = async (summary: unknown) => {
      received.push(summary);
    };
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, null, [sink]);
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await manager.stop(record.id);
      await waitFor(async () => received.length === 1);
      const summary = received[0] as { sessionId: string; archiveRef: string; lessons: { text: string }[] };
      expect(summary.sessionId).toBe(record.id);
      expect(summary.archiveRef).toBe(`sessions/${record.id}/events.jsonl`);
      // "session.created"/"session.started" aren't digest-worthy (see
      // digest.test.ts) but "session.stopped" itself isn't either — real
      // proof this is rule-based extraction, not "every event is a lesson".
      expect(summary.lessons.length).toBe(0);
    } finally {
      await manager.shutdown();
    }
  });

  it("a throwing sink never breaks stop() — the error becomes a visible system event instead", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const badSink = async () => {
      throw new Error("webhook unreachable");
    };
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, null, [badSink]);
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const ack = await manager.stop(record.id);
      expect(ack.ok).toBe(true); // stop() itself must succeed regardless
      await waitFor(async () => {
        const events = await manager.tail(record.id, 0);
        return events.some((e) => (e.payload as { kind?: string }).kind === "session.digest_sink_failed");
      });
      const events = await manager.tail(record.id, 0);
      const failure = events.find((e) => (e.payload as { kind?: string }).kind === "session.digest_sink_failed");
      expect((failure!.payload as { error?: string }).error).toContain("webhook unreachable");
    } finally {
      await manager.shutdown();
    }
  });

  it("an empty reportingSinks array (the default) never touches the store — exact pre-T4.1 behavior", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await manager.stop(record.id);
      await new Promise((r) => setTimeout(r, 50));
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind?.startsWith("session.digest"))).toBe(false);
    } finally {
      await manager.shutdown();
    }
  });

  it("T5.10: puts the extends chain in the prompt and reapplies it after recovery", async () => {
    const root = await mkdtemp(join(dir, "chain-"));
    const project = join(root, "proj");
    await mkdir(join(root, ".claude", "skills", "task"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "task", "SKILL.md"), "---\nname: task\ndescription: form\n---\nFORM\n");
    await mkdir(join(project, ".claude", "skills", "neon"), { recursive: true });
    await writeFile(
      join(project, ".claude", "skills", "neon", "SKILL.md"),
      "---\nname: neon\ndescription: look\nextends: task\n---\nDELTA\n",
    );

    const seen: string[] = [];
    const open = (dbName: string) => {
      const db = new HubDatabase(join(dir, dbName));
      const store = new EventStore(dir);
      const registry = new AdapterRegistry();
      registry.register(
        "dummy",
        (config) => {
          const inner = createDummy(config);
          return {
            ...inner,
            start: async (spec, ctx) => {
              seen.push(spec.prompt ?? "");
              return inner.start(spec, ctx);
            },
          };
        },
        { eventsPerSecond: 1, autoStopAfterEvents: 1 },
      );
      return { manager: new SessionManager(db, store, registry, new ProcessRunner()), store };
    };

    const first = open("chain.db");
    let secondManager: SessionManager | undefined;
    try {
      const record = await first.manager.create({
        adapter: "dummy",
        project,
        prompt: "hello",
        args: { skill: "neon" },
      });
      expect(seen[0]).toContain("FORM");
      expect(seen[0]).toContain("DELTA");
      expect(seen[0]?.indexOf("FORM")).toBeLessThan(seen[0]?.indexOf("DELTA") ?? -1);
      expect(seen[0]?.endsWith("hello")).toBe(true);
      await waitFor(async () => {
        const events = await first.manager.tail(record.id, 0);
        return events.some((e) => e.summary === "dummy: auto-stop reached");
      });
      const created = (await first.manager.tail(record.id, 0)).find(
        (e) => (e.payload as { kind?: string }).kind === "session.created",
      );
      expect((created?.payload as { args?: { skillChain?: string[] } }).args?.skillChain).toEqual(["task", "neon"]);
      const chainEvent = (await first.manager.tail(record.id, 0)).find(
        (e) => (e.payload as { kind?: string }).kind === "session.skill_chain",
      );
      expect(chainEvent?.summary).toBe("Skills task → neon");
      expect(JSON.stringify(chainEvent?.payload)).not.toContain("FORM");
      await first.store.flush();

      const second = open("chain.db");
      secondManager = second.manager;
      await second.manager.recoverAll();
      const ack = await second.manager.steer(record.id, { kind: "prompt", text: "again" });
      expect(ack.ok).toBe(true);
      // Nach der K7-Recovery (ADR-0050) hat eine beendete Session kein
      // Adapter-Handle mehr — der Prompt geht als Neustart raus, nicht als
      // steer-Event. Was beim Adapter ankam, steht in seen (start-Wrapper):
      // die Skill-Kette muss wieder davorstehen.
      const text = seen.at(-1) ?? "";
      expect(text).toContain("FORM");
      expect(text).toContain("DELTA");
      expect(text.endsWith("again")).toBe(true);
    } finally {
      await secondManager?.shutdown();
    }
  });

  it("continues a stopped session using the provider id from the worker log", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir, prompt: "first" });
      await manager.stop(record.id);
      expect(manager.get(record.id)?.status).toBe("stopped");
      await mkdir(join(dir, "workers"), { recursive: true });
      await writeFile(join(dir, "workers", `ancientvoid-${record.id}.log`), '{"sessionID":"ses_kept"}\n');
      const ack = await manager.steer(record.id, { kind: "prompt", text: "weiter" });
      expect(ack.ok).toBe(true);
      expect(manager.get(record.id)?.status).toBe("working");
      expect(manager.get(record.id)?.nativeSessionId).toBe("ses_kept");
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.continued")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });
});

describe("SessionManager mirror (ADR-0011 Erweiterung)", () => {
  let dir: string;
  let dataDir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-mirror-sm-"));
    dataDir = join(dir, "opencode-data");
    await mkdir(dataDir, { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const odb = new DatabaseSync(join(dataDir, "opencode.db"));
    odb.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER)");
    odb.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
    odb.exec("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
    odb.prepare("INSERT INTO session VALUES (?,?,?,?,?)").run("ses_live", dir, "Spiegel-Titel", 1000, 2000);
    odb.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run("m1", "ses_live", 1000, 1000, JSON.stringify({ role: "user" }));
    odb.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p1", "m1", "ses_live", 1000, 1000, JSON.stringify({ type: "text", text: "erste Frage" }));
    odb.close();
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function manager() {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy);
    return { manager: new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, undefined, [], {}, dataDir), db };
  }

  it("creates a read-only mirror without any adapter and imports the chat", async () => {
    const { manager: sm, db } = manager();
    try {
      // adapter "opencode" is deliberately NOT registered — a mirror runs nothing
      const record = await sm.create({ adapter: "opencode", project: dir, mirrorNativeSessionId: "ses_live" });
      expect(record.controlMode).toBe("mirror");
      expect(record.status).toBe("idle");
      expect(record.title).toBe("Spiegel-Titel");
      expect(record.nativeSessionId).toBe("ses_live");
      const events = await sm.tail(record.id, 0);
      expect(events.some((e) => e.type === "user" && (e.payload as { text?: string }).text === "erste Frage")).toBe(true);
      // steering anything into the mirror is loudly refused
      const ack = await sm.steer(record.id, { kind: "prompt", text: "hack" });
      expect(ack).toMatchObject({ ok: false });
    } finally {
      await sm.shutdown();
      db.close();
    }
  });

  it("refreshMirror appends only the delta — new opencode parts become events", async () => {
    const { manager: sm, db } = manager();
    try {
      const record = await sm.create({ adapter: "opencode", project: dir, mirrorNativeSessionId: "ses_live" });
      const before = (await sm.tail(record.id, 0)).length;
      const { DatabaseSync } = await import("node:sqlite");
      const odb = new DatabaseSync(join(dataDir, "opencode.db"));
      odb.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run("m2", "ses_live", 3000, 3000, JSON.stringify({ role: "assistant" }));
      odb.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p2", "m2", "ses_live", 3000, 3000, JSON.stringify({ type: "text", text: "neue Antwort" }));
      odb.close();
      await sm.refreshMirror(record.id);
      const events = await sm.tail(record.id, 0);
      expect(events.length).toBe(before + 2); // the assistant event + the delta marker
      expect(events.some((e) => e.type === "assistant" && (e.payload as { text?: string }).text === "neue Antwort")).toBe(true);
      // idempotent: refreshing again without new parts adds only the marker
      await sm.refreshMirror(record.id);
      const again = await sm.tail(record.id, 0);
      expect(again.length).toBe(events.length + 1);
      expect(again.filter((e) => e.type === "assistant")).toHaveLength(1);
    } finally {
      await sm.shutdown();
      db.close();
    }
  });
});

describe("SessionManager adoption (BUG-0039)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-adopt-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes importHistory along the native id and ends idle without a prompt", async () => {
    const seen: SessionSpec[] = [];
    const fake: Adapter = {
      id: "fake-acp",
      version: "0.0.1",
      capabilities() {
        return { reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures() };
      },
      async start(spec: SessionSpec, ctx: AdapterContext) {
        seen.push(spec);
        // the adoption's history import — what a loadSession-capable agent
        // replays during start()
        ctx.emit({ type: "assistant", summary: "alte Nachricht aus der übernommenen Session", payload: { text: "alte Nachricht aus der übernommenen Session" } });
        return { sessionId: ctx.sessionId };
      },
      async status() {
        return { state: "healthy" };
      },
      async steer() {
        return { ok: false, detail: "fake" };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("fake-acp", () => fake);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "fake-acp", project: dir, adoptNativeSessionId: "ses_adopt_1" });
      expect(seen[0]!.args).toMatchObject({ resumeSessionId: "ses_adopt_1", importHistory: true });
      expect(manager.get(record.id)?.status).toBe("idle");
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => e.type === "assistant")).toBe(true);
    } finally {
      await manager.shutdown();
      db.close();
    }
  });

  it("ADR-0040: Kopie und Titel der Übernahme werden an den Adapter und in den Record gegeben, discover sucht darin", async () => {
    const seen: SessionSpec[] = [];
    const fake: Adapter = {
      id: "fake-claude",
      version: "0.0.1",
      capabilities() {
        return { reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures() };
      },
      async start(spec: SessionSpec, ctx: AdapterContext) {
        seen.push(spec);
        return { sessionId: ctx.sessionId };
      },
      async status() {
        return { state: "healthy" };
      },
      async steer() {
        return { ok: true };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("fake-claude", () => fake);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "fake-claude", project: dir, adoptNativeSessionId: "n-42", adoptFork: true, title: "Mobile-hub Session-Abbrüche" });
      expect(seen[0]!.args).toMatchObject({ resumeSessionId: "n-42", forkSession: true });
      expect(manager.get(record.id)).toMatchObject({ title: "Mobile-hub Session-Abbrüche", fork: true, nativeSessionId: "n-42" });

      const hit = await manager.discover([], 0, 50, { q: "abbrüche" });
      expect(hit.items.map((i) => i.hubSessionId)).toEqual([record.id]);
      expect(hit.items[0]).toMatchObject({ title: "Mobile-hub Session-Abbrüche", fork: true });
      expect((await manager.discover([], 0, 50, { q: "nichts davon" })).items).toEqual([]);

      const plain = await manager.create({ adapter: "fake-claude", project: dir, adoptNativeSessionId: "n-43" });
      expect(seen[1]!.args).not.toHaveProperty("forkSession");
      expect(manager.get(plain.id)?.fork).toBe(false);
    } finally {
      await manager.shutdown();
      db.close();
    }
  });

  it("ADR-0041: eine externe Zeile aus dem Worktree einer Hub-Session ist keine zweite Session", async () => {
    const fake: Adapter = {
      id: "fake-wt",
      version: "0.0.1",
      capabilities() {
        return { reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures() };
      },
      async start(_spec: SessionSpec, ctx: AdapterContext) {
        return { sessionId: ctx.sessionId };
      },
      async status() {
        return { state: "healthy" };
      },
      async steer() {
        return { ok: true };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("fake-wt", () => fake);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const own = await manager.create({ adapter: "fake-wt", project: dir });
      const row = (project: string, native: string) =>
        ({ hubSessionId: null, project, adapter: "pi", status: "observed", controlMode: "observed", harness: "cli", hostId: "local", nativeSessionId: native, resumeVersion: 1, observedAt: "2026-10-28T10:00:00.000Z", unsupportedResume: false, fork: false, parentSessionId: null }) as const;
      const source = { id: "t", list: async () => [row(`${dir}/data/worktrees/${own.id}`, "a"), row(`${dir}/data/worktrees/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`, "b"), row("/work/app", "c")] };
      const { items } = await manager.discover([source], 0, 50);
      expect(items.filter((i) => i.hubSessionId === null).map((i) => i.nativeSessionId).sort()).toEqual(["b", "c"]);
    } finally {
      await manager.shutdown();
      db.close();
    }
  });

  // BUG-0188 (live belegt 2026-11-17, Hermes-Session d2910969): stop()
  // abortet das Signal, bevor der Adapter den onExit-Flush der Worker-Ausgabe
  // liefert — das hermes.native_session-Event mit payload.nativeSessionId
  // (der generische Binding-Griff, s. emitEvents) wurde still verworfen.
  // 76 Messages echte Arbeit waren danach über den Hub unerreichbar (K7).
  it("BUG-0188: Adapter-Event mit nativeSessionId nach stop() überlebt — Binding und EventStore", async () => {
    const lateDir = await mkdtemp(join(tmpdir(), "ancientvoid-sm-latebind-"));
    let lateCtx: AdapterContext | undefined;
    const oneShot: Adapter = {
      id: "oneshot",
      version: "0.0.1",
      capabilities() {
        return {
          reasoning: false,
          tools: false,
          cost: false,
          steer: true,
          usage: false,
          nativeDiscovery: "none",
          nativeResume: "native",
          resume: { argv: ["oneshot", "--resume", "{sessionId}"], ref: "native", hub: true, auto: true },
          features: basicFeatures(),
        };
      },
      async start(_spec: SessionSpec, ctx: AdapterContext) {
        lateCtx = ctx;
        return { sessionId: ctx.sessionId };
      },
      async status() {
        return { state: "healthy" };
      },
      async steer() {
        return { ok: true };
      },
      async stop() {
        // Form des hermes-onExit-Flush nach dem Kill: das Binding kommt
        // NACH dem Abort — hier modelliert als sofortiger Folge-Callback.
        setImmediate(() =>
          lateCtx?.emit({ type: "system", summary: "Hermes · Session SID-1", payload: { kind: "hermes.native_session", nativeSessionId: "SID-1" } }),
        );
      },
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("oneshot", () => oneShot);
    const store = new EventStore(lateDir);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "oneshot", project: lateDir, prompt: "x" });
      await manager.stop(record.id);
      await waitFor(async () => (manager.get(record.id)?.nativeSessionId ?? null) === "SID-1");
      // Event NACH dem Abort journalisiert; Status bleibt „stopped“
      const events = await store.replay(record.id);
      const late = events.find((e) => (e.payload as { kind?: string }).kind === "hermes.native_session");
      expect(late).toBeDefined();
      expect((late!.payload as { nativeSessionId?: string }).nativeSessionId).toBe("SID-1");
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.stopped")).toBe(true);
      expect(manager.get(record.id)?.status).toBe("stopped");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(lateDir, { recursive: true, force: true });
    }
  });
});
