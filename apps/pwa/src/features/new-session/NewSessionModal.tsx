import { t } from "../../shared/i18n/index.ts";
import { pageHash, sessionHash } from "../../app/route.ts";
import { popView } from "../../shared/nav-history.ts";
import { useHubStatus } from "../shell/hub-status.ts";
import { Sheet } from "../../shared/ui/index.ts";
import { CreateSession } from "./CreateSession.tsx";

/**
 * BUG-0291: „Neue Session“ am PC/Tablet (wide) als Modal über allem — die
 * Form belegte bisher Kachel 1 (BUG-0244) und vertrieb damit das Raster,
 * und nach dem Start blieb sie in der Kachel stehen. Das Modal hängt an der
 * Route (`#/neu`): Startet die Session, springt der Hash auf sie und das
 * Modal geht damit von selbst zu; Esc/Hintergrund/✕ kehren auf die gemerkte
 * Ansicht davor zurück (popView, Muster der Anhang-Ansicht). Am Handy bleibt
 * der Seiten-Flow (App rendert CreateSession selbst).
 */
export function NewSessionModal({ open }: { open: boolean }) {
  const hub = useHubStatus();
  const close = () => {
    location.hash = popView() ?? pageHash("dashboard");
  };
  return (
    <Sheet open={open} onClose={close} label={t("common.new_session")} variant="modal" testid="new-session-modal" class="new-session-modal">
      <div class="new-session-modal-head">
        <h3>{t("common.new_session")}</h3>
        {/* tool-pane-close: Zielflächengröße (--icon-target) wie die ×-Taste der Werkzeugfläche. */}
        <button type="button" class="tool-pane-close" aria-label={t("common.close")} title={t("common.close")} onClick={close}>
          ×
        </button>
      </div>
      <CreateSession
        adapters={hub.adapters}
        hosts={hub.hosts}
        onCreated={(session) => {
          location.hash = sessionHash(session.id, session.hostId);
        }}
      />
    </Sheet>
  );
}
