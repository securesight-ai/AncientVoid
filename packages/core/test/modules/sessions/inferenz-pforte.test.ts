import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext, type SteerInput } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";
import { createPforte } from "../../../src/modules/inference/index.ts";

/**
 * BUG-0272 (ADR-0116): zwei Sitzungen, ein Einzelslot-Modell (Strata). Ohne Pforte
 * schickte der Hub beide gleichzeitig in denselben KV-Kontext — die zweite bekam
 * "Kontext des Modells reicht nicht", und die erste musste neu vorbehandeln.
 * Mit Pforte bleibt die Meldung in der Warteschlange, und die Akte zeigt den Grund.
 */
function fakeAdapter() {
  const steered: { sessionId: string; input: SteerInput }[] = [];
  const ctxs = new Map<string, AdapterContext>();
  const adapter: Adapter = {
    id: "turny",
    version: "0.0.1",
    capabilities: () => ({
      reasoning: false,
      tools: false,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "none",
      features: basicFeatures({ followUp: true, interrupt: true }),
    }),
    async start(_spec, ctx) {
      ctxs.set(ctx.sessionId, ctx);
      return { sessionId: ctx.sessionId };
    },
    async steer(handle, input, ctx) {
      steered.push({ sessionId: ctx.sessionId, input });
      if (input.kind === "prompt") ctx.turn?.("working");
      return { ok: true };
    },
    async recover(sessionId, _lastSeq, ctx) {
      ctxs.set(sessionId, ctx);
      await ctx.adoptWorker?.();
      return { sessionId };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
  const registry = new AdapterRegistry();
  // Der Adapter bekommt denselben Modell-Hinweis wie in hub.config.json — daran
  // erkennt der Hub, welche Pforte für diese Sessions gilt.
  registry.register("turny", () => adapter, { model: "strata/qwen-test" });
  return { steered, registry, endTurn: (sessionId: string) => ctxs.get(sessionId)!.turn!("idle") };
}

async function waitFor(grund: string, check: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`waitFor: ${grund} — nicht erfüllt nach ${String(ms)} ms`);
}

const setup = async (leaseMs = 0) => {
  const dir = await mkdtemp(join(tmpdir(), "ancientvoid-pforte-"));
  const { steered, registry, endTurn } = fakeAdapter();
  const db = new HubDatabase(":memory:");
  const pforte = createPforte({ engines: [{ provider: "strata", slots: 1, leaseMs, maxWaitMs: 60_000 }] });
  const sessions = new SessionManager(
    db, new EventStore(dir), registry, new ProcessRunner(),
    undefined, undefined, undefined, null, [], {}, undefined, null, undefined, pforte,
  );
  return {
    dir, sessions, steered, endTurn, pforte,
    prompts: () => steered.filter((s) => s.input.kind === "prompt").map((s) => (s.input as { text: string }).text),
    done: async () => {
      await sessions.shutdown();
      await rm(dir, { recursive: true, force: true });
    },
  };
};

describe("BUG-0272: Pforte pro Modell-Endpoint", () => {
  it("hält den Endpoint für den laufenden Zug und formt den zweiten Zug zur Warteschlange", async () => {
    const f = await setup();
    try {
      const a = await f.sessions.create({ adapter: "turny", project: f.dir });
      const b = await f.sessions.create({ adapter: "turny", project: f.dir });
      f.endTurn(a.id);
      f.endTurn(b.id);
      await waitFor("beide idle", () => f.sessions.get(a.id)?.status === "idle" && f.sessions.get(b.id)?.status === "idle");

      expect(await f.sessions.steer(a.id, { kind: "prompt", text: "A1" }, "phone")).toMatchObject({ ok: true });
      await waitFor("A hält den Platz", () => f.pforte.zustand("strata")?.plaetze.length === 1);
      expect(f.pforte.zustand("strata")?.plaetze[0]?.inhaber).toBe(a.id);

      // B darf nicht in denselben Kontext: vormerken, mit Grund in der Akte.
      expect(await f.sessions.steer(b.id, { kind: "prompt", text: "B1" }, "phone")).toMatchObject({ ok: true, detail: "queued" });
      expect((await f.sessions.tail(b.id, 0)).some((e) => e.payload.kind === "inference.slot_wait")).toBe(true);
      expect(f.prompts()).toEqual(["A1"]);

      // A ist fertig: der Weckruf der Pforte lässt B an die Reihe kommen.
      f.endTurn(a.id);
      await waitFor("B1 kommt", () => f.prompts().includes("B1"), 8000);
      await waitFor("B hält den Platz", () => f.pforte.zustand("strata")?.plaetze.map((x) => x.inhaber)[0] === b.id);
      expect(f.sessions.queued(b.id)).toHaveLength(0);
    } finally {
      await f.done();
    }
  });

  it("ohne Pforten-Konfiguration läuft alles wie bisher (kein Deckel)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-pforte-ohne-"));
    const { steered, registry, endTurn } = fakeAdapter();
    const sessions = new SessionManager(
      new HubDatabase(":memory:"), new EventStore(dir), registry, new ProcessRunner(),
      undefined, undefined, undefined, null, [], {},
    );
    try {
      const a = await sessions.create({ adapter: "turny", project: dir });
      const b = await sessions.create({ adapter: "turny", project: dir });
      await sessions.steer(a.id, { kind: "prompt", text: "A1" }, "phone");
      expect(await sessions.steer(b.id, { kind: "prompt", text: "B1" }, "phone")).toMatchObject({ ok: true });
      expect(steered.filter((s) => s.input.kind === "prompt")).toHaveLength(2);
      endTurn(a.id);
      endTurn(b.id);
    } finally {
      await sessions.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("der Lease hält den Platz für die fertige Sitzung — ihr nächster Zug behält den KV", async () => {
    const f = await setup(200);
    try {
      const a = await f.sessions.create({ adapter: "turny", project: f.dir });
      const b = await f.sessions.create({ adapter: "turny", project: f.dir });
      f.endTurn(a.id);
      f.endTurn(b.id);
      await waitFor("beide idle", () => f.sessions.get(a.id)?.status === "idle" && f.sessions.get(b.id)?.status === "idle");
      await f.sessions.steer(a.id, { kind: "prompt", text: "A1" }, "phone");
      f.endTurn(a.id);
      await waitFor("Platz wieder leer", () => f.pforte.zustand("strata")?.plaetze.length === 0);

      // A will sofort weiterarbeiten: sie kommt vor B dran, obwohl B schon wartet.
      expect(await f.sessions.steer(b.id, { kind: "prompt", text: "B1" }, "phone")).toMatchObject({ ok: true, detail: "queued" });
      expect(await f.sessions.steer(a.id, { kind: "prompt", text: "A2" }, "phone")).toMatchObject({ ok: true });
      await waitFor("A2 kommt zuerst", () => f.prompts().includes("A2"), 6000);
      expect(f.prompts()).toEqual(["A1", "A2"]);
      // A gibt den Platz zurück: jetzt kommt B — der Lease war ein Vorrang, keine Sperre.
      f.endTurn(a.id);
      await waitFor("B1 nach A's Freigabe", () => f.prompts().includes("B1"), 6000);
      expect(f.prompts()).toEqual(["A1", "A2", "B1"]);
    } finally {
      await f.done();
    }
  });
});
