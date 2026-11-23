import { describe, expect, it } from "vitest";
import {
  attachmentHash,
  browserHash,
  codeHash,
  filetreeHash,
  isToolPage,
  pageHash,
  PAGE_SLUG,
  parseAppHash,
  redirectLegacyStatHash,
  sessionAttachmentHash,
  sessionHash,
  type ListPage,
} from "../../src/app/route.ts";

describe("Browser-Route (EPIC-P39 T39.3)", () => {
  it("round-trips lokal und auf einem anderen Host; die Session-Route bleibt unberührt", () => {
    expect(browserHash("s1")).toBe("#/sessions/s1/browser");
    expect(parseAppHash(browserHash("s1"))).toEqual({ view: "tail", sessionId: "s1", browser: true });
    expect(parseAppHash(browserHash("s2", "h2"))).toEqual({ view: "tail", sessionId: "s2", hostId: "h2", browser: true });
    expect(parseAppHash("#/sessions/s1")).toEqual({ view: "tail", sessionId: "s1" });
    expect(parseAppHash("#/sessions/s1/graph")).toEqual({ view: "tail", sessionId: "s1", tab: "graph" });
  });
});

describe("session hash route (AC-P5-5)", () => {
  it("round-trips a session id", () => {
    const hash = sessionHash("abc/def");
    expect(parseAppHash(hash)).toEqual({ view: "tail", sessionId: "abc/def" });
  });

  it("treats an empty hash as the list", () => {
    expect(parseAppHash("")).toEqual({ view: "list", page: "dashboard" });
    expect(parseAppHash("#/settings")).toEqual({ view: "list", page: "dashboard" });
  });

  it("T8.1: every page round-trips through its hash", () => {
    for (const page of ["dashboard", "new", "settings", "approvals", "status"] as const) expect(parseAppHash(pageHash(page))).toEqual({ view: "list", page });
    expect(pageHash("new")).toBe("#/neu");
    // EPIC-P47 §3.4: `#/gefunden` ist kein eigener Page-Slug mehr, sondern ein Alias auf die Übersicht.
    expect(parseAppHash("#/gefunden")).toEqual({ view: "list", page: "dashboard" });
    expect(parseAppHash("#/gefunden/")).toEqual({ view: "list", page: "dashboard" });
  });

  it("T7.6: a code line round-trips, paths with slashes and special characters included", () => {
    const hash = codeHash("s1", "src/a b/ä.ts", 42, "gpubox");
    expect(parseAppHash(hash)).toEqual({ view: "tail", hostId: "gpubox", sessionId: "s1", code: { path: "src/a b/ä.ts", line: 42 } });
    expect(parseAppHash(codeHash("s1", "README.md", null))).toEqual({ view: "tail", sessionId: "s1", code: { path: "README.md", line: null } });
  });
});

describe("Werkzeugseiten (EPIC-P34 T34.2)", () => {
  it("Einstellungen, Medien, PC und Status füllen die Detailspalte; Übersicht, Neu und Freigaben bleiben in der Liste (Entdeckt ist seit EPIC-P47 ein Übersichtszustand)", () => {
    const tools: ListPage[] = ["settings", "media", "pc", "status", "statistics"];
    const listed: ListPage[] = ["dashboard", "new", "approvals"];
    for (const page of tools) expect(isToolPage(page), page).toBe(true);
    for (const page of listed) expect(isToolPage(page), page).toBe(false);
  });

  it("die Direktlinks #/pc und #/medien bleiben gültig (AC-P34-1)", () => {
    expect(parseAppHash("#/pc")).toEqual({ view: "list", page: "pc" });
    expect(parseAppHash("#/medien")).toEqual({ view: "list", page: "media" });
    expect(parseAppHash("#/statistik")).toEqual({ view: "list", page: "statistics" });
  });
});

describe("Analyse-Seite mit Tabs (BUG-0257)", () => {
  it("die drei Ansichten sind ein Reiter-Hash auf einer Seite", () => {
    expect(parseAppHash("#/statistik")).toEqual({ view: "list", page: "statistics" });
    expect(parseAppHash("#/statistik/metriken")).toEqual({ view: "list", page: "statistics", statTab: "metriken" });
    expect(parseAppHash("#/statistik/inferenz")).toEqual({ view: "list", page: "statistics", statTab: "inferenz" });
    expect(parseAppHash("#/statistik/statistik/")).toEqual({ view: "list", page: "statistics" });
  });

  it("Altlinks #/metriken und #/inferenz leiten permanent auf die Tabs um", () => {
    expect(redirectLegacyStatHash("#/metriken")).toBe("#/statistik/metriken");
    expect(redirectLegacyStatHash("#/metriken/")).toBe("#/statistik/metriken");
    expect(redirectLegacyStatHash("#/inferenz")).toBe("#/statistik/inferenz");
    expect(redirectLegacyStatHash("#/statistik")).toBeNull();
    expect(redirectLegacyStatHash("#/sessions/s1")).toBeNull();
  });

  it("es gibt genau einen Analyse-Navigations-Eintrag: statistics ist Tool-Seite, aimetrics/inference existieren nicht mehr", () => {
    expect(isToolPage("statistics")).toBe(true);
    expect(PAGE_SLUG.statistics).toBe("statistik");
    expect("aimetrics" in PAGE_SLUG).toBe(false);
    expect("inference" in PAGE_SLUG).toBe(false);
  });
});

describe("host-qualified session links (EPIC-P6)", () => {
  it("round-trips host and session", () => {
    const hash = sessionHash("abc", "home-server");
    expect(hash).toBe("#/hosts/home-server/sessions/abc");
    expect(parseAppHash(hash)).toEqual({ view: "tail", hostId: "home-server", sessionId: "abc" });
  });

  it("keeps old links without a host working", () => {
    expect(parseAppHash("#/sessions/abc")).toEqual({ view: "tail", sessionId: "abc" });
  });
});

describe("Dateibaum-Fenster-Route (BUG-0128)", () => {
  it("#/dateibaum markiert das Fensterziel; vergleichbar mit #/geraete", () => {
    expect(filetreeHash()).toBe("#/dateibaum");
    expect(parseAppHash(filetreeHash())).toEqual({ view: "filetree" });
    expect(parseAppHash("#/dateibaum/")).toEqual({ view: "filetree" });
  });
});


describe("Anhang-Route (Bild-Link aus einer Agent-Nachricht)", () => {
  it("baut die Hashes — einzeln und innerhalb der Session", () => {
    expect(attachmentHash("a 1")).toBe("#/anhang/a%201");
    expect(sessionAttachmentHash("s1", "a1")).toBe("#/sessions/s1/anhang/a1");
    expect(sessionAttachmentHash("s1", "a1", "h2")).toBe("#/hosts/h2/sessions/s1/anhang/a1");
  });

  it("erkennt den Einzeln-Link als eigenes Bildfenster", () => {
    expect(parseAppHash("#/anhang/a1")).toEqual({ view: "attachment", attachmentId: "a1" });
    expect(parseAppHash("#/anhang/a%201")).toEqual({ view: "attachment", attachmentId: "a 1" });
  });

  it("erkennt den Link innerhalb der Session, ohne die Session-Route zu zerstoeren", () => {
    expect(parseAppHash(sessionAttachmentHash("s1", "a1"))).toEqual({ view: "tail", sessionId: "s1", attachment: "a1" });
    expect(parseAppHash(sessionAttachmentHash("s2", "a2", "h2"))).toEqual({ view: "tail", sessionId: "s2", hostId: "h2", attachment: "a2" });
    // Kombination aus Tab und Anhang ist bewusst nicht unterstuetzt: der Datei-Tab traegt
    // Pfade mit Schraegstrichen, ein zusaetzliches Segment waere mehrdeutig.
    expect(parseAppHash("#/sessions/s1/graph")).toEqual({ view: "tail", sessionId: "s1", tab: "graph" });
  });

  it("laesst die bestehenden Session-Routen unveraendert — auch Pfade mit Schrägstrichen", () => {
    expect(parseAppHash("#/sessions/s1/datei/src/a.ts")).toEqual({ view: "tail", sessionId: "s1", tab: "datei", file: "src/a.ts" });
    expect(parseAppHash("#/sessions/s1/browser")).toEqual({ view: "tail", sessionId: "s1", browser: true });
    expect(parseAppHash("#/hosts/h2/sessions/s1/code/src%2Fa.ts:L12")).toEqual({ view: "tail", hostId: "h2", sessionId: "s1", code: { path: "src/a.ts", line: 12 } });
  });
});
