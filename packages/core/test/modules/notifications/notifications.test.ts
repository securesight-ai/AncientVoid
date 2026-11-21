import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "@ancientvoid/contracts";
import { basicFeatures } from "@ancientvoid/contracts";
import { providerErrorEvent } from "@ancientvoid/contracts";
import { notificationFor } from "../../../src/modules/notifications/index.ts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

/** One worker per turn; "LIMIT" makes the provider fail with a quota error. */
function provider(): Adapter {
  const turn = async (ctx: Parameters<Adapter["start"]>[1], text: string) => {
    if (text.includes("DOPPELT")) {
      ctx.emit(providerErrorEvent("fake", "Rate limit reached. Retrying after 60 seconds."));
      ctx.emit(providerErrorEvent("fake", "Usage limit reached for 5 hour. Your limit will reset at 2026-09-23 15:00:00"));
      const proc = await ctx.spawnWorker(["sh", "-c", "sleep 0.1; exit 1"]);
      proc.onExit((code) => ctx.emit({ type: "system", summary: `fake: process exited with code ${code}`, payload: { code } }));
      return;
    }
    if (text.includes("SERVER")) {
      ctx.emit(providerErrorEvent("fake", "Unexpected server error. Check server logs for details."));
      const proc = await ctx.spawnWorker(["sh", "-c", "sleep 0.1; exit 1"]);
      proc.onExit((code) => ctx.emit({ type: "system", summary: `fake: process exited with code ${code}`, payload: { code } }));
      return;
    }
    const proc = await ctx.spawnWorker(["sh", "-c", text.includes("LIMIT") ? "sleep 0.1; exit 1" : "sleep 0.1"]);
    if (text.includes("LIMIT")) {
      ctx.emit(providerErrorEvent("fake", "Usage limit reached for 5 hour. Your limit will reset at 2026-09-23 15:00:00"));
      proc.onExit((code) => ctx.emit({ type: "system", summary: `fake: process exited with code ${code}`, payload: { code } }));
    }
  };
  return {
    id: "fake",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(spec, ctx) {
      await turn(ctx, spec.prompt ?? "");
      return { sessionId: ctx.sessionId };
    },
    async steer(_h, input, ctx) {
      if (input.kind === "prompt") await turn(ctx, input.text);
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("notifications feed (ADR-0015)", () => {
  it("records errors, finished turns and approvals once, readable and in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-notif-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("fake", provider);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      await mkdir(join(dir, "tetris"));
      const record = await manager.create({ adapter: "fake", project: join(dir, "tetris"), prompt: "Hallo" });
      await waitFor(() => manager.notifications().items.length >= 1);
      await manager.steer(record.id, { kind: "prompt", text: "LIMIT bitte" });
      await waitFor(() => manager.notifications().items.some((n) => n.level === "error"));
      await new Promise((r) => setTimeout(r, 400));

      const { items, lastId } = manager.notifications();
      const titles = items.map((n) => `${n.level}: ${n.title}`);
      expect(titles).toEqual(["error: tetris · fake: Kontingent erschöpft (5 h)", "success: tetris · Zug fertig"]);
      expect(items[0]?.detail).toContain("2026-09-23 15:00:00");
      expect(items[0]).toMatchObject({ sessionId: record.id, kind: "provider.error" });

      const newer = manager.notifications(items[1]!.id);
      expect(newer.items.map((n) => n.id)).toEqual([items[0]!.id]);
      expect(lastId).toBe(items[0]!.id);

      // EPIC-P61 T61.7 / ADR-0101: messageKey + Params überleben Persistenz (K7);
      // der Catalog-Key ist nach dem Lesen noch da, die Titel-Fallbacks auch.
      expect(items[1]).toMatchObject({
        messageKey: "notification.turn_done",
        params: { project: "tetris" },
        title: "tetris · Zug fertig",
      });
      expect(items[0]!.messageKey).toBeUndefined();
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Fehler benennen erst beim Abbruch (Nutzerfund 2026-11-15)", () => {
  it("zwei Provider-Fehler in einem Lauf werden zu einer Meldung — die letzte mit Worten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-notif-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("fake", provider);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      await mkdir(join(dir, "tetris"));
      const record = await manager.create({ adapter: "fake", project: join(dir, "tetris"), prompt: "Hallo" });
      await waitFor(() => manager.notifications().items.length >= 1); // Zug 1 sauber beenden
      await manager.steer(record.id, { kind: "prompt", text: "DOPPELT bitte" });
      await waitFor(() => manager.notifications().items.some((n) => n.level === "error"));
      await new Promise((r) => setTimeout(r, 500));
      const errors = manager.notifications().items.filter((n) => n.level === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.title).toBe("tetris · fake: Kontingent erschöpft (5 h)");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ein Serverfehler, der abbricht, benennt die Ursache — ohne zweite Meldung", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-notif-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("fake", provider);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      await mkdir(join(dir, "tetris"));
      const record = await manager.create({ adapter: "fake", project: join(dir, "tetris"), prompt: "Hallo" });
      await waitFor(() => manager.notifications().items.length >= 1); // Zug 1 sauber beenden
      await manager.steer(record.id, { kind: "prompt", text: "SERVER bitte" });
      await waitFor(() => manager.notifications().items.some((n) => n.level === "error"));
      await new Promise((r) => setTimeout(r, 500));
      const after = manager.notifications().items.filter((n) => n.kind !== "session.turn_end");
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ level: "error", title: "tetris · fake: Serverfehler beim Provider" });
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Loop-Benachrichtigungen (EPIC-P19, AC-P19-2)", () => {
  const ev = (payload: Record<string, unknown>) => ({ seq: 1, ts: "t", sessionId: "s", type: "system", summary: "x", payload, blobRef: null }) as never;
  const ctx = { adapter: "loop:securesight-factory", project: "/p/securesight" };

  it("ein Halt für eine Person, eine Störung und eine Eskalation erreichen das Handy", () => {
    expect(notificationFor(ev({ kind: "loop.hold", reason: "Gates dreimal rot" }), ctx)).toEqual({ level: "warning", title: "securesight · Loop wartet auf dich", detail: "Gates dreimal rot", kind: "loop.hold", messageKey: "notification.loop_hold", params: { project: "securesight" } });
    expect(notificationFor(ev({ kind: "loop.broken", reason: "Watchdog ausgefallen" }), ctx)).toMatchObject({ level: "error", title: "securesight · Loop gestört", detail: "Watchdog ausgefallen" });
    expect(notificationFor(ev({ kind: "loop.notify", level: "2", reason: "gates-rot" }), ctx)).toMatchObject({ level: "warning", title: "securesight · Loop eskaliert (Stufe 2)" });
  });

  it("Routinemeldungen (Info, Fortschritt, Wiederherstellung) bleiben im Verlauf", () => {
    for (const kind of ["loop.info", "loop.progress", "loop.state", "loop.recovered", "loop.transcript"]) expect(notificationFor(ev({ kind }), ctx)).toBeNull();
  });

  it("Exit-Fallback greift nur für System-Events — Agent-Text ist nie Prozesswahrheit (BUG-0162)", () => {
    // Live-Fund 14.11.2026: Der Agent dachte über den Regex selbst nach und
    // feuerte so eine „abgebrochen (Code 0)“-Fehler-Notification.
    const ev = (type: string, summary: string) => ({ seq: 1, ts: "t", sessionId: "s", type, summary, payload: {}, blobRef: null }) as never;
    const ctx = { adapter: "opencode", project: "/p/av", recentProviderError: false };
    expect(notificationFor(ev("thinking", "der Adapter sagt process exited with code 0 im Text"), ctx)).toBeNull();
    expect(notificationFor(ev("assistant", "laut log: process exited with code 0"), ctx)).toBeNull();
    // Echte System-Events melden weiterhin einen Absturz.
    expect(notificationFor(ev("system", "opencode: process exited with code 3"), ctx)).toMatchObject({ level: "error", kind: "process.exit" });
  });
});

describe("Abbruch und blockierte Hintergrundarbeit (ADR-0015 Nachtrag 2026-11-15)", () => {
  const ev = (payload: Record<string, unknown>, summary = "x") => ({ seq: 1, ts: "t", sessionId: "s", type: "system", summary, payload, blobRef: null }) as never;
  const ctx = { adapter: "acp", project: "/p/galaxy" };

  it("ein mit Fehler abgebrochener Zug wird als Fehler benannt, mit Detail aus dem Register", () => {
    expect(notificationFor(ev({ kind: "session.turn_end", code: 1, reason: "error", detail: "Messlauf (systemd)" }), ctx)).toEqual({
      level: "error",
      title: "galaxy · Zug fehlgeschlagen",
      detail: "Messlauf (systemd)",
      kind: "session.turn_failed",
      messageKey: "notification.turn_failed",
      params: { project: "galaxy" },
    });
    expect(notificationFor(ev({ kind: "session.turn_end", code: 1, reason: "error" }), ctx)?.detail).toContain("Verlauf");
  });

  it("blockierte Wiederherstellung ist eine Fehler-Meldung", () => {
    expect(notificationFor(ev({ kind: "session.recovery_blocked", detail: "Hintergrundarbeit „X“ ist fehlgeschlagen." }), ctx)).toMatchObject({
      level: "error",
      title: "galaxy · Hintergrundarbeit fehlgeschlagen",
      kind: "session.recovery_blocked",
    });
  });

  it("Prozess-Ende und adapter.down bleiben Fehler in Worten — die Entfeinerung übernimmt recordNotifications", () => {
    expect(notificationFor(ev({ kind: "adapter.down", detail: "kein Lebenszeichen" }), ctx)).toMatchObject({ level: "error", title: "galaxy · acp antwortet nicht" });
    expect(notificationFor(ev({ kind: "x", code: 3 }, "acp: process exited with code 3"), ctx)).toMatchObject({ level: "error", title: "galaxy · acp abgebrochen (Code 3)", kind: "process.exit" });
  });
});

// EPIC-P61 T61.7 / ADR-0101: der Hub erzeugt Katalogschlüssel statt Prosadaten —
// title/detail bleiben als deutscher Fallback (Alt-Journal, Alt-Clients).
describe("EPIC-P61 T61.7: messageKey und Params für determinierte Texte", () => {
  const ev = (payload: Record<string, unknown>, summary = "x") => ({ seq: 1, ts: "t", sessionId: "s", type: "system", summary, payload, blobRef: null }) as never;
  const ctx = { adapter: "acp", project: "/p/galaxy" };

  it("Startfehler: Schlüssel mit Projekt- und Adapter-Param, deutscher Titel bleibt Fallback", () => {
    expect(notificationFor(ev({ kind: "session.start_failed", error: "boom" }), ctx)).toMatchObject({
      messageKey: "notification.start_failed",
      params: { project: "galaxy", adapter: "acp" },
      title: "galaxy · acp: Start fehlgeschlagen",
    });
  });

  it("Prozess-Ende: Code als Param — die Zahl ist Daten, der Satz ist Katalog", () => {
    expect(notificationFor(ev({ kind: "x", code: 3 }, "acp: process exited with code 3"), ctx)).toMatchObject({
      messageKey: "notification.process_exit",
      params: { project: "galaxy", adapter: "acp", code: "3" },
    });
  });

  it("dynamische Provider-Prosa bekommt keinen Schlüssel — sie bleibt Daten", () => {
    expect(notificationFor(ev({ kind: "provider.error", detail: "Rate limit" }, "Usage limit reached"), ctx)?.messageKey).toBeUndefined();
  });
});

