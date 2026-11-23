import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLICK_SUPPRESS_MS, LONG_PRESS_MS, MOVE_TOLERANCE_PX, createLongPress, placeTip, tipText } from "../../src/shared/tooltip-logic.ts";

describe("Long-Press (Touch-Tooltip)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const onLongPress = vi.fn();
    return { onLongPress, press: createLongPress({ onLongPress }) };
  };

  it("löst erst nach der Schwelle aus", () => {
    const { onLongPress, press } = make();
    press.start(10, 10);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("ein kurzer Tap ist kein Long-Press und sein Click wird nicht unterdrückt", () => {
    const { onLongPress, press } = make();
    press.start(10, 10);
    vi.advanceTimersByTime(100);
    expect(press.end()).toBe(false);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(press.shouldSuppressClick()).toBe(false);
  });

  it("der Click nach einem Long-Press wird genau einmal unterdrückt", () => {
    const { press } = make();
    press.start(10, 10);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(press.end()).toBe(true);
    expect(press.shouldSuppressClick()).toBe(true);
    expect(press.shouldSuppressClick()).toBe(false);
  });

  it("der Click kommt schon vor dem Loslassen: auch dann unterdrückt", () => {
    const { press } = make();
    press.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(press.shouldSuppressClick()).toBe(true);
  });

  it("ein viel späterer Tap löst wieder aus (Sperre läuft ab)", () => {
    const { press } = make();
    press.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    press.end();
    vi.advanceTimersByTime(CLICK_SUPPRESS_MS + 1);
    expect(press.shouldSuppressClick()).toBe(false);
  });

  it("Bewegung über der Toleranz bricht ab (Scrollen), kleine Bewegung nicht", () => {
    const small = make();
    small.press.start(0, 0);
    small.press.move(MOVE_TOLERANCE_PX - 1, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(small.onLongPress).toHaveBeenCalledTimes(1);

    const far = make();
    far.press.start(0, 0);
    far.press.move(MOVE_TOLERANCE_PX + 1, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(far.onLongPress).not.toHaveBeenCalled();
    expect(far.press.end()).toBe(false);
    expect(far.press.shouldSuppressClick()).toBe(false);
  });

  it("cancel (pointercancel/Scroll) verhindert Auslösung und Sperre", () => {
    const { onLongPress, press } = make();
    press.start(0, 0);
    press.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(press.shouldSuppressClick()).toBe(false);
  });

  it("ein neuer Druck startet frisch", () => {
    const { onLongPress, press } = make();
    press.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS - 10);
    press.start(50, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS - 10);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});

describe("tipText", () => {
  it("Reihenfolge: data-tip, aria-label, title, Text", () => {
    expect(tipText({ dataTip: "a", ariaLabel: "b", title: "c", text: "d" })).toBe("a");
    expect(tipText({ ariaLabel: "b", title: "c", text: "d" })).toBe("b");
    expect(tipText({ title: "c", text: "d" })).toBe("c");
    expect(tipText({ text: "  Sende \n  jetzt " })).toBe("Sende jetzt");
    expect(tipText({ dataTip: "  ", text: "x" })).toBe("x");
  });
  it("leer bleibt leer, Langes wird gekürzt", () => {
    expect(tipText({})).toBe("");
    expect(tipText({ text: "x".repeat(300) }).length).toBe(118);
  });
});

describe("placeTip (BUG-0255: Tooltip-Geometrie ohne DOM)", () => {
  // Tablet 800×1280, split: Icon-Leiste links, Icon 0..55, Mitte 27,5 px
  const vp = { width: 800, height: 1280 };
  const railIcon = { x: 27.5, top: 600, bottom: 644, right: 55 };

  it("Icon am linken Rand: Tooltip rechts daneben, vollständig im Viewport", () => {
    const p = placeTip(railIcon, vp, { width: 97, height: 24 }); // „Automationen“ (gemessen)
    expect(p.mode).toBe("side");
    expect(p.left).toBe(63); // Icon-Kante 55 + 8px Rand
    expect(p.left + 97).toBeLessThanOrEqual(792);
    expect(p.top).toBeGreaterThanOrEqual(20); // vertikal eingeklemmt, nicht über den Rand
    expect(p.top).toBeLessThanOrEqual(1260);
  });

  it("langer Tooltip am Umschalter (129 px) bleibt ebenfalls rechts und sichtbar", () => {
    const p = placeTip({ x: 27.5, top: 6, bottom: 50, right: 55 }, vp, { width: 129, height: 24 });
    expect(p.mode).toBe("side");
    expect(p.left).toBe(63);
  });

  it("Ziel mittig im Bild: weiterhin über dem Ziel zentriert", () => {
    const p = placeTip({ x: 400, top: 300, bottom: 340, right: 420 }, vp, { width: 120, height: 24 });
    expect(p.mode).toBe("above");
    expect(p.left).toBe(340);
    expect(p.top).toBe(300);
  });

  it("kein Platz rechts vom Rand-Icon: Box wird in den Viewport geklemmt, ragt nicht raus", () => {
    const p = placeTip(railIcon, { width: 120, height: 800 }, { width: 90, height: 24 });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 90).toBeLessThanOrEqual(112);
  });

  it("Ziel ganz oben (top < 40): Tooltip unter dem Ziel", () => {
    const p = placeTip({ x: 400, top: 10, bottom: 46, right: 420 }, vp, { width: 60, height: 24 });
    expect(p.mode).toBe("below");
    expect(p.top).toBe(46);
  });
});
