import { homedir } from "node:os";
import { readFile as readFileFs } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  INFERENCE_ANSWER_MAX_CHARS,
  InferenceAskInput,
  InferenceModelSettingsPatch,
  type InferenceAskResult,
  type InferenceModelStatus,
  type InferenceSnapshot,
  type InferenceSourceList,
} from "@ancientvoid/contracts";
import type { SettingsStore } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/** Wie tts.routes: Key nur aus der Datei, nie im State oder Log. */
async function bearerFromFile(file: string | null, readFile: (p: string) => Promise<string | null>): Promise<string | null> {
  const key = file ? (await readFile(file.replace(/^~(?=\/)/, homedir())))?.trim() : null;
  return key ? key : null;
}

const SnapshotQuery = z.object({
  id: z.string().min(1).max(80),
  /** Zeitfenster für die Verteilungen in Stunden (UI-Pills). */
  fenster: z.coerce.number().min(0.25).max(720).optional(),
});

export function registerInferenceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get("/api/inference/sources", async (): Promise<InferenceSourceList> => {
    const tracker = ctx.deps.inference;
    if (!tracker) {
      return { generatedAt: new Date().toISOString(), fensterH: 0, schwelleGelesen: 0, quellen: [] };
    }
    return tracker.sources();
  });

  app.get("/api/inference/snapshot", async (req, reply): Promise<InferenceSnapshot | { error: string; verfuegbare: string[] }> => {
    const parsed = SnapshotQuery.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: `id (und optional fenster 0,25…720) fehlt oder ist ungültig: ${parsed.error.issues.map((i) => i.message).join("; ")}`, verfuegbare: ctx.deps.inference?.sources().quellen.map((q) => q.id) ?? [] };
    }
    const tracker = ctx.deps.inference;
    if (!tracker) {
      reply.code(503);
      return { error: "inference ist nicht konfiguriert (Abschnitt `inference.engines`)", verfuegbare: [] };
    }
    const snap = tracker.snapshot(parsed.data.id, parsed.data.fenster);
    if (!snap) {
      reply.code(404);
      return { error: `unbekannte Quelle: ${parsed.data.id}`, verfuegbare: tracker.sources().quellen.map((q) => q.id) };
    }
    return snap;
  });
}

/**
 * BUG-0258: manuelle Modell-Anbindung (OpenAI-kompatibel, z. B. Halogen auf
 * evo-local) plus Frage-Route für den Inferenz-Tab. Die Anbindung lebt im
 * SettingsStore (runtime änderbar), der Schlüssel nur als Dateireferenz
 * (ADR-0011). Fragen sind kurze REST-Antworten, keine Events (K5).
 */
export function registerInferenceModelRoutes(app: FastifyInstance, deps: { settings: SettingsStore; fetch?: typeof fetch; readFile?: (p: string) => Promise<string | null> }): void {
  const doFetch = deps.fetch ?? fetch;
  const readFile = deps.readFile ?? (async (p) => await readFileFs(p, "utf8").catch(() => null));
  const view = () => deps.settings.inferenceModelView();

  app.get("/api/settings/inference", async (): Promise<InferenceModelStatus> => {
    const v = view();
    if (!v.url || !v.model) return { bound: false, url: v.url, model: v.model, probe: null };
    let probe: { ok: boolean; detail?: string };
    try {
      const res = await doFetch(new URL("models", `${v.url.replace(/\/$/, "")}/`).href, {
        headers: { ...(v.apiKeyFile ? { authorization: `Bearer ${await bearerFromFile(v.apiKeyFile, readFile) ?? ""}` } : {}) },
        signal: AbortSignal.timeout(2_000),
      });
      probe = res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
    } catch (err) {
      const detail = err instanceof Error ? err.message.split("\n")[0] : "Dienst nicht erreichbar";
      probe = detail ? { ok: false, detail } : { ok: false };
    }
    return { bound: true, url: v.url, model: v.model, probe };
  });

  app.put("/api/settings/inference", async (req, reply) => {
    const body = InferenceModelSettingsPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Ungültige Inferenz-Anbindung (url, model, apiKeyFile)" });
    const p = body.data;
    if (p.url !== undefined) deps.settings!.set("inference.model.url", p.url);
    if (p.model !== undefined) deps.settings!.set("inference.model.id", p.model);
    if (p.apiKeyFile !== undefined) deps.settings!.set("inference.model.keyFile", p.apiKeyFile);
    return { inference: view() };
  });

  app.post("/api/inference/ask", { bodyLimit: 16_384 }, async (req: FastifyRequest, reply: FastifyReply): Promise<InferenceAskResult | { error: string }> => {
    const v = view();
    if (!v.url || !v.model) return reply.code(501).send({ error: "Kein Inferenz-Modell angebunden — URL und Modell in den Einstellungen eintragen." });
    const body = InferenceAskInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: `Ungültige Frage (1…4000 Zeichen).` });
    const started = Date.now();
    try {
      const auth = await bearerFromFile(v.apiKeyFile, readFile);
      const res = await doFetch(new URL("chat/completions", `${v.url.replace(/\/$/, "")}/`).href, {
        method: "POST",
        headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify({ model: v.model, messages: [{ role: "user", content: body.data.text }], max_tokens: 1024, stream: false }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Modell HTTP ${res.status}`);
      const json = z.object({ choices: z.array(z.object({ message: z.object({ content: z.union([z.string(), z.null()]) }) })).min(1), usage: z.object({ prompt_tokens: z.number().nullable().optional(), completion_tokens: z.number().nullable().optional() }).nullish() }).parse(await res.json());
      const answer = (json.choices[0]?.message.content ?? "").slice(0, INFERENCE_ANSWER_MAX_CHARS);
      if (!answer.trim()) throw new Error("Modell antwortete ohne Text");
      return { model: v.model, answer, tokens: json.usage ? { prompt: json.usage.prompt_tokens ?? null, completion: json.usage.completion_tokens ?? null } : null, ms: Date.now() - started };
    } catch (err) {
      const reason = err instanceof Error ? (err.message.split("\n")[0] ?? "").slice(0, 120) : "Fehler";
      return reply.code(502).send({ error: `Inferenz nicht erreichbar (${reason})` });
    }
  });
}
