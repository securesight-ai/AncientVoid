import { describe, expect, it, afterEach, vi } from "vitest";
import { contentHash, parseContent, warVorwaertsSchritt } from "../../../src/features/workspace/content.ts";
import { onWorkspaceOpen, openWorkspaceContent } from "../../../src/features/workspace/open-content.ts";
import { PAGE_SLUG } from "../../../src/app/route.ts";

afterEach(() => vi.unstubAllGlobals());
describe("Karten-Ziele", () => {
  it("kennt jede Inhaltsseite und verwirft unbekannte gespeicherte Ziele", () => {
    for (const page of Object.keys(PAGE_SLUG).filter((p) => p !== "dashboard")) expect(parseContent({ kind: "page", page })).toEqual({ kind: "page", page });
    for (const raw of [null, {}, { kind: "page", page: "unknown" }, { kind: "session", tab: "unknown" }]) expect(parseContent(raw)).toBeUndefined();
  });
  it("berechnet den Hash aus dem Ziel der jeweiligen Karte", () => {
    expect(contentHash({ sessionId: "a" })).toBe("#/sessions/a");
    expect(contentHash({ sessionId: "a", content: { kind: "session", tab: "graph" } })).toBe("#/sessions/a/graph");
    expect(contentHash({ sessionId: "a", content: { kind: "session", tab: "datei", file: "src/a.ts" } })).toBe("#/sessions/a/datei/src/a.ts");
    expect(contentHash({ sessionId: "", content: { kind: "page", page: "settings" } })).toBe("#/einstellungen");
    // Tabs ohne rekonstruierbare Route (Bericht/Diff/…) → Adresszeile `#/` (BUG-0249:
    // ContinueCard darf deshalb nicht location.href lesen).
    expect(contentHash({ sessionId: "a", content: { kind: "session", tab: "bericht" } })).toBe("#/");
  });
  it("lässt Handy und Popouts ihren Ablauf behalten; nur ein vorhandenes Grid übernimmt", () => {
    vi.stubGlobal("window", new EventTarget());
    const ref = { sessionId: "a" };
    expect(openWorkspaceContent(ref)).toBe(false);
    const open = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const dispose = onWorkspaceOpen(open);
    expect(openWorkspaceContent(ref)).toBe(false);
    expect(openWorkspaceContent(ref)).toBe(true);
    expect(open).toHaveBeenCalledWith(ref);
    dispose();
    expect(openWorkspaceContent(ref)).toBe(false);
  });
});

describe("Vorwärtsschritt oder Fokus-Sprung (Nutzerfund 24.11.2026: Zurück warf aus der App)", () => {
  const sitzungA = { sessionId: "a", content: { kind: "session", tab: "chat" } };
  const sitzungB = { sessionId: "b", content: { kind: "session", tab: "chat" } };
  const notizen = { sessionId: "", content: { kind: "page", page: "notes" } };

  it("öffnet eine neue Sitzung in derselben Kachel: echter Vorwärtsschritt", () => {
    expect(warVorwaertsSchritt(1, 1, sitzungB, [sitzungA])).toBe(true);
  });
  it("springt auf eine Kachel, die dieselbe Ansicht schon hält: kein Schritt", () => {
    expect(warVorwaertsSchritt(2, 2, sitzungA, [sitzungB, sitzungA])).toBe(false);
  });
  it("Reiter mit eigener Adresse (Graph) ist ein Schritt, der without (Verlauf) nicht", () => {
    const verlauf = { sessionId: "a", content: { kind: "session", tab: "verlauf" } };
    const graph = { sessionId: "a", content: { kind: "session", tab: "graph" } };
    // Der Verlauf teilt sich die Adresse der Sitzung — es gibt nichts vorwärts zu setzen.
    expect(contentHash(verlauf)).toBe(contentHash(sitzungA));
    expect(warVorwaertsSchritt(1, 1, verlauf, [sitzungA])).toBe(false);
    expect(warVorwaertsSchritt(1, 1, graph, [sitzungA])).toBe(true);
  });
  it("schließt eine Kachel: kein Schritt, auch wenn der Inhalt ein anderer wird", () => {
    expect(warVorwaertsSchritt(2, 1, sitzungB, [sitzungA, sitzungB])).toBe(false);
  });
  it("bläst der Fokus-Tastatur (Alt+1/2/3) die Historie nicht auf", () => {
    const offen = [sitzungA, sitzungB, notizen];
    for (const ziel of offen) expect(warVorwaertsSchritt(3, 3, ziel, offen)).toBe(false);
  });
});
