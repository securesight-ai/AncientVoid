import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { ApprovalService } from "../../../src/modules/approvals/index.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/** BUG-0048: „Freigabe nötig“ ohne offene Freigabe heilt sich selbst. */
function setup() {
  const ctxs = new Map<string, AdapterContext>();
  const adapter: Adapter = {
    id: "talky",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures() }),
    async start(_s, ctx) {
      ctxs.set(ctx.sessionId, ctx);
      return { sessionId: ctx.sessionId };
    },
    async recover(sessionId, _l, ctx) {
      ctxs.set(sessionId, ctx);
      await ctx.adoptWorker?.();
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
  const registry = new AdapterRegistry();
  registry.register("talky", () => adapter);
  return { registry, ctxs };
}
const waitFor = async (check: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor");
};
type Internals = { live: Map<string, { record: { status: string } }> };

describe("BUG-0048 waiting_approval ohne offene Freigabe", () => {
  it("geht bei Aktivität des Providers zurück auf working", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-heal-"));
    const { registry, ctxs } = setup();
    const db = new HubDatabase(":memory:");
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir });
      (sessions as unknown as Internals).live.get(rec.id)!.record.status = "waiting_approval"; // wie nach einem Neustart mitten in einer Freigabe
      ctxs.get(rec.id)!.emit({ type: "assistant", summary: "weiter gehts", payload: { text: "weiter gehts" } });
      await waitFor(() => sessions.get(rec.id)?.status === "working");
    } finally {
      await sessions.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bleibt bei einer wirklich offenen Tool-Freigabe auf waiting_approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-heal-open-"));
    const { registry, ctxs } = setup();
    const db = new HubDatabase(":memory:");
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    sessions.enableToolPermissions({ approvals: new ApprovalService(db), timeoutMs: 60_000 });
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir });
      const asked = await (sessions as unknown as { tools: { request(id: string, r: unknown): Promise<{ ok: boolean }> } }).tools.request(rec.id, { toolName: "Bash", input: { command: "ls" } });
      expect(asked.ok).toBe(true);
      expect(sessions.get(rec.id)?.status).toBe("waiting_approval");
      ctxs.get(rec.id)!.emit({ type: "assistant", summary: "parallele Ausgabe", payload: { text: "parallele Ausgabe" } });
      await new Promise((r) => setTimeout(r, 150));
      expect(sessions.get(rec.id)?.status).toBe("waiting_approval");
    } finally {
      await sessions.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("die Recovery setzt eine verwaiste Freigabe-Anzeige zurück (kein Zug überlebt: idle)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-heal-recover-"));
    const file = join(dir, "hub.db");
    const first = setup();
    const db1 = new HubDatabase(file);
    const s1 = new SessionManager(db1, new EventStore(dir), first.registry, new ProcessRunner());
    const rec = await s1.create({ adapter: "talky", project: dir });
    (s1 as unknown as Internals).live.get(rec.id)!.record.status = "waiting_approval";
    await s1.setMeta(rec.id, { pinned: false }); // schreibt den Zustand in die Datenbank
    await s1.shutdown({ keepWorkers: true });

    const second = setup();
    const s2 = new SessionManager(new HubDatabase(file), new EventStore(dir), second.registry, new ProcessRunner());
    try {
      expect(s2.get(rec.id)?.status).toBe("waiting_approval");
      await s2.recoverAll();
      expect(s2.get(rec.id)?.status).toBe("idle");
    } finally {
      await s2.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
