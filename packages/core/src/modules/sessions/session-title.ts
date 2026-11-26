import type { PlannerModelConfig } from "../commands/model.ts";
import { hintergrundAnfrage } from "../inference/index.ts";

/**
 * EPIC-P15 T15.5: a short title from the model — only from the person's first
 * words and the start of the first answer, cut short. Nothing else leaves the hub.
 */
const SYSTEM = `Du vergibst Titel für Coding-Sessions in einer Übersicht. Antworte NUR mit dem Titel: 3 bis 7 Wörter, auf Deutsch, ohne Anführungszeichen, ohne Satzzeichen am Ende, ohne Präfix wie "Titel:". Nenne das Ziel der Session, keine Höflichkeitsfloskeln.`;

/** The first line of a model answer, cleaned; null when it is not usable as a title. */
export function cleanModelTitle(raw: string): string | null {
  const noThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const line = noThink
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const text = line
    .replace(/^(?:titel|title)\s*:\s*/i, "")
    .replace(/^[#>*\-\s]+/, "")
    .replace(/[*_`"„“”'«»]/g, "")
    .replace(/[.!?:;,\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 80 || text.split(" ").length > 12) return null;
  return text;
}

export async function askTitleModel(cfg: PlannerModelConfig, prompt: string, answer: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15_000);
  try {
    const res = await hintergrundAnfrage(cfg.pforte, cfg.model, cfg.url, "titel", "Sitzungstitel", () =>
      (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          max_tokens: 200,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Auftrag:\n${prompt.slice(0, 500)}\n\nAnfang der Antwort:\n${answer.slice(0, 300)}` },
          ],
        }),
      }));
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return cleanModelTitle(body.choices?.[0]?.message?.content ?? "");
  } catch {
    return null; // der Titel aus dem Prompt bleibt
  } finally {
    clearTimeout(timer);
  }
}
