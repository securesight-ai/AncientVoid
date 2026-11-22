/** EPIC-P75 (ADR-0097): limits around the chat read-aloud — one shared box, no lies. */

/** One read-aloud may be at most this much UTF-8 text; the hub answers 413 beyond,
 *  the PWA cuts visibly at the same cap before asking. */
export const TTS_MAX_TEXT_BYTES = 4_000;
/** Voxtral can be slow on long text (VoidWarden ADR-0013 profile) — the timeout is
 *  settings-configurable, this is its default. */
export const TTS_TIMEOUT_MS = 120_000;
/** The Hivemind `/tts` box is shared with VoidWarden and Telegram — the hub
 *  serialises instead of stampeding it. */
export const TTS_MAX_CONCURRENT = 1;
/** Requests beyond the running one wait in a FIFO; past this waiting cap the hub
 *  answers 429 instead of queuing forever. */
export const TTS_MAX_QUEUE_WAITING = 3;

/**
 * The Hivemind-compatible `/tts` form the hub proxies: `multipart/form-data`
 * fields `{text, speed?, language?}` with `language` as `"German"|"English"`
 * (mapped from settings `de`/`en`); the answer is WAV bytes, passed through
 * as `audio/wav`. The engine/voice stays server-side. (BUG-0254: the real
 * pocket-tts service rejects a JSON body with 422 — form-data is the wire
 * format, `speed`/`language` are optional hints a service may ignore.)
 */
export interface TtsUpstreamRequest {
  text: string;
  speed?: number;
  language?: "German" | "English";
}

/** `GET /api/tts`: availability from a real probe (BUG-0214 lesson), never from
 *  configuration alone. `checkedMsAgo` proves a probe ran. */
export interface TtsStatusResponse {
  available: boolean;
  engine?: string;
  language?: "de" | "en";
  reason?: string;
  checkedMsAgo?: number;
}

/** Stored TTS settings (SettingsStore keys `tts.*`, ADR-0097 §2). */
export interface TtsSettingsView {
  url: string | null;
  engine: string | null;
  language: "de" | "en";
  speed: number;
  timeoutMs: number;
}

/** `PUT /api/settings/tts` body — partial, `null` clears a field back to default. */
export interface TtsSettingsPatch {
  url?: string | null;
  engine?: string | null;
  language?: "de" | "en" | null;
  speed?: number | null;
  timeoutMs?: number | null;
}
