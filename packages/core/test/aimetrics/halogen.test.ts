import { describe, expect, it } from "vitest";
import { parseHalogenHealth } from "../../src/modules/aimetrics/halogen-health.ts";
import { parseHalogenLogChunk } from "../../src/modules/aimetrics/halogen-log.ts";
import { createAiMetricsSampler, type AiMetricsSamplerDeps } from "../../src/modules/aimetrics/index.ts";

/** EPIC-P59 / ADR-0078 Nachtrag: Halogen /health + Log-Raten. */

const HEALTH = JSON.stringify({
  status: "ok",
  model: "halogen-qwen3.8-flash-next-uncensored-iq4xs",
  queued: 2,
  in_flight: 1,
  busy: true,
  busy_for_s: 12.5,
  slots: 2,
  context: 216064,
  kv_pool_positions: 216064,
  version: { api: "0.18.2" },
});

describe("halogen health parse", () => {
  it("liest Queue/Busy/Slots aus /health", () => {
    const { raw, recognized } = parseHalogenHealth(HEALTH);
    expect(recognized).toBe(true);
    expect(raw["halogen:queued"]).toBe(2);
    expect(raw["halogen:in_flight"]).toBe(1);
    expect(raw["halogen:busy"]).toBe(1);
    expect(raw["halogen:slots"]).toBe(2);
  });

  it("erkennt Nicht-Halogen-JSON nicht als Treffer", () => {
    expect(parseHalogenHealth('{"hello":1}').recognized).toBe(false);
  });
});

describe("halogen log parse", () => {
  it("nimmt Decode- und Prefill-Rate aus serve_api-Zeilen", () => {
    const line =
      "serve_api: decode 400 tok in 8.0s = 50.0 t/s | prompt 3000 (1000 cached), prefill 4.0s";
    const rates = parseHalogenLogChunk(line);
    expect(rates.decodeTokensPerS).toBe(50);
    expect(rates.prefillTokensPerS).toBe(500); // (3000-1000)/4
  });

  it("nimmt Proxy-Raten als Decode-Fallback", () => {
    const rates = parseHalogenLogChunk("12:00:01 [#3] n_gen ~120  41.5 t/s  Phase Antwort");
    expect(rates.decodeTokensPerS).toBe(41.5);
  });
});

describe("aimetrics sampler halogen fallback", () => {
  it("fällt bei /metrics 404 auf /health zurück und bleibt ok", async () => {
    const logs: string[] = [];
    const deps: AiMetricsSamplerDeps = {
      fetch: async (url) => {
        if (url.endsWith("/metrics")) return { status: 404, ok: false, text: async () => "not found" };
        if (url.endsWith("/health")) return { status: 200, ok: true, text: async () => HEALTH };
        return { status: 500, ok: false, text: async () => "" };
      },
      readFile: async () => null,
      readdir: async () => [],
      os: { loadavg: () => [0, 0, 0], cpus: () => [], totalmem: () => 1, freemem: () => 1 },
      now: () => new Date("2026-11-17T12:00:00.000Z"),
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    };
    const s = createAiMetricsSampler({
      intervalSec: 10,
      windowSec: 900,
      retentionSamples: 100,
      hostProbe: false,
      servers: [{ url: "http://evox2:8100/v1", label: "halogen" }],
      selfLabel: "test",
      deps,
    });
    await s.tickNow();
    const src = s.report().sources[0]!;
    expect(src.status.ok).toBe(true);
    expect(src.fields.find((f) => f.key === "halogen:queued")?.value).toBe(2);
    expect(src.fields.find((f) => f.key === "halogen:busy")?.value).toBe(1);
  });

  it("liest Prefill/Decode aus halogenLog", async () => {
    const log =
      "serve_api: decode 100 tok in 2.0s = 50.0 t/s | prompt 2500 (500 cached), prefill 5.0s\n";
    const deps: AiMetricsSamplerDeps = {
      fetch: async (url) => {
        if (url.endsWith("/metrics")) return { status: 404, ok: false, text: async () => "not found" };
        return { status: 200, ok: true, text: async () => HEALTH };
      },
      readFile: async (path) => (path === "/tmp/halogen.log" ? log : null),
      readdir: async () => [],
      os: { loadavg: () => [0, 0, 0], cpus: () => [], totalmem: () => 1, freemem: () => 1 },
      now: () => new Date("2026-11-17T12:00:00.000Z"),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
    const s = createAiMetricsSampler({
      intervalSec: 10,
      windowSec: 900,
      retentionSamples: 100,
      hostProbe: false,
      servers: [{ url: "http://evox2:8100/v1", label: "halogen", halogenLog: "/tmp/halogen.log" }],
      selfLabel: "test",
      deps,
    });
    await s.tickNow();
    const fields = s.report().sources[0]!.fields;
    expect(fields.find((f) => f.key === "halogen:decode_tokens_per_s")?.value).toBe(50);
    expect(fields.find((f) => f.key === "halogen:prefill_tokens_per_s")?.value).toBe(400);
  });
});

describe("BUG-0278: Halogen-Zähler neben dem Gateway", () => {
  const COUNTERS = (req: number, tok: number, sec: number) =>
    `halogen:requests_total ${req}\nllamacpp:tokens_predicted_total ${tok}\nllamacpp:tokens_predicted_seconds_total ${sec}\nllamacpp:prompt_tokens_total 10\nllamacpp:prompt_seconds_total 1\n`;

  function setup() {
    const state = { counters: COUNTERS(5, 100, 2) as string | null, now: Date.parse("2026-11-23T22:00:00.000Z"), keys: new Map<string, string | undefined>() };
    const deps: AiMetricsSamplerDeps = {
      fetch: async (url, init) => {
        state.keys.set(url, (init?.headers as Record<string, string> | undefined)?.authorization);
        if (url === "http://127.0.0.1:18099/metrics" && state.counters !== null) return { status: 200, ok: true, text: async () => state.counters! };
        if (url === "http://gw:8100/health") return { status: 200, ok: true, text: async () => HEALTH };
        return { status: 404, ok: false, text: async () => "" };
      },
      readFile: async () => "gateway-key",
      readdir: async () => [],
      os: { loadavg: () => [0, 0, 0], cpus: () => [], totalmem: () => 1, freemem: () => 1 },
      now: () => new Date(state.now),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
    const sampler = createAiMetricsSampler({
      intervalSec: 10, windowSec: 900, retentionSamples: 100, hostProbe: false, selfLabel: "test", deps,
      servers: [{ url: "http://gw:8100/v1", label: "halogen", apiKeyFile: "k", metricsUrl: "http://127.0.0.1:18099/metrics" }],
    });
    const tick = async (counters: string | null) => {
      state.counters = counters;
      state.now += 10_000;
      await sampler.tickNow();
    };
    const field = (key: string) => sampler.report().sources[0]!.fields.find((f) => f.key === key)!;
    return { state, sampler, tick, field };
  }

  it("eine Anfrage zwischen zwei Abfragen wird sichtbar, der letzte Wert bleibt mit Zeit stehen", async () => {
    const { tick, field, state } = setup();
    await tick(COUNTERS(5, 100, 2));
    expect(field("derived:decode_active").value).toBeNull();
    await tick(COUNTERS(6, 370, 6.5));
    expect(field("derived:decode_active").value).toBeCloseTo(60);
    expect(field("derived:requests_per_min").value).toBeCloseTo(6);
    expect(field("llamacpp:predicted_tokens_seconds_total").value).toBe(6.5);
    const seen = field("derived:decode_active").ts;
    await tick(COUNTERS(6, 370, 6.5));
    expect(field("derived:decode_active")).toMatchObject({ ts: seen });
    expect(field("derived:requests_per_min").value).toBe(0);
    // Slots kommen weiter aus /health; der Gateway-Schlüssel geht nur ans Gateway.
    expect(field("halogen:slots").value).toBe(2);
    expect(state.keys.get("http://127.0.0.1:18099/metrics")).toBeUndefined();
    expect(state.keys.get("http://gw:8100/health")).toBe("Bearer gateway-key");
  });

  it("Neustart der Engine ergibt keine negative Rate", async () => {
    const { tick, field } = setup();
    await tick(COUNTERS(6, 370, 6.5));
    await tick(COUNTERS(0, 0, 0));
    expect(field("derived:requests_per_min").value).toBeNull();
    expect(field("derived:tokens_per_s_decode").value).toBeNull();
  });

  it("Zähler weg: Quelle meldet Fehler, /health-Werte bleiben (K9)", async () => {
    const { tick, field, sampler } = setup();
    await tick(null);
    expect(sampler.report().sources[0]!.status).toMatchObject({ ok: false, error: expect.stringContaining("Zähler nicht erreichbar") });
    expect(field("halogen:slots").value).toBe(2);
  });
});
