import { describe, it, expect } from "vitest";
import { toolImageRef, sessionRefFor } from "../../src/features/session/tool-image.ts";
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
