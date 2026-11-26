import { t } from "../../shared/i18n/index.ts";
import { StatisticsPage } from "../statistics/StatisticsPage.tsx";
import { CreateSession } from "../new-session/CreateSession.tsx";
import { ApprovalQueuePane } from "../approvals/Approvals.tsx";
import { sessionHash } from "../../app/route.ts";
import { useEffect, useLayoutEffect } from "preact/hooks";
import type { ListPage } from "../../app/route.ts";
import { registerShortcut, comboLabel, ariaCombo } from "../../shared/shortcuts/registry.ts";
import { DesktopPage } from "../desktop/DesktopPage.tsx";
import { MediaPage } from "../media/MediaPage.tsx";
import { SettingsPage } from "../settings/SettingsPage.tsx";
import { StatusPage } from "../status/StatusPage.tsx";
import { VaultTabs } from "../vault/VaultTabs.tsx";
import { TeamsPane } from "../team/TeamsPane.tsx";
import { AutomationsPane } from "../automations/AutomationsPane.tsx";
import { TerminalPage } from "../terminal/TerminalPage.tsx";
import { ReleaseNotesPage } from "../release-notes/ReleaseNotesPage.tsx";
import { PentestPage } from "../pentest/PentestPage.tsx";
import { useHubStatus } from "./hub-status.ts";

export const TITLES: Partial<Record<ListPage, string>> = {
  new: t("common.new_session"),
  approvals: "Freigaben",
  statistics: "Statistik",
  settings: "Einstellungen",
  media: "Medien",
  pc: "Am PC eintippen",
  status: "Provider-Status",
  vault: "Notizen",
  teams: "Agenten-Teams",
  automationen: "Automationen",
  terminal: t("common.terminal"),
  releasenotes: t("common.release_notes"),
  pentest: t("pentest.title"),
};

/**
 * EPIC-P34 T34.2 (desktop only): tool pages use the detail column instead of the 420 px list column.
 * The tiles stay mounted underneath (main.tsx marks them inert) — unmounting would reconnect every
 * WebSocket and could flicker an unsent draft. Data comes from what `App` already polls.
 */
export function ToolPane({
  page,
  onClose,
  onSwitchToken,
  vaultFile = null,
  vaultTab = "notizen",
  statTab = null,
  onPopout,
  closeLabel = t("common.close"),
  escCloses = true,
  closeButton = escCloses,
  initialHash,
}: {
  page: ListPage;
  onClose: () => void;
  onSwitchToken: () => void;
  /** EPIC-P49: Datei-Deep-Link für die Vault-Seite. */
  vaultFile?: string | null;
  /** BUG-0257: Reiter der Analyse-Seite (#/statistik/metriken). */
  statTab?: "hosts" | "metriken" | "inferenz" | null;
  /** EPIC-P74 T74.6: Reiter im Notizen-Bereich (#/notizen/wissen). */
  vaultTab?: "notizen" | "wissen";
  onPopout?: () => void;
  closeLabel?: string;
  /** Im eigenen Fenster schließt Esc nichts: das Fenster gibt man mit dem Knopf zurück. */
  escCloses?: boolean;
  closeButton?: boolean;
  initialHash?: string;
}) {
  const hub = useHubStatus();
  // BUG-0106: Preact 11 spült passive Effekte erst im nächsten
  // requestAnimationFrame — die Pane ist schon sichtbar, bevor dieser
  // Keydown-Listener hängt, und ein sofortiges Esc (unter CI-Last) ging
  // ins Leere. useLayoutEffect hängt die Registrierung synchron beim
  // DOM-Commit. Ein Dialog in der Pane (Farbwähler, T34.5) behandelt Esc
  // selbst und markiert das Event (defaultPrevented).
  // EPIC-P51 T51.5: Esc läuft über die Shortcut-Registry.
  useLayoutEffect(() => {
    if (!escCloses) return;
    const off = registerShortcut("tool.close", (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    });
    return off;
  }, [onClose, escCloses]);
  const title = TITLES[page] ?? "";
  return (
    <section class="tool-pane" aria-label={title}>
      <header class="tool-pane-head">
        <h2>{title}</h2>
        <span >
          {onPopout && (
            <button type="button" class="tool-pane-popout" aria-label={t("common.open_in_window")} title={t("common.open_in_window")} onClick={onPopout}>
              ⧉
            </button>
          )}
          {closeButton && (
            <button type="button" class="tool-pane-close" aria-label={closeLabel} title={t("common.close_combo", { "label": closeLabel, "combo": comboLabel("tool.close") })} aria-keyshortcuts={ariaCombo("tool.close")} data-shortcut="tool.close" onClick={onClose}>
              ×
            </button>
          )}
        </span>
      </header>
      <div class="tool-pane-body">
        {page === "new" && <CreateSession adapters={hub.adapters} hosts={hub.hosts} onCreated={(session) => { location.hash = sessionHash(session.id, session.hostId); }} />}
        {page === "approvals" && <ApprovalQueuePane />}
        {page === "statistics" && <StatisticsPage {...(statTab ? { tab: statTab } : {})} />}
        {page === "settings" && <SettingsPage onSwitchToken={onSwitchToken} />}
        {page === "media" && <MediaPage sessions={hub.sessions} />}
        {page === "pc" && <DesktopPage />}
        {page === "status" && <StatusPage adapters={hub.adapters} usage={hub.usage} />}
        {page === "vault" && <VaultTabs {...(vaultFile ? { initialFile: vaultFile } : {})} initialTab={vaultTab} />}
        {page === "teams" && <TeamsPane initialHash={initialHash} />}
        {page === "automationen" && <AutomationsPane />}
        {page === "terminal" && <TerminalPage />}
        {page === "releasenotes" && <ReleaseNotesPage />}
        {page === "pentest" && <PentestPage />}
      </div>
    </section>
  );
}
