import { z } from "zod";

/**
 * BUG-0258: manuelle Modell-Anbindung für die Inferenz — ein gebundenes Chat-
 * Modell (OpenAI-kompatibel, z. B. llama.cpp/Halogen auf dem evo-local-Server),
 * runtime im SettingsStore änderbar. Kein zweiter Adapter: der Hub fragt das
 * Modell nur für kurze Antworten im Analyse-Tab an (Smoke/Verifikation),
 * Session-Arbeit bleibt den echten Adaptern vorbehalten.
 *
 * Schlüssel nur als Dateireferenz (ADR-0011), niemals im Config-Commit.
 */

export const INFERENCE_ASK_MAX_CHARS = 4_000;
/** Antworten sind REST-Payloads, keine Events — trotzdem begrenzt (K5-Geist). */
export const INFERENCE_ANSWER_MAX_CHARS = 6_000;

export const InferenceModelSettingsPatch = z.object({
  /** Basis-URL des OpenAI-kompatiblen Dienstes inkl. `/v1`. */
  url: z.url().max(500).nullable().optional(),
  model: z.string().trim().min(1).max(200).nullable().optional(),
  apiKeyFile: z.string().min(1).max(500).nullable().optional(),
});
export type InferenceModelSettingsPatch = z.infer<typeof InferenceModelSettingsPatch>;

export interface InferenceModelView {
  url: string | null;
  model: string | null;
  /** Dateireferenz — der Pfad ist öffentlich, der Inhalt nie. */
  apiKeyFile: string | null;
}

export interface InferenceModelStatus {
  bound: boolean;
  url: string | null;
  model: string | null;
  /** Echte Probe gegen `<url>/models` — `null` heißt noch nicht geprüft. */
  probe: { ok: boolean; detail?: string } | null;
}

export const InferenceAskInput = z.object({
  text: z.string().trim().min(1).max(INFERENCE_ASK_MAX_CHARS),
});
export type InferenceAskInput = z.infer<typeof InferenceAskInput>;

export interface InferenceAskResult {
  model: string;
  /** Ggf. gekürzt auf INFERENCE_ANSWER_MAX_CHARS. */
  answer: string;
  tokens: { prompt: number | null; completion: number | null } | null;
  ms: number;
}
