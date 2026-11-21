import assert from "node:assert/strict";
import { it } from "vitest";

import { InferenceSnapshot as SnapshotSchema, InferenceSourceList as SourceListSchema } from "@ancientvoid/contracts";

import { createInferenceTracker } from "../src/modules/inference/index.ts";
import { perfOf, percentile, summarize } from "../src/modules/inference/perf.ts";
import { promReading } from "../src/modules/inference/prom-engines.ts";
import { createRequestStore } from "../src/modules/inference/store.ts";
import { assertStrataShape, strataReading } from "../src/modules/inference/strata.ts";
import { assertPromShape } from "../src/modules/inference/prom-engines.ts";

// --- Strata: JSON-Snapshot der gesprächigsten Quelle -----------------------

const strataBody = {
  engine: { model: "Qwen3.8-Flash", version: "0.9", max_context: 262144, kv_resident: true, expert_cache_mib: 1200 },
  live: { state: "generating", phase: "writing", tok_s: 49.6, prefill_tok_s_mean: 78.7, queued: 1, generated: 414, prompt_total: 71000, prompt_read: 102, reused: 70898, elapsed_s: 8.3 },
  totals: { requests: 120, prompt_tokens: 900000, reused: 810000, output_tokens: 150000, prompt_ms: 500000, decode_ms: 3000000, drafts_offered: 90000, drafts_accepted: 54000 },
  hardware: { gpu_util: 0.87, gpu_temp: 68, gpu_mem_used: 30_000_000_000, gpu_mem_total: 34_000_000_000, gpu_power: 250, gpu_power_limit: 300, gpu_pcie_gen: 4, gpu_pcie_width: 16 },
  hardware_static: { gpu_name: "RX 7900 XTX" },
  conversation_cache: { bytes: 1000, evictions: 3, budget_mib: 8000, parked: 4, restores: 2, refused_total: 1 },
  history: { tok_s: [40, 42, 44], prefill_tok_s_mean: [70, 74], ram_used: [60_000_000_000, 61_000_000_000] },
  requests: [
    { id: "r1", prompt_tokens: 71000, reused: 70898, prompt_read: 102, output_tokens: 414, prompt_ms: 1296, decode_ms: 8346, first_engine_token_s: 1.4, finish: "stop", hit_rate: 0.98, duration_s: 9.7 },
    { id: "r2", prompt_tokens: 5000, reused: 4000, output_tokens: 200, prompt_ms: 1000, decode_ms: 4000, first_engine_token_s: 1.1, finish: "stop", hit_rate: 0.8 },
  ],
};

it("Strata: Vorbehandlungs-Tempo bezieht sich auf gelesene Token, nicht auf Prompt-Token", () => {
  const r = strataReading(strataBody, "2026-11-21T12:00:00.000Z");
  const [r1] = r.requests;
  assert.ok(r1);
  assert.equal(r1.read, 102);
  // Engine-Log: "102 read in 1296 ms (78.7 tok/s)"
  assert.ok(Math.abs((r1.prefillTokS ?? 0) - 78.7) < 0.1, `gemessen: ${r1.prefillTokS}`);
  assert.ok(Math.abs((r1.decodeTokS ?? 0) - 49.6) < 0.1);
  assert.equal(r1.at, "2026-11-21T12:00:00.000Z");
  assert.equal(r.features.perRequest, true);
  assert.equal(r.features.hardware, true);
});

it("Strata: Summen, Wiederverwendungs-Anteil und Hardware-Felder", () => {
  const r = strataReading(strataBody, "2026-11-21T12:00:00.000Z");
  assert.equal(r.totals?.read, 90000);
  assert.ok(Math.abs((r.totals?.reuseShare ?? 0) - 0.9) < 1e-9);
  assert.ok(Math.abs((r.totals?.avgDecodeTokS ?? 0) - 50) < 1e-9);
  assert.equal(r.hardware?.gpuName, "RX 7900 XTX");
  assert.equal(r.hardware?.vramUsedBytes, 30_000_000_000);
  assert.equal(r.hardware?.ramUsedBytes, 61_000_000_000);
  assert.equal(r.engine.kvResident, true);
});

it("Strata: unpassendes Antwort-Schema wirft, statt halbe Zahlen zu zeigen", () => {
  assert.throws(() => assertStrataShape({ totals: {} }, "http://strata/metrics"), /Antwort-Schema/);
  assert.throws(() => assertPromShape("# TYPE x gauge\nx 1\n", "http://h/metrics"), /keine llamacpp/);
});

// --- llama.cpp / Halogen: Prometheus-Gegenwerte ----------------------------

const llm1 = `# TYPE llamacpp:prompt_tokens_total counter
llamacpp:prompt_tokens_total 1000
# TYPE llamacpp:prompt_tokens_cached_total counter
llamacpp:prompt_tokens_cached_total 400
# TYPE llamacpp:prompt_seconds_total counter
llamacpp:prompt_seconds_total 2
# TYPE llamacpp:tokens_predicted_total counter
llamacpp:tokens_predicted_total 500
# TYPE llamacpp:tokens_predicted_seconds_total counter
llamacpp:tokens_predicted_seconds_total 10
# TYPE llamacpp:predicted_tokens_seconds gauge
llamacpp:predicted_tokens_seconds 55.5
# TYPE llamacpp:requests_deferred gauge
llamacpp:requests_deferred 3
`;
const llm2 = llm1
  .replace("llamacpp:prompt_tokens_total 1000", "llamacpp:prompt_tokens_total 1600")
  .replace("llamacpp:prompt_tokens_cached_total 400", "llamacpp:prompt_tokens_cached_total 420")
  .replace("llamacpp:prompt_seconds_total 2", "llamacpp:prompt_seconds_total 2.5")
  .replace("llamacpp:tokens_predicted_total 500", "llamacpp:tokens_predicted_total 700")
  .replace("llamacpp:tokens_predicted_seconds_total 10", "llamacpp:tokens_predicted_seconds_total 12.5");

it("llama.cpp: erster Abruf ohne Rate, zweiter mit Rate aus Deltas", () => {
  const erste = promReading("llamacpp", llm1, { prev: null, nowMs: 0 });
  assert.equal(erste.reading.totals?.window, null);
  assert.ok(erste.reading.hints.some((h) => h.includes("Erster Abruf")));
  const zweite = promReading("llamacpp", llm2, { prev: erste.book, nowMs: 10_000 });
  const f = zweite.reading.totals?.window;
  assert.ok(f);
  assert.equal(f.read, 580, "Delta: 600 Prompt minus 20 wiederverwendet");
  assert.equal(f.prefillTokS, 1160, "580 gelesen / 0,5 s Vorbehandlung");
  assert.equal(f.decodeTokS, 80, "200 Token / 2,5 s");
  assert.equal(zweite.reading.totals?.requests, null, "llama.cpp meldet keine Request-Zähler");
});

it("llama.cpp: keine Einzel-Requests -> Verteilungen sind nicht möglich", () => {
  const { reading } = promReading("llamacpp", llm1, { prev: null, nowMs: 0 });
  assert.equal(reading.features.perRequest, false);
  assert.equal(reading.features.hardware, false);
  assert.equal(reading.requests.length, 0);
  assert.ok(reading.hints.some((h) => h.includes("keine Einzel-Requests")));
  assert.equal(reading.live?.queued, 3);
});

it("llama.cpp: Zähler-Reset erzeugt keine Fantasierate", () => {
  const erste = promReading("llamacpp", llm2, { prev: null, nowMs: 0 });
  const zweite = promReading("llamacpp", llm1, { prev: erste.book, nowMs: 10_000 });
  assert.equal(zweite.reading.totals?.window?.prefillTokS, null);
  assert.ok(zweite.reading.hints.some((h) => h.includes("negativ")));
});

it("Halogen: Cache aus /cache und /health, Experten-Treffer bleibt null", () => {
  const text = `${llm1}# TYPE halogen:requests_total counter\nhalogen:requests_total 40\n# TYPE halogen:cache_entries gauge\nhalogen:cache_entries 7\n`;
  const { reading } = promReading("halogen", text, {
    prev: null,
    nowMs: 0,
    health: { model: "Qwen3.8", version: "0.4.1", queued: 2 },
    cache: { hit_rate: 0.87, token_hit_rate: 0.91 },
  });
  assert.equal(reading.totals?.requests, 40);
  assert.equal(reading.cache?.hitRate, 0.87);
  assert.equal(reading.cache?.entries, 7);
  assert.equal(reading.live?.queued, 2, "/health queued schlägt requests_deferred");
  assert.equal(reading.engine.model, "Qwen3.8");
  assert.equal(reading.totals?.expertHitRate, null, "Halogen hat keinen MoE-Experten-Cache");
});

// --- Store: K7-Rekonstruktion ---------------------------------------------

function storeDeps() {
  const dateien = new Map<string, string>();
  return {
    dateien,
    deps: {
      readFile: async (p: string) => dateien.get(p) ?? null,
      appendFile: async (p: string, d: string) => {
        dateien.set(p, (dateien.get(p) ?? "") + d);
      },
      now: () => new Date("2026-11-21T12:00:00.000Z"),
    },
  };
}

const rekord = (id: string, at: string, read: number, prefillTokS: number, quelle = "strata") => ({
  id,
  source: quelle,
  at,
  prompt: read + 10,
  reused: 10,
  read,
  output: 100,
  prefillTokS,
  decodeTokS: 50,
  ttftS: 1,
  prefillS: read / prefillTokS,
  decodeS: 2,
  finish: "stop",
});

it("Store: dedupliziert, überlebt Neustart und hält sich ans Fenster (K7)", async () => {
  const { deps } = storeDeps();
  const a = createRequestStore(deps, "r.jsonl", { maxAgeH: 72 });
  assert.equal(await a.add([rekord("x1", "2026-11-21T11:59:00.000Z", 5000, 900)]), 1);
  assert.equal(await a.add([rekord("x1", "2026-11-21T11:59:00.000Z", 5000, 900)]), 0, "gleiche ID zählt einmal");
  assert.equal(await a.add([rekord("alt", "2026-11-18T11:00:00.000Z", 5000, 900)]), 1);
  const b = createRequestStore(deps, "r.jsonl", { maxAgeH: 72 });
  const l = await b.load();
  assert.equal(l.geladen, 2);
  assert.equal(b.count(), 1, "außerhalb des Fensters verworfen");
  assert.equal(b.window(24).length, 1);
  assert.equal(b.window(24, undefined, "andere").length, 0, "Historie ist nach Quelle getrennt");
});

// --- Perzentile -----------------------------------------------------------

it("Perzentile: R6-Interpolation, Tukey-Ausreißer und Stichprobenminimum", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  const s = summarize([10, 11, 12, 13, 14, 15, 16, 17, 400]);
  assert.equal(s.n, 9);
  assert.equal(s.p50, 14);
  assert.equal(s.peakRaw, 400);
  assert.equal(s.peakRobust, 17, "Ausreißer bleibt sichtbar, Spitze ohne ihn ist 17");
  assert.equal(s.ausreisser, 1);
  const klein = summarize([10, 11, 12]);
  assert.equal(klein.usable, false);
  assert.equal(klein.p50, null, "zu wenige Stichproben -> keine Perzentile");
  assert.equal(klein.reasons["zu wenige Stichproben"], 1);
});

it("perfOf: Vorbehandlung nach Größe der gelesenen Token geschichtet", () => {
  const recs = [
    ...Array.from({ length: 10 }, (_, i) => rekord(`b${i}`, "2026-11-21T11:00:00.000Z", 50, 120)),
    ...Array.from({ length: 10 }, (_, i) => rekord(`g${i}`, "2026-11-21T11:10:00.000Z", 4_000 + i * 300, 1_400 + i * 40)),
  ].map((r) => ({ read: r.read, output: r.output, prefillS: r.prefillS, decodeS: r.decodeS, prefillTokS: r.prefillTokS, decodeTokS: r.decodeTokS, ttftS: r.ttftS }));
  const p = perfOf(recs, { fensterH: 24, minReadPrefill: 4000 });
  const klein = p.groessenSchichten.find((b) => b.label.startsWith("20"));
  const groß = p.groessenSchichten.find((b) => b.label.startsWith("4.000"));
  assert.ok(klein && klein.n === 10 && klein.p50 === 120);
  assert.ok(groß && groß.n === 10, "Schicht 4.000–11.999 gezählt");
  assert.ok((p.prefill[0]?.p50 ?? 0) > 1400, "nur die großen Lesemengen zählen in der Überschrift");
  assert.ok(p.asymptote && (p.asymptote.tokS ?? 0) > 1000, "Grenzlaufrate braucht gestreute Lesemengen");
});

// --- Tracker: End-to-End gegen Attrappen ----------------------------------

function attrappen() {
  const quelle = storeDeps();
  const texte: Record<string, string> = {
    "http://strata/metrics": JSON.stringify(strataBody),
    "http://halo/metrics": `${llm1}# TYPE halogen:requests_total counter\nhalogen:requests_total 40\n`,
    "http://halo/health": JSON.stringify({ model: "Qwen3.8", queued: 1 }),
    "http://halo/cache": JSON.stringify({ hit_rate: 0.8 }),
    "http://tot/elsewhere": "",
  };
  quelle.dateien.set("/tmp/key", "geheim\n");
  return {
    dateien: quelle.dateien,
    deps: {
      readFile: quelle.deps.readFile,
      appendFile: quelle.deps.appendFile,
      now: quelle.deps.now,
      logger: { info() {}, warn() {}, error() {} },
      fetch: async (url: string) => ({
        status: texte[url] == null ? 404 : 200,
        ok: texte[url] != null,
        text: async () => texte[url] ?? "",
      }),
    },
  };
}

it("Tracker: Snapshot gültig, Grenzen eingehalten, kaputte Quelle bleibt sichtbar", async () => {
  const a = attrappen();
  const tracker = createInferenceTracker(a.deps, [
      { id: "strata", kind: "strata", url: "http://strata/metrics", apiKeyFile: "/tmp/key" },
      { id: "halo", kind: "halogen", url: "http://halo/metrics" },
      { id: "weg", kind: "llamacpp", url: "http://tot/elsewhere" },
    ],
    { storeFile: "r.jsonl", windowHours: 24 },
  );
  await tracker.tickNow();
  const liste = SourceListSchema.parse(tracker.sources());
  assert.deepEqual(liste.quellen.map((q) => q.id), ["strata", "halo", "weg"]);
  assert.equal(liste.quellen[2]?.status.ok, false, "Ausfall bleibt in der Liste (K9)");

  const snap = SnapshotSchema.parse(tracker.snapshot("strata"));
  assert.equal(snap.requests.length, 2);
  assert.ok(snap.perf, "Strata liefert Einzel-Requests -> Verteilung vorhanden");
  assert.ok(snap.hardware?.gpuName);
  assert.ok(JSON.stringify(snap).length < 8_192, `Antwortgröße gemessen: ${JSON.stringify(snap).length} Byte`);

  const halo = SnapshotSchema.parse(tracker.snapshot("halo"));
  assert.equal(halo.perf, null, "Gegenwert-Engine: keine erfundene Verteilung");
  assert.equal(halo.requests.length, 0);
  assert.ok(halo.hinweise.some((h) => h.includes("Verteilungen brauchen Einzel-Requests")));
  assert.equal(tracker.snapshot("unbekannt"), null);
});

it("Tracker: Raten entstehen erst über den zweiten Poll derselben Quelle", async () => {
  let abrufe = 0;
  const uhr = { ms: Date.parse("2026-11-21T12:00:00.000Z") };
  const tracker = createInferenceTracker(
    {
      fetch: async (url: string) => ({
        status: 200,
        ok: true,
        text: async () => (url === "http://halo/metrics" ? (abrufe++ === 0 ? llm1 : llm2) : "{}"),
      }),
      readFile: async () => null,
      appendFile: async () => {},
      now: () => {
        uhr.ms += 5_000;
        return new Date(uhr.ms);
      },
      logger: { info() {}, warn() {}, error() {} },
    },
    [{ id: "halo", kind: "halogen", url: "http://halo/metrics" }],
  );
  await tracker.tickNow();
  assert.equal(tracker.snapshot("halo")?.totals?.window, null, "erster Poll: noch keine Rate");
  await tracker.tickNow();
  const snap = tracker.snapshot("halo");
  assert.ok(snap);
  assert.equal(snap.totals?.window?.read, 580);
  assert.ok((snap.totals?.window?.prefillTokS ?? 0) > 0, "zweiter Poll: Rate aus Zähler-Delta");
  assert.ok((snap.live?.decodeTokS ?? 0) > 0, "Gemeldete Gegenwerte bleiben sichtbar");
});
