import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Ack, type Adapter, type AdapterContext, type SteerInput } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/**
 * EPIC-P17 T17.4 (AC-P17-3): der Submit-Wait des Hubs ist hart begrenzt,
 * und ein Timeout beweist nichts — dieselbe inputId wird nie zweimal
 * gesendet. `gated` beantwortet einen Prompt erst, wenn der Test ihn
 * freigibt; `turny` meldet „working“ erst nach einer Verzögerung.
 */

// BUG-0163: Drain-/Pinning-Fenster ist hardware-abhängig — auf gemieteten
// Runnern verlor der Pinning schon im GitLab-Quartett zeitweise (Läufe
// schwanken); GitHub-Runner trafen ihn im main-Lauf vom 16.11. Dort
// sichtbar geskippt, im lokalen Gate Pflicht.
const HOSTED_RUNNER = process.env.AV_HOSTED_RUNNER === "1";
function gatedAdapter() {
  const steered: SteerInput[] = [];
  const gates: ((ack: Ack) => void)[] = [];
  const adapter: Adapter = {
    id: "gated",
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
    async start(_spec, _ctx) {
      return { sessionId: _ctx.sessionId };
    },
    async steer(_handle, input, _ctx) {
      steered.push(input);
      return new Promise<Ack>((resolve) => gates.push(resolve));
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
  const registry = new AdapterRegistry();
  registry.register("gated", () => adapter);
  return {
    registry,
    prompts: () => steered.filter((s) => s.kind === "prompt").map((s) => (s as { text: string }).text),
    /** Der Adapter nimmt den ältesten wartenden Prompt an / lehnt ihn ab. */
    accept: () => gates.shift()?.({ ok: true }),
    refuse: () => gates.shift()?.({ ok: false, detail: "kaputt" }),
  };
}

/** Wie ein Spawn-Adapter: der Status-Flip auf „working“ hinkt hinterher —
 * genau das Fenster, in dem ein Queue-Drain den falschen Zug treffen konnte. */
function laggingTurnAdapter(delayMs: number) {
  const steered: SteerInput[] = [];
  const ctxs = new Map<string, AdapterContext>();
  const adapter: Adapter = {
    id: "turny2",
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
    async steer(_handle, input, ctx) {
      steered.push(input);
      if (input.kind !== "prompt") return { ok: true };
      return new Promise<Ack>((resolve) => {
        setTimeout(() => {
          ctx.turn?.("working");
          resolve({ ok: true });
        }, delayMs);
      });
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
  const registry = new AdapterRegistry();
  registry.register("turny2", () => adapter);
  const endTurn = (sessionId: string) => ctxs.get(sessionId)!.turn!("idle");
  return { registry, endTurn, prompts: () => steered.filter((s) => s.kind === "prompt").map((s) => (s as { text: string }).text) };
}

const kinds = async (sessions: SessionManager, id: string) =>
  (await sessions.tail(id, 0)).map((e) => (e.payload as { kind?: string }).kind).filter(Boolean);

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor: Bedingung nicht erfüllt");
}

async function setup(registry: AdapterRegistry, steerWaitMs: number) {
  const dir = await mkdtemp(join(tmpdir(), "ancientvoid-steerwait-"));
  const db = new HubDatabase(":memory:");
  const store = new EventStore(dir);
  const sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, null, [], { steerWaitMs });
  const done = async () => {
    await sessions.shutdown();
    db.close();
    // Ein zuletzt zugestellter Eintrag journalisiert queue_ack/dequeued noch nach
    // dem Testende (Adapter-Ack nach 60 ms) — rm darf das abwarten statt ENOTEMPTY.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  return { sessions, store, done };
}

describe("Steer-Wait-Timeout (AC-P17-3)", () => {
  it("ein hängender Prompt endet mit Timeout-Ack und sichtbarem Event — dieselbe inputId wird nie zweimal gesendet", async () => {
    const { registry, prompts, refuse } = gatedAdapter();
    const { sessions, done } = await setup(registry, 80);
    try {
      const rec = await sessions.create({ adapter: "gated", project: process.cwd() });
      const first = await sessions.steer(rec.id, { kind: "prompt", text: "einmal bitte" }, "phone", { inputId: "in-1" });
      expect(first.ok).toBe(false);
      expect(first.detail).toMatch(/steer timeout/);
      expect(await kinds(sessions, rec.id)).toContain("session.steer_timeout");

      const retry = await sessions.steer(rec.id, { kind: "prompt", text: "einmal bitte" }, "phone", { inputId: "in-1" });
      expect(retry.ok).toBe(false);
      expect(retry.detail).toMatch(/in flight/);
      expect(prompts()).toEqual(["einmal bitte"]); // genau eine Submission
      refuse(); // aufräumen: der hängende Attempt wird abgelehnt
    } finally {
      await done();
    }
  });

  it("nimmt der verspätete Attempt doch an, wird die inputId nachgetragen — der nächste Retry ist „duplicate input ignored“", async () => {
    const { registry, prompts, accept } = gatedAdapter();
    const { sessions, done } = await setup(registry, 80);
    try {
      const rec = await sessions.create({ adapter: "gated", project: process.cwd() });
      const first = await sessions.steer(rec.id, { kind: "prompt", text: "einmal bitte" }, "phone", { inputId: "in-1" });
      expect(first.ok).toBe(false);

      accept(); // der Adapter bestätigt verspätet
      await waitFor(() => sessions.get(rec.id)?.inputRevision === 1);

      const late = await sessions.steer(rec.id, { kind: "prompt", text: "einmal bitte" }, "phone", { inputId: "in-1" });
      expect(late).toEqual({ ok: true, detail: "duplicate input ignored" });
      expect(prompts()).toEqual(["einmal bitte"]);
    } finally {
      await done();
    }
  });

  it("lehnt der verspätete Attempt ab, ist derselbe inputId wieder erlaubt", async () => {
    const { registry, prompts, accept, refuse } = gatedAdapter();
    const { sessions, done } = await setup(registry, 80);
    try {
      const rec = await sessions.create({ adapter: "gated", project: process.cwd() });
      const first = await sessions.steer(rec.id, { kind: "prompt", text: "einmal bitte" }, "phone", { inputId: "in-1" });
      expect(first.ok).toBe(false);

      refuse(); // nachweislich nicht angekommen
      await waitFor(() => prompts().length === 1); // Freigabe braucht einen Tick
      await new Promise((r) => setTimeout(r, 25));

      const retry = await sessions.steer(rec.id, { kind: "prompt", text: "einmal bitte" }, "phone", { inputId: "in-1" });
      expect(retry.ok).toBe(false); // neuer Versuch — hängt wieder im Adapter
      expect(retry.detail).toMatch(/steer timeout/);
      expect(prompts()).toEqual(["einmal bitte", "einmal bitte"]);
      accept();
    } finally {
      await done();
    }
  });

  it.skipIf(HOSTED_RUNNER)("Occupant-Pinning: ein vorgemerkter Prompt wartet auf das Ende des Zugs, der während des Drains begann", async () => {
    const { registry, endTurn, prompts } = laggingTurnAdapter(60);
    const { sessions, done } = await setup(registry, 5_000);
    try {
      const rec = await sessions.create({ adapter: "turny2", project: process.cwd() });
      expect(sessions.get(rec.id)?.status).toBe("working");
      await sessions.steer(rec.id, { kind: "prompt", text: "danach bitte" }, "jan", { queue: true });
      expect(sessions.queued(rec.id)).toHaveLength(1);

      endTurn(rec.id); // idle → Drain geplant …
      const slow = sessions.steer(rec.id, { kind: "prompt", text: "schneller neuer Zug" }); // … und im selben Tick beginnt ein neuer Prompt-Steer
      await slow;
      await new Promise((r) => setTimeout(r, 200));

      // Der Eintrag wartet auf das Ende des NEUEN Zugs — rot vor dem Patch
      // nahm ihn der alte Drain mit und sendete ihn in den laufenden Zug.
      expect(prompts()).toEqual(["schneller neuer Zug"]);

      endTurn(rec.id);
      await waitFor(() => prompts().length === 2);
      expect(prompts()).toEqual(["schneller neuer Zug", "danach bitte"]);
    } finally {
      await done();
    }
  });

  it("BUG-0286: langsames Journal hinter turn(working) lässt nichts Vorgemerktes in den laufenden Zug", async () => {
    const { registry, endTurn, prompts } = laggingTurnAdapter(60);
    const { sessions, store, done } = await setup(registry, 5_000);
    const append = store.append.bind(store);
    store.append = async (id, events) => {
      if (events.some((e) => e.payload.kind === "session.main_turn_start")) await new Promise((r) => setTimeout(r, 150));
      return append(id, events);
    };
    try {
      const rec = await sessions.create({ adapter: "turny2", project: process.cwd() });
      await sessions.steer(rec.id, { kind: "prompt", text: "danach bitte" }, "jan", { queue: true });
      endTurn(rec.id);
      await sessions.steer(rec.id, { kind: "prompt", text: "schneller neuer Zug" });
      await new Promise((r) => setTimeout(r, 400));
      expect(prompts()).toEqual(["schneller neuer Zug"]);
      endTurn(rec.id);
      await waitFor(() => prompts().length === 2);
      expect(prompts()).toEqual(["schneller neuer Zug", "danach bitte"]);
    } finally {
      await done();
    }
  });
});
