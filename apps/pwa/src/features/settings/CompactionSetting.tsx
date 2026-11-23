import { useEffect, useState } from "preact/hooks";
import { hubApi } from "../../shared/api.ts";
import { t } from "../../shared/i18n/index.ts";
import { Switch } from "../../shared/ui/index.ts";
import { SettingRow } from "./parts.tsx";

export function CompactionSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hubApi.compactionSettings()
      .then((settings) => setEnabled(settings.enabled))
      .catch(() => setError(t("settings.settings_unreachable")));
  }, []);

  async function save(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      setEnabled((await hubApi.setCompactionSettings({ enabled: next })).enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.settings_unreachable"));
    } finally {
      setSaving(false);
    }
  }

  const label = t("settings.compaction");
  return (
    <>
      <SettingRow label={label} hint={t("settings.compaction_note")}>
        <Switch checked={enabled === true} label={label} disabled={enabled === null || saving} onChange={(next) => void save(next)} />
      </SettingRow>
      {error && <div class="reply-error" role="alert">{error}</div>}
    </>
  );
}
