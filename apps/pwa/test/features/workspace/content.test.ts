import { describe, expect, it, afterEach, vi } from "vitest";
import { contentHash, parseContent } from "../../../src/features/workspace/content.ts";
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
