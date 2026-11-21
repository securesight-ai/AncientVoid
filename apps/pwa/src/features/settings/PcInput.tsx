import { t } from "../../shared/i18n/index.ts";
import { useState } from "preact/hooks";
import { DesktopPage } from "../desktop/DesktopPage.tsx";

/**
 * EPIC-P34 T34.1: der Zugang "Am PC eintippen" liegt in den Einstellungen.
 * Der Inhalt wird erst beim Aufklappen eingehängt — DesktopPage fragt sekündlich
 * den Hub ab, das soll nur laufen, solange jemand hinsieht.
 */
export function PcInput() {
  const [open, setOpen] = useState(false);
  return (
    <details class="setting-details" data-testid="pc-input" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{t("settings.pc_input")}</summary>
      {open && <DesktopPage />}
    </details>
  );
}
