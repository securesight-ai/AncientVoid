import { useEffect } from "preact/hooks";
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const classes = ["ui-sheet", variant === "modal" ? "ui-sheet--modal" : null, cls].filter(Boolean).join(" ");
  return (
    <>
      <div class="ui-sheet-backdrop" onClick={onClose} aria-hidden="true" />
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
