import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isYesNo, nyxSentence, nyxSummary, recommendedOption, type NyxInput } from "../../src/features/nyx/nyx-state.ts";
import { setLanguageSetting } from "../../src/shared/i18n/index.ts";

function fakeStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

// Bestands-Tests festigen Deutsch (EPIC-P61); der T61.9-Fall setzt en selbst.
beforeEach(() => {
  fakeStorage();
  setLanguageSetting("de");
});
afterEach(() => vi.unstubAllGlobals());

const base: NyxInput = { online: true, sessions: [], pendingApprovals: 0, questionSessions: [] };
const s = (id: string, status: string, archived = false) => ({ id, status, archived });

describe("nyxSummary (EPIC-P43 T43.8, Priorität VoidWarden §5.1)", () => {
  it("offline schlägt alles", () => {
    expect(nyxSummary({ ...base, online: false, sessions: [s("a", "waiting_approval")], pendingApprovals: 1 }).state).toBe("offline");
  });

  it("Freigabe vor Frage vor Fehler vor Arbeit vor Ruhe", () => {
    const all = [s("a", "working"), s("b", "error"), s("c", "waiting_approval"), s("d", "waiting_approval"), s("e", "idle")];
    expect(nyxSummary({ ...base, sessions: all, pendingApprovals: 2, questionSessions: ["d"] })).toEqual({ state: "approval", count: 1 });
    expect(nyxSummary({ ...base, sessions: all.filter((x) => x.id !== "c"), pendingApprovals: 1, questionSessions: ["d"] })).toEqual({ state: "question", count: 1 });
    expect(nyxSummary({ ...base, sessions: [s("a", "working"), s("b", "interrupted")] })).toEqual({ state: "error", count: 1 });
    expect(nyxSummary({ ...base, sessions: [s("a", "working"), s("b", "starting"), s("e", "idle")] })).toEqual({ state: "working", count: 2 });
    expect(nyxSummary({ ...base, sessions: [s("e", "idle"), s("f", "stopped")] })).toEqual({ state: "quiet", count: 2 });
  });

  it("eine Freigabe des Hubs zählt auch ohne passende Session in der Liste", () => {
    expect(nyxSummary({ ...base, pendingApprovals: 3 })).toEqual({ state: "approval", count: 3 });
  });

  it("Archiviertes zählt nicht; Unbekanntes ist ein Fehler (fail loud)", () => {
    expect(nyxSummary({ ...base, sessions: [s("a", "error", true)] }).state).toBe("quiet");
    expect(nyxSummary({ ...base, sessions: [s("a", "wunderlich")] }).state).toBe("error");
  });
});

describe("nyxSentence", () => {
  it("feste Vorlagen, Einzahl und Mehrzahl", () => {
    expect(nyxSentence({ state: "approval", count: 1 })).toBe("Eine Freigabe wartet auf dich.");
    expect(nyxSentence({ state: "approval", count: 2 })).toBe("2 Freigaben warten auf dich.");
    expect(nyxSentence({ state: "question", count: 3 })).toBe("3 Agenten haben Fragen.");
    expect(nyxSentence({ state: "quiet", count: 0 })).toBe("Alles ruhig.");
  });

  it("EPIC-P61 T61.9: dieselben Vorlagen auf Englisch, mit Plural", () => {
    setLanguageSetting("en");
    expect(nyxSentence({ state: "approval", count: 1 })).toBe("One approval is waiting for you.");
    expect(nyxSentence({ state: "approval", count: 2 })).toBe("2 approvals are waiting for you.");
    expect(nyxSentence({ state: "question", count: 3 })).toBe("3 agents have questions.");
    expect(nyxSentence({ state: "quiet", count: 0 })).toBe("All quiet.");
    expect(nyxSentence({ state: "offline", count: 1 })).toBe("I cannot reach the hub.");
  });
});

describe("Optionen", () => {
  it("die empfohlene Option erkennt sich am Zusatz", () => {
    expect(recommendedOption([{ label: "Sofort" }, { label: "Später (Recommended)" }])).toBe("Später (Recommended)");
    expect(recommendedOption([{ label: "A" }, { label: "B" }])).toBeNull();
  });

  it("Ja/Nein in beiden Sprachen, sonst nicht", () => {
    expect(isYesNo([{ label: "Ja" }, { label: "Nein" }])).toBe(true);
    expect(isYesNo([{ label: "No" }, { label: "Yes." }])).toBe(true);
    expect(isYesNo([{ label: "Ja" }, { label: "Vielleicht" }])).toBe(false);
    expect(isYesNo([{ label: "Ja" }, { label: "Nein" }, { label: "Weiß nicht" }])).toBe(false);
  });
});
