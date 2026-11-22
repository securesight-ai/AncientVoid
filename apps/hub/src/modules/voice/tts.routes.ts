import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  TTS_MAX_CONCURRENT,
  TTS_MAX_QUEUE_WAITING,
  TTS_MAX_TEXT_BYTES,
  TTS_TIMEOUT_MS,
  type TtsStatusResponse,
  type TtsUpstreamRequest,
} from "@ancientvoid/contracts";
import type { SettingsStore } from "@ancientvoid/core";

/** Hivemind `/tts` speaks `"German"|"English"` — our settings say `de`/`en`. */
export function ttsUpstreamLanguage(language: "de" | "en"): "German" | "English" {
  return language === "en" ? "English" : "German";
}

export class TtsQueueFullError extends Error {
  constructor() {
    super("TTS-Wartebereich voll");
  }
}

/**
 * EPIC-P75 (ADR-0097 §6): die Hivemind-Box teilt sich mit VoidWarden und dem
 * Telegram-Setup — der Hub serialisiert Synthesen (FIFO) statt sie zu stampeden.
 * Über den Wartebereich hinaus wird sofort 429, nichts wartet heimlich ewig.
 */
export class TtsQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= TTS_MAX_CONCURRENT && this.waiting.length >= TTS_MAX_QUEUE_WAITING) return Promise.reject(new TtsQueueFullError());
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        job().then(resolve, reject).finally(() => {
          this.active -= 1;
          this.waiting.shift()?.();
        });
      };
      if (this.active < TTS_MAX_CONCURRENT) start();
      else this.waiting.push(start);
    });
  }
}

/**
 * BUG-0214-Analogie: `available:true` entsteht aus einer echten Probe gegen den
 * Dienst, nie aus der Konfiguration alone. Kurz gecacht — aber der Cache gilt je
 * URL, weil die Einstellung zur Laufzeit wechseln kann (SettingsStore, kein Restart).
 */
export function makeTtsProbe(getUrl: () => string | undefined, deps: { fetch?: typeof fetch } = {}, ttlMs = 4_000, timeoutMs = 1_200): { check(): Promise<{ ok: boolean; ageMs: number; configured: boolean }>; invalidate(): void } {
  const doFetch = deps.fetch ?? fetch;
  let cache: { at: number; ok: boolean; url: string } | null = null;
  let inflight: Promise<{ ok: boolean; ageMs: number; configured: boolean }> | null = null;
  const check = async (): Promise<{ ok: boolean; ageMs: number; configured: boolean }> => {
    const url = getUrl();
    if (!url) {
      cache = null;
      return { ok: false, ageMs: 0, configured: false };
    }
    const now = Date.now();
    if (cache && cache.url === url && now - cache.at < ttlMs) return { ok: cache.ok, ageMs: now - cache.at, configured: true };
    if (inflight) return inflight;
    inflight = (async () => {
      let ok = true;
      try {
        await doFetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        ok = false; // kein Aufbau, keine Antwort: auch ein 405 wäre ein Lebenszeichen
      }
      cache = { at: Date.now(), ok, url };
      inflight = null;
      return { ok, ageMs: 0, configured: true };
    })();
    return inflight;
  };
  return { check, invalidate: () => { cache = null; } };
}

const ttsPatch = z.object({
  url: z.url().max(500).nullable().optional(),
  engine: z.string().trim().min(1).max(200).nullable().optional(),
  language: z.enum(["de", "en"]).nullable().optional(),
  speed: z.number().min(0.5).max(2).nullable().optional(),
  timeoutMs: z.number().int().min(1_000).max(600_000).nullable().optional(),
});

/**
 * EPIC-P75 (ADR-0097): Sprachausgabe als Hub-Proxy — die PWA ruft nie direkt den
 * TTS-Dienst auf (CORS, keine Policy-Stelle, keine ehrliche Verfügbarkeit).
 * Audio ist transient: keine Events, kein JSONL, keine Blobs (K5).
 */
export function registerTtsRoutes(app: FastifyInstance, deps: { settings: SettingsStore; fetch?: typeof fetch }): void {
  const doFetch = deps.fetch ?? fetch;
  const probe = makeTtsProbe(() => deps.settings.ttsView().url ?? undefined, { fetch: doFetch });
  const queue = new TtsQueue();

  app.get("/api/tts", async (): Promise<TtsStatusResponse> => {
    const cfg = deps.settings.ttsView();
    if (!cfg.url) return { available: false, reason: "Sprachausgabe nicht eingerichtet — TTS-URL in den Einstellungen eintragen" };
    const check = await probe.check();
    if (!check.ok) return { available: false, reason: "Sprachausgabedienst nicht erreichbar", checkedMsAgo: check.ageMs };
    return { available: true, ...(cfg.engine ? { engine: cfg.engine } : {}), language: cfg.language, checkedMsAgo: check.ageMs };
  });

  app.post("/api/tts", { bodyLimit: TTS_MAX_TEXT_BYTES * 2 }, async (req, reply) => {
    const cfg = deps.settings.ttsView();
    if (!cfg.url) return reply.code(501).send({ error: "Keine Sprachausgabe konfiguriert — TTS-URL in den Einstellungen eintragen." });
    const body = z.object({ text: z.string() }).safeParse(req.body);
    if (!body.success || body.data.text.trim().length === 0) return reply.code(400).send({ error: "Kein Text zum Vorlesen." });
    if (Buffer.byteLength(body.data.text, "utf8") > TTS_MAX_TEXT_BYTES) {
      return reply.code(413).send({ error: `Text zu lang für die Sprachausgabe (max ${TTS_MAX_TEXT_BYTES} Bytes).` });
    }
    let wav: Buffer;
    try {
      wav = await queue.run(async () => {
        const res = await doFetch(cfg.url as string, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: body.data.text, speed: cfg.speed, language: ttsUpstreamLanguage(cfg.language) } satisfies TtsUpstreamRequest),
          signal: AbortSignal.timeout(cfg.timeoutMs > 0 ? cfg.timeoutMs : TTS_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`TTS ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      });
    } catch (err) {
      if (err instanceof TtsQueueFullError) return reply.code(429).send({ error: "Sprachausgabe ausgelastet — gleich nochmal versuchen." });
      // Eine gescheiterte Synthese ist bessere Evidenz als eine Sekunden-alte
      // GET-Probe — der Cache darf danach nicht weiter „verfügbar" behaupten.
      probe.invalidate();
      return reply.code(502).send({ error: `Sprachausgabe nicht erreichbar (${err instanceof Error ? err.message.slice(0, 80) : "Fehler"})` });
    }
    return reply.type("audio/wav").send(wav);
  });

  app.get("/api/settings/tts", async () => ({ tts: deps.settings.ttsView() }));

  app.put("/api/settings/tts", async (req, reply) => {
    const body = ttsPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Ungültige Sprachausgabe-Einstellungen" });
    const p = body.data;
    if (p.url !== undefined) deps.settings.set("tts.url", p.url);
    if (p.engine !== undefined) deps.settings.set("tts.engine", p.engine);
    if (p.language !== undefined) deps.settings.set("tts.language", p.language);
    if (p.speed !== undefined) deps.settings.set("tts.speed", p.speed === null ? null : String(p.speed));
    if (p.timeoutMs !== undefined) deps.settings.set("tts.timeoutMs", p.timeoutMs === null ? null : String(p.timeoutMs));
    return { tts: deps.settings.ttsView() };
  });
}
