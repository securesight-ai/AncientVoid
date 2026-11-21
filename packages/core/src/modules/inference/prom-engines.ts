import type { InferenceCache, InferenceEngine, InferenceFeatures, InferenceLive, InferenceTotals } from "@ancientvoid/contracts";
import { anteil, NO_HISTORY, num, text } from "./engine.ts";
import type { EngineReading, RequestRecord } from "./engine.ts";
import { counter, deltas, gauge, parseProm } from "./prom.ts";
import type { DeltaBook, MetricFamily } from "./prom.ts";

/**
 * EPIC-P79 T79.2: Adapter für **llama.cpp** (`--metrics`) und **Halogen**
 * (Prometheus-Exposition nach llama-server-Art plus eigene `halogen:`-Zähler,
 * zusätzlich `/health` und `/cache` als JSON).
 *
 * Gemeinsame Grenze: diese Engines melden **keine Einzel-Requests**. Raten
 * entstehen deshalb aus Deltas zweier Abrufe, und Verteilungen sind nicht
 * möglich — `features.perRequest = false`, und die Seite sagt das.
 */

const EMPTY: InferenceCache = {
  hitRate: null, tokenHitRate: null, savedTokens: null, entries: null, bytes: null, evictions: null,
  budgetMib: null, parked: null, restores: null, refusedTotal: null, longestWaitS: null, poolBelegung: null,
};

/** Gegenwerte sind Momentwerte; Raten brauchen Arbeit im Fenster (Schwelle an der Arbeit). */
const MIN_READ = 50;
const MIN_OUTPUT = 20;
const MIN_SECONDS = 0.05;

export type PromReading = { reading: EngineReading; book: DeltaBook };

function zaehler(text_: string): Record<string, number> {
  const { families } = parseProm(text_);
  const namen = [
    "llamacpp:prompt_tokens_total", "llamacpp:prompt_tokens_cached_total", "llamacpp:prompt_seconds_total",
    "llamacpp:tokens_predicted_total", "llamacpp:tokens_predicted_seconds_total",
    "llamacpp:requests_processing", "llamacpp:requests_deferred", "llamacpp:n_tokens_max",
    "llamacpp:spec_decode_num_draft_tokens_total", "llamacpp:spec_decode_num_accepted_tokens_total",
    "halogen:requests_total", "halogen:prompt_tokens_cached_total", "halogen:draft_tokens_total",
    "halogen:draft_tokens_accepted_total", "halogen:cache_hits_total", "halogen:cache_misses_total",
    "halogen:cache_prompt_tokens_saved_total", "halogen:cache_evicted_total", "halogen:queue_gave_up_total",
    "halogen:queue_waited_total",
  ];
  const out: Record<string, number> = {};
  for (const n of namen) {
    const v = counter(families, n);
    if (v != null) out[n] = v;
  }
  return out;
}

function hole(families: Map<string, MetricFamily>, name: string): number | null {
  return gauge(families, name);
}

export function promReading(
  kind: "llamacpp" | "halogen",
  promText: string,
  opts: { prev: DeltaBook | null; nowMs: number; health?: unknown; cache?: unknown },
): PromReading {
  const { families } = parseProm(promText);
  const now: DeltaBook = { at: opts.nowMs, values: zaehler(promText) };
  const d = deltas(opts.prev, now);
  const hinweise: string[] = [];

  const prompt = now.values["llamacpp:prompt_tokens_total"] ?? null;
  const cached = now.values["llamacpp:prompt_tokens_cached_total"] ?? now.values["halogen:prompt_tokens_cached_total"] ?? null;
  const output = now.values["llamacpp:tokens_predicted_total"] ?? null;
  const requests = kind === "halogen" ? (now.values["halogen:requests_total"] ?? null) : null;

  // Raten aus Deltas — die Schwelle sitzt an der geleisteten Arbeit, nicht an der
  // Zeitspanne: 60 gelesene Token in 0,05 s sind messbar, 2 Token in 0,01 s sind Müll.
  let fenster: InferenceTotals["window"] = null;
  if (d) {
    const dCached = d.values["llamacpp:prompt_tokens_cached_total"] ?? d.values["halogen:prompt_tokens_cached_total"] ?? 0;
    const gelesen = Math.max(0, (d.values["llamacpp:prompt_tokens_total"] ?? 0) - dCached);
    const dOut = d.values["llamacpp:tokens_predicted_total"] ?? 0;
    fenster = {
      seconds: d.seconds,
      prompt: d.values["llamacpp:prompt_tokens_total"] ?? null,
      read: gelesen,
      output: dOut,
      prefillTokS: gelesen >= MIN_READ && (d.values["llamacpp:prompt_seconds_total"] ?? 0) >= MIN_SECONDS
        ? gelesen / (d.values["llamacpp:prompt_seconds_total"] as number)
        : null,
      decodeTokS: dOut >= MIN_OUTPUT && (d.values["llamacpp:tokens_predicted_seconds_total"] ?? 0) >= MIN_SECONDS
        ? dOut / (d.values["llamacpp:tokens_predicted_seconds_total"] as number)
        : null,
    };
    if (d.inconsistent) hinweise.push("Zähler-Delta negativ (Engine neu gestartet?) — Fenster-Rate verworfen");
  }

  const draftOff = now.values["llamacpp:spec_decode_num_draft_tokens_total"] ?? now.values["halogen:draft_tokens_total"] ?? null;
  const draftAcc = now.values["llamacpp:spec_decode_num_accepted_tokens_total"] ?? now.values["halogen:draft_tokens_accepted_total"] ?? null;

  const totals: InferenceTotals | null = prompt == null && output == null
    ? null
    : {
        requests,
        prompt,
        reused: cached,
        read: prompt != null && cached != null ? prompt - cached : null,
        output,
        reuseShare: anteil(cached, prompt),
        avgPrefillTokS: fenster?.prefillTokS ?? null,
        avgDecodeTokS: fenster?.decodeTokS ?? hole(families, "llamacpp:predicted_tokens_seconds"),
        draftAcceptShare: anteil(draftAcc, draftOff),
        expertHitRate: null,
        window: fenster,
      };

  const health = typeof opts.health === "object" && opts.health !== null ? (opts.health as Record<string, unknown>) : null;
  const cacheJson = typeof opts.cache === "object" && opts.cache !== null ? (opts.cache as Record<string, unknown>) : null;

  const cache: InferenceCache = {
    ...EMPTY,
    hitRate: num(cacheJson?.hit_rate),
    tokenHitRate: num(cacheJson?.tokenHit_rate),
    savedTokens: now.values["halogen:cache_prompt_tokens_saved_total"] ?? null,
    entries: hole(families, "halogen:cache_entries"),
    bytes: hole(families, "halogen:cache_bytes"),
    evictions: now.values["halogen:cache_evicted_total"] ?? null,
    poolBelegung: hole(families, "llamacpp:kv_cache_usage_ratio"),
    refusedTotal: now.values["halogen:queue_gave_up_total"] ?? null,
    longestWaitS: hole(families, "halogen:queue_wait_longest_seconds"),
  };

  const live: InferenceLive = {
    state: hole(families, "halogen:engine_up") === 0 ? "offline" : "bereit",
    phase: null,
    queued: num(health?.queued) ?? hole(families, "llamacpp:requests_deferred"),
    decodeTokS: hole(families, "llamacpp:predicted_tokens_seconds"),
    prefillTokS: hole(families, "llamacpp:prompt_tokens_seconds"),
    ttftS: null,
    output: null,
    prompt: null,
    read: null,
    reused: null,
    elapsedS: hole(families, "halogen:busy_for_seconds"),
  };

  const engine: InferenceEngine = {
    model: text(health?.model),
    version: text(health?.version) ?? text(health?.engine_version),
    context: null,
    kvTokens: hole(families, "llamacpp:kv_cache_tokens"),
    kvResident: null,
    expertCacheMib: null,
  };

  if (d == null) hinweise.push("Erster Abruf — Raten erscheinen ab dem zweiten Poll");
  hinweise.push("keine Einzel-Requests gemeldet — Verteilungen und Protokoll sind nicht möglich");
  hinweise.push("keine Hardware-Werte gemeldet — Gerät und GPU bleiben leer statt geschätzt");

  const features: InferenceFeatures = { perRequest: false, hardware: false, history: false, totals: true };
  const requests_: RequestRecord[] = [];

  return {
    book: now,
    reading: { engine, features, live, totals, cache: kind === "halogen" ? cache : null, hardware: null, history: NO_HISTORY, requests: requests_, hints: hinweise },
  };
}

/** Rohtext-Exposition muss mindestens einen bekannten Zähler haben (Fail-loud, K9). */
export function assertPromShape(promText: string, url: string): void {
  const { families, skipped } = parseProm(promText);
  const bekannt = ["llamacpp:prompt_tokens_total", "llamacpp:tokens_predicted_total", "halogen:requests_total"];
  if (!bekannt.some((n) => families.has(n))) {
    throw new Error(`${url}: keine llamacpp:/halogen:-Zähler in der Exposition (${families.size} Familien, ${skipped} Zeilen übersprungen)`);
  }
}
