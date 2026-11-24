import { t, sttLocale } from "./i18n/index.ts";
export function speechRecognitionSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
}

interface SpeechRecognitionResultLike {
  transcript: string;
  isFinal?: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results: { length: number; [i: number]: { length: number; isFinal?: boolean; [j: number]: SpeechRecognitionResultLike } };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
  stop(): void;
}

/**
 * BUG-0177: durchgehende Diktat-Erkennung mit Wort-für-Wort-Vorschau.
 *
 * Die Erkennung bleibt an, bis die Person
 * selbst stoppt: Chrome beendet eine continuous-Erkennung trotzdem intern
 * (Stille, Netz, Endpointing), also startet dieser Handler sie neu und haelt die
 * finalen Segmente fest. ZwischenErgebnisse gehen als Vorschau ins UI.
 *
 * Cloud-Hinweis (Web Speech geht meist an einen Dienst des Browsers) bleibt beim
 * Aufrufer in der UI, nicht hier.
 */
export interface ContinuousSttCallbacks {
  /** aktueller Stand: finale Segmente + noch laufender (nicht finaler) Text */
  onPreview?: (text: string) => void;
  /** je abgeschlossenem, finalem Segment */
  onSegment?: (segment: string) => void;
  /** Zaehler der Neustarts, damit die UI "laeuft noch" beweisen kann */
  onRestarts?: (count: number) => void;
  onEnd?: (info: { reason: "stopped" | "fatal" | "restarted-out"; message?: string; heard: boolean; text: string }) => void;
}

export interface ContinuousSttHandle {
  /** wie von Hand gestoppt: ausstehende Finale werden noch uebernommen */
  stop(): void;
  /** sofort abbrechen, nichts nachwarten */
  abort(): void;
}

const MAX_RESTARTS = 120;
const RESTART_DELAY_MS = 250;
const STOP_GRACE_MS = 1500;

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  if (typeof w.SpeechRecognition === "function") return w.SpeechRecognition;
  if (typeof w.webkitSpeechRecognition === "function") return w.webkitSpeechRecognition;
  return null;
}

export function startContinuousStt(lang = sttLocale(), cb: ContinuousSttCallbacks = {}): ContinuousSttHandle {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    cb.onEnd?.({ reason: "fatal", message: t("stt.browser_no_speech"), heard: false, text: "" });
    return { stop: () => undefined, abort: () => undefined };
  }
  const finals: string[] = [];
  let interim = "";
  let rec: SpeechRecognitionLike | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let restarts = 0;
  let stopped = false;
  let finished = false;
  let heard = false;

  const joined = () => `${finals.join(" ")} ${interim}`.replace(/\s+/g, " ").trim();

  /**
   * Chrome wiederholt beim Neustart gern das letzte Stück (oder liefert denselben
   * Schluss noch einmal). Ohne das hier steht ein halber Satz doppelt im Feld —
   * genau das war im Handy-Test zu sehen ("…für Kinder Die Kopfhörer sind gut für
   * Kinder und günstig Die …"). Deshalb: exakte Duplikate weg, ein Schluss, der die
   * vorherige Folge nur erweitert, ersetzt sie, und was schon drinsteht, wird nicht
   * noch mal angehängt.
   */
  const addFinal = (text: string) => {
    const prev = finals[finals.length - 1] ?? "";
    if (prev && text === prev) return;
    if (prev && text.startsWith(prev)) { finals[finals.length - 1] = text; return; }
    const acc = finals.join(" ");
    if (acc && acc.endsWith(text)) return;
    finals.push(text);
  };
  const finish = (reason: "stopped" | "fatal" | "restarted-out", message?: string) => {
    if (finished) return;
    finished = true;
    if (restartTimer) clearTimeout(restartTimer);
    cb.onEnd?.({ reason, message, heard, text: joined() });
  };

  const begin = () => {
    if (stopped || finished) return;
    rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => undefined;
    rec.onresult = (event) => {
      const results = event.results;
      let live = "";
      for (let i = event.resultIndex ?? 0; i < results.length; i++) {
        const res = results[i];
        let text = "";
        for (let j = 0; j < res.length; j++) text += `${res[j]?.transcript ?? ""}`;
        text = text.trim();
        if (!text) continue;
        heard = true;
        if (res.isFinal) {
          addFinal(text);
          cb.onSegment?.(text);
        } else {
          live += ` ${text}`;
        }
      }
      interim = live.trim();
      cb.onPreview?.(joined());
    };
    rec.onerror = (event) => {
      const code = (event?.error ?? "").toLowerCase();
      if (code === "not-allowed" || code === "service-not-allowed") finish("fatal", t("stt.mic_denied"));
      else if (code === "audio-capture") finish("fatal", t("stt.mic_not_found"));
      // no-speech / network / aborted: Chrome macht daraus ein onend, und das
      // startet hier neu — kein Grund, die Diktat-Sitzung zu beenden.
    };
    rec.onend = () => {
      if (finished) return;
      interim = "";
      if (stopped) { finish("stopped"); return; }
      if (restarts >= MAX_RESTARTS) {
        finish("restarted-out", t("stt.restarted_out", { n: restarts }));
        return;
      }
      restarts++;
      cb.onRestarts?.(restarts);
      restartTimer = setTimeout(begin, RESTART_DELAY_MS);
    };
    try {
      rec.start();
    } catch (err) {
      finish("fatal", err instanceof Error ? err.message : String(err));
    }
  };

  begin();
  return {
    stop: () => {
      if (stopped || finished) return;
      stopped = true;
      try {
        rec?.stop();
      } catch {
        // schon beendet
      }
      // onend bleibt in manchen Chromium-Bauten aus: nach der Frist trotzdem schliessen.
      restartTimer = setTimeout(() => finish("stopped"), STOP_GRACE_MS);
    },
    abort: () => {
      if (stopped || finished) return;
      stopped = true;
      try {
        rec?.abort();
      } catch {
        // schon beendet
      }
      finish("stopped");
    },
  };
}
