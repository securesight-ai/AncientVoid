import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { APPEARANCE_EVENT, DEFAULT_APPEARANCE, getAppearance, isDefaultAppearance, setAppearance } from "../../app/appearance.ts";
import { StatusDot } from "../../shared/StatusDot.tsx";
import { SettingsSection } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

/**
 * Gruppe „Vorschau“: ein kleiner Chat mit den echten Klassen der Oberfläche — Akzent, Oberflächen- und
 * Codeschrift, Status-Farben —, damit jede Änderung ohne Seitenwechsel zu sehen ist.
 */
export function PreviewSettings() {
  const [custom, setCustom] = useState(!isDefaultAppearance(getAppearance()));
  useEffect(() => {
    const sync = () => setCustom(!isDefaultAppearance(getAppearance()));
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);
  return (
    <SettingsSection title={t("settings.preview")} class="settings-preview">
      <div class="preview-chat" aria-hidden="true">
        <div class="event user own">
          <div class="summary prose">{t("settings.du_example")}</div>
        </div>
        <p class="preview-text">
          {t("settings.i_found_cause")} <code class="preview-code">{t("settings.clear_timeout")}</code> {t("settings.stands_after")} <strong>{t("settings.await")}</strong>.
        </p>
        <pre class="preview-diff">{t("settings.diff_example")}</pre>
        <div class="preview-chips">
          <StatusDot status="working" />
          <StatusDot status="waiting_approval" />
          <StatusDot status="waiting_approval" question />
          <StatusDot status="idle" unseen />
          <StatusDot status="error" />
          <StatusDot status="idle" />
          <span class="ui-button ui-button--primary preview-button">{t("session.send")}</span>
          <span class="preview-link">{t("settings.link")}</span>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <span class="setting-title">{t("settings.reset_appearance")}</span>
          <span class="dim setting-hint">{t("settings.accent_fonts")}</span>
        </div>
        <div class="setting-control">
          <Button disabled={!custom} onClick={() => setAppearance(DEFAULT_APPEARANCE)}>
            {t("settings.reset")}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
