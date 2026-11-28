import { describe, expect, it } from "vitest";
import { askTitleModel, cleanModelTitle } from "../../../src/modules/sessions/session-title.ts";

/** EPIC-P15 T15.5: der KI-Titel — kurz, nur aus Prompt und erster Antwort. */
const reply = (content: string, ok = true) =>
  (async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content } }] }) })) as unknown as typeof fetch;

describe("cleanModelTitle", () => {
  it("nimmt die erste Zeile, ohne Anführungszeichen, Markdown und Schlusspunkt", () => {
    expect(cleanModelTitle('"Settings-Seite verbessern."')).toBe("Settings-Seite verbessern");
    expect(cleanModelTitle("**Epic für Settings**\nWeitere Erklärung")).toBe("Epic für Settings");
    expect(cleanModelTitle("Titel: Login reparieren")).toBe("Login reparieren");
    expect(cleanModelTitle("<think>überlege</think>Login reparieren")).toBe("Login reparieren");
  });
  it("verwirft Leeres und Zu-Langes statt es zu raten", () => {
    expect(cleanModelTitle("")).toBeNull();
    expect(cleanModelTitle("   \n  ")).toBeNull();
    expect(cleanModelTitle("x ".repeat(80))).toBeNull();
  });
});

describe("askTitleModel", () => {
  it("fragt mit gekürztem Prompt und Antwort und liefert den bereinigten Titel", async () => {
    let body: { messages: { content: string }[]; max_tokens: number } | null = null;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Worktree-Hygiene planen" } }] }) };
    }) as unknown as typeof fetch;
    const title = await askTitleModel({ url: "http://m", model: "x", fetch: fetchFn }, "p".repeat(2000), "a".repeat(2000));
    expect(title).toBe("Worktree-Hygiene planen");
    const user = body!.messages.find((m) => m.content.includes("pppp"))!.content;
    expect(user.length).toBeLessThan(1200); // nichts Großes verlässt den Hub
  });

  it("ein Fehler des Modells ist null, kein Wurf", async () => {
    expect(await askTitleModel({ url: "http://m", model: "x", fetch: reply("", false) }, "p", "a")).toBeNull();
    const boom = (async () => {
      throw new Error("netz weg");
    }) as unknown as typeof fetch;
    expect(await askTitleModel({ url: "http://m", model: "x", fetch: boom }, "p", "a")).toBeNull();
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/** Ein Adapter, der auf Zuruf antwortet. */
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
  const answer = (id: string, text: string) => ctxs.get(id)!.emit({ type: "assistant", summary: text, payload: { text } });
  return { registry, answer };
}
const waitFor = async (check: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor");
};

describe("EPIC-P15 T15.5: KI-Titel am SessionManager", () => {
  const modelWith = (title: string, calls: { n: number }) => ({
    url: "http://m",
    model: "x",
    fetch: (async () => {
      calls.n++;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: title } }] }) };
    }) as unknown as typeof fetch,
  });
  const setup = async (title: string, calls: { n: number }) => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-aititle-"));
    const { registry, answer } = answering();
    const sessions = new SessionManager(new HubDatabase(":memory:"), new EventStore(dir), registry, new ProcessRunner());
    sessions.enableAiTitles(modelWith(title, calls));
    return { dir, sessions, answer, done: async () => { await sessions.shutdown(); await rm(dir, { recursive: true, force: true }); } };
  };

  it("ersetzt den Prompt-Titel nach der ersten Antwort, einmal, und merkt sich die Herkunft", async () => {
    const calls = { n: 0 };
    const { dir, sessions, answer, done } = await setup("Settings-Seite verbessern", calls);
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir, prompt: "Kannst du ein neues Epic erstellen, um die settings Seite zu verbessern?" });
      expect(rec.title).toBe("Ein neues Epic erstellen, um die settings Seite zu verbessern");
      expect(rec.originIntent).toBe("Kannst du ein neues Epic erstellen, um die settings Seite zu verbessern?");
      expect(rec.titleSource).toBe("auto");
      answer(rec.id, "Ich lege das Epic an …");
      await waitFor(() => sessions.get(rec.id)?.titleSource === "ai");
      expect(sessions.get(rec.id)).toMatchObject({ title: "Settings-Seite verbessern", titleSource: "ai" });
      expect(sessions.get(rec.id)?.originIntent).toBe(rec.originIntent);
      answer(rec.id, "Zweite Antwort");
      await new Promise((r) => setTimeout(r, 80));
      expect(calls.n).toBe(1); // nur einmal gefragt
      const event = (await sessions.tail(rec.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "session.titled");
      expect(event?.payload).toMatchObject({ title: "Settings-Seite verbessern", source: "ai" });
    } finally {
      await done();
    }
  });

  it("ein von Hand gesetzter Titel wird nie überschrieben", async () => {
    const calls = { n: 0 };
    const { dir, sessions, answer, done } = await setup("KI-Titel", calls);
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir, prompt: "Mach etwas" });
      await sessions.setMeta(rec.id, { title: "Mein eigener Titel" });
      expect(sessions.get(rec.id)).toMatchObject({ title: "Mein eigener Titel", titleSource: "manual",
        originIntent: "Mach etwas", focus: { text: "Mein eigener Titel", source: "manual" } });
      answer(rec.id, "Antwort");
      await new Promise((r) => setTimeout(r, 120));
      expect(calls.n).toBe(0);
      expect(sessions.get(rec.id)?.title).toBe("Mein eigener Titel");
    } finally {
      await done();
    }
  });

  it("wird der Titel während der Anfrage umbenannt, gewinnt die Person", async () => {
    const calls = { n: 0 };
    const { dir, sessions, answer, done } = await setup("KI-Titel", calls);
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir, prompt: "Mach etwas" });
      answer(rec.id, "Antwort");
      await sessions.setMeta(rec.id, { title: "Von Hand" }); // direkt danach, vor der Modellantwort
      await new Promise((r) => setTimeout(r, 120));
      expect(sessions.get(rec.id)).toMatchObject({ title: "Von Hand", titleSource: "manual" });
    } finally {
      await done();
    }
  });

  it("ohne Modell oder bei unbrauchbarer Antwort bleibt der Prompt-Titel", async () => {
    const calls = { n: 0 };
    const none = await setup("", calls);
    try {
      const rec = await none.sessions.create({ adapter: "talky", project: none.dir, prompt: "Baue ein Tetris" });
      none.answer(rec.id, "Antwort");
      await new Promise((r) => setTimeout(r, 120));
      expect(none.sessions.get(rec.id)).toMatchObject({ title: "Baue ein Tetris", titleSource: "auto" });
    } finally {
      await none.done();
    }
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-aititle-off-"));
    const { registry, answer } = answering();
    const sessions = new SessionManager(new HubDatabase(":memory:"), new EventStore(dir), registry, new ProcessRunner());
    try {
      const rec = await sessions.create({ adapter: "talky", project: dir, prompt: "Baue ein Tetris" });
      answer(rec.id, "Antwort");
      await new Promise((r) => setTimeout(r, 80));
      expect(sessions.get(rec.id)?.titleSource).toBe("auto");
    } finally {
      await sessions.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
