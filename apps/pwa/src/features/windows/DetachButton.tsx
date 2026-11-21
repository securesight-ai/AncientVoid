import { t } from "../../shared/i18n/index.ts";
import { useState } from "preact/hooks";
import type { WindowTarget } from "./protocol.ts";
import { isPopoutWindow, openPopout } from "./windows.ts";

/** Fenster gibt es nur am PC (ab 1280 px) und nie im Fenster selbst (ADR-0068 Punkt 6). */
export function canDetach(): boolean {
  return !isPopoutWindow() && matchMedia("(min-width: 1280px)").matches;
}

/**
 * EPIC-P43 T43.7 (ADR-0068): die eine Taste fürs Herauslösen — immer die letzte im Kopf, 30 px, `⧉` mit
 * aria-label und Tooltip; das Wort „Herauslösen“ zeigt sich beim Überfahren und bei Fokus.
 * `onDetached` läuft, wenn das Fenster aufging (oder schon offen war und nach vorn kam).
 */
export function DetachButton({ target, label, onDetached, class: cls }: { target: WindowTarget; label: string; onDetached?: () => void; class?: string }) {
  const [blocked, setBlocked] = useState(false);
  if (!canDetach()) return null;
  return (
    <span class="detach-wrap">
      <button
        type="button"
        class={`detach-btn${cls ? ` ${cls}` : ""}`}
        aria-label={`${label} in eigenem Fenster öffnen`}
        title={`${label} in eigenem Fenster öffnen`}
        onClick={() =>
          void openPopout(target).then((r) => {
            setBlocked(r === "blocked");
            if (r !== "blocked") onDetached?.();
          })
        }
      >
        <span aria-hidden="true">⧉</span>
        <span class="detach-word">{t("windows.detach")}</span>
      </button>
      {blocked && (
        <span class="detach-blocked" role="alert">
          {t("windows.popups_blocked")}
        </span>
      )}
    </span>
  );
}
