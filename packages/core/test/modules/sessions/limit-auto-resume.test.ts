import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext, type AdapterResume, type WorkerProcess, type WorkerRunner } from "@ancientvoid/contracts";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager } from "../../../src/index.ts";

/**
 * ADR-0076 Nachtrag (Limit-Wiederaufnahme): Starb ein Zug am Kontingent-/
 * Rate-Limit des Providers, entscheidet der Mensch pro Session, ob der Hub
 * nach dem Freigabefenster automatisch weitermacht. Ohne die Option bleibt
 * alles beim Bestandsverhalten: sichtbar `error`, manuell weiter.
 */

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

const resume: AdapterResume = { argv: ["test", "--resume", "{sessionId}"], ref: "native", hub: true, auto: true };

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "av-limit-"));
  const db = new HubDatabase(join(dir, "hub.db"));
  const store = new EventStore(dir);
  let ctx!: AdapterContext;
  let starts = 0;
  const runner: WorkerRunner = {
    kind: "test", isAvailable: async () => true, list: async () => [], reapOrphans: async () => [], killByName: async () => {},
    async spawn() {
      const proc: WorkerProcess = { onStdout() {}, onStderr() {}, onExit() {}, write() {}, kill: async () => {}, exited: async () => ({ code: null }) };
      return proc;
    },
  };
  const adapter: Adapter = {
    id: "limit-test", version: "1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, usage: false, steer: true, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }), resume }),
    async start(spec, context) {
      starts++;
      ctx = context;
      ctx.emit({ type: "system", summary: "native id", payload: { nativeSessionId: "native-123" } });
      if (!spec.args?.resumeSessionId) await ctx.spawnWorker(["test-worker"], { persistent: true });
      return { sessionId: ctx.sessionId };
    },
    steer: async () => ({ ok: true }), status: async () => ({ state: "healthy" }), stop: async () => {},
  };
  const registry = new AdapterRegistry();
  registry.register(adapter.id, () => adapter);
  const manager = new SessionManager(db, store, registry, runner);
  cleanup.push(async () => { await manager.shutdown({ keepWorkers: true }); db.close(); await rm(dir, { recursive: true, force: true }); });
  const record = await manager.create({ adapter: adapter.id, project: dir, prompt: "arbeit" });
  const events = () => manager.tail(record.id, 0);
  const wait = async (check: () => Promise<boolean> | boolean, what: string) => {
    for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error(`timed out: ${what}`);
  };
  // Ein Zug, der am Limit stirbt: provider.error (Kontingent) plus der
  // strukturierte Fensterstand, wie Claude ihn liefert (ADR-0004). Das
  // Warten auf das Journal ist bewusst: ctx.emit ist fire-and-forget, und
  // die Klassifizierung des Zugendes (Worker-Pfad: 250-ms-Settle-Fenster)
  // darf das Fehler-Event nicht verpassen — ein echter Adapter awaited
  // seine Ausgaben, bevor er das Zugende meldet.
  const failWith = async (category: string, resetsAt: string | null) => {
    ctx.emit({
      type: "system", summary: "Fehler", payload: { kind: "provider.error", category },
      ...(resetsAt !== null ? { usageQuota: { windows: [{ id: "five_hour", utilization: 1.03, resetsAt }] } } : {}),
    });
    for (let i = 0; i < 100 && !(await events()).some((e) => e.payload.kind === "provider.error"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    ctx.turn?.("idle");
  };
  const hitLimit = (resetsAt: string | null) => failWith("quota", resetsAt);
  return { manager, record, events, wait, hitLimit, failWith, starts: () => starts, dir };
}

describe("Limit-Wiederaufnahme (ADR-0076 Nachtrag)", () => {
  it("ohne Option bleibt ein Kontingent-Fehler ehrlich error", async () => {
    const f = await fixture();
    await f.hitLimit(inAnHour());
    await f.wait(async () => f.manager.get(f.record.id)?.status === "error", "error ohne Option");
    expect(f.starts()).toBe(1);
    expect((await f.events()).some(e => e.payload.kind === "session.interrupted")).toBe(false);
  });

  it("mit Option wird der Kontingent-Fehler interrupted mit Freigabezeit — und wartet still", async () => {
    const f = await fixture();
    await f.manager.setAutoResumeOnLimit(f.record.id, true, "phone");
    await f.hitLimit(inAnHour());
    // Status und Journal können auseinanderlaufen (emit fire-and-forget) —
    // erst auf das Interrupt-Event warten, sonst flake in CI unter Last.
    await f.wait(async () => {
      if (f.manager.get(f.record.id)?.status !== "interrupted") return false;
      return (await f.events()).some((e) => e.payload.kind === "session.interrupted");
    }, "interrupted mit Option");
    const interrupt = (await f.events()).findLast(e => e.payload.kind === "session.interrupted");
    expect(interrupt?.payload).toMatchObject({ reason: "provider_limit", limit: true, autoResumeEligible: true });
    expect(typeof interrupt?.payload.resumesAt).toBe("string");
    // Fenster läuft: kein Resume-Versuch, kein verbrauchter Attempt.
    await new Promise((r) => setTimeout(r, 600));
    expect(f.starts()).toBe(1);
    expect((await f.events()).some(e => e.payload.kind === "session.auto_resume_attempt")).toBe(false);
    // Freigabezeit erreicht → Heartbeat nimmt die Wiederaufnahme auf.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3_700_000);
      f.manager.runHeartbeat();
      await f.wait(async () => f.starts() === 2, "Resume nach Freigabe");
    } finally { vi.useRealTimers(); }
    expect((await f.events()).some(e => e.payload.kind === "session.auto_resume_attempt")).toBe(true);
  });

  it("ohne Fensterangabe des Providers bleibt es bei einer sichtbaren Klärung", async () => {
    const f = await fixture();
    await f.manager.setAutoResumeOnLimit(f.record.id, true, "phone");
    await f.hitLimit(null);
    await f.wait(async () => f.manager.get(f.record.id)?.status === "interrupted", "interrupted ohne Fenster");
    await f.wait(async () => (await f.events()).some(e => e.payload.kind === "session.recovery_blocked"), "recovery_blocked");
    expect(f.starts()).toBe(1);
    expect(String((await f.events()).findLast(e => e.payload.kind === "session.recovery_blocked")?.payload.detail)).toContain("keine Freigabezeit");
  });

  it("die Option an einer error-Session überführt den Limit-Fehler in die Wartestellung", async () => {
    const f = await fixture();
    await f.hitLimit(anHourAgo()); // Fenster ist frei: Freigabe liegt in der Vergangenheit
    await f.wait(async () => f.manager.get(f.record.id)?.status === "error", "error vor Option");
    await f.manager.setAutoResumeOnLimit(f.record.id, true, "phone");
    await f.wait(async () => f.manager.get(f.record.id)?.status === "interrupted", "interrupted nach Option");
    await f.wait(async () => f.starts() === 2, "automatische Fortsetzung");
    expect((await f.events()).some(e => e.payload.kind === "session.resumed")).toBe(true);
  });

  it("ein Nicht-Limit-Fehler wird durch die Option nicht zur Wiederaufnahme", async () => {
    const f = await fixture();
    await f.failWith("auth", null);
    await f.wait(async () => f.manager.get(f.record.id)?.status === "error", "error nach Auth-Fehler");
    await f.manager.setAutoResumeOnLimit(f.record.id, true, "phone");
    // Kein Limit-Fehler im Zug → keine Überführung in die Wartestellung.
    expect(f.manager.get(f.record.id)?.status).toBe("error");
    expect((await f.events()).some(e => e.payload.kind === "session.interrupted")).toBe(false);
    expect(f.starts()).toBe(1);
  });

  it("Agenten dürfen die Option nicht schalten", async () => {
    const f = await fixture();
    await expect(f.manager.setAutoResumeOnLimit(f.record.id, true, "agent:smith")).rejects.toThrow("Nur Menschen");
  });
});
