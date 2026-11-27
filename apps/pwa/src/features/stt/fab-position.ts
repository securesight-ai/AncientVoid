/** Persistierte FAB-Position je Breakpoint (Handy / Tablet / PC). */

export type FabBreakpoint = "phone" | "tablet" | "pc";

export interface FabPos {
  x: number;
  y: number;
}

const KEY = "ancientvoid.nyx-fab.v1";

/** Muss zu `.nyx-fab` in 43-nyx-fab.css passen. */
export const FAB_SIZE = 64;

export function fabBreakpoint(width = typeof window !== "undefined" ? window.innerWidth : 390): FabBreakpoint {
  if (width >= 1280) return "pc";
  if (width >= 700) return "tablet";
  return "phone";
}

/**
 * Default: Handy/Tablet rechts, über der Oberkante des Docks; PC mittig im Viewport.
 * `dockTop` ist die gemessene Oberkante — der Dock wächst mit Steuerzeilen, eine feste
 * Schätzung legte den FAB über dessen Tasten (BUG-0138).
 */
export function defaultFabPos(bp: FabBreakpoint, vw: number, vh: number, dockTop?: number): FabPos {
  const size = FAB_SIZE;
  if (bp === "pc") {
    // Nicht mittig: mittig liegt der Knopf über der Lesestelle. Gemessen am produktiven Hub
    // (1280x800, Sitzungansicht): FAB bei 608,368 — direkt auf der Ereigniszeile
    // „session.queue…“. Unten links liegt er in der freien Flaeche der Sitzungsliste,
    // rechts neben der Icon-Leiste und uber der Statuszeile.
    return { x: 96, y: Math.max(8, vh - size - 32) };
  }
  const floor = dockTop !== undefined && dockTop > 0 && dockTop < vh ? dockTop : vh - 88;
  return {
    x: Math.max(8, vw - size - 16),
    y: Math.max(8, Math.round(floor - size - 12)),
  };
}

function storedFabPos(bp: FabBreakpoint): FabPos | null {
  try {
    const stored = (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<FabBreakpoint, FabPos>>)[bp];
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) return stored;
  } catch {
    // ignore
  }
  return null;
}

/** Hat der Nutzer fuer diesen Breakpoint selbst platziert? Dann darf ihm nichts weggeschoben werden. */
export function hasStoredFabPos(bp: FabBreakpoint): boolean {
  return storedFabPos(bp) !== null;
}

export function loadFabPos(bp: FabBreakpoint, vw: number, vh: number, dockTop?: number): FabPos {
  const stored = storedFabPos(bp);
  return stored ? clampFabPos(stored, vw, vh) : defaultFabPos(bp, vw, vh, dockTop);
}

export function saveFabPos(bp: FabBreakpoint, pos: FabPos): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<FabBreakpoint, FabPos>>;
    raw[bp] = pos;
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    // ignore
  }
}

/**
 * Tastatur-Resize erkennen: auf dem Handy (Grobzeiger) schrumpft beim Aufgehen der Bildschirmtastatur
 * die sichtbare Hoehe deutlich, die Breite bleibt, und ein Editierfeld haelt den Fokus — iOS Safari
 * und Chrome (resizes-content) feuern dafuer window-resize. Fixe Elemente bewegt der Browser dabei
 * nicht; nur das Neuplatzieren mit der geschrumpften Hoehe liess den FAB springen (gemessen 158 px
 * bei 844→480). Der FAB bleibt stehen (Nutzerwunsch 27.11.2026) — Achtung, Schwellen: Adressleisten
 * und PWA-Rahmen aendern die Hoehe nur um Dutzend Pixel, Tastaturen um Hunderte.
 */
export function isKeyboardResize(
  prev: { w: number; h: number },
  next: { w: number; h: number },
  opts: { coarse: boolean; editableFocused: boolean },
): boolean {
  if (!opts.coarse || !opts.editableFocused) return false;
  if (Math.abs(next.w - prev.w) > 2) return false;
  return next.h < prev.h - 120;
}

export function clampFabPos(pos: FabPos, vw: number, vh: number, size = FAB_SIZE): FabPos {
  return {
    x: Math.min(Math.max(0, pos.x), Math.max(0, vw - size)),
    y: Math.min(Math.max(0, pos.y), Math.max(0, vh - size)),
  };
}
