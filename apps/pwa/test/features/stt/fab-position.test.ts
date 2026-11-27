import { describe, expect, it } from "vitest";
import { clampFabPos, defaultFabPos, FAB_SIZE, fabBreakpoint, isKeyboardResize } from "../../../src/features/stt/fab-position.ts";

describe("fab-position", () => {
  it("mappt Breakpoints", () => {
    expect(fabBreakpoint(390)).toBe("phone");
    expect(fabBreakpoint(800)).toBe("tablet");
    expect(fabBreakpoint(1400)).toBe("pc");
  });

  it("Default: Handy unten rechts, PC unten links in der freien Liste — nicht ueber dem Text", () => {
    const phone = defaultFabPos("phone", 390, 800);
    expect(phone.x).toBeGreaterThan(300);
    expect(phone.y).toBeGreaterThan(600);
    const pc = defaultFabPos("pc", 1280, 800);
    expect(pc.x).toBeGreaterThanOrEqual(80); // rechts von der festen Icon-Leiste
    expect(pc.x).toBeLessThan(300); // in der Spalte der Sitzungsliste, nicht ueber dem Chat
    expect(pc.y + FAB_SIZE).toBeLessThanOrEqual(800 - 24); // ueber der Statuszeile
    expect(pc.y).toBeGreaterThan(400); // nicht in der Kopfzeile
  });

  it("BUG-0138: Handy/Tablet sitzt über der gemessenen Dock-Oberkante, nicht über einer Schätzung", () => {
    const tall = defaultFabPos("phone", 390, 800, 520);
    expect(tall.y + FAB_SIZE).toBeLessThanOrEqual(520);
    // unplausible Messung (kein Dock / außerhalb) fällt auf die Schätzung zurück
    expect(defaultFabPos("phone", 390, 800, 0)).toEqual(defaultFabPos("phone", 390, 800));
    expect(defaultFabPos("pc", 1400, 900, 300)).toEqual(defaultFabPos("pc", 1400, 900));
  });

  it("clamp hält im Viewport", () => {
    expect(clampFabPos({ x: -10, y: 9999 }, 400, 700)).toEqual({ x: 0, y: 700 - FAB_SIZE });
  });

});

describe("isKeyboardResize (Nutzerwunsch 27.11.2026: FAB bleibt bei Tastatur stehen)", () => {
  const tastatur = { coarse: true, editableFocused: true };

  it("Tastatur: Breite gleich, Hoehe um Hunderte geschrumpft, Editierfeld fokussiert", () => {
    expect(isKeyboardResize({ w: 390, h: 844 }, { w: 390, h: 480 }, tastatur)).toBe(true);
    expect(isKeyboardResize({ w: 844, h: 390 }, { w: 844, h: 120 }, tastatur)).toBe(true);
  });

  it("Drehung ist keine Tastatur: die Breite aendert sich", () => {
    expect(isKeyboardResize({ w: 390, h: 844 }, { w: 844, h: 390 }, tastatur)).toBe(false);
  });

  it("Adressleiste/Rahmen schrumpfen nur um Dutzend Pixel — keine Tastatur", () => {
    expect(isKeyboardResize({ w: 390, h: 844 }, { w: 390, h: 800 }, tastatur)).toBe(false);
  });

  it("Desktop ohne Touch wird nie als Tastatur gelesen (Fensterhoehen-Drag bleibt echt)", () => {
    expect(isKeyboardResize({ w: 1280, h: 800 }, { w: 1280, h: 500 }, { coarse: false, editableFocused: true })).toBe(false);
  });

  it("ohne fokussiertes Editierfeld ist keine Tastatur auf", () => {
    expect(isKeyboardResize({ w: 390, h: 844 }, { w: 390, h: 480 }, { coarse: true, editableFocused: false })).toBe(false);
  });
});
