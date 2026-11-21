import { beforeEach, describe, expect, it } from "vitest";
import type { FleetHost, SessionRecord } from "../../../src/shared/api.ts";
import { getLastSession, isLastSession, rememberSession } from "../../../src/features/shell/last-session.ts";
import { clockText, countSessions, fleetSummary } from "../../../src/features/shell/status-summary.ts";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  store.set("ancientvoid.language", "de"); // Tests pinnen die Sprache (EPIC-P61)
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

const session = (status: string, archived = false) => ({ status, archived }) as SessionRecord;
const host = (state: FleetHost["state"], self = false) => ({ hostId: state, self, state }) as FleetHost;

describe("zuletzt aktive Session (T23.1)", () => {
  it("merkt sich lokale und Flotten-Sessions und liest sie zurück", () => {
    expect(getLastSession()).toBeNull();
    rememberSession({ sessionId: "a" });
    expect(getLastSession()).toEqual({ sessionId: "a" });
    rememberSession({ sessionId: "b", hostId: "gpubox" });
    expect(getLastSession()).toEqual({ sessionId: "b", hostId: "gpubox" });
  });

  it("ein leerer Aufruf überschreibt nichts, kaputter Speicher ergibt keine Auswahl", () => {
    rememberSession({ sessionId: "a" });
    rememberSession(null);
    expect(getLastSession()).toEqual({ sessionId: "a" });
    store.set("ancientvoid.lastSession", "{kaputt");
    expect(getLastSession()).toBeNull();
  });

  it("markiert nur dieselbe Session auf demselben Host", () => {
    const ref = { sessionId: "a", hostId: "gpubox" };
    expect(isLastSession(ref, "a", "gpubox")).toBe(true);
    expect(isLastSession(ref, "a", null)).toBe(false);
    expect(isLastSession({ sessionId: "a" }, "a", null)).toBe(true);
    expect(isLastSession(null, "a", null)).toBe(false);
  });
});

describe("Statusleiste (T23.2)", () => {
  it("zählt Sessions nach Zustand und lässt Archiviertes weg", () => {
    expect(countSessions([session("working"), session("starting"), session("waiting_approval"), session("error"), session("idle"), session("idle", true), session("stopped")])).toEqual({
      working: 2,
      waiting: 1,
      error: 1,
      idle: 1,
    });
  });

  it("fasst die Flotte zusammen: lokal, gesund, gestört", () => {
    expect(fleetSummary([host("reachable", true)])).toEqual({ text: "lokal", problem: false });
    expect(fleetSummary([host("reachable", true), host("reachable")])).toEqual({ text: "2 Hosts", problem: false });
    expect(fleetSummary([host("reachable", true), host("offline"), host("reachable")])).toEqual({ text: "1 von 2 Hosts gestört", problem: true });
  });

  it("zeigt den Stand der letzten Abfrage oder ehrlich 'nie'", () => {
    expect(clockText(null)).toBe("nie");
    expect(clockText(Date.parse("2026-10-28T12:00:00Z"))).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
