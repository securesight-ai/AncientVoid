import { afterEach, describe, expect, it, vi } from "vitest";
import { DEPTH3D_EVENT, DEPTH3D_KEY, applyDepth3d, depth3dAllowed, depth3dOn, toggleDepth3d } from "../../src/app/depth3d.ts";

/**
 * EPIC-P86 T86.1: Ablage und Kaskade der Tiefenebene. Das Muster ist das
 * ctxMotion aus ui-scale.ts: an ist der Default, localStorage hält nur das
 * explizite „0“, jede Änderung setzt das Attribut am Wurzelelement und
 * meldet es als Ereignis (CSS in 61-depth3d.css wertet es selbst aus).
 */

interface FakeOptions {
  stored?: string | null;
  ctxMotion?: "on" | "off";
  reduced?: boolean;
}

function fakeDom({ stored = null, ctxMotion = "on", reduced = false }: FakeOptions = {}) {
  const storage = new Map<string, string>();
  if (stored !== null) storage.set(DEPTH3D_KEY, stored);
  const attrs = new Map<string, string>();
  const events: string[] = [];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal("document", {
    documentElement: {
      dataset: { ctxMotion },
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
    },
  });
  vi.stubGlobal("window", { dispatchEvent: (e: Event) => (events.push(e.type), true) });
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  return { attrs, events };
}

afterEach(() => vi.unstubAllGlobals());

describe("depth3dOn / applyDepth3d (EPIC-P86, AC-P86-2)", () => {
  it("Standard ist an; „0“ ist aus; applyDepth3d setzt Attribut und Ereignis in beide Richtungen", () => {
    const on = fakeDom();
    expect(depth3dOn()).toBe(true);
    expect(on.attrs.get("data-ctx-3d")).toBeUndefined();

    applyDepth3d(false);
    expect(depth3dOn()).toBe(false);
    expect(on.attrs.get("data-ctx-3d")).toBe("off");
    expect(on.events).toContain(DEPTH3D_EVENT);

    applyDepth3d(true);
    expect(depth3dOn()).toBe(true);
    expect(on.attrs.get("data-ctx-3d")).toBe("on");
  });

  it("applyDepth3d(true) räumt den Schlüssel ab (wie ctxMotion: kein Dauer-Eintrag)", () => {
    const dom = fakeDom({ stored: "0" });
    applyDepth3d(true);
    expect(localStorage.getItem(DEPTH3D_KEY)).toBeNull();
    expect(dom.attrs.get("data-ctx-3d")).toBe("on");
  });

  it("toggleDepth3d dreht den eigenen Schalter", () => {
    fakeDom();
    toggleDepth3d();
    expect(depth3dOn()).toBe(false);
    toggleDepth3d();
    expect(depth3dOn()).toBe(true);
  });
});

describe("depth3dAllowed — Kaskade prefers-reduced-motion > Bewegung > 3D (AC-P86-3)", () => {
  it("an nur, wenn der eigene Schalter an und Bewegung erlaubt ist", () => {
    fakeDom();
    expect(depth3dAllowed()).toBe(true);

    fakeDom({ stored: "0" });
    expect(depth3dAllowed()).toBe(false);

    fakeDom({ ctxMotion: "off" });
    expect(depth3dAllowed()).toBe(false);

    fakeDom({ reduced: true });
    expect(depth3dAllowed()).toBe(false);
  });
});
