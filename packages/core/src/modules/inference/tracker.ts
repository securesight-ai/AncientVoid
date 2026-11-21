import type { InferenceApi, InferenceEngineKind, InferenceSnapshot, InferenceSourceEntry, InferenceSourceList } from "@ancientvoid/contracts";
import { type EngineReading, type RequestRecord } from "./engine.ts";
import { assertPromShape, promReading } from "./prom-engines.ts";
import type { DeltaBook } from "./prom.ts";
import { assertStrataShape, strataReading } from "./strata.ts";
import { createRequestStore, type RequestStore } from "./store.ts";
import { perfOf } from "./perf.ts";

/**
 * EPIC-P79 T79.2: Tracker — pollt die konfigurierten Engines, hält den
 * Momentzustand und baut daraus die Snapshot-Antwort. Perzentile kommen aus der
 * eigenen Historie (`store.ts`), nicht aus den Engine-Gegenwerten.
 *
 * K5: die Antwort ist gekappt (12 Requests, 120 Verlaufs-Punkte, 8 Hinweise);
 * K9: eine erreichbarkeitshalber fehlgeschlagene Engine bleibt als Fehlerzustand
 * sichtbar, statt aus der Liste zu verschwinden.
 */

export interface InferenceTrackerDeps {
  fetch(url: string, init?: { headers?: Record<string, string> }): Promise<{ status: number; ok: boolean; text(): Promise<string> }>;
  readFile(path: string): Promise<string | null>;
  appendFile(path: string, data: string): Promise<void>;
  now(): Date;
  logger: { info(m: string): void; warn(m: string): void; error(m: string): void };
}

export interface InferenceEngineConfig {
  id?: string;
  kind: InferenceEngineKind;
  url: string;
  label?: string;
  /** Datei mit dem Bearer-Schlüssel — nie der Schlüssel selbst (ADR-0011). */
  apiKeyFile?: string;
}

export interface InferenceTrackerOptions {
  intervalSec?: number;
  windowHours?: number;
  minReadPrefill?: number;
  storeFile?: string;
  timeoutMs?: number;
}

export type InferenceTracker = Pick<InferenceApi, "sources" | "snapshot" | "start" | "stop" | "tickNow">;
type Quelle = {
  id: string;
  kind: InferenceEngineKind;
  label: string;
  url: string;
  apiKeyFile?: string;
  book: DeltaBook | null;
  reading: EngineReading | null;
  sampledAt: string | null;
  status: { ok: true } | { ok: false; error: string };
};

const HISTORY_LIMIT = 120;
const REQUEST_LIMIT = 12;
const HINWEIS_LIMIT = 8;

export function createInferenceTracker(
  deps: InferenceTrackerDeps,
  engines: InferenceEngineConfig[],
  opts: InferenceTrackerOptions = {},
): InferenceTracker {
  const intervalSec = opts.intervalSec ?? 2;
  const windowHours = opts.windowHours ?? 72;
  const minReadPrefill = opts.minReadPrefill ?? 4_000;
  const timeoutMs = opts.timeoutMs ?? 4_000;
  const store: RequestStore = createRequestStore(
    { readFile: deps.readFile, appendFile: deps.appendFile, now: deps.now },
    opts.storeFile ?? "inference-requests.jsonl",
    { maxAgeH: windowHours },
  );
  const quellen: Quelle[] = engines.map((e, i) => ({
    id: e.id ?? `${e.kind}-${i + 1}`,
    kind: e.kind,
    label: e.label ?? `${e.kind} ${new URL(e.url).host}`,
    url: e.url,
    ...(e.apiKeyFile ? { apiKeyFile: e.apiKeyFile } : {}),
    book: null,
    reading: null,
    sampledAt: null,
    status: { ok: true },
  }));
  let timer: ReturnType<typeof setInterval> | null = null;

  async function hole(q: Quelle): Promise<EngineReading> {
    const headers: Record<string, string> = { accept: "application/json, text/plain" };
    if (q.apiKeyFile) {
      const key = (await deps.readFile(q.apiKeyFile))?.trim();
      if (!key) throw new Error(`Schlüsseldatei ${q.apiKeyFile} ist leer oder fehlt`);
      headers.authorization = `Bearer ${key}`;
    }
    const hol = async (url: string) => {
      // Frist ablauf lassen wirlaufen, damit eine hängende Engine den Poll-Takt nicht legt.
      const frist = new Promise<never>((_, verwerf) => {
        setTimeout(() => verwerf(new Error(`${url}: keine Antwort in ${timeoutMs} ms`)), timeoutMs).unref?.();
      });
      const res = await Promise.race([deps.fetch(url, { headers }), frist]);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.text();
    };
    if (q.kind === "strata") {
      return strataReading(assertStrataShape(JSON.parse(await hol(q.url)), q.url), deps.now().toISOString());
    }
    const promText = await hol(q.url);
    // /health und /cache sind optional (ältere Halogen-Bauten, andere Engines).
    const basis = q.url.replace(/\/$/, "");
    const extra = async (pfad: string): Promise<unknown> => {
      try {
        return JSON.parse(await hol(`${basis}${pfad}`));
      } catch {
        return null;
      }
    };
    const health = q.kind === "halogen" ? await extra("/health") : null;
    const cache = q.kind === "halogen" ? await extra("/cache") : null;
    const built = promReading(q.kind, promText, { prev: q.book, nowMs: deps.now().getTime(), health, cache });
    // Das Zählerbuch muss überleben, sonst entstehen aus zwei Abrufen nie Raten.
    q.book = built.book;
    assertPromShape(promText, q.url);
    return built.reading;
  }

  return {
    start() {
      if (timer) return;
      void store.load().then(({ geladen, verworfen }) => {
        deps.logger.info(`inference: ${geladen} Requests rekonstruiert${verworfen ? `, ${verworfen} außerhalb des Fensters verworfen` : ""}`);
      });
      timer = setInterval(() => void this.tickNow(), intervalSec * 1000);
      void this.tickNow();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async tickNow() {
      for (const q of quellen) {
        try {
          const reading = await hole(q);
          q.reading = reading;
          q.sampledAt = deps.now().toISOString();
          q.status = { ok: true };
          if (reading.features.perRequest && reading.requests.length) {
            // Quellename an jeder Zeile: Perzentile und Protokoll bleiben pro Engine.
            await store.add(reading.requests.map((r) => ({ ...r, source: q.id })));
          }
        } catch (err) {
          q.status = { ok: false, error: err instanceof Error ? err.message : String(err) };
          deps.logger.warn(`inference: ${q.id} — ${q.status.error}`);
        }
      }
    },
    sources(): InferenceSourceList {
      const quellenListe: InferenceSourceEntry[] = quellen.slice(0, 16).map((q) => ({
        id: q.id,
        kind: q.kind,
        label: q.label,
        url: q.url,
        status: q.status,
        lastSampleAt: q.sampledAt,
        features: q.reading?.features ?? { perRequest: false, hardware: false, history: false, totals: false },
        kurz: {
          decodeTokS: q.reading?.live?.decodeTokS ?? q.reading?.totals?.window?.decodeTokS ?? null,
          prefillTokS: q.reading?.live?.prefillTokS ?? q.reading?.totals?.window?.prefillTokS ?? null,
        },
      }));
      return { generatedAt: deps.now().toISOString(), fensterH: windowHours, schwelleGelesen: minReadPrefill, quellen: quellenListe };
    },
    snapshot(id: string, fensterH = windowHours): InferenceSnapshot | null {
      const q = quellen.find((x) => x.id === id);
      if (!q) return null;
      const lese = q.reading;
      const imFenster = store.window(fensterH, undefined, q.id).filter((r: RequestRecord) => r.id.length > 0);
      const perRequest = lese?.features.perRequest ?? false;
      const perf = perRequest
        ? {
            ...perfOf(
              imFenster.map((r: RequestRecord) => ({
                read: r.read,
                output: r.output,
                prefillS: r.prefillS,
                decodeS: r.decodeS,
                prefillTokS: r.prefillTokS,
                decodeTokS: r.decodeTokS,
                ttftS: r.ttftS,
              })),
              { fensterH, minReadPrefill },
            ),
            engineHinweis: null as string | null,
          }
        : null;
      if (perf && perf.asymptote && perf.asymptote.n < 3) perf.engineHinweis = "Vorbehandlung: Vorlauf/Grenzlaufrate braucht ≥ 3 große Stichproben";
      const letzten = imFenster.slice(-REQUEST_LIMIT).map((r: RequestRecord) => ({
        id: r.id,
        at: r.at,
        prompt: r.prompt,
        reused: r.reused,
        read: r.read,
        output: r.output,
        prefillTokS: r.prefillTokS,
        decodeTokS: r.decodeTokS,
        ttftS: r.ttftS,
        finish: r.finish,
      }));
      return {
        id: q.id,
        kind: q.kind,
        label: q.label,
        url: q.url,
        status: q.status,
        sampledAt: q.sampledAt,
        fensterH,
        engine: lese?.engine ?? { model: null, version: null, context: null, kvTokens: null, kvResident: null, expertCacheMib: null },
        features: lese?.features ?? { perRequest: false, hardware: false, history: false, totals: false },
        live: lese?.live ?? null,
        totals: lese?.totals ?? null,
        cache: lese?.cache ?? null,
        hardware: lese?.hardware ?? null,
        history: {
          decodeTokS: (lese?.history.decodeTokS ?? []).slice(-HISTORY_LIMIT),
          prefillTokS: (lese?.history.prefillTokS ?? []).slice(-HISTORY_LIMIT),
          ramUsedBytes: (lese?.history.ramUsedBytes ?? []).slice(-HISTORY_LIMIT),
        },
        perf,
        requests: letzten,
        hinweise: [...(lese?.hints ?? []), ...(perRequest ? [] : ["Verteilungen brauchen Einzel-Requests — diese Engine meldet nur Gegenwerte"])].slice(0, HINWEIS_LIMIT),
      };
    },
  };
}
