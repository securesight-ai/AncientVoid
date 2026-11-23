import { describe, it, expect } from "vitest";
import { toolImageRef, toolImageHits, sessionRefFor } from "../../src/features/session/tool-image.ts";
import type { NormalizedEvent } from "../../src/shared/ws.ts";

const sitzung = { id: "s1", project: "/home/kaib/repos/AncientVoid" };

function nutzung(eingabe: unknown): NormalizedEvent {
  return { type: "tool_use", payload: { id: "call_1", name: "read", input: eingabe } } as unknown as NormalizedEvent;
}
function ergebnis(content: string, isError = false): NormalizedEvent {
  return { type: "tool_result", payload: { toolUseId: "call_1", isError, content } } as unknown as NormalizedEvent;
}

describe("Bildvorschau für gelesene Bilder (Nutzerfund 2026-11-23)", () => {
  it("absoluter Pfad im Projekt wird zum Projekt-Ziel mit relativem Pfad", () => {
    const e = nutzung({ path: "/home/kaib/repos/AncientVoid/data/attachments/12033b.png" });
    const r = ergebnis("Read image file [image/png][image]");
    expect(toolImageRef(e, r, sitzung)).toEqual({
      target: "project=%2Fhome%2Fkaib%2Frepos%2FAncientVoid",
      path: "data/attachments/12033b.png",
      name: "12033b.png",
    });
  });

  it("relativer Pfad läuft über die Sitzungsroute (Arbeitsverzeichnis der Sitzung)", () => {
    const e = nutzung({ path: "docs/bild.png" });
    expect(toolImageRef(e, undefined, sitzung)).toEqual({ target: "session=s1", path: "docs/bild.png", name: "bild.png" });
  });

  it("außerhalb des Projekts gibt es keine Vorschau — auch keine falsche Fehlermeldung", () => {
    const e = nutzung({ path: "/home/kaib/Bilder/Screenshot.png" });
    expect(toolImageRef(e, ergebnis("Read image file [image/png][image]"), sitzung)).toBeNull();
  });

  it("kein Bild, kein read-Werkzeug, kein erfolgreiches Lesen → keine Vorschau", () => {
    expect(toolImageRef(nutzung({ path: "README.md" }), ergebnis("text"), sitzung)).toBeNull();
    expect(toolImageRef({ type: "tool_use", payload: { id: "c", name: "bash", input: { command: "cat bild.png" } } } as unknown as NormalizedEvent, undefined, sitzung)).toBeNull();
    expect(toolImageRef(nutzung({ path: "bild.jpg" }), ergebnis("Datei nicht gefunden", true), sitzung)).toBeNull();
    expect(toolImageRef(nutzung({ path: "bild.png" }), undefined, undefined)).toBeNull();
  });

  it("andere Eingabe-Schlüssel (file_path) werden ebenfalls erkannt", () => {
    const e = nutzung({ file_path: "/home/kaib/repos/AncientVoid/x/webp.webp" });
    expect(toolImageRef(e, undefined, sitzung)?.path).toBe("x/webp.webp");
  });

  // Nutzerfund 2026-11-23: die Vorschau erschien live nirgends. Der Sitzungs-
  // datensatz trägt immer eine hostId — auch die des eigenen Hubs (live nach-
  // gewiesen: hostId "cachyos-ai" auf der eigenen Sitzung) — und die Weiche
  // `hostId ? undefined : …` schloss damit jede eigene Sitzung aus.
  it("eigene Sitzung mit eigener hostId bekommt die Vorschau, fremde nicht", () => {
    const eigene = { id: "s1", project: "/home/kaib/repos/x", hostId: "cachyos-ai" };
    expect(sessionRefFor(eigene, null)).toEqual({ id: "s1", project: "/home/kaib/repos/x" });
    expect(sessionRefFor({ ...eigene, hostId: "kaisgamingdesk" }, "kaisgamingdesk")).toBeUndefined();
    expect(sessionRefFor({ id: "s1", hostId: "cachyos-ai" }, null)).toBeUndefined();
    expect(sessionRefFor(undefined, null)).toBeUndefined();
  });
});

/** Nutzerfund 23.11.2026: eine Shell-Ausgabe nannte Bildnamen als Text
 * (`neonsunset_shot1.png 200 65140 …`) — im Chat führte kein Weg zu den Dateien. */
function schale(befehl: string): NormalizedEvent {
  return { type: "tool_use", payload: { id: "call_9", name: "bash", input: { command: befehl } } } as unknown as NormalizedEvent;
}

describe("Bildvorschläge aus Shell-Ausgaben", () => {
  it("Dateinamen in der Ausgabe werden zu Sitzungs-Zielen (relativ zum Arbeitsverzeichnis)", () => {
    const treffer = toolImageHits(schale("for f in *.png; do printf '%s %s\\n' \"$f\" $(wc -c < \"$f\"); done"), ergebnis("neonsunset_shot1.png 200 65140\r\nneonsunset_shot2.png 200 58564\r\nneonbay_shot1.png 200 61989\n"), sitzung);
    expect(treffer.direkt).toEqual([]);
    expect(treffer.vorschlaege.map((b) => b.name)).toEqual(["neonsunset_shot1.png", "neonsunset_shot2.png", "neonbay_shot1.png"]);
    expect(treffer.vorschlaege[0]).toMatchObject({ target: "session=s1", path: "neonsunset_shot1.png" });
  });

  it("Pfade mit Ordner bleiben erhalten, absolute Pfade im Projekt werden umgewurzelt", () => {
    const treffer = toolImageHits(schale("ls"), ergebnis("docs/skaleneu/webp/banner.webp\n/home/kaib/repos/AncientVoid/e2e/fixtures/shot.jpg"), sitzung);
    expect(treffer.vorschlaege.map((b) => `${b.target} ${b.path}`)).toEqual([
      "session=s1 docs/skaleneu/webp/banner.webp",
      "project=%2Fhome%2Fkaib%2Frepos%2FAncientVoid e2e/fixtures/shot.jpg",
    ]);
  });

  it("unauflösbares Zeug fliegt raus: URLs, Egg-dirs, mehr als sechs Vorschläge", () => {
    const text = ["https://cdn.example.de/bild.png", "../geheim/oben.png", ".git/objects/blobs/paket.png", "a.png", "b.png", "c.png", "d.png", "e.png", "f.png", "g.png"].join("\n");
    const treffer = toolImageHits(schale("liste"), ergebnis(text), sitzung);
    expect(treffer.vorschlaege.map((b) => b.path)).toEqual(["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"]);
  });

  it("nur Schalen-Werkzeuge schlagen vor — ein grep oder read-listet keine Bilder", () => {
    const treffer = toolImageHits({ type: "tool_use", payload: { id: "c", name: "grep", input: {} } } as unknown as NormalizedEvent, ergebnis("styles/banner.png:1"), sitzung);
    expect(treffer.vorschlaege).toEqual([]);
  });

  it("ein gelesenes Bild bleibt Vorschau (direkt) und taucht nicht doppelt auf", () => {
    const e = nutzung({ path: "/home/kaib/repos/AncientVoid/data/attachments/12033b.png" });
    const treffer = toolImageHits(e, ergebnis("Read image file [image/png][image] 12033b.png"), sitzung);
    expect(treffer.direkt.map((b) => b.name)).toEqual(["12033b.png"]);
    expect(treffer.vorschlaege).toEqual([]);
  });

  it("ohne eigene Sitzung gibt es nichts zu zeigen", () => {
    expect(toolImageHits(schale("ls"), ergebnis("bild.png"), undefined)).toEqual({ direkt: [], vorschlaege: [] });
  });
});
