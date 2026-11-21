import { useState } from "preact/hooks";
import { SOUND_OPTIONS, loadSoundSettings, saveSoundSettings, soundPlayer, type SoundCategory, type SoundSettings as SoundSettingsState } from "../../shared/audio.ts";
import { Select, Switch } from "../../shared/forms.tsx";
import { Button } from "../../shared/ui/index.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";

/**
 * EPIC-P65 T65.3: Einstellungen-Section „Töne“ — Master, je Kategorie an/aus,
 * Variantenauswahl mit Vorschau, Lautstärke. Persistiert lokal
 * (ancientvoid.sounds), offline nutzbar (K10). Der Vorschau-Knopf ist zugleich
 * die nutzende Geste, die WebAudio entsperrt (Premortem P65-1).
 */
const LABELS: Record<SoundCategory, string> = {
  error: "Fehler",
  action: "Aktion nötig",
  done: "Lauf beendet",
  info: "Info",
};

const ORDER: SoundCategory[] = ["error", "action", "done", "info"];

export function SoundSettings() {
  const [settings, setSettings] = useState<SoundSettingsState>(loadSoundSettings);

  const save = (next: SoundSettingsState) => {
    setSettings(next);
    saveSoundSettings(next);
  };

  return (
    <SettingsSection title="Töne" testid="settings-sounds">
      <SettingRow label="Töne insgesamt" hint="Der Master gilt für alle Kategorien — derselbe Schalter wie am Benachrichtigungs-Panel. VoidWarden aktiv? Sounds hier abschalten.">
        <Switch label="Töne insgesamt" checked={settings.master} onChange={(next) => save({ ...settings, master: next })} />
      </SettingRow>
      {ORDER.map((cat) => {
        const row = settings.categories[cat]!;
        const patch = (next: Partial<typeof row>) =>
          save({ ...settings, categories: { ...settings.categories, [cat]: { ...row, ...next } } });
        return (
          <div data-testid={`sound-cat-${cat}`}>
            <SettingRow label={LABELS[cat]}>
              <Switch label={`Ton ${LABELS[cat]}`} checked={row.enabled} onChange={(next) => patch({ enabled: next })} />
            </SettingRow>
            <SettingRow label="Variante" hint="Klick auf ▶ ist die Hörprobe — und entsperrt die Wiedergabe im Browser.">
              <Select
                label={`Variante ${LABELS[cat]}`}
                hideLabel
                value={row.variant}
                options={SOUND_OPTIONS[cat].map((o) => ({ value: o.id, label: o.label }))}
                onChange={(next) => patch({ variant: next })}
                disabled={!row.enabled}
              />
            </SettingRow>
            <SettingRow label="Lautstärke">
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(row.volume * 100)}
                disabled={!row.enabled}
                aria-label={`Lautstärke ${LABELS[cat]}`}
                onInput={(e) => patch({ volume: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
              />
            </SettingRow>
            <SettingRow label="Vorschau">
              <Button
                size="sm"
                onClick={() => soundPlayer.preview(cat, row.variant)}
                disabled={!row.enabled}
                aria-label={`Vorschau ${LABELS[cat]}`}
                title={`Vorschau ${LABELS[cat]}`}
              >
                ▶
              </Button>
            </SettingRow>
          </div>
        );
      })}
    </SettingsSection>
  );
}
