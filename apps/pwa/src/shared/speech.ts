import { t, sttLocale } from "./i18n/index.ts";
/**
 * T1.5-7 — browser-native STT (Web Speech API), MVP per EPIC-P1.5 §3.3:
 * chosen over a Whisper.cpp server because it needs zero infrastructure.
 * The Whisper.cpp path (originally P3 T3.6) remains the documented local
 * alternative for browsers without this API — not built here.
 *
 * Real, verified limitation (this dev machine, 2026-09-16): open-source
 * Chromium (Arch Linux build, 151.0.7922.173) exposes the
 * `webkitSpeechRecognition` constructor, but calling `.start()` never
 * fires ANY callback (no result, no error, no end) — confirmed via a real
 * Playwright run against the real binary, not assumed. Google's official
 * Chrome build ships a service key this API needs to reach Google's
 * speech backend; generic Chromium builds don't. This is exactly why
 * `recognize()` below has its own timeout: without one, a broken/unkeyed
 * browser leaves the UI stuck in "listening…" forever, indistinguishable
 * from an unusually quiet user. A real device's own browser (a phone's
 * Chrome/Safari) is expected to behave differently — unverified from
 * here, verify on a real device before trusting this on mobile.
 */

const RECOGNITION_TIMEOUT_MS = 10_000;

export function speechRecognitionSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
}

export type SpeechResult =
  | { ok: true; text: string; latencyMs: number }
  | { ok: false; reason: "unsupported" | "no-speech" | "not-allowed" | "timeout" | "error"; detail?: string };

/**
 * Runs one recognition pass. Never auto-submits anything — the caller
 * always gets text back into an editable field, per §3.3's explicit
 * "Transkript ist immer editierbar vor dem Absenden" rule.
 */
export function recognizeOnce(lang = sttLocale()): Promise<SpeechResult> {
  return new Promise((resolve) => {
    if (!speechRecognitionSupported()) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.continuous = false;

    let settled = false;
    // K6: latency is measured from the moment recording actually starts
    // (onstart, not the .start() call itself, which can be queued behind
    // a permission prompt) to the transcript arriving.
    let startedAt = performance.now();

    const finish = (result: SpeechResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      recognition.abort();
      finish({ ok: false, reason: "timeout" });
    }, RECOGNITION_TIMEOUT_MS);

    recognition.onstart = () => {
      startedAt = performance.now();
    };
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript ?? "";
      finish({ ok: true, text, latencyMs: performance.now() - startedAt });
    };
    recognition.onerror = (event) => {
      const errorCode = event.error;
      const reason: "no-speech" | "not-allowed" | "error" =
        errorCode === "no-speech" ? "no-speech" : errorCode === "not-allowed" ? "not-allowed" : "error";
      finish({ ok: false, reason, detail: errorCode });
    };
    recognition.onend = () => {
      // Only reachable if neither onresult nor onerror fired first —
      // exactly the hung-recognition case this dev machine's Chromium
      // hits (see module comment). Timeout handles it if onend itself
      // never fires either.
      finish({ ok: false, reason: "error", detail: "ended without a result" });
    };

    try {
      recognition.start();
    } catch (err) {
      finish({ ok: false, reason: "error", detail: err instanceof Error ? err.message : String(err) });
    }
  });
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
 * `recognizeOnce` oben ist ein einzelner kurzer Stoss (10 s, `continuous =
 * false`): wer laenger als ~10 s spricht oder auch nur eine Pause macht, dessen
 * Spracheingabe endete von selbst — genau die Rueckmeldung aus dem Alltag
 * ("bricht schon wieder ab"). Hier bleibt die Erkennung an, bis die Person
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
