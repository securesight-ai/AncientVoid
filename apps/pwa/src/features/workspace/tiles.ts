import { parseContent, type WorkspaceContent } from "./content.ts";
/**
 * EPIC-P18 T18.2: the tile workspace as plain data — which layout, which
 * session in which tile, which tile has focus. Rendering and keys live in
 * TileWorkspace.tsx; everything here is pure and unit-tested.
 *
 * Four legacy slots grow into a scrolling grid when more content opens.
 * The layout decides how many of the first four slots are visible.
 * A slot hidden by a smaller layout keeps its session, so switching back
 * brings it back instead of silently dropping it.
 */

export const LAYOUTS = ["1", "2v", "3v", "2h", "1+2", "2x2"] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface TileRef {
  /** Empty for global pages and project files; content identifies those cards. */
  sessionId: string;
  content?: WorkspaceContent;
  hostId?: string;
}

export interface Workspace {
  layout: Layout;
  slots: (TileRef | null)[];
  focus: number;
  /** QoL 2026-10-29: gezogene Kachelgrößen — Anteil der ersten Spalte
   * (zweispaltige Layouts) bzw. ersten Zeile (zweizeilige) als Bruchteil,
   * je auf 0.2–0.8 geklemmt. Ohne Angabe gilt der Layout-Default. */
  sizes?: { col?: number; row?: number; col2?: number };
  /** EPIC-P34 T34.10: Sessions, die in einem eigenen Fenster laufen. Fehlt in alten Ständen. */
  detached?: TileRef[];
  /** Fixiertes Raster (Default an): Öffnen wächst nicht; Schließen lässt leere Slots stehen.
   * Nur `false` löst — fehlendes Feld in alten Ständen gilt als fixiert. */
  layoutFixed?: boolean;
}

/** Default an: nur explizites `false` löst das Raster. */
export function isLayoutFixed(ws: Workspace): boolean {
  return ws.layoutFixed !== false;
}

const COUNT: Record<Layout, number> = { "1": 1, "2v": 2, "3v": 3, "2h": 2, "1+2": 3, "2x2": 4 };
/** "Open in a new tile" grows along this path. */
const GROW: Record<number, Layout> = { 1: "2v", 2: "1+2", 3: "2x2" };

export const LAYOUT_LABELS: Record<Layout, string> = {
  "1": "Eine Kachel",
  "2v": "Zwei nebeneinander",
  "3v": "Drei nebeneinander",
  "2h": "Zwei übereinander",
  "1+2": "Eine groß, zwei daneben",
  "2x2": "Vier als Raster",
};

export function tileCount(layout: Layout): number {
  return COUNT[layout];
}

export function emptyWorkspace(): Workspace {
  return { layout: "1", slots: [null, null, null, null], focus: 0, layoutFixed: true };
}

export function visibleTiles(ws: Workspace): (TileRef | null)[] {
  return ws.slots.slice(0, ws.slots.length > 4 ? ws.slots.length : COUNT[ws.layout]);
}

function same(x: TileRef | null, y: TileRef): boolean {
  return x !== null && x.sessionId === y.sessionId && (x.hostId ?? null) === (y.hostId ?? null) && JSON.stringify(parseContent(x.content) ?? { kind: "session", tab: "chat" }) === JSON.stringify(parseContent(y.content) ?? { kind: "session", tab: "chat" });
}

function isSessionCard(ref: TileRef): boolean {
  const content = parseContent(ref.content);
  return !!ref.sessionId && (!content || content.kind === "session");
}

function sameSessionCard(x: TileRef | null, y: TileRef): boolean {
  return x !== null && isSessionCard(x) && isSessionCard(y) && x.sessionId === y.sessionId && (x.hostId ?? null) === (y.hostId ?? null);
}

function put(ws: Workspace, index: number, ref: TileRef | null): Workspace {
  const slots = [...ws.slots];
  slots[index] = ref;
  return { ...ws, slots, focus: index };
}

/** All opening paths share the non-destructive default. */
export function openSession(ws: Workspace, ref: TileRef): Workspace {
  return openInNewTile(ws, ref);
}

/**
 * Schon offene Session-Karte fokussieren (Liste/Wechsel), ohne zweite Kachel.
 * Inhalt/Tab der bestehenden Karte bleibt; nur der Fokus springt hin.
 */
export function focusOpenSession(ws: Workspace, ref: TileRef): Workspace | null {
  if (!isSessionCard(ref)) return null;
  const at = ws.slots.findIndex((t) => sameSessionCard(t, ref));
  if (at < 0) return null;
  const visible = COUNT[ws.layout];
  if (at < visible) return { ...ws, focus: at };
  if (isLayoutFixed(ws)) {
    // Hinter dem fixierten Raster: mit dem Fokus-Slot tauschen, Layout bleibt.
    const target = Math.min(Math.max(0, ws.focus), visible - 1);
    const slots = [...ws.slots];
    [slots[target], slots[at]] = [slots[at]!, slots[target] ?? null];
    return { ...ws, slots, focus: target };
  }
  const layout = (GROW[at] ?? "2x2") as Layout;
  return { ...ws, layout, focus: at };
}

/** Open without eviction, including slots hidden by a smaller chosen layout. */
export function openInNewTile(ws: Workspace, ref: TileRef): Workspace {
  const at = ws.slots.findIndex((t) => same(t, ref));
  if (at >= 0) {
    const layout = !isLayoutFixed(ws) && at >= COUNT[ws.layout] ? (GROW[at] ?? "2x2") : ws.layout;
    return { ...ws, layout, focus: at };
  }

  // Fixiertes Raster: dieselbe Session (anderer Tab) aktualisiert die bestehende Karte.
  if (isLayoutFixed(ws) && isSessionCard(ref)) {
    const sessionAt = ws.slots.findIndex((t) => sameSessionCard(t, ref));
    if (sessionAt >= 0) return put(ws, sessionAt, ref);
  }

  if (isLayoutFixed(ws)) {
    const visible = COUNT[ws.layout];
    const empty = ws.slots.slice(0, visible).findIndex((t) => t === null);
    const index = empty >= 0 ? empty : Math.min(Math.max(0, ws.focus), visible - 1);
    return put(ws, index, ref);
  }

  const empty = ws.slots.indexOf(null);
  const index = empty >= 0 ? empty : ws.slots.length;
  const needed = Math.max(index + 1, ws.slots.reduce((last, t, i) => (t === null ? last : i + 1), 0));
  const layout = needed > COUNT[ws.layout] ? (GROW[needed - 1] ?? "2x2") : ws.layout;
  return put({ ...ws, layout }, index, ref);
}

/** BUG-0244: feste Kachel (Neue Session → Index 0). Belegte Kachel wird verschoben, nicht verworfen. */
export function openInTile(ws: Workspace, ref: TileRef, index: number): Workspace {
  if (index < 0) return openInNewTile(ws, ref);
  const at = ws.slots.findIndex((t) => same(t, ref));
  if (at === index) return { ...ws, focus: index };
  const slots = Array.from({ length: Math.max(4, ws.slots.length, index + 1) }, (_, i) => ws.slots[i] ?? null);
  if (at >= 0) slots[at] = null;
  const displaced = slots[index];
  slots[index] = at >= 0 ? (ws.slots[at] as TileRef) : ref;
  if (displaced && !(at >= 0 && same(displaced, ref))) {
    const empty = slots.findIndex((t, i) => i !== index && t === null);
    if (empty >= 0) slots[empty] = displaced;
    else slots.push(displaced);
  }
  const needed = slots.reduce((last, t, i) => (t === null ? last : i + 1), 0);
  const layout = !isLayoutFixed(ws) && needed > COUNT[ws.layout] ? (GROW[needed - 1] ?? "2x2") : ws.layout;
  return { ...ws, slots, layout, focus: index };
}

/** BUG-0245: Lücken nach Ablösen/Schließen schließen und Layout auf die belegten Kacheln schrumpfen. */
export function compactTiles(ws: Workspace): Workspace {
  const filled = ws.slots.filter((t): t is TileRef => t !== null);
  const slots = Array.from({ length: Math.max(4, filled.length) }, (_, i) => filled[i] ?? null);
  const n = Math.max(1, filled.length);
  const layout: Layout = n <= 1 ? "1" : n === 2 ? (ws.layout === "2h" ? "2h" : "2v") : n === 3 ? (ws.layout === "3v" ? "3v" : "1+2") : "2x2";
  const focus = Math.min(ws.focus, Math.max(0, Math.min(n, COUNT[layout]) - 1));
  return { ...ws, slots, layout, focus };
}

export function setLayout(ws: Workspace, layout: Layout): Workspace {
  return { ...ws, layout, focus: Math.min(ws.focus, COUNT[layout] - 1) };
}

export function setLayoutFixed(ws: Workspace, layoutFixed: boolean): Workspace {
  if (isLayoutFixed(ws) === layoutFixed) return ws;
  return layoutFixed ? { ...ws, layoutFixed: true } : compactTiles({ ...ws, layoutFixed: false });
}

export function cycleLayout(ws: Workspace, dir: 1 | -1): Workspace {
  const i = LAYOUTS.indexOf(ws.layout);
  return setLayout(ws, LAYOUTS[(i + dir + LAYOUTS.length) % LAYOUTS.length]!);
}

export function focusTile(ws: Workspace, index: number): Workspace {
  return index >= 0 && index < visibleTiles(ws).length ? { ...ws, focus: index } : ws;
}

/** Hyprland's swap: the focused session trades places with tile n. */
export function swapWith(ws: Workspace, index: number): Workspace {
  if (index < 0 || index >= visibleTiles(ws).length || index === ws.focus) return ws;
  const slots = [...ws.slots];
  [slots[ws.focus], slots[index]] = [slots[index]!, slots[ws.focus]!];
  return { ...ws, slots, focus: index };
}

/** Kachel schließen: ohne Fix kompakt (Slot weg, Layout schrumpft); mit Fix nur leeren. */
export function closeTile(ws: Workspace, index: number): Workspace {
  if (index < 0 || index >= ws.slots.length || ws.slots[index] === null) return ws;
  const slots = [...ws.slots];
  slots[index] = null;
  const next = { ...ws, slots, focus: Math.min(ws.focus, Math.max(0, (isLayoutFixed(ws) ? COUNT[ws.layout] : Math.max(1, slots.filter(Boolean).length)) - 1)) };
  return isLayoutFixed(ws) ? next : compactTiles(next);
}

const MIN_TILE_SHARE = 0.2;
const MAX_TILE_SHARE = 0.8;

/** Wirksame Anteile inklusive Layout-Default („1+2“ startet 1.35:1, „3v“ drittelgleich).
 * col2 ist die zweite Spaltengrenze des Dreispalters und bleibt immer ein Stück rechts von col. */
export function tileFractions(ws: Workspace): { col: number; row: number; col2: number } {
  const clamp = (v: number | undefined, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_TILE_SHARE, Math.max(MIN_TILE_SHARE, v)) : d;
  const col = clamp(ws.sizes?.col, ws.layout === "1+2" ? 0.575 : ws.layout === "3v" ? 1 / 3 : 0.5);
  return { col, row: clamp(ws.sizes?.row, 0.5), col2: Math.max(clamp(ws.sizes?.col2, 2 / 3), col + 0.1) };
}

/** Ein beendeter Divider-Zug: Anteil speichern (geklemmt auf 0.2–0.8). */
export function resizeTile(ws: Workspace, axis: "col" | "row" | "col2", fraction: number): Workspace {
  const f = Math.min(MAX_TILE_SHARE, Math.max(MIN_TILE_SHARE, fraction));
  return { ...ws, sizes: { ...ws.sizes, [axis]: f } };
}

export function isDetached(ws: Workspace, ref: TileRef): boolean {
  return (ws.detached ?? []).some((d) => same(d, ref));
}

/** Die Kachel wandert in ein eigenes Fenster: Slot weg (kompakt), Session wird vermerkt. */
export function detachTile(ws: Workspace, index: number): Workspace {
  const ref = ws.slots[index];
  if (!ref) return ws;
  const detached = isDetached(ws, ref) ? (ws.detached ?? []) : [...(ws.detached ?? []), ref];
  const slots = [...ws.slots];
  slots[index] = null;
  return compactTiles({ ...ws, slots, detached, focus: ws.focus === index ? 0 : ws.focus > index ? ws.focus - 1 : ws.focus });
}

/** „In die App zurück“: aus der Liste der Fenster nehmen und wieder in eine Kachel öffnen. */
export function reattach(ws: Workspace, ref: TileRef): Workspace {
  const rest = (ws.detached ?? []).filter((d) => !same(d, ref));
  const { detached: _old, ...base } = ws;
  return openInNewTile(rest.length > 0 ? { ...base, detached: rest } : base, ref);
}

/** Ein Fenster, das nicht mehr antwortet, ist keine Ablage mehr: nur aus der Liste nehmen. */
export function forgetDetached(ws: Workspace, ref: TileRef): Workspace {
  const rest = (ws.detached ?? []).filter((d) => !same(d, ref));
  const { detached: _old, ...base } = ws;
  return rest.length > 0 ? { ...base, detached: rest } : base;
}

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify(ws);
}

function tileRef(raw: unknown): TileRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { sessionId, hostId, content: value } = raw as { sessionId?: unknown; hostId?: unknown; content?: unknown };
  const content = parseContent(value);
  if (value !== undefined && !content) return null;
  if (typeof sessionId !== "string" || (!sessionId && !content)) return null;
  return { sessionId, ...(typeof hostId === "string" && hostId ? { hostId } : {}), ...(content ? { content } : {}) };
}

/** Whatever localStorage holds: a valid workspace or an empty one. */
export function parseWorkspace(raw: string | null): Workspace {
  if (!raw) return emptyWorkspace();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyWorkspace();
  }
  const { layout, slots, focus, sizes, detached, layoutFixed } = (data ?? {}) as { layout?: unknown; slots?: unknown; focus?: unknown; sizes?: unknown; detached?: unknown; layoutFixed?: unknown };
  if (!LAYOUTS.includes(layout as Layout) || !Array.isArray(slots)) return emptyWorkspace();
  const ws: Workspace = { layout: layout as Layout, slots: Array.from({ length: Math.max(4, slots.length) }, (_, i) => tileRef(slots[i])), focus: 0 };
  const sized =
    sizes && typeof sizes === "object"
      ? {
          ...(typeof (sizes as { col?: unknown }).col === "number" ? { col: (sizes as { col: number }).col } : {}),
          ...(typeof (sizes as { row?: unknown }).row === "number" ? { row: (sizes as { row: number }).row } : {}),
          ...(typeof (sizes as { col2?: unknown }).col2 === "number" ? { col2: (sizes as { col2: number }).col2 } : {}),
        }
      : undefined;
  const away = Array.isArray(detached) ? detached.map(tileRef).filter((r): r is TileRef => r !== null) : [];
  return focusTile({
    ...ws,
    ...(sized && (sized.col !== undefined || sized.row !== undefined || sized.col2 !== undefined) ? { sizes: sized } : {}),
    ...(away.length > 0 ? { detached: away } : {}),
    layoutFixed: layoutFixed !== false,
  }, typeof focus === "number" ? focus : 0);
}
