import type { TranscriptSegment } from "@ancientvoid/contracts";
import { parseTimestamp } from "@ancientvoid/contracts";
import { hintergrundAnfrage, type Pforte } from "../inference/index.ts";

/**
 * EPIC-P10.5: the services a media job may ask — whisper.cpp for speech,
 * an OpenAI-compatible model (llama.cpp) for summaries and, with a vision
 * model loaded, for images; Gemini only when the job allows the cloud.
 */
export interface OpenAiModel {
  url: string;
  model: string;
  apiKey?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** BUG-0272 Rest: Zusammenfassen/Bildbeschrieb läuft als Hintergrund durch die Modell-Pforte. */
  pforte?: Pforte | undefined;
}

export interface GeminiModel {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

export interface WhisperServer {
  /** whisper-server `/inference` URL. */
  url: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}

export const GEMINI_HOST = "generativelanguage.googleapis.com";

/** whisper-server with timestamps (`verbose_json`); `offsetMs` shifts a chunk into place. */
export async function whisperSegments(server: WhisperServer, wav: Uint8Array, language: string, offsetMs: number, signal?: AbortSignal): Promise<{ segments: TranscriptSegment[]; language: string | null }> {
  const boundary = `----ancientvoidmedia${Date.now()}`;
  const field = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const body = Buffer.concat([
    Buffer.from(field("response_format", "verbose_json") + field("language", language) + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
    wav,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const timeout = AbortSignal.timeout(server.timeoutMs ?? 600_000);
  const res = await (server.fetch ?? fetch)(server.url, { method: "POST", body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!res.ok) throw new Error(`Spracherkennung ${res.status}`);
  const out = (await res.json()) as { segments?: { start: number; end: number; text: string }[]; text?: string; detected_language?: string; language?: string };
  const segments = (out.segments ?? []).map((s) => ({ startMs: Math.round(s.start * 1000) + offsetMs, endMs: Math.round(s.end * 1000) + offsetMs, text: s.text.trim() })).filter((s) => s.text && !/^\[.*\]$/.test(s.text));
  return { segments, language: out.detected_language ?? out.language ?? null };
}

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

/** One JSON answer from an OpenAI-compatible chat model (llama.cpp: schema-constrained). */
export async function chatJson<T>(cfg: OpenAiModel, system: string, user: string, schema: object, maxTokens: number, signal?: AbortSignal): Promise<T> {
  const res = await hintergrundAnfrage(cfg.pforte, cfg.model, cfg.url, "analyse", "Analyse", () =>
    (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: withTimeout(cfg.timeoutMs ?? 300_000, signal),
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object", schema },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    }));
  if (!res.ok) throw new Error(`Modell ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseJsonAnswer<T>(body.choices?.[0]?.message?.content ?? "");
}

/** A JSON object out of a model answer (tolerates ```json fences and text around it). */
export function parseJsonAnswer<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Modell-Antwort ohne JSON");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

export interface FrameReading {
  description: string | null;
  text: string | null;
}

const FRAME_PROMPT =
  'Beschreibe dieses Standbild aus einem Video sachlich in 1–2 Sätzen auf Deutsch (was ist zu sehen, z. B. Folie, Code, Person, Diagramm). Gib außerdem den lesbaren Text im Bild wörtlich wieder. Antworte nur als JSON: {"description": "...", "text": "..."}; "text" leer, wenn kein Text zu sehen ist.';

/** A local vision model behind an OpenAI-compatible API (llama.cpp with mmproj). */
export async function describeFrameOpenAi(cfg: OpenAiModel, jpeg: Uint8Array, signal?: AbortSignal): Promise<FrameReading> {
  const res = await hintergrundAnfrage(cfg.pforte, cfg.model, cfg.url, "bild", "Standbild beschreiben", () =>
    (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: withTimeout(cfg.timeoutMs ?? 120_000, signal),
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: FRAME_PROMPT },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` } },
            ],
          },
        ],
      }),
    }));
  if (!res.ok) throw new Error(`Bildmodell ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return readingOf(body.choices?.[0]?.message?.content ?? "");
}

function readingOf(text: string): FrameReading {
  try {
    const j = parseJsonAnswer<{ description?: unknown; text?: unknown }>(text);
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return { description: s(j.description), text: s(j.text) };
  } catch {
    return { description: text.trim() || null, text: null };
  }
}

async function gemini(cfg: GeminiModel, parts: object[], json: boolean, signal?: AbortSignal, timeoutMs = 300_000): Promise<string> {
  const res = await (cfg.fetch ?? fetch)(`https://${GEMINI_HOST}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: "POST",
    signal: withTimeout(timeoutMs, signal),
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify({ contents: [{ parts }], ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.error?.message ?? "Fehler"}`);
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

export async function describeFrameGemini(cfg: GeminiModel, jpeg: Uint8Array, signal?: AbortSignal): Promise<FrameReading> {
  return readingOf(await gemini(cfg, [{ text: FRAME_PROMPT }, { inline_data: { mime_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } }], true, signal, 120_000));
}

export async function geminiJson<T>(cfg: GeminiModel, prompt: string, signal?: AbortSignal): Promise<T> {
  return parseJsonAnswer<T>(await gemini(cfg, [{ text: prompt }], true, signal));
}

/** Gemini hears the audio (Opus/OGG, inline) and returns lines with timestamps. */
export async function transcribeGemini(cfg: GeminiModel, ogg: Uint8Array, offsetMs: number, signal?: AbortSignal): Promise<TranscriptSegment[]> {
  const text = await gemini(
    cfg,
    [
      { text: 'Transkribiere diese Audioaufnahme wörtlich in der gesprochenen Sprache. Antworte nur als JSON: {"segments": [{"start": "m:ss", "text": "..."}]}, ein Eintrag je Satz, Zeitmarke ab Beginn der Aufnahme.' },
      { inline_data: { mime_type: "audio/ogg", data: Buffer.from(ogg).toString("base64") } },
    ],
    true,
    signal,
    600_000,
  );
  const j = parseJsonAnswer<{ segments?: { start?: string; text?: string }[] }>(text);
  const rows = (j.segments ?? []).map((s) => ({ startMs: (parseTimestamp(String(s.start ?? "")) ?? -1) + offsetMs, text: String(s.text ?? "").trim() })).filter((s) => s.startMs >= offsetMs && s.text);
  return rows.map((r, i) => ({ startMs: r.startMs, endMs: rows[i + 1]?.startMs ?? r.startMs + 5000, text: r.text }));
}
