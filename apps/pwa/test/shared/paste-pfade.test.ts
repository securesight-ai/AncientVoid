import { describe, expect, it } from "vitest";
import { imagePathsFrom } from "../../src/shared/paste-images.ts";

/** Nachgebauter DataTransfer-Ausschnitt, wie ihn Chromium unter Linux liefert. */
const transfer = (typen: Record<string, string>) =>
  ({ getData: (typ: string) => typen[typ] ?? "" }) as unknown as DataTransfer;

describe("Bildpfade aus der Zwischenablage (Linux/Wayland)", () => {
  it("uri-list aus dem Datei-Manager wird zu absoluten Pfaden", () => {
    const t = transfer({ "text/uri-list": "file:///home/kaib/Bilder/Screenshot%201.png" });
    expect(imagePathsFrom(t)).toEqual(["/home/kaib/Bilder/Screenshot 1.png"]);
  });

  it("mehrere Einträge, Kommentarzeilen und Duplikate werden behandelt", () => {
    const t = transfer({ "text/uri-list": "# comment\nfile:///a/b.png\nfile:///c/d.jpg\nfile:///a/b.png\n" });
    expect(imagePathsFrom(t)).toEqual(["/a/b.png", "/c/d.jpg"]);
  });

  it("Nicht-Bilder und relative Pfade bleiben draußen", () => {
    expect(imagePathsFrom(transfer({ "text/uri-list": "file:///a/b.txt\nrelativ/bild.png\n" }))).toEqual([]);
  });

  it("text/plain mit Pfad funktioniert ebenfalls (wl-copy, xclip)", () => {
    expect(imagePathsFrom(transfer({ "text/plain": "/home/kaib/Bilder/Screenshot.png" }))).toEqual(["/home/kaib/Bilder/Screenshot.png"]);
  });

  it("leere Zwischenablage ergibt nichts statt Fehler", () => {
    expect(imagePathsFrom(transfer({}))).toEqual([]);
    expect(imagePathsFrom(null)).toEqual([]);
  });
});
