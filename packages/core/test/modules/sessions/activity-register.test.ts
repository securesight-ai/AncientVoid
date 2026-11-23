import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityReport, basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

/**
 * ADR-0074 / BUG-0155 (Issue #62): Eine Session ist so lange `working`, wie
 * zugehörige Arbeit läuft — auch wenn der Adapter das Zugende meldet. Externe
 * Jobs registrieren sich explizit; der Hub rät nie (PRD §8.5).
 */

/** Persistent-worker-Adapter: meldet turn("idle"), sobald der Prompt „fertig" ist. */
function persistentTurnAdapter(): Adapter {
  return {
    id: "persistent",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(spec, ctx) {
      ctx.turn?.("working");
      if (spec.prompt?.includes("SOFORT_FERTIG")) ctx.turn?.("idle");
      return { sessionId: ctx.sessionId };
    },
    async steer(_handle, input, ctx) {
      if (input.kind === "prompt") {
        ctx.turn?.("working");
        if (!input.text.includes("LAUF_WEITER")) ctx.turn?.("idle");
      }
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

/** Adapter, der mitten im Zug steckenbleibt — optional mit einer offenen
 * Provider-Aktivität (BUG-0165: sie stirbt mit dem Worker beim Hub-Crash). */
function openTurnAdapter(withActivity: boolean): Adapter {
  const run = (ctx: Parameters<Adapter["start"]>[1]) => {
    ctx.turn?.("working");
    if (withActivity) ctx.activity?.({ id: "sub:1", kind: "agent", state: "running", label: "Subagent läuft" });
  };
  return {
    id: withActivity ? "openturn-activity" : "openturn",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(_spec, ctx) {
      run(ctx);
      return { sessionId: ctx.sessionId };
    },
    async steer(_handle, input, ctx) {
      if (input.kind === "prompt") run(ctx);
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

/** BUG-0209: ein Adapter, dessen Zug endet, während eine Provider-Aktivität offen ist
 * (ACP: ein Werkzeugaufruf bekommt nie sein terminales Update). */
function endsWithOpenActivity(id: string, kind: "tool" | "agent", out: { ctx?: Parameters<Adapter["start"]>[1] } = {}): Adapter {
  return {
    id: "open-activity",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(_spec, ctx) {
      out.ctx = ctx;
      ctx.turn?.("working");
      ctx.activity?.({ id, kind, state: "running", label: "hängt" });
      ctx.turn?.("idle");
      return { sessionId: ctx.sessionId };
    },
    async recover(sessionId) {
      return { sessionId };
    },
    async steer() {
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

/** BUG-0220: Adapter, der denselben Running-Report wiederholt absetzt —
 * Herzschlag im Regelbetrieb oder ein verklemmter Provider-Prozess. */
function heartbeatAdapter(id: string, repeats: number, out: { ctx?: Parameters<Adapter["start"]>[1] } = {}): Adapter {
  return {
    id: "heartbeat",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(_spec, ctx) {
      out.ctx = ctx;
      ctx.turn?.("working");
      for (let i = 0; i < repeats; i++) ctx.activity?.({ id, kind: "tool", state: "running", label: `läuft (${i})` });
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
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function setup(registry: AdapterRegistry, dir: string, store?: EventStore): { manager: SessionManager; db: HubDatabase; store: EventStore } {
  const db = new HubDatabase(":memory:");
  const es = store ?? new EventStore(dir);
  const manager = new SessionManager(db, es, registry, new ProcessRunner());
  return { manager, db, store: es };
}

const kinds = async (manager: SessionManager, id: string) =>
  (await manager.tail(id, 0)).map((e) => (e.payload as { kind?: string }).kind ?? "");

const begins = async (manager: SessionManager, id: string, activityId: string) =>
  (await manager.tail(id, 0)).filter((e) => {
    const p = e.payload as { kind?: string; id?: string };
    return p.kind === "session.activity_begin" && p.id === activityId;
  }).length;

describe("Aktivitätsregister (ADR-0074, BUG-0155)", () => {
  it("Wiederholte Provider-Running-Reports emittieren activity_begin genau einmal (BUG-0220)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    const out: { ctx?: Parameters<Adapter["start"]>[1] } = {};
    registry.register("heartbeat", () => heartbeatAdapter("tool:dup", 3, out));
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "heartbeat", project: dir, prompt: "start" });
      for (let i = 0; i < 250 && (await begins(manager, record.id, "tool:dup")) < 1; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(await begins(manager, record.id, "tool:dup")).toBe(1);
      // Wiederbeginn nach Ende bleibt erlaubt: dieselbe ID darf erneut beginnen.
      out.ctx?.activity?.({ id: "tool:dup", kind: "tool", state: "completed" });
      out.ctx?.activity?.({ id: "tool:dup", kind: "tool", state: "running", label: "neuer Lauf" });
      for (let i = 0; i < 250 && (await begins(manager, record.id, "tool:dup")) < 2; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(await begins(manager, record.id, "tool:dup")).toBe(2);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Externer Herzschlag (hubctl activity) emittiert activity_begin nur beim ersten Running-Report (BUG-0220)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      const report = (state: "running" | "completed") =>
        ActivityReport.parse({ id: "heartbeat", kind: "job", state, label: " langer Lauf " });
      expect((await manager.activity(record.id, report("running"))).ok).toBe(true);
      for (let i = 0; i < 250 && (await begins(manager, record.id, "job:heartbeat")) < 1; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      for (let i = 0; i < 3; i++) {
        expect((await manager.activity(record.id, report("running"))).ok).toBe(true); // Herzschlag
      }
      expect(await begins(manager, record.id, "job:heartbeat")).toBe(1);
      expect((await manager.activity(record.id, report("completed"))).ok).toBe(true);
      expect((await manager.activity(record.id, report("running"))).ok).toBe(true); // Wiederbeginn nach Ende
      for (let i = 0; i < 250 && (await begins(manager, record.id, "job:heartbeat")) < 2; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(await begins(manager, record.id, "job:heartbeat")).toBe(2);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Zugende bei laufender Aktivität bleibt working und nennt die offene Arbeit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      const job = await manager.registerActivity(record.id, "TTFS-Messlauf (systemd-Unit)");
      expect(job).not.toBeNull();
      // Zug meldet Ende — die Session bleibt working, turn_end bleibt aus.
      await manager.steer(record.id, { kind: "prompt", text: "mach" });
      const pendingSeen = async () => (await kinds(manager, record.id)).includes("session.activity_pending");
      for (let i = 0; i < 100 && !(await pendingSeen()); i++) await new Promise((r) => setTimeout(r, 20));
      expect(manager.get(record.id)?.status).toBe("working");
      expect(await kinds(manager, record.id)).toContain("session.activity_begin");
      expect(await kinds(manager, record.id)).not.toContain("session.turn_end");
      expect(await kinds(manager, record.id)).toContain("session.activity_pending");
      // Letzte Aktivität endet → idle + turn_end.
      expect(await manager.endActivity(record.id!, job!.id)).toBe(true);
      expect(manager.get(record.id)?.status).toBe("idle");
      expect(await kinds(manager, record.id)).toContain("session.activity_end");
      expect(await kinds(manager, record.id)).toContain("session.turn_end");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Tool-Ende während der laufenden Hauptarbeit beendet den Zug nicht (BUG-0161)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      // Hauptzug läuft weiter (turn("working"), kein idle) — wie ein Agent mitten in der Aufgabe.
      await manager.steer(record.id, { kind: "prompt", text: "LAUF_WEITER" });
      for (let i = 0; i < 100 && !(await kinds(manager, record.id)).includes("session.main_turn_start"); i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      // Provider-Tool-Aktivität: begin → end, während der Hauptzug weiterläuft.
      expect((await manager.activity(record.id, { id: "call_1", kind: "tool", state: "running", label: "grep" })).ok).toBe(true);
      expect((await manager.activity(record.id, { id: "call_1", kind: "tool", state: "completed" })).ok).toBe(true);
      // BUG-0161: Das Tool-Ende ist kein Zugende — Status bleibt working, kein turn_end.
      expect(manager.get(record.id)?.status).toBe("working");
      expect(await kinds(manager, record.id)).not.toContain("session.turn_end");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Werkzeug-Aktivitäten im Hauptzug schließen den Lauf nicht — „Zug fertig“ genau einmal, mit dem Hauptzug (Nutzerfund 2026-11-15)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    // Persistenter Adapter (wie ACP/app-server): meldet jeden Tool-Call als
    // Aktivität. Zwischen zwei sequenziellen Tools ist das Register leer —
    // das ist eine Lücke, kein Laufende.
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const runTurn = async (ctx: Parameters<Adapter["start"]>[1]) => {
      ctx.turn?.("working");
      ctx.activity?.({ id: "tool:1", kind: "tool", state: "running", label: "Werkzeug eins" });
      await delay(40);
      ctx.activity?.({ id: "tool:1", kind: "tool", state: "completed", label: "Werkzeug eins" });
      await delay(300);
      ctx.activity?.({ id: "tool:2", kind: "tool", state: "running", label: "Werkzeug zwei" });
      await delay(40);
      ctx.activity?.({ id: "tool:2", kind: "tool", state: "completed", label: "Werkzeug zwei" });
      ctx.turn?.("idle");
    };
    registry.register("toolwork", () => ({
      id: "toolwork",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
      async start(_spec, ctx) {
        void runTurn(ctx); // der Zug läuft los — create() wartet nicht aufs Ende
        return { sessionId: ctx.sessionId };
      },
      async steer(_h, input, ctx) {
        if (input.kind === "prompt") await runTurn(ctx);
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    }));
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "toolwork", project: dir, prompt: "arbeit" });
      // Nach dem Ende des ersten Werkzeugs (Register leer, Hauptzug läuft):
      // kein vorzeitiges Zugende, kein Flackern auf idle.
      const firstToolDone = async () => (await kinds(manager, record.id)).includes("session.activity_end");
      for (let i = 0; i < 200 && !(await firstToolDone()); i++) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 100));
      expect(manager.get(record.id)?.status, "Hauptzug läuft — Session bleibt working").toBe("working");
      expect((await kinds(manager, record.id)).filter((k) => k === "session.turn_end")).toHaveLength(0);
      // Das echte Zugende meldet genau ein turn_end — mit allem, was dazugehört.
      // BUG-0217: settle() setzt idle VOR dem turn_end-Event (Promise.then) —
      // auf das Ereignis warten, nicht auf den Status, sonst liest der Lauf
      // der Events zu früh (Hosted-Runner-Flake: Länge 0 statt 1).
      await waitFor(async () => (await kinds(manager, record.id)).some((k) => k === "session.turn_end"), "turn_end am echten Zugende");
      await waitFor(async () => (await kinds(manager, record.id)).some((k) => k === "session.main_turn_end"), "main_turn_end vorhanden");
      const all = await kinds(manager, record.id);
      expect(all.filter((k) => k === "session.turn_end")).toHaveLength(1);
      expect(all.indexOf("session.main_turn_end")).toBeLessThan(all.lastIndexOf("session.turn_end"));
      await waitFor(async () => manager.notifications().items.some((n) => n.kind === "session.turn_end"), "turn_end-Notification vorhanden");
      expect(manager.notifications().items.filter((n) => n.kind === "session.turn_end")).toHaveLength(1);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Hub-Neustart (K7): offene Aktivitäten kommen aus dem JSONL zurück", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const dbPath = join(dir, "hub.db");
    const store = new EventStore(dir);
    {
      const db = new HubDatabase(dbPath);
      const manager = new SessionManager(db, store, registry, new ProcessRunner());
      // BUG-0155-Kern: Der Zug ist fertig, nur die externe Arbeit hält die
      // Session `working` — nicht ein zur Crash-Zeit offener Zug (BUG-0165).
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "SOFORT_FERTIG" });
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle nach fertigem Zug");
      await manager.registerActivity(record.id, "Diagnose-Unit");
      expect(manager.get(record.id)?.status).toBe("working");
      db.close(); // K7: Hard-Kill — kein graceful shutdown, die Unit läuft weiter
    }
    // Gleiche Daten (SQLite-Datei + JSONL), neuer Manager = Hub-Neustart.
    const db2 = new HubDatabase(dbPath);
    const manager2 = new SessionManager(db2, store, registry, new ProcessRunner());
    try {
      await manager2.recoverAll();
      const [record] = manager2.list();
      expect(record?.status).toBe("working");
      const beginId = (await manager2.tail(record!.id, 0)).map((e) => (e.payload as { kind?: string; id?: string })).find((e) => e.kind === "session.activity_begin")?.id;
      expect(typeof beginId).toBe("string");
      // Ende nach dem Neustart wird angenommen und schließt den Lauf.
      expect(await manager2.endActivity(record!.id, beginId!, 0)).toBe(true);
      await waitFor(() => manager2.get(record!.id)?.status === "idle", "idle nach spätem Ende");
    } finally {
      await manager2.shutdown();
      db2.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("BUG-0165: Hub-Restart mit offener Provider-Aktivität wird interrupted, nicht dauerhaft working", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("openturn-activity", () => openTurnAdapter(true));
    const dbPath = join(dir, "hub.db");
    const store = new EventStore(dir);
    {
      const db = new HubDatabase(dbPath);
      const manager = new SessionManager(db, store, registry, new ProcessRunner());
      const record = await manager.create({ adapter: "openturn-activity", project: dir, prompt: "arbeit" });
      for (let i = 0; i < 250 && !(await kinds(manager, record.id)).includes("session.activity_begin"); i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(manager.get(record.id)?.status).toBe("working");
      db.close(); // K7: Hard-Kill — der Worker und seine Provider-Aktivität sterben mit dem Hub
    }
    const db2 = new HubDatabase(dbPath);
    const manager2 = new SessionManager(db2, store, registry, new ProcessRunner());
    try {
      await manager2.recoverAll();
      const [record] = manager2.list();
      // Der Zug ist abgeschnitten: interrupted statt dauerhaft working.
      expect(record?.status).toBe("interrupted");
      const all = await kinds(manager2, record!.id);
      expect(all).toContain("session.interrupted");
      expect(all).toContain("session.turn_end");
      // Die tote Provider-Aktivität ist ehrlich geschlossen — kein Eintrag bleibt offen.
      expect(all).toContain("session.activity_end");
      const beginId = (await manager2.tail(record!.id, 0)).map((e) => (e.payload as { kind?: string; id?: string })).find((e) => e.kind === "session.activity_begin")?.id;
      expect(await manager2.endActivity(record!.id, beginId!, 0)).toBe(false);
    } finally {
      await manager2.shutdown();
      db2.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("BUG-0165: abgeschnittener Zug mit externer Arbeit wird interrupted, die externe Arbeit bleibt offen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("openturn", () => openTurnAdapter(false));
    const dbPath = join(dir, "hub.db");
    const store = new EventStore(dir);
    {
      const db = new HubDatabase(dbPath);
      const manager = new SessionManager(db, store, registry, new ProcessRunner());
      const record = await manager.create({ adapter: "openturn", project: dir, prompt: "arbeit" });
      for (let i = 0; i < 250 && !(await kinds(manager, record.id)).includes("session.main_turn_start"); i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const job = await manager.registerActivity(record.id, "Diagnose-Unit");
      expect(job).not.toBeNull();
      db.close(); // K7: Hard-Kill — Zug weg, die externe Unit läuft weiter
    }
    const db2 = new HubDatabase(dbPath);
    const manager2 = new SessionManager(db2, store, registry, new ProcessRunner());
    try {
      await manager2.recoverAll();
      const [record] = manager2.list();
      expect(record?.status).toBe("interrupted");
      const all = await kinds(manager2, record!.id);
      expect(all).toContain("session.interrupted");
      // Die externe Arbeit läuft unabhängig weiter: Ihr Eintrag überlebt und
      // ihr spätes Ende wird angenommen (status bleibt interrupted — der
      // abgeschnittene Zug braucht eine Wiederaufnahme, kein stilles idle).
      const beginId = (await manager2.tail(record!.id, 0)).map((e) => (e.payload as { kind?: string; id?: string })).find((e) => e.kind === "session.activity_begin")?.id;
      expect(typeof beginId).toBe("string");
      expect(await manager2.endActivity(record!.id, beginId!, 0)).toBe(true);
      expect(manager2.get(record!.id)?.status).toBe("interrupted");
    } finally {
      await manager2.shutdown();
      db2.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("BUG-0209: ein beim Zugende offener Werkzeugaufruf hält die Session nicht auf working", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("open-activity", () => endsWithOpenActivity("tool:call_1", "tool"));
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "open-activity", project: dir, prompt: "start" });
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle trotz offenem Werkzeugaufruf");
      const all = await kinds(manager, record.id);
      expect(all).toContain("session.activity_end");
      expect(all).toContain("session.turn_end");
      expect(all).not.toContain("session.activity_pending");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("BUG-0209: ein beim Zugende offener Subagent bleibt dagegen Arbeit (ADR-0074)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("open-activity", () => endsWithOpenActivity("task:sub_1", "agent"));
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "open-activity", project: dir, prompt: "start" });
      await waitFor(() => manager.get(record.id) !== undefined, "Session da");
      for (let i = 0; i < 100 && !(await kinds(manager, record.id)).includes("session.activity_pending"); i++) await new Promise((r) => setTimeout(r, 20));
      expect(manager.get(record.id)?.status).toBe("working");
      expect(await kinds(manager, record.id)).toContain("session.activity_pending");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("BUG-0209: Recovery schließt einen nach dem Hauptzug verwaisten Werkzeugaufruf und setzt idle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    const out: { ctx?: Parameters<Adapter["start"]>[1] } = {};
    registry.register("open-activity", () => endsWithOpenActivity("tool:call_0", "tool", out));
    const dbPath = join(dir, "hub.db");
    const store = new EventStore(dir);
    {
      const db = new HubDatabase(dbPath);
      const manager = new SessionManager(db, store, registry, new ProcessRunner());
      const record = await manager.create({ adapter: "open-activity", project: dir, prompt: "start" });
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle");
      // Spätes Update nach dem Zugende — niemand meldet je sein Ende (Journal von 976960bb).
      out.ctx!.activity?.({ id: "tool:late", kind: "tool", state: "running", label: "spät" });
      await waitFor(() => manager.get(record.id)?.status === "working", "working durch spätes Werkzeug");
      db.close(); // Hard-Kill
    }
    const db2 = new HubDatabase(dbPath);
    const manager2 = new SessionManager(db2, store, registry, new ProcessRunner());
    try {
      await manager2.recoverAll();
      const [record] = manager2.list();
      expect(record?.status).toBe("idle");
      expect(await kinds(manager2, record!.id)).toContain("session.turn_end");
    } finally {
      await manager2.shutdown();
      db2.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("verspätetes Ende einer unbekannten Aktivität (alte Generation) wird ignoriert", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      const job = await manager.registerActivity(record.id, "Alter Job");
      await manager.endActivity(record.id!, job!.id);
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle");
      expect(await manager.endActivity(record.id!, job!.id, 0)).toBe(false); // doppelt/alte Generation
      expect(manager.get(record.id)?.status).toBe("idle");
      expect(await manager.registerActivity("gibts-nicht", "x")).toBeNull();
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Registrierung einer Aktivität an einer idle Session macht sie working", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      await manager.steer(record.id, { kind: "prompt", text: "mach" }); // Zug endet, keine Aktivität
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle nach Zug ohne Aktivität");
      const job = await manager.registerActivity(record.id, "Nacharbeit");
      expect(manager.get(record.id)?.status).toBe("working");
      await manager.endActivity(record.id!, job!.id);
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle nach Ende");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
