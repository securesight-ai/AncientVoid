import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { recordingSupported, sttStatus } from "../../shared/local-stt.ts";
import { speechRecognitionSupported } from "../../shared/speech.ts";
import { EREIGNIS, grund, liesstModus, modusHinweis, setzeModus, waehlePfad, type SttFaehigkeiten, type SttModus } from "../../shared/stt-mode.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";

/**
 * ADR-0095 (Nachtrag): die Quelle der Spracheingabe — lokal am Hub oder über den
 * Browser (meist Cloud) — wird pro Gerät gespeichert. Der schnelle Weg ist
 * „Mikro-Knopf gedrückt halten"; dieser Abschnitt ist der nachschlagbare, damit die
 * Wahl auch ohne dieses Wissen zu finden ist.
 */
const OPTIONEN: { wert: SttModus; knopf: string; label: string }[] = [
  { wert: "auto", knopf: "stt-modus-s-auto", label: "Automatisch" },
  { wert: "lokal", knopf: "stt-modus-s-lokal", label: "Lokal" },
  { wert: "browser", knopf: "stt-modus-s-browser", label: "Browser" },
];

export function VoiceSettings() {
  const [modus, setModus] = useState<SttModus>(() => liesstModus());
  const [status, setStatus] = useState<{ available: boolean; engine?: string }>({ available: false });

  useEffect(() => {
    void sttStatus().then(setStatus);
    const horcht = () => setModus(liesstModus());
    window.addEventListener(EREIGNIS, horcht);
    return () => window.removeEventListener(EREIGNIS, horcht);
  }, []);

  const faehigkeiten: SttFaehigkeiten = {
    lokalVerfuegbar: status.available,
    aufnahmeMoeglich: recordingSupported(),
    browserFaehig: speechRecognitionSupported(),
  };
  const pfad = waehlePfad(modus, faehigkeiten);

  return (
    <SettingsSection title={t("settings.voice_input")} testid="settings-voice">
      <SettingRow label={t("composer.source")} hint="auch: Mikro-Knopf halten">
        <span class="segmented" role="group" aria-label={t("settings.voice_source")}>
          {OPTIONEN.map((o) => (
            <button
              key={o.wert}
              type="button"
              data-testid={o.knopf}
              class={o.wert === modus ? "active" : ""}
              aria-pressed={o.wert === modus}
              onClick={() => setModus(setzeModus(o.wert))}
            >
              {o.label}
            </button>
          ))}
        </span>
      </SettingRow>
      <div class="stt-modus-note" data-testid="stt-modus-s-note">
        {pfad === "kein" ? grund(modus, faehigkeiten) : modusHinweis(modus, faehigkeiten, status.engine)}
      </div>
    </SettingsSection>
  );
}
