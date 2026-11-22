import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryTerms, searchProjectLocal } from "../../../src/modules/search/search.ts";

/**
 * Suche (Nachschärfe 2026-11-22): der Markdown-Durchlauf ohne qmd. Bisher war
 * die Suchansicht auf einem Rechner ohne `qmd`-CLI tot (501). Diese Tests
 * laufen bewusst **ohne** qmd — sie sind der Nachweis, dass die Ansicht auch
 * ohne Fremdkli echte Fundstellen liefert.
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ancientvoid-docs-local-"));
  await writeFile(join(dir, "README.md"), "# Start\n\nBaue das Hub mit `npm run build`. Der Start braucht tmux.\n", "utf8");
  await mkdir(join(dir, "docs", "adr"), { recursive: true });
  await writeFile(join(dir, "docs", "adr", "0002-tmux.md"), "# tmux als Worker\n\nWarum der Worker in tmux läuft und nicht im Hub-Prozess.\n", "utf8");
  await writeFile(join(dir, "docs", "leer.md"), "hier steht nichts Brauchbares\n", "utf8");
  await writeFile(join(dir, "notizen.txt"), "tmux — aber keine Markdown-Datei\n", "utf8");
  await mkdir(join(dir, "node_modules", "fremd"), { recursive: true });
  await writeFile(join(dir, "node_modules", "fremd", "README.md"), "# fremd\n\ntmux tmux tmux\n", "utf8");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("queryTerms", () => {
  it("schneidet Wörter und lässt Ein-Zeichen-Restchen weg", () => {
    expect(queryTerms("Build  des, HUBS!")).toEqual(["build", "des", "hubs"]);
    expect(queryTerms("a b")).toEqual([]);
    expect(queryTerms("")).toEqual([]);
  });
});

describe("searchProjectLocal — Markdown ohne qmd", () => {
  it("findet das Dokument, in dem alle Begriffe stecken", async () => {
    const hits = await searchProjectLocal(dir, "tmux worker");
    expect(hits.map((h) => h.file)).toContain("docs/adr/0002-tmux.md");
    const hit = hits.find((h) => h.file === "docs/adr/0002-tmux.md")!;
    expect(hit.title).toBe("tmux als Worker");
    expect(hit.line).toBeGreaterThan(0);
    // Gleiche Marker wie die Session-Suche — die PWA rendert beide gleich.
    expect(hit.snippet).toContain("\u0002tmux\u0003");
  });

  it("blättert node_modules nicht an und liest kein Textfile an", async () => {
    const hits = await searchProjectLocal(dir, "tmux");
    expect(hits.some((h) => h.file.startsWith("node_modules/"))).toBe(false);
    expect(hits.some((h) => h.file.endsWith(".txt"))).toBe(false);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("ein Volltreffer steht vor einem Streifschuss", async () => {
    const hits = await searchProjectLocal(dir, "tmux hub-prozess");
    expect(hits[0]?.file).toBe("docs/adr/0002-tmux.md");
  });

  it("nichts gefunden ist eine leere Liste, kein Fehler", async () => {
    expect(await searchProjectLocal(dir, "Phantombegriff Trübvolimatratze")).toEqual([]);
    expect(await searchProjectLocal(dir, "a")).toEqual([]);
    expect(await searchProjectLocal("/gibt/es/nicht", "tmux")).toEqual([]);
  });
});
