import { useEffect, useRef, useState } from "preact/hooks";
import { speechRecognitionSupported, startContinuousStt, type ContinuousSttHandle } from "../../shared/speech.ts";
import { LocalRecorder, recordingSupported, refreshSttStatus, sttStatus } from "../../shared/local-stt.ts";
import { pasteTranscript } from "./paste-target.ts";
import { saveRecording } from "../../shared/stt-replay.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import {
  EREIGNIS,
  grund as ablehnungsGrund,
  liesstModus,
  titelDesKnopfs,
  waehlePfad,
  type SttFaehigkeiten,
  type SttModus,
} from "../../shared/stt-mode.ts";

/** BUG-0157: Wie lange das Feedback nach dem Aufnahmeende sichtbar bleibt, bevor die Blende ausblendet. */
const FEEDBACK_HIDE_MS = 10_000;

/**
 * BUG-0177: Diktat soll auch nach einer Minute noch laufen — und nach fünf.
 * Früher endete die Browser-Erkennung nach 10 s von selbst (recognizeOnce mit
 * `continuous = false`), was als "bricht schon wieder ab" ankam. 15 Minuten sind
 * die obere Grenze, damit ein vergessenes Mikrofon nicht stundenlang mitläuft.
 */
const MAX_DICTATION_MS = 15 * 60_000;

/** Was dieses Geraet gerade an Erkennung koennte (ADR-0094). */
function ableitbar(status: { available: boolean }): SttFaehigkeiten {
  return {
    lokalVerfuegbar: status.available,
    aufnahmeMoeglich: recordingSupported(),
    browserFaehig: speechRecognitionSupported(),
  };
}

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener?(type: string, cb: () => void): void };

/**
 * Push-to-talk: nochmal tippen stoppt. Lokal (Hub/whisper) wenn konfiguriert,
 * sonst durchgehende Browser-Erkennung mit Wort-für-Wort-Vorschau.
 */
export function usePushToTalk() {
  const [localStt, setLocalStt] = useState<{ available: boolean; engine?: string; streaming?: boolean }>({ available: false });
  // ADR-0094: pro Geraet waehlbar, welche Quelle drankommt — und die Wahl lebt
  // weiter, solange die App offen ist (andere Offnungen hoeren sofort mit).
  const [modus, setModus] = useState<SttModus>(() => liesstModus());
  useEffect(() => {
    const horcht = () => setModus(liesstModus());
    window.addEventListener(EREIGNIS, horcht);
    return () => window.removeEventListener(EREIGNIS, horcht);
  }, []);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [partial, setPartial] = useState("");
  const [streamNotice, setStreamNotice] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [restarts, setRestarts] = useState(0);
  const recorder = useRef<LocalRecorder | null>(null);
  const handle = useRef<ContinuousSttHandle | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useRef<WakeLockSentinelLike | null>(null);
  const secondsRef = useRef(0);

  useEffect(() => {
    void sttStatus().then(setLocalStt);
  }, []);

  // ADR-0092 (Nachtrag): die Rohaufnahme bleibt auf dem Geraet — als Sprachnachricht
  // in der Ablage, von dort aus neu erkennbar (replay-recognize.ts).
  const gemerkt = (aufnahme: { blob: Blob; seconds: number; text?: string; engine?: string; failed?: boolean; reason?: string }) =>
    saveRecording({ blob: aufnahme.blob, mime: aufnahme.blob.type || "audio/webm", seconds: aufnahme.seconds, text: aufnahme.text, engine: aufnahme.engine, failed: aufnahme.failed, reason: aufnahme.reason });

  const active = recording || listening;

  // BUG-0157: info/error dürfen nicht für alle Zeit stehen bleiben.
  useEffect(() => {
    if (active || (!info && !error)) return;
    const t = setTimeout(() => {
      setInfo("");
      setError("");
    }, FEEDBACK_HIDE_MS);
    return () => clearTimeout(t);
  }, [active, info, error]);

  // BUG-0177: Sekundenzähler — die UI zeigt damit belegt, dass die Erkennung lebt.
  useEffect(() => {
    if (!active) {
      secondsRef.current = 0;
      setSeconds(0);
      return;
    }
    const t = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, [active]);

  // BUG-0177: Wach-Riegel, damit das Handy die Erkennung nicht nach dem Display-Sleep
  // verschluckt. Kein Muss: ohne Unterstützung läuft die Diktation trotzdem weiter.
  useEffect(() => {
    if (!active) {
      const w = wake.current;
      wake.current = null;
      void w?.release().catch(() => undefined);
      return;
    }
    const nav = navigator as unknown as { wakeLock?: { request?(type: "screen"): Promise<WakeLockSentinelLike> } };
    void nav.wakeLock?.request?.("screen")
      .then((s) => {
        if (active) wake.current = s;
        else void s.release().catch(() => undefined);
      })
      .catch(() => undefined);
  }, [active]);

  // Harte Obergrenze statt stiller Kurz-Abbrüche: danach wird geschlossen und der
  // bis dahin gehörte Text eingefügt — niemand verliert ein minutenlanges Diktat.
  useEffect(() => {
    if (!active) return;
    capTimer.current = setTimeout(() => {
      setInfo(`15-Minuten-Grenze erreicht — Diktat wird abgeschlossen.`);
      if (handle.current) handle.current.stop();
      else if (recorder.current) void stopLocal();
    }, MAX_DICTATION_MS);
    return () => {
      if (capTimer.current) clearTimeout(capTimer.current);
      capTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // BUG-0041: Bildschirm sperren war bisher ein sofortiger Abbruch. Ab jetzt bricht
  // erst das echte Signal — der Mikrofon-Track endet (oder der Browser kappt die
  // Erkennung dauerhaft). Sperren allein darf ein laufendes Diktat nicht vernichten.
  useEffect(() => {
    if (!recording) return;
    const notice = () => {
      if (document.visibilityState === "hidden") setInfo("Bildschirm gesperrt — Aufnahme läuft weiter, solange der Browser das Mikro hält.");
      else setInfo("");
    };
    const lost = () => {
      const rec = recorder.current;
      if (!rec) return;
      recorder.current = null;
      rec.cancel();
      setRecording(false);
      setPartial("");
      setError("Aufnahme abgebrochen — Mikrofon nicht mehr verfügbar.");
    };
    document.addEventListener("visibilitychange", notice);
    const track = recorder.current?.track();
    track?.addEventListener("ended", lost);
    return () => {
      document.removeEventListener("visibilitychange", notice);
      track?.removeEventListener("ended", lost);
    };
  }, [recording]);

  const applyText = async (text: string, meta?: string) => {
    const where = await pasteTranscript(text);
    if (where === "nowhere") setError("Kein Eingabefeld fokussiert — Text nicht eingefügt (Zwischenablage ebenfalls fehlgeschlagen).");
    else if (where === "clipboard-only") setInfo(`${meta ? `${meta} · ` : ""}nur Zwischenablage — kein fokussiertes Feld`);
    else setInfo(meta ?? "eingefügt");
  };

  const stopLocal = async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setRecording(false);
    setListening(true);
    const dauer = secondsRef.current;
    let blob: Blob | undefined;
    try {
      blob = await rec.stop();
      const t = await rec.transcribe(blob);
      if (t.text) {
        await applyText(t.text, `lokal · ${t.engine} · ${(t.k6Ms / 1000).toFixed(1)} s${streamNotice ? " · Live-Vorschau nicht verfügbar" : ""}`);
        // ADR-0092: die Aufnahme bleibt — fuer eine spaetere Neu-Erkennung aus der Ablage.
        await gemerkt({ blob, seconds: dauer, engine: t.engine, text: t.text });
      } else {
        setError("Nichts erkannt — nochmal versuchen.");
        await gemerkt({ blob, seconds: dauer, failed: true, reason: "nichts erkannt" });
      }
    } catch (err) {
      // BUG-0214: nach einem Ausfall der eigenen Erkennung die Auskunft neu holen — sonst
      // hält die App für den Rest der Sitzung an einem toten Weg fest.
      const fresh = await refreshSttStatus().catch(() => ({ available: false as const }));
      setLocalStt(fresh);
      const grund = err instanceof Error ? err.message : "Spracherkennung fehlgeschlagen.";
      const faehigkeiten = ableitbar(localStt);
      setError(
        fresh.available
          ? grund
          : modus === "lokal"
            // Wer "lokal" gewaehlt hat, kriegt NICHT heimlich die Cloud untergeschoben.
            ? `${grund} — ${ablehnungsGrund("lokal", { ...faehigkeiten, lokalVerfuegbar: false })}`
            : speechRecognitionSupported()
              ? `${grund} — eigene Erkennung nicht erreichbar; beim nächsten Drücken übernimmt die Browser-Erkennung.`
              : `${grund} — eigene Erkennung ist gerade nicht erreichbar.`,
      );
      // ADR-0092: der Fehlversuch bleibt als Sprachnachricht liegen und darf neu
      // erkannt werden, sobald die Erkennung wieder laeuft.
      if (blob) await gemerkt({ blob, seconds: dauer, failed: true, reason: grund });
    } finally {
      setListening(false);
      setPartial("");
    }
  };

  const stop = () => {
    if (handle.current) handle.current.stop();
    else if (recorder.current) void stopLocal();
  };

  const startBrowser = () => {
    setError("");
    setInfo("");
    setPartial("");
    setRestarts(0);
  const lang = navigator.language || "de-DE";
    handle.current = startContinuousStt(lang, {
      onPreview: setPartial,
      onRestarts: setRestarts,
      onEnd: (info) => {
        handle.current = null;
        setListening(false);
        const took = secondsRef.current;
        if (info.reason === "fatal") {
          setPartial("");
          setError(info.message ?? "Spracherkennung fehlgeschlagen.");
          return;
        }
        if (!info.text) {
          setPartial("");
          setError(info.message ?? "Nichts gehört — bitte näher ans Mikrofon sprechen oder länger am Stück diktieren.");
          return;
        }
        setPartial("");
        void applyText(info.text, `Diktat · ${took} s${restarts ? ` · ${restarts}× neu gestartet` : ""}`);
      },
    });
    setListening(true);
  };

  // Esc wie Tippen: stoppen, der gehörte Text bleibt erhalten (Registry-Eintrag
  // „stt.cancel“ bleibt als ID bestehen, weil das Tastenkürzel im Übersichtsblatt
  // verlinkt ist — nur die Bedeutung hat sich von „verwerfen“ zu „stoppen“ geändert).
  useEffect(() => {
    if (!active) return;
    return registerShortcut("stt.cancel", (e) => {
      e.preventDefault();
      stop();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const toggle = async () => {
    const faehigkeiten = ableitbar(localStt);
    const pfad = waehlePfad(modus, faehigkeiten);
    if (pfad === "kein") {
      // ADR-0094: kein stiller Ausweichpfad — die App sagt, woran es liegt.
      setError(ablehnungsGrund(modus, faehigkeiten));
      return;
    }
    if (pfad === "lokal") {
      if (recording) return void stopLocal();
      setError("");
      setInfo("");
      setPartial("");
      setStreamNotice("");
      // BUG-0177: ohne streamendes ASR am Hub kann es keine Live-Wörter geben —
      // das muss sichtbar gesagt werden, sonst hält die Person die App für kaputt.
      if (!localStt.streaming) setStreamNotice("Live-Wörter brauchen ein streamendes ASR am Hub (stt.streaming) — der Text erscheint hier nach dem Stoppen.");
      try {
        const rec = new LocalRecorder();
        await rec.start(() => void stopLocal(), { onPartial: setPartial, onStreamError: setStreamNotice });
        recorder.current = rec;
        setRecording(true);
      } catch {
        setError("Mikrofon-Zugriff verweigert.");
      }
      return;
    }
    if (listening) {
      stop();
      return;
    }
    startBrowser();
  };

  const faehigkeiten = ableitbar(localStt);
  const pfad = waehlePfad(modus, faehigkeiten);
  const supported = pfad !== "kein";
  const title = pfad === "kein" ? ablehnungsGrund(modus, faehigkeiten) : titelDesKnopfs(pfad, localStt.engine);

  return {
    toggle,
    stop,
    listening,
    recording,
    active,
    error,
    info,
    partial,
    streamNotice,
    seconds,
    restarts,
    supported,
    title,
    modus,
    browserPfad: pfad === "browser",
    localAvailable: localStt.available,
  };
}
