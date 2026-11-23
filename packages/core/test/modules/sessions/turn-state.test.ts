import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "@ancientvoid/contracts";
import { basicFeatures } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

/** Like every real CLI adapter: one worker process per turn. */
function oneProcessPerTurn(): Adapter {
  const spawnTurn = (ctx: Parameters<Adapter["start"]>[1], text: string) =>
    ctx.spawnWorker(["sh", "-c", text.includes("FAIL") ? "sleep 0.2; exit 3" : "sleep 0.2"]);
  return {
    id: "turns",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(spec, ctx) {
      if (spec.prompt?.includes("AGENT_ERROR")) ctx.emit({ type: "error", summary: "agent failed", payload: {} });
      await spawnTurn(ctx, spec.prompt ?? "");
      return { sessionId: ctx.sessionId };
    },
    async steer(_handle, input, ctx) {
      if (input.kind === "prompt") await spawnTurn(ctx, input.text);
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("turn state (T5.4)", () => {
  it("is working while a turn runs and idle between turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-turns-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("turns", oneProcessPerTurn);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "turns", project: dir, prompt: "eins" });
      expect(manager.get(record.id)?.status).toBe("working");
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle after first turn");

      expect((await manager.steer(record.id, { kind: "prompt", text: "zwei" })).ok).toBe(true);
      expect(manager.get(record.id)?.status).toBe("working");
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle after second turn");

      // idle is set just before the turn_end event is written — wait for it.
      const turnEnds = async () => (await manager.tail(record.id, 0)).filter((e) => (e.payload as { kind?: string }).kind === "session.turn_end");
      for (let i = 0; i < 100 && (await turnEnds()).length < 2; i++) await new Promise((r) => setTimeout(r, 20));
      expect(await turnEnds()).toHaveLength(2);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a worker cut off without an agent error becomes interrupted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-turns-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("turns", oneProcessPerTurn);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "turns", project: dir, prompt: "FAIL" });
      await waitFor(() => manager.get(record.id)?.status === "interrupted", "unexpected exit classified");
      expect(manager.get(record.id)?.status).toBe("interrupted");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("after a failed turn in error state, the next prompt runs again (ADR-0015)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-turns-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("turns", () => ({ ...oneProcessPerTurn(), status: async () => ({ state: "down" as const }) }));
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "turns", project: dir, prompt: "FAIL AGENT_ERROR" });
      await waitFor(() => manager.get(record.id)?.status === "error", "agent failure classified");
      await manager.runHeartbeat();
      expect(manager.get(record.id)?.status).toBe("error");
      expect((await manager.steer(record.id, { kind: "prompt", text: "nochmal" })).ok).toBe(true);
      expect(manager.get(record.id)?.status).toBe("working");
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle after the retry");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a planned shutdown that keeps workers leaves sessions as they are", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-turns-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    let stops = 0;
    registry.register("turns", () => ({ ...oneProcessPerTurn(), stop: async () => void stops++ }));
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
    const record = await manager.create({ adapter: "turns", project: dir, prompt: "eins" });
    // BUG-0218: unter parallelen Forks kann die Working-Markierung nach
    // create() noch anstehen — warten statt einmalig lesen.
    await waitFor(() => manager.get(record.id)?.status === "working", "working nach create");
    await manager.shutdown({ keepWorkers: true });
    expect(manager.get(record.id)?.status).toBe("working");
    expect(stops).toBe(0);
    expect((await manager.tail(record.id, 0)).some((e) => (e.payload as { kind?: string }).kind === "session.stopped")).toBe(false);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
