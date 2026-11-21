import { describe, expect, it, vi } from "vitest";
// EPIC-P61: Sprache auf Deutsch fixiert — Intl-Format und Katalogtexte der Tests sind de.
vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "ancientvoid.language" ? "de" : null), setItem: () => {}, removeItem: () => {} });
import { diffLineClass, isOneSided, pairHunkLines, oversizeNote } from "../../../src/features/session/diff-lines.ts";

describe("pairHunkLines", () => {
  it("stellt Löschungen und Hinzufügungen eines Blocks Zeile für Zeile nebeneinander", () => {
    const rows = pairHunkLines(" gleich\n-alt1\n-alt2\n+neu1\n gleich2");
    expect(rows.map((r) => [r.left.type, r.right.type])).toEqual([
      ["ctx", "ctx"],
      ["del", "add"],
      ["del", "empty"],
      ["ctx", "ctx"],
    ]);
  });
});

describe("isOneSided (EPIC-P20 T20.1)", () => {
  it("eine neue Datei (nur Hinzufügungen) ist einseitig, damit sie die ganze Breite nutzt", () => {
    expect(isOneSided(pairHunkLines("+a\n+b\n+c"))).toBe(true);
  });

  it("eine gelöschte Datei (nur Löschungen) ist einseitig", () => {
    expect(isOneSided(pairHunkLines("-a\n-b"))).toBe(true);
  });

  it("Kontext oder ein ersetzter Block hat zwei Seiten", () => {
    expect(isOneSided(pairHunkLines(" kontext\n+neu"))).toBe(false);
    expect(isOneSided(pairHunkLines("-alt\n+neu"))).toBe(false);
  });

  it("die leere Schlusszeile hinter dem letzten \\n zählt nicht als Kontext (echte Hunks enden mit \\n)", () => {
    expect(pairHunkLines("+a\n+b\n")).toHaveLength(2);
    expect(isOneSided(pairHunkLines("+a\n+b\n"))).toBe(true);
    expect(pairHunkLines(" kontext\n")).toHaveLength(1);
  });

  it("ein leerer Hunk ist nicht einseitig", () => {
    expect(isOneSided([])).toBe(false);
  });
});

describe("diffLineClass", () => {
  it("ordnet Zeilen ihrer Art zu", () => {
    expect(diffLineClass("+x")).toBe("diff-line-add");
    expect(diffLineClass("-x")).toBe("diff-line-del");
    expect(diffLineClass("@@ -1 +1 @@")).toBe("diff-line-hunk");
    expect(diffLineClass("+++ b/x")).toBe("diff-line-file");
    expect(diffLineClass(" x")).toBe("diff-line-ctx");
  });
});

describe("oversizeNote — Teilbefund fuer einen zu grossen Commit", () => {
  it("nennt Zahlen, statt den View zu verlieren", () => {
    expect(oversizeNote({ files: 1, changedLines: 6000 })).toContain("1 Datei, 6.000 geänderte Zeilen");
    expect(oversizeNote({ files: 12, changedLines: 41 })).toContain("12 Dateien, 41 geänderte Zeilen");
  });

  it("erklaert den Fall ohne Zahlen ehrlich", () => {
    expect(oversizeNote({ files: null, changedLines: null })).toContain("zum Aufzählen");
    expect(oversizeNote({ files: null, changedLines: null })).toContain("git show");
    expect(oversizeNote(undefined)).toBe("");
  });
});
