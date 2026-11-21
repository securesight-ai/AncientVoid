import { anteil, bool, num, text } from "./engine.ts";
import type { EngineReading, RequestRecord } from "./engine.ts";

/**
 * EPIC-P79 T79.2: Adapter für **Strata** (`GET /metrics` → JSON, Bearer-Schlüssel).
 * Strata ist die gesprächigste Quelle: sie meldet Einzel-Requests, Hardware und
 * ihren eigenen Sekundentakt. Wichtigster Punkt der Umrechnung: das
 * **Vorbehandlungs-Tempo bezieht sich auf gelesene Token** — wiederverwendete
 * KV-Tokens kosten keine Arbeit (im Engine-Protokoll nachgeprüft:
 * `… 102 read in 1296 ms (78,7 tok/s)`).
 */

type Roh = Record<string, unknown>;

const feld = (o: Roh, key: string): Roh => (typeof o[key] === "object" && o[key] !== null ? (o[key] as Roh) : {});
const liste = (o: Roh, key: string): Roh[] => (Array.isArray(o[key]) ? (o[key] as Roh[]) : []);
const werte = (o: Roh, key: string): number[] =>
  Array.isArray(o[key]) ? ((o[key] as unknown[]).filter((v) => typeof v === "number" && Number.isFinite(v)) as number[]) : [];

function request(r: Roh, at: string): RequestRecord {
  const prompt = num(r.prompt_tokens) ?? 0;
  const reused = num(r.reused) ?? 0;
  const read = num(r.prompt_read) ?? prompt - reused;
  const output = num(r.output_tokens);
  const prefillS = (num(r.prompt_ms) ?? 0) / 1000;
  const decodeS = (num(r.decode_ms) ?? 0) / 1000;
  return {
    id: String(r.id ?? ""),
    source: "",
    at,
    prompt: num(r.prompt_tokens),
    reused: num(r.reused),
    read,
    output,
    prefillTokS: prefillS > 0 ? read / prefillS : null,
    decodeTokS: decodeS > 0 && output != null ? output / decodeS : null,
    ttftS: num(r.first_engine_token_s),
    prefillS,
    decodeS,
    finish: text(r.finish),
  };
}

export function strataReading(body: Roh, sampledAt: string): EngineReading {
  const live = feld(body, "live");
  const totals = feld(body, "totals");
  const engine = feld(body, "engine");
  const hardware = feld(body, "hardware");
  const hwStatic = feld(body, "hardware_static");
  const cache = feld(body, "conversation_cache");
  const history = feld(body, "history");
  const reqs = liste(body, "requests");

  const prompt = num(totals.prompt_tokens);
  const reused = num(totals.reused);
  const output = num(totals.output_tokens);
  const read = prompt != null && reused != null ? prompt - reused : null;
  const prefillS = (num(totals.prompt_ms) ?? 0) / 1000;
  const decodeS = (num(totals.decode_ms) ?? 0) / 1000;
  const draftsOff = num(totals.drafts_offered);
  const draftsAcc = num(totals.drafts_accepted);

  const records = reqs.map((r) => request(r, sampledAt));
  const hitRates = reqs.map((r) => num(r.hit_rate)).filter((v): v is number => v != null);

  return {
    engine: {
      model: text(engine.model),
      version: text(engine.version),
      context: num(engine.max_context) ?? num(engine.context),
      kvTokens: null,
      kvResident: bool(engine.kv_resident),
      expertCacheMib: num(engine.expert_cache_mib),
    },
    features: { perRequest: true, hardware: true, history: true, totals: true },
    live: {
      state: text(live.state),
      phase: text(live.phase),
      queued: num(live.queued),
      decodeTokS: num(live.tok_s),
      prefillTokS: num(live.prefill_tok_s_mean),
      ttftS: reqs.length ? (num(liste(body, "requests")[0]!.first_engine_token_s) ?? null) : null,
      output: num(live.generated),
      prompt: num(live.prompt_total),
      read: num(live.prompt_read),
      reused: num(live.reused),
      elapsedS: num(live.elapsed_s),
    },
    totals: {
      requests: num(totals.requests),
      prompt,
      reused,
      read,
      output,
      reuseShare: anteil(reused, prompt),
      avgPrefillTokS: prefillS > 0 && read != null ? read / prefillS : null,
      avgDecodeTokS: decodeS > 0 && output != null ? output / decodeS : null,
      draftAcceptShare: anteil(draftsAcc, draftsOff),
      expertHitRate: hitRates.length ? hitRates.reduce((a, b) => a + b, 0) / hitRates.length : null,
      window: null,
    },
    cache: {
      hitRate: null,
      tokenHitRate: null,
      savedTokens: null,
      entries: null,
      bytes: num(cache.bytes),
      evictions: num(cache.evictions),
      budgetMib: num(cache.budget_mib),
      parked: num(cache.parked),
      restores: num(cache.restores),
      refusedTotal: num(cache.refused_total),
      longestWaitS: null,
      poolBelegung: null,
    },
    hardware: {
      gpuName: text(hwStatic.gpu_name),
      gpuUtil: num(hardware.gpu_util),
      gpuTempC: num(hardware.gpu_temp),
      vramUsedBytes: num(hardware.gpu_mem_used),
      vramTotalBytes: num(hardware.gpu_mem_total),
      powerW: num(hardware.gpu_power),
      powerLimitW: num(hardware.gpu_power_limit),
      pcieGen: num(hardware.gpu_pcie_gen),
      pcieWidth: num(hardware.gpu_pcie_width),
      ramUsedBytes: werte(history, "ram_used").at(-1) ?? null,
      ramTotalBytes: num(hwStatic.ram_total_bytes),
    },
    history: {
      decodeTokS: werte(history, "tok_s"),
      prefillTokS: werte(history, "prefill_tok_s_mean"),
      ramUsedBytes: werte(history, "ram_used"),
    },
    requests: records,
    hints: [],
  };
}

/** Antwort-Schema prüfen, statt still halbe Zahlen zu zeigen (Fail-loud, K9). */
export function assertStrataShape(body: unknown, url: string): Roh {
  if (!body || typeof body !== "object" || !("totals" in body) || !("live" in body)) {
    throw new Error(`${url}: unerwartetes Antwort-Schema (kein totals/live)`);
  }
  return body as Roh;
}
