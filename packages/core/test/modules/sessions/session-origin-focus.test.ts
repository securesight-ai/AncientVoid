import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/** EPIC-P90 T90.2: Ursprung (immutable), Fokus-Anlässe und K7-Backfill aus dem Journal. */
function answering() {
  const ctxs = new Map<string, AdapterContext>();
  const adapter: Adapter = {
    id: "talky",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures() }),
    async start(_s, ctx) {
      ctxs.set(ctx.sessionId, ctx);
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
  const registry = new AdapterRegistry();
  registry.register("talky", () => adapter);
  return { registry, answer: (id: string, text: string) => ctxs.get(id)!.emit({ type: "assistant", summary: text, payload: { text } }) };
}

const setup = async () => {
  const dir = await mkdtemp(join(tmpdir(), "ancientvoid-origin-"));
  const db = new HubDatabase(":memory:");
  const { registry, answer } = answering();
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  return { dir, db, sessions, answer, done: async () => { await sessions.shutdown(); await rm(dir, { recursive: true, force: true }); } };
};

describe("EPIC-P90 T90.2: Ursprung und Fokus", () => {
  it("der Ursprung bleibt nach Umbenennung und Übergabe unverändert (AC-P90-1)", async () => {
    const { dir, sessions, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir, prompt: "Karte überarbeiten" });
      expect(sessions.get(rec.id)?.originIntent).toBe("Karte überarbeiten");
      await sessions.setMeta(rec.id, { title: "Anderer Fokus" });
      expect(sessions.get(rec.id)).toMatchObject({ title: "Anderer Fokus", originIntent: "Karte überarbeiten" });
      // Der Zielarm einer Übergabe erbt den Ursprung der Quelle — nicht den Übergabetext.
      const handed = await sessions.handover(rec.id, { adapter: "talky", prompt: "Druckerspeicher leeren" });
      expect(sessions.get(handed.id)?.originIntent).toBe("Karte überarbeiten");
      expect(sessions.get(handed.id)?.handoverFrom).toBe(rec.id);
    } finally {
      await done();
    }
  });

  it("eine abweichende Übergabe setzt den Fokus, eine thematisch gleiche nicht", async () => {
    const { dir, sessions, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir, prompt: "Karte überarbeiten" });
      const abweichend = await sessions.handover(rec.id, { adapter: "talky", prompt: "Druckerspeicher leeren" });
      expect(sessions.get(abweichend.id)?.focus).toMatchObject({ text: "Druckerspeicher leeren", source: "handoff" });
      expect(sessions.get(abweichend.id)?.title).toBe("Karte überarbeiten");
      // Wort-Overlap 2/3 ≥ 0,5: der Fokus der Quelle bleibt, kein Titel-Churn.
      const base = await sessions.create({ adapter: "talky", project: dir, prompt: "Karte überarbeiten" });
      const thematisch = await sessions.handover(base.id, { adapter: "talky", prompt: "Karte überarbeiten jetzt" });
      expect(sessions.get(thematisch.id)?.focus).toBeNull();
      expect(sessions.get(thematisch.id)?.title).toBe("Karte überarbeiten");
      expect(sessions.get(thematisch.id)?.originIntent).toBe("Karte überarbeiten");
    } finally {
      await done();
    }
  });

  it("vor-P90-Bestand: der Ursprung wird einmalig aus dem Journal geholt und danach nie überschrieben (K7)", async () => {
    const { dir, db, sessions, answer, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir, prompt: "Alter Auftrag: Karte überarbeiten" });
      answer(rec.id, "Erste Antwort");
      await sessions.steer(rec.id, { kind: "prompt", text: "Zweiter Auftrag: Druckerspeicher" });
      await sessions.stop(rec.id, "test");
      // Altbestand simulieren: die Spalte existiert nicht in alten Datensätzen.
      db.prepare("UPDATE sessions SET origin_intent = NULL WHERE id = ?").run(rec.id);
      const record = sessions.get(rec.id)!;
      expect(record.originIntent).toBeNull();
      expect(await sessions.sessionOrigin(record)).toBe("Alter Auftrag: Karte überarbeiten");
      expect(sessions.get(rec.id)?.originIntent).toBe("Alter Auftrag: Karte überarbeiten");
      // Der spätere Auftrag im Journal gewinnt nie — Immutability auch nach dem Backfill.
      await sessions.sessionOrigin(sessions.get(rec.id)!);
      db.prepare("UPDATE sessions SET origin_intent = NULL WHERE id = ?").run(rec.id);
      expect(await sessions.sessionOrigin(sessions.get(rec.id)!)).toBe("Alter Auftrag: Karte überarbeiten");
    } finally {
      await done();
    }
  });
});
