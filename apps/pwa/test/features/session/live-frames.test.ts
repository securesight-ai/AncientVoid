import { describe, expect, it } from "vitest";
import { liveZuwachs, type StreamFrameView } from "../../../src/features/session/live-frames.ts";

// BUG-0288: In der App lief der Thinking-Stream sichtbar mit, im Browser nicht. Die
// Rahmen kamen nachweislich an (259 onFrames-Aufrufe, Blase bis 3.048 Zeichen) — der
// Strom hing aber an der Chat-Ansicht, und der Verlauf hatte keine. Diese Tests halten
// die **Regel** fest, nach der Teiltexte zu einer wachsenden Blase werden, damit der
// Bug nicht wieder als Anzeigefehler getarnt zurückkehrt.

const rahmen = (turnId: string, stream: StreamFrameView["stream"], text: string, seq: number, final = false): StreamFrameView => ({ turnId, stream, seq, text, final });

describe("liveZuwachs (BUG-0288)", () => {
  it("sammelt Teiltexte in Reihenfolge getrennt nach Strom", () => {
    const z = liveZuwachs([
      rahmen("t1", "thinking", "Denke über ", 0),
      rahmen("t1", "thinking", "die Datei nach", 1),
      rahmen("t1", "assistant", "Antwort", 0),
    ]);
    expect(z.thinking).toBe("Denke über die Datei nach");
    expect(z.assistant).toBe("Antwort");
  });

  it("ein Rahmen ohne Text fügt der Blase nichts hinzu", () => {
    // Der Vertrag verbietet leeren Text (`min(1)`); die Anzeige darf sich darauf nicht
    // verlassen — ein leerer Rahmen darf keinen Geisterabsatz erzeugen.
    const z = liveZuwachs([rahmen("t2", "thinking", "", 0)], new Set());
    expect(z.thinking).toBe("");
    expect(z.assistant).toBe("");
  });

  it("ein laufender Rahmen öffnet den Strom, final schließt und meldet ihn", () => {
    const offen = new Set<string>();
    const erster = liveZuwachs([rahmen("t3", "thinking", "a", 0)], offen);
    expect(erster.offen).toEqual(["t3"]);
    const letzter = liveZuwachs([rahmen("t3", "thinking", "b", 1, true)], new Set(erster.offen));
    expect(letzter.offen).toEqual([]);
    expect(letzter.geschlossen).toEqual(["t3"]);
    expect(letzter.thinking).toBe("b");
  });

  it("verändert die übergebene Menge nicht — der Aufrufer führt sie selbst weiter", () => {
    const offen = new Set(["t4"]);
    liveZuwachs([rahmen("t5", "assistant", "x", 0)], offen);
    expect([...offen]).toEqual(["t4"]);
  });

  it("leere oder fehlende Rahmenserie ist kein Zustand", () => {
    expect(liveZuwachs(undefined, new Set(["t6"])).offen).toEqual(["t6"]);
    expect(liveZuwachs([]).assistant).toBe("");
  });
});
