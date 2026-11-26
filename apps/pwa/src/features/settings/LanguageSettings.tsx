// EPIC-P61 T61.2: Sprache ist eine Geräte-Einstellung (localStorage, wie die
// Presets). Der Wechsel lädt die PWA neu (deterministisch, ADR-0101); die
// Draft-Persistenz (Composer/Vormerkung) überlebt den Reload. Unvollständige
// Kataloge sind wählbar, solange die Ratchet-Baseline nicht leer ist
// (Premortem 1) — sichtbar über das Dev-Flag `ancientvoid.i18n-dev`.
import { SettingRow, Segmented } from "./parts.tsx";
import { availableLanguages, getLanguageSetting, setLanguageSetting, t, type LanguageSetting } from "../../shared/i18n/index.ts";

function i18nDevFlagOn(): boolean {
  try {
    return globalThis.localStorage?.getItem("ancientvoid.i18n-dev") === "1";
  } catch {
    return false;
  }
}

function selectableLanguages(): { value: LanguageSetting; label: string }[] {
  const opts: { value: LanguageSetting; label: string }[] = [{ value: "auto", label: t("settings.language.auto") }];
  for (const lang of availableLanguages) if (lang.complete || i18nDevFlagOn()) opts.push({ value: lang.code, label: lang.label });
  return opts;
}

export function LanguageSettingRow() {
  const options = selectableLanguages();
  const setting = getLanguageSetting();

  const choose = (next: LanguageSetting) => {
    if (next === setting) return;
    setLanguageSetting(next);
    // ADR-0101: Reload statt Live-Re-Render — deterministisch, Entwürfe bleiben.
    location.reload();
  };

  return (
    <SettingRow label={t("settings.language.title")} hint={t("settings.language.hint")}>
      <Segmented label={t("settings.language.title")} value={setting} options={options} onChange={choose} />
    </SettingRow>
  );
}
