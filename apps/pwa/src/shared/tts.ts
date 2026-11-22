import { TTS_MAX_TEXT_BYTES } from "@ancientvoid/contracts";
import { hubApi } from "./api.ts";

/**
 * EPIC-P75 (ADR-0097): Chat vorlesen über den Hub-Proxy. Der Status kommt
 * gecacht vom Hub (BUG-0214-Muster: nach einem Ausfall neu holen), die
 * Wiedergabe läuft über Blob-URL + `<audio>` — der Play-Tipp ist die
 * Autoplay-Geste (P65-Erkenntnis). Audio bleibt transient (K5): kein
 * Persistenz-Pfad, nur ein kleiner Wiedergabe-Cache im Speicher.
 */
export type TtsStatus = { available: boolean; engine?: string; language?: "de" | "en"; reason?: string; checkedMsAgo?: number };

let status: Promise<TtsStatus> | null = null;

function fetchStatus(): Promise<TtsStatus> {
  return hubApi.ttsStatus().catch(() => ({ available: false, reason: "Hub nicht erreichbar" }));
}

export function ttsStatus(): Promise<TtsStatus> {
  status ??= fetchStatus();
  return status;
}

/** BUG-0214-Analogie: nach dem Eintragen in den Einstellungen oder einem
 *  Dienst-Ausfall holt die App die Auskunft neu statt an der alten zu hängen. */
export function refreshTtsStatus(): Promise<TtsStatus> {
  status = fetchStatus();
  return status;
}

/** Kleiner struktureller Ausschnitt — Tests Attrappen statt Lautsprecher. */
export interface TtsAudioSource {
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended", listener: () => void): void;
}

const utf8 = new TextEncoder();

/** Text auf das Byte-Cap kürzen, ohne ein Multi-Byte-Zeichen zu zerschneiden. */
export function clipToTtsCap(text: string): { text: string; truncated: boolean } {
  if (utf8.encode(text).length <= TTS_MAX_TEXT_BYTES) return { text, truncated: false };
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8.encode(text.slice(0, mid)).length <= TTS_MAX_TEXT_BYTES) lo = mid;
    else hi = mid - 1;
  }
  return { text: text.slice(0, lo), truncated: true };
}

/** Settings-Anzeige „geprüft vor …" — die Einheit wechselt bei zwei Minuten. */
export function checkedAgo(ms: number): { key: "tts.checked_ago_sec" | "tts.checked_ago_min"; n: number } {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 120 ? { key: "tts.checked_ago_sec", n: s } : { key: "tts.checked_ago_min", n: Math.round(s / 60) };
}

const LRU_MAX = 4;

export interface TtsHandle {
  stop(): void;
  /** Löst mit "finished" wenn der Clip durchgespielt ist, "stopped" bei Stop. */
  ended: Promise<"finished" | "stopped">;
}

export interface TtsPlayer {
  speak(text: string): Promise<TtsHandle>;
  stop(): void;
}

/** Wiedergabe-Steuereinheit: synthetisieren, abspielen, stoppen — prozessweit
 *  genau eine aktive Wiedergabe; wiederholter gleicher Text kommt aus dem Cache. */
export function createTtsPlayer(deps: { speak: (text: string) => Promise<Blob>; makeAudio: (url: string) => TtsAudioSource } = { speak: (text) => hubApi.ttsSpeak(text), makeAudio: (url) => new Audio(url) as unknown as TtsAudioSource }): TtsPlayer {
  const cache = new Map<string, string>();
  let current: { source: TtsAudioSource; url: string; end: (how: "finished" | "stopped") => void } | null = null;

  const stop = () => {
    if (!current) return;
    current.source.pause();
    current.end("stopped");
    current = null;
  };

  return {
    stop,
    async speak(text: string): Promise<TtsHandle> {
      stop();
      let url = cache.get(text);
      if (url) cache.delete(text);
      else {
        const blob = await deps.speak(text);
        url = URL.createObjectURL(blob);
        while (cache.size >= LRU_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          const stale = cache.get(oldest);
          cache.delete(oldest);
          if (stale && stale !== current?.url) URL.revokeObjectURL(stale);
        }
      }
      cache.set(text, url); // jüngste Nutzung ans Ende (LRU)
      const source = deps.makeAudio(url);
      let end!: (how: "finished" | "stopped") => void;
      const ended = new Promise<"finished" | "stopped">((resolve) => {
        end = resolve;
      });
      source.addEventListener("ended", () => {
        if (current?.source === source) current = null;
        end("finished");
      });
      current = { source, url, end };
      // Der Tipp auf „Vorlesen" ist die Nutzergeste — autoplay darf hier durch.
      await source.play();
      return { stop, ended };
    },
  };
}

/** Die eine Instanz der App (EventRow, ApprovalCard, Hörprobe). */
export const ttsPlayer = createTtsPlayer();
