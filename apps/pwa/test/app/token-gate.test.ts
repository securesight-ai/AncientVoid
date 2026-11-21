import { beforeEach, describe, expect, it } from "vitest";

const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
});

const { classifyGateError, gateMessage, lastHubContact, noteHubContact } = await import("../../src/app/token-gate.ts");

beforeEach(() => {
  mem.clear();
  mem.set("ancientvoid.language", "de"); // Tests pinnen die Sprache (EPIC-P61)
});

describe("Token-Gate: Ursache je Fall (AC-P57-8)", () => {
  it("401/403 heißt abgelehnt, fehlender Status und 502–504 heißt unerreichbar, sonst anderer Fehler", () => {
    expect(classifyGateError(Object.assign(new Error("unauthorized"), { status: 401 }))).toBe("rejected");
    expect(classifyGateError(Object.assign(new Error("forbidden"), { status: 403 }))).toBe("rejected");
    expect(classifyGateError(new TypeError("Failed to fetch"))).toBe("unreachable");
    expect(classifyGateError(Object.assign(new Error("503"), { status: 503 }))).toBe("unreachable");
    expect(classifyGateError(Object.assign(new Error("boom"), { status: 500 }))).toBe("other");
  });

  it("jede Meldung ist eigen und nennt den nächsten Schritt", () => {
    const empty = gateMessage("empty", "");
    const rejected = gateMessage("rejected", "401");
    const unreachable = gateMessage("unreachable", "Failed to fetch");
    expect(new Set([empty, rejected, unreachable]).size).toBe(3);
    expect(empty).toMatch(/setup\.sh|hubctl token issue/);
    expect(rejected).toMatch(/abgelehnt/);
    expect(rejected).toMatch(/hubctl token issue/);
    expect(unreachable).toMatch(/nicht erreichbar/);
    expect(unreachable).toMatch(/hub\.sh status/);
    expect(gateMessage("other", "kaputt")).toContain("kaputt");
  });

  it("unerreichbar nennt die letzte Verbindung als Zeitstempel (K10), sofern bekannt", () => {
    const at = "2026-11-13T08:30:00.000Z";
    expect(gateMessage("unreachable", "", at)).toMatch(new Date(at).toLocaleString("de-DE"));
    expect(gateMessage("unreachable", "", null)).not.toMatch(/Letzte Verbindung/);
    expect(gateMessage("unreachable", "", "kein-datum")).not.toMatch(/Letzte Verbindung/);
  });

  it("keine Meldung trägt ein Token oder eine URL mit Token (PRD §8)", () => {
    for (const p of ["empty", "rejected", "unreachable", "other"] as const) expect(gateMessage(p, "x")).not.toMatch(/token=|[?&#]t=|Bearer/i);
  });
});

describe("Token-Gate: letzte Verbindung", () => {
  it("wird gemerkt, aber höchstens einmal je Minute überschrieben", () => {
    const t0 = new Date("2026-11-13T10:00:00Z");
    noteHubContact(t0);
    noteHubContact(new Date(t0.getTime() + 30_000));
    expect(lastHubContact()).toBe(t0.toISOString());
    const later = new Date(t0.getTime() + 61_000);
    noteHubContact(later);
    expect(lastHubContact()).toBe(later.toISOString());
  });
});
