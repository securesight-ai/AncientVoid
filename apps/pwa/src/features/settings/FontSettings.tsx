import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { APPEARANCE_EVENT, clampFontScale, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, FONTS, getAppearance, setAppearance, type FontId } from "../../app/appearance.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

function useAppearance() {
  const [appearance, setState] = useState(getAppearance());
  useEffect(() => {
    const sync = () => setState(getAppearance());
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);
  return appearance;
}

/** Jeder Eintrag ist in seiner eigenen Schrift gesetzt, die Wahl wirkt sofort (Vorschau daneben). */
function FontChoices({ label, value, onPick, monoOnly }: { label: string; value: FontId; onPick: (id: FontId) => void; monoOnly?: boolean }) {
  return (
    <div class="font-choices" role="radiogroup" aria-label={label}>
      {FONTS.filter((f) => !monoOnly || f.mono).map((f) => (
        <button key={f.id} type="button" role="radio" aria-checked={f.id === value} class={`font-choice${f.id === value ? " active" : ""}`} style={{ fontFamily: f.stack }} onClick={() => onPick(f.id)}>
          <span class="font-sample" aria-hidden="true">
            {t("settings.aa")}
          </span>
          <span class="font-name">{f.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Gruppe „Schrift“: Oberflächenschrift, Codeschrift (nur Festbreite) und Textgröße. */
export function FontSettings() {
  const a = useAppearance();
  const pct = Math.round(a.fontScale * 100);
  return (
    <SettingsSection title={t("settings.font")}>
      <p class="settings-intro dim">{t("settings.ui_font_note")}</p>
      <div class="font-block">
        <span class="setting-title">{t("settings.interface")}</span>
        <FontChoices label={t("settings.font_ui")} value={a.fontUi} onPick={(fontUi) => setAppearance({ ...a, fontUi })} />
      </div>
      <div class="font-block">
        <span class="setting-title">{t("settings.code_diff")}</span>
        <FontChoices label={t("settings.font_code")} value={a.fontCode} monoOnly onPick={(fontCode) => setAppearance({ ...a, fontCode })} />
      </div>
      <SettingRow label={t("settings.font_size")} hint="nur Text — der Zoom skaliert die ganze Oberfläche">
        <span class="scale-control">
          <Button aria-label={t("settings.decrease_font")} title={t("settings.decrease_font")} disabled={a.fontScale <= FONT_SCALE_MIN} onClick={() => setAppearance({ ...a, fontScale: clampFontScale(a.fontScale - FONT_SCALE_STEP) })}>
            −
          </Button>
          <span class="font-scale-value mono" aria-live="polite">
            {pct} %
          </span>
          <Button aria-label={t("settings.increase_font")} title={t("settings.increase_font")} disabled={a.fontScale >= FONT_SCALE_MAX} onClick={() => setAppearance({ ...a, fontScale: clampFontScale(a.fontScale + FONT_SCALE_STEP) })}>
            +
          </Button>
          <Button aria-label={t("settings.reset_font")} disabled={a.fontScale === 1} onClick={() => setAppearance({ ...a, fontScale: 1 })}>
            100 %
          </Button>
        </span>
      </SettingRow>
    </SettingsSection>
  );
}
