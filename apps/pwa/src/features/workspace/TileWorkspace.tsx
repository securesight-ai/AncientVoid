import { WorkspaceTile } from "./WorkspaceTile.tsx";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Page } from "../../app/Dock.tsx";
import type { DropPoint } from "../windows/drag.ts";
import { closeTile, cycleLayout, focusTile, isLayoutFixed, LAYOUT_LABELS, LAYOUTS, resizeTile, setLayout, setLayoutFixed, swapWith, tileCount, tileFractions, visibleTiles, type Layout, type TileRef, type Workspace } from "./tiles.ts";
import { ariaCombo, comboLabel, registerShortcut } from "../../shared/shortcuts/registry.ts";
import { Button, Chip } from "../../shared/ui/index.ts";

/** Tiles below this height start with the controls folded (P18 premortem 3). */
const COMPACT_TILE_PX = 800;

/** EPIC-P18 T18.3/T18.4: content cards in the existing grid, with Hyprland-style keys. */
export function TileWorkspace({
  ws,
  onChange,
  onNavigate,
  listCollapsed,
  onToggleList,
  onPopout,
  onSwitchToken,
}: {
  onSwitchToken: () => void;
  /** EPIC-P34 T34.10: die Session der Kachel in ein eigenes Fenster legen. */
  onPopout?: (index: number, drop?: DropPoint) => void;
  listCollapsed: boolean;
  onToggleList: () => void;
  ws: Workspace;
  onChange: (ws: Workspace) => void;
  onNavigate: (page: Page) => void;
}) {
  const count = visibleTiles(ws).length;
  const overflow = count > 4;
  // BUG-0071: the handler works on the NEWEST state, not the one of its last render — two shortcuts
  // within one tick (fast typing, a loaded machine) must compose instead of the second one
  // starting from the state before the first. EPIC-P51 T51.5: Registrierung
  // über die Shortcut-Registry statt eigenem window-Listener.
  const latest = useRef(ws);
  latest.current = ws;
  useEffect(() => {
    const apply = (next: Workspace | null) => {
      if (!next) return;
      latest.current = next;
      onChange(next);
    };
    const tile = (n: number, e: KeyboardEvent) => {
      e.preventDefault();
      const cur = latest.current;
      apply(e.shiftKey ? swapWith(cur, n - 1) : focusTile(cur, n - 1));
    };
    const offs = [
      registerShortcut("workspace.tile-1", (e) => tile(1, e)),
      registerShortcut("workspace.tile-2", (e) => tile(2, e)),
      registerShortcut("workspace.tile-3", (e) => tile(3, e)),
      registerShortcut("workspace.tile-4", (e) => tile(4, e)),
      registerShortcut("workspace.tile-swap-1", (e) => tile(1, e)),
      registerShortcut("workspace.tile-swap-2", (e) => tile(2, e)),
      registerShortcut("workspace.tile-swap-3", (e) => tile(3, e)),
      registerShortcut("workspace.tile-swap-4", (e) => tile(4, e)),
      registerShortcut("workspace.layout", (e) => {
        e.preventDefault();
        apply(cycleLayout(latest.current, e.shiftKey ? -1 : 1));
      }),
      registerShortcut("workspace.tile-close", (e) => {
        e.preventDefault();
        apply(closeTile(latest.current, latest.current.focus));
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [onChange]);

  // A tile in a stacked layout gets half the height (or less).
  const stacked = ws.layout === "2h" || ws.layout === "2x2" || ws.layout === "1+2";
  const compact = stacked && window.innerHeight / 2 < COMPACT_TILE_PX;

  // QoL 2026-10-29 (K2): Kacheln per Divider-Zug größer/kleiner — der Zug
  // läuft über einen lokalen Override (kein State-Stampede während des
  // Ziehens), commit und Persistenz erst am Ende über onChange.
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ axis: "col" | "row" | "col2"; fraction: number } | null>(null);
  const fractions = tileFractions(ws);
  const col = drag?.axis === "col" ? drag.fraction : fractions.col;
  const row = drag?.axis === "row" ? drag.fraction : fractions.row;
  const col2 = drag?.axis === "col2" ? drag.fraction : fractions.col2;
  const startDrag = (axis: "col" | "row" | "col2") => (e: PointerEvent) => {
    e.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const clampTo = (f: number) => Math.min(0.8, Math.max(0.2, f));
    const from = (ev: PointerEvent) => clampTo(axis === "row" ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width);
    const move = (ev: PointerEvent) => setDrag({ axis, fraction: from(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      onChange(resizeTile(latest.current, axis, from(ev)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    setDrag({ axis, fraction: from(e) });
  };
  const template = (() => {
    // Spalten: erste Kachel `col`, Divider-Spur, Rest; Zeilen analog. Beim Dreispalter
    // gilt col2 als zweite Grenze; die Grenze darf col nie einholen (0.1 Mindest-Staffel).
    const threeCol = (() => {
      const c1 = Math.min(col, col2 - 0.1);
      const c2 = Math.max(col2, c1 + 0.1);
      return `${c1}fr 10px ${c2 - c1}fr 10px ${1 - c2}fr`;
    })();
    const cols = ws.layout === "3v" ? threeCol : ws.layout === "2v" || ws.layout === "1+2" || ws.layout === "2x2" ? `${col}fr 10px ${1 - col}fr` : "1fr";
    const rows = ws.layout === "2h" || ws.layout === "1+2" || ws.layout === "2x2" ? `${row}fr 10px ${1 - row}fr` : "1fr";
    return { gridTemplateColumns: cols, gridTemplateRows: rows } as const;
  })();

  return (
    <div class="tile-workspace">
      <div class="tile-bar" role="toolbar" aria-label="Kachel-Layout">
        <button type="button" class="tile-list-toggle" onClick={onToggleList} aria-expanded={!listCollapsed}>
          {listCollapsed ? "☰ Liste ausklappen" : "⟨ Liste einklappen"}
        </button>
        {LAYOUTS.map((layout) => (
          <Button
            key={layout}
            aria-pressed={layout === ws.layout}
            aria-label={LAYOUT_LABELS[layout]}
            aria-keyshortcuts={ariaCombo("workspace.layout")}
            title={`${LAYOUT_LABELS[layout]} (${comboLabel("workspace.layout")} wechselt)`}
            onClick={() => onChange(setLayout(ws, layout))}
            class={`tile-layout-btn${layout === ws.layout ? " active" : ""}`}
          >
            <LayoutGlyph layout={layout} />
          </Button>
        ))}
        <Button
          aria-pressed={isLayoutFixed(ws)}
          aria-label={isLayoutFixed(ws) ? "Layout lösen" : "Layout fixieren"}
          title={isLayoutFixed(ws) ? "Layout gelöst — Öffnen kann neue Kacheln anlegen" : "Layout fixieren — Öffnen bleibt im Raster, schon offene Sessions springen hin"}
          onClick={() => onChange(setLayoutFixed(ws, !isLayoutFixed(ws)))}
          class={`tile-layout-btn tile-layout-fix${isLayoutFixed(ws) ? " active" : ""}`}
        >
          <span class="tile-glyph layout-fix" aria-hidden="true"><span /></span>
        </Button>
        {/* Dieselben Aktionen wie die Tastenkürzel, damit sie auch per Tipp gehen (Tablet, Touch). */}
        <div class="tile-actions" role="group" aria-label="Kachel-Aktionen">
          <Chip title={`Fokus auf die vorige Kachel (${comboLabel("workspace.tile-1")}–4 wählt direkt)`} data-shortcut="workspace.tile-1" disabled={count < 2} onClick={() => onChange(focusTile(ws, (ws.focus + count - 1) % count))}>
            ‹ Fokus
          </Chip>
          <Chip title={`Fokus auf die nächste Kachel (${comboLabel("workspace.tile-1")}–4 wählt direkt)`} data-shortcut="workspace.tile-1" disabled={count < 2} onClick={() => onChange(focusTile(ws, (ws.focus + 1) % count))}>
            Fokus ›
          </Chip>
          <Chip title={`Kachel mit der nächsten tauschen (${comboLabel("workspace.tile-swap-1")}–4)`} data-shortcut="workspace.tile-swap-1" disabled={count < 2} onClick={() => onChange(swapWith(ws, (ws.focus + 1) % count))}>
            ⇄ Tauschen
          </Chip>
          <Chip title={`Nächstes Layout (${comboLabel("workspace.layout")})`} data-shortcut="workspace.layout" onClick={() => onChange(cycleLayout(ws, 1))}>
            ⟳ Layout
          </Chip>
          <Chip title={`Fokussierte Kachel schließen (${comboLabel("workspace.tile-close")})`} data-shortcut="workspace.tile-close" onClick={() => onChange(closeTile(ws, ws.focus))}>
            ✕ Schließen
          </Chip>
          {/* EPIC-P51 T51.7: detaillierte Kürzelzeile durch ?-Übersicht ersetzt (aus T43.6 hierher gezogen). */}
          <span class="tile-keys dim">Tastatur: ? zeigt alle Kürzel · Öffnen: {isLayoutFixed(ws) ? "Raster fixiert" : "neue Kachel"}</span>
        </div>
      </div>
      <div ref={gridRef} class={`tile-grid ${overflow ? "layout-overflow" : `layout-${ws.layout.replace("+", "p")}`}`} style={overflow ? undefined : template}>
        {visibleTiles(ws).map((ref, i) => (
          <WorkspaceTile
            key={i}
            onSwitchToken={onSwitchToken}
            index={i}
            tileRef={ref}
            focused={i === ws.focus && count > 1}
            active={i === ws.focus}
            compact={compact && !(ws.layout === "1+2" && i === 0)}
            onFocus={() => ref?.content?.kind !== "search" && i !== ws.focus && onChange(focusTile(ws, i))}
            onClose={() => onChange(closeTile(ws, i))}
            {...(onPopout ? { onPopout: (drop?: DropPoint) => onPopout(i, drop) } : {})}
            onNavigate={onNavigate}
          />
        ))}
        {/* Divider nach den Kacheln — <div> neben <section>, damit die
         * nth-of-type-Platzierung der Kacheln unberührt bleibt. */}
        {!overflow && (ws.layout === "2v" || ws.layout === "1+2" || ws.layout === "2x2" || ws.layout === "3v") && (
          <div
            class="tile-divider col"
            role="separator"
            aria-orientation="vertical"
            aria-label="Kachelbreite ändern"
            onPointerDown={startDrag("col")}
          />
        )}
        {!overflow && ws.layout === "3v" && (
          <div
            class="tile-divider col second"
            role="separator"
            aria-orientation="vertical"
            aria-label="Kachelbreite ändern"
            onPointerDown={startDrag("col2")}
          />
        )}
        {!overflow && ws.layout !== "1" && ws.layout !== "2v" && ws.layout !== "3v" && (
          <div
            class={`tile-divider row${ws.layout === "1+2" ? " right-only" : ""}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Kachelhöhe ändern"
            onPointerDown={startDrag("row")}
          />
        )}
      </div>
    </div>
  );
}

function LayoutGlyph({ layout }: { layout: Layout }) {
  return (
    <span class={`tile-glyph layout-${layout.replace("+", "p")}`} aria-hidden="true">
      {Array.from({ length: tileCount(layout) }, (_, i) => (
        <span key={i} />
      ))}
    </span>
  );
}
