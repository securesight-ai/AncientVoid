import { describe, expect, it } from "vitest";
import { clampScale, scaleKey, SCALE_MAX, SCALE_MIN } from "../../src/app/ui-scale.ts";

describe("clampScale (EPIC-P20 T20.2)", () => {
  it("rastet auf 10-%-Schritte ein und bleibt zwischen 70 und 200 %", () => {
    expect(clampScale(1.04)).toBe(1);
    expect(clampScale(1.26)).toBe(1.3);
    expect(clampScale(0.1)).toBe(SCALE_MIN);
    // Kais PC-Fenster: 70 % reichte nicht, um die Spalten klein genug zu machen.
    // Die Untergrenze ist eine bewusste Entscheidung, kein Nebenprodukt.
    expect(SCALE_MIN).toBe(0.5);
    expect(clampScale(0.3)).toBe(0.5);
    expect(clampScale(9)).toBe(SCALE_MAX);
  });

  it("alles, was keine Zahl ist, ist 100 %", () => {
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("Gleitkomma-Schritte driften nicht (1.1 + 0.1 ist 1.2)", () => {
    expect(clampScale(1.1 + 0.1)).toBe(1.2);
    expect(clampScale(0.7 + 0.1 * 13)).toBe(2);
  });
});

describe("scaleKey", () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => scaleKey({ key: k, ctrlKey: true, metaKey: false, altKey: false, ...mods });

  it("Strg + Plus/Gleich vergrößert, Strg + Minus verkleinert, Strg + 0 setzt zurück", () => {
    expect(key("+")).toBe(1);
    expect(key("=")).toBe(1);
    expect(key("-")).toBe(-1);
    expect(key("0")).toBe(0);
  });

  it("ohne Strg/⌘ oder mit Alt gehört die Taste nicht uns (Alt+1–4 sind die Kachel-Kürzel)", () => {
    expect(key("+", { ctrlKey: false })).toBeNull();
    expect(key("+", { altKey: true })).toBeNull();
    expect(key("a")).toBeNull();
  });

  it("⌘ zählt wie Strg", () => {
    expect(key("+", { ctrlKey: false, metaKey: true })).toBe(1);
  });
});
