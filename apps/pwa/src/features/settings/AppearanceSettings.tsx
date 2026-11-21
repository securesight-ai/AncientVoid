import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { applyTheme, getTheme, THEME_KEY, type Theme } from "../../app/theme.ts";
import { applyCtxMotion, ctxMotionOn, getScale, setScale, SCALE_MAX, SCALE_MIN, SCALE_STEP } from "../../app/ui-scale.ts";
import { applyShortcutHints, shortcutHintsOn } from "../../shared/shortcut-hint.ts";
import { AccentSetting } from "./AccentPicker.tsx";
import { LanguageSettingRow } from "./LanguageSettings.tsx";
import { SettingRow, SettingsSection, Segmented, Switch } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

/** Gruppe „Darstellung“: Theme, Zoom, Bewegung. Akzent und Schrift kommen mit T34.5/T34.6 hierher. */
export function AppearanceSettings() {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  useEffect(() => {
    const sync = () => setThemeState(getTheme());
    const storage = (e: StorageEvent) => { if (e.key === THEME_KEY || e.key === null) sync(); };
    window.addEventListener("ancientvoid:theme", sync);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener("ancientvoid:theme", sync); window.removeEventListener("storage", storage); };
  }, []);
  // EPIC-P20: the scale changes from the keyboard and wheel too — follow it.
  const [scale, setScaleState] = useState<number>(getScale());
  const [motion, setMotion] = useState<boolean>(ctxMotionOn());
  const [hints, setHints] = useState<boolean>(shortcutHintsOn());
  useEffect(() => {
    const on = (e: Event) => setScaleState((e as CustomEvent<number>).detail);
    window.addEventListener("ancientvoid:scale", on);
    return () => window.removeEventListener("ancientvoid:scale", on);
  }, []);

  return (
    <SettingsSection title={t("settings.appearance")}>
      <SettingRow label={t("settings.look")}>
        <Segmented
          label={t("settings.look")}
          value={theme}
          options={[
            { value: "dark", label: "Dunkel" },
            { value: "light", label: "Hell" },
          ]}
          onChange={(next) => {
            applyTheme(next);
            setThemeState(next);
          }}
        />
      </SettingRow>
      <AccentSetting />
      <SettingRow label={t("settings.ui_zoom")} hint="Strg + Mausrad, Strg + / − , Strg + 0">
        <span class="scale-control">
          <Button aria-label={t("settings.smaller")} title={t("settings.smaller")} disabled={scale <= SCALE_MIN} onClick={() => setScale(scale - SCALE_STEP)}>
            −
          </Button>
          <span class="scale-value mono" aria-live="polite">
            {Math.round(scale * 100)} %
          </span>
          <Button aria-label={t("settings.larger")} title={t("settings.larger")} disabled={scale >= SCALE_MAX} onClick={() => setScale(scale + SCALE_STEP)}>
            +
          </Button>
          <Button disabled={scale === 1} onClick={() => setScale(1)}>
            100 %
          </Button>
        </span>
      </SettingRow>
      <SettingRow label={t("settings.motion")} hint="Atmen, Schimmer, Ruf und Übergänge; „Bewegung reduzieren“ des Systems schaltet sie immer ab">
        <Switch
          label={t("settings.motion")}
          checked={motion}
          onChange={(next) => {
            applyCtxMotion(next);
            setMotion(next);
          }}
        />
      </SettingRow>
      {/* EPIC-P51 T51.8: Klick-Hinweise auf vorhandene Kürzel — Standard an (Lernphase). */}
      <SettingRow label={t("settings.shortcut_hints")} hint="Klick auf eine Aktion mit Kürzel zeigt kurz die Kombination unten an">
        <Switch
          label={t("settings.shortcut_hints")}
          checked={hints}
          onChange={(next) => {
            applyShortcutHints(next);
            setHints(next);
          }}
        />
      </SettingRow>
      <LanguageSettingRow />
    </SettingsSection>
  );
}
