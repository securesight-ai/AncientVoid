import { languageEntry, t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { recordingSupported, sttStatus } from "../../shared/local-stt.ts";
import { speechRecognitionSupported } from "../../shared/speech.ts";
import { EREIGNIS, grund, liesstModus, modusHinweis, setzeModus, waehlePfad, type SttFaehigkeiten, type SttModus } from "../../shared/stt-mode.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";
import { hubApi } from "../../shared/api.ts";
import type { TtsSettingsView } from "@ancientvoid/contracts";
import { checkedAgo, refreshTtsStatus, ttsPlayer, type TtsStatus } from "../../shared/tts.ts";
import { Button } from "../../shared/ui/index.ts";

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
    <>
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
      <TtsSettingsSection />
    </>
  );
}

/**
 * EPIC-P75 (ADR-0097 §2): Sprachausgabe im SettingsStore — URL/Engine/Sprache/
 * Tempo/Timeout, runtime änderbar ohne Hub-Restart. Die Hörprobe ist Verifikation
 * und Autoplay-Geste in einem; die Verfügbarkeit kommt aus der echten Hub-Probe.
 */
function TtsSettingsSection() {
  const [saved, setSaved] = useState<TtsSettingsView | null>(null);
  const [url, setUrl] = useState("");
  const [engine, setEngine] = useState("");
  const [language, setLanguage] = useState<"de" | "en">("de");
  const [speed, setSpeed] = useState("1");
  const [timeoutMs, setTimeoutMs] = useState(String(120_000));
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [probiert, setProbiert] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void hubApi
      .ttsSettings()
      .then((s) => {
        setSaved(s.tts);
        setUrl(s.tts.url ?? "");
        setEngine(s.tts.engine ?? "");
        setLanguage(s.tts.language);
        setSpeed(String(s.tts.speed));
        setTimeoutMs(String(s.tts.timeoutMs));
      })
      .catch(() => setSaved(null));
    void refreshTtsStatus().then(setStatus);
  }, []);

  const dirty =
    (url.trim() || null) !== (saved?.url ?? null) ||
    (engine.trim() || null) !== (saved?.engine ?? null) ||
    language !== saved?.language ||
    Number(speed) !== saved?.speed ||
    Number(timeoutMs) !== saved?.timeoutMs;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await hubApi.setTtsSettings({
        url: url.trim() || null,
        engine: engine.trim() || null,
        language,
        speed: Number(speed),
        timeoutMs: Number(timeoutMs),
      });
      setSaved(res.tts);
      setUrl(res.tts.url ?? "");
      setEngine(res.tts.engine ?? "");
      setLanguage(res.tts.language);
      setSpeed(String(res.tts.speed));
      setTimeoutMs(String(res.tts.timeoutMs));
      setMessage({ ok: true, text: t("tts.saved") });
      setStatus(await refreshTtsStatus());
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("tts.save_failed") });
    } finally {
      setBusy(false);
    }
  };

  const hoerprobe = async () => {
    setProbiert(true);
    setMessage(null);
    try {
      const handle = await ttsPlayer.speak(t("tts.probe_text"));
      await handle.ended;
      setMessage({ ok: true, text: t("tts.probe_done") });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("tts.error") });
      setStatus(await refreshTtsStatus());
    } finally {
      setProbiert(false);
    }
  };

  const verfuegbarkeit = status === null
    ? "…"
    : status.available
      ? `${t("tts.status_ok")}${status.engine ? ` · ${status.engine}` : ""}`
      : `${t(status.checkedMsAgo === undefined ? "tts.reason_unconfigured" : "tts.reason_unreachable")}${status.checkedMsAgo === undefined ? "" : ` · ${t(checkedAgo(status.checkedMsAgo).key, { n: checkedAgo(status.checkedMsAgo).n })}`}`;

  return (
    <SettingsSection title={t("settings.tts")} testid="settings-tts">
      <div class="dim settings-intro">{t("tts.hint")}</div>
      <label>
        {t("tts.url")}
        <input value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder={t("tts.url_ph")} autocapitalize="off" autocorrect="off" spellcheck={false} data-testid="tts-url-input" />
      </label>
      <label>
        {t("tts.engine")}
        <input value={engine} onInput={(e) => setEngine((e.target as HTMLInputElement).value)} placeholder={t("tts.engine_ph")} autocapitalize="off" autocorrect="off" spellcheck={false} />
      </label>
      <SettingRow label={t("tts.language")}>
        <span class="segmented" role="group" aria-label={t("tts.language")}>
          {(["de", "en"] as const).map((code) => (
            <button key={code} type="button" data-testid={`tts-lang-${code}`} class={code === language ? "active" : ""} aria-pressed={code === language} onClick={() => setLanguage(code)}>
              {languageEntry(code).label}
            </button>
          ))}
        </span>
      </SettingRow>
      <label>
        {t("tts.speed")}
        <input type="number" min="0.5" max="2" step="0.05" value={speed} onInput={(e) => setSpeed((e.target as HTMLInputElement).value)} data-testid="tts-speed-input" />
      </label>
      <label>
        {t("tts.timeout")}
        <input type="number" min="1000" max="600000" step="500" value={timeoutMs} onInput={(e) => setTimeoutMs((e.target as HTMLInputElement).value)} />
      </label>
      <div class="dim" data-testid="tts-availability">{verfuegbarkeit}</div>
      <div class="row" style="gap: 8px">
        <Button disabled={busy || !dirty} onClick={() => void save()} variant="primary" class={busy ? "busy" : undefined} data-testid="tts-save">
          {t("common.save")}
        </Button>
        <Button disabled={probiert} onClick={() => void hoerprobe()} class={probiert ? "busy" : undefined} data-testid="tts-probe">
          {t("tts.probe")}
        </Button>
      </div>
      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"} data-testid="tts-message">{message.text}</div>}
    </SettingsSection>
  );
}
