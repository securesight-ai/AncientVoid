import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useOverlayFocus } from "../overlay-focus.ts";

/**
 * EPIC-P63 T63.8: Blatt-Baustein — Overlays mit Hinterlegung, Fokusfalle
 * (Tab bleibt im Blatt, Fokus kehrt zum Auslöser zurück) und Esc. Baut auf
 * shared/overlay-focus.ts (T51.6) auf; Stile: styles/ui/sheet.css.
 *
 * `variant="sheet"` (Standard): unten am Rand (Skill/Nyx/Mehr).
 * `variant="modal"`: zentrierte Karte (Sammelversand, Modell-Dialog, Trace).
 */

/** BUG-0291: Esc schließt bei geschachtelten Blättern/Modals (z. B.
 * Neue-Session-Modal mit eigenem Modell-Dialog darin) nur das zuoberst
 * geöffnete — vorher nahm ein Tastendruck alle gleichzeitig mit. */
const escStack: { fire: () => void }[] = [];
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Name für Screenreader (aria-label des Dialogs). */
  label: string;
  variant?: "sheet" | "modal";
  /** Element, das beim Öffnen den Fokus bekommen soll (z. B. die erste Taste). */
  preferred?: () => HTMLElement | null;
  /** Testanker für E2E-Specs. */
  testid?: string;
  class?: string;
  children?: ComponentChildren;
}

export function Sheet({ open, onClose, label, variant = "sheet", preferred, testid, class: cls, children }: SheetProps) {
  const { ref } = useOverlayFocus<HTMLDivElement>(open, { preferred });
  // BUG-0291: onClose über Ref — die Stapelreihenfolge (oben = zuletzt
  // geöffnet) darf durch Neu-Render mit neuer Callback-Identität nicht
  // umsortiert werden.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const entry = { fire: () => closeRef.current() };
    escStack.push(entry);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (escStack[escStack.length - 1] !== entry) return;
      // Konvention der Shortcut-Registry: preventDefault markiert „erledigt“ —
      // darunterliegende Esc-Handler (z. B. tool.close der Werkzeugfläche)
      // schließen nicht mit (ein Esc, eine Ebene).
      e.preventDefault();
      entry.fire();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = escStack.indexOf(entry);
      if (at >= 0) escStack.splice(at, 1);
    };
  }, [open]);
  if (!open) return null;
  const classes = ["ui-sheet", variant === "modal" ? "ui-sheet--modal" : null, cls].filter(Boolean).join(" ");
  return (
    <>
      {/* window-backdrop: gemeinsame Marke aller Fenster-Hinterlegungen (61-depth3d.css). */}
      <div class="ui-sheet-backdrop window-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref as never}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabindex={-1}
        class={classes}
        data-testid={testid}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}
