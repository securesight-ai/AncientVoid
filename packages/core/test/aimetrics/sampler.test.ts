import { describe, expect, it } from "vitest";
import { createAiMetricsSampler, type AiMetricsSamplerDeps } from "../../src/modules/aimetrics/index.ts";
import type { AiMetricsReport } from "@ancientvoid/contracts";

/** EPIC-P59 (ADR-0078): Sampler — Prometheus-Parser, Fenster-Persistenz, Redaction, Recovery. */

const SECRET = "geheim-KEY-XYZ";

function fakeDeps(overrides: Partial<AiMetricsSamplerDeps> = {}): AiMetricsSamplerDeps & { logs: string[]; authHeader: () => string | undefined } {
  const logs: string[] = [];
  let lastAuth: string | undefined;
  const deps: AiMetricsSamplerDeps = {
    fetch: async (_url, init) => {
      lastAuth = (init?.headers as Record<string, string> | undefined)?.authorization;
      return { status: 200, ok: true, text: async () => FULL_TEXT };
    },
    readFile: async (path) => (path.endsWith("key.txt") ? `${SECRET}\n` : SYSFS[path] ?? null),
    readdir: async (dir) => (dir.endsWith("/drm") ? ["card0"] : dir.endsWith("/hwmon") ? ["hwmon3"] : []),
    os: {
      loadavg: () => [1.5, 1.2, 1.0],
      cpus: () => [{ times: { user: 1000, nice: 0, system: 500, idle: 8000, irq: 0, softirq: 0, steal: 0 } }],
      totalmem: () => 64_000_000_000,
      freemem: () => 40_000_000_000,
    },
    now: () => new Date("2026-11-14T12:00:00.000Z"),
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    ...overrides,
  };
  return Object.assign(deps, { logs, authHeader: () => lastAuth });
}

const FULL_TEXT = [
  "# TYPE llamacpp:prompt_tokens_total counter",
  "llamacpp:prompt_tokens_total 1000",
  "# TYPE llamacpp:prompt_seconds_total counter",
  "llamacpp:prompt_seconds_total 2",
  "# TYPE llamacpp:prompt_tokens_seconds gauge",
  "llamacpp:prompt_tokens_seconds 500",
  "# TYPE llamacpp:tokens_predicted_total counter",
  "llamacpp:tokens_predicted_total 200",
  "# TYPE llamacpp:predicted_tokens_seconds_total counter",
  "llamacpp:predicted_tokens_seconds_total 4",
  "# TYPE llamacpp:predicted_tokens_seconds gauge",
  "llamacpp:predicted_tokens_seconds 50",
  "# TYPE llamacpp:requests_processing gauge",
  "llamacpp:requests_processing 1",
  "# TYPE llamacpp:requests_deferred gauge",
  "llamacpp:requests_deferred 0",
  "# TYPE llamacpp:n_tokens_max counter",
  "llamacpp:n_tokens_max 4096",
  "# TYPE llamacpp:n_decode_total counter",
  "llamacpp:n_decode_total 700",
  "# TYPE llamacpp:n_busy_slots_per_decode gauge",
  "llamacpp:n_busy_slots_per_decode 1",
  "# TYPE llamacpp:spec_decode_num_accepted_tokens_per_pos_total counter",
  'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="0"} 30',
  'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="1"} 12',
].join("\n");

const SYSFS: Record<string, string> = {
  "/sys/class/drm/card0/device/gpu_busy_percent": "42\n",
  "/sys/class/drm/card0/device/mem_info_vram_used": "2000000000\n",
  "/sys/class/drm/card0/device/mem_info_vram_total": "8000000000\n",
  "/sys/class/drm/card0/device/mem_info_gtt_used": "100000000\n",
  "/sys/class/drm/card0/device/hwmon/hwmon3/name": "amdgpu\n",
  "/sys/class/drm/card0/device/hwmon/hwmon3/temp1_input": "51000\n",
};

function sampler(deps: AiMetricsSamplerDeps) {
  return createAiMetricsSampler({
    intervalSec: 2,
    windowSec: 900,
    retentionSamples: 5400,
    hostProbe: true,
    servers: [{ url: "http://fake:8081/v1", label: "qwen", apiKeyFile: "key.txt" }],
    selfLabel: "testhub",
    deps,
  });
}

describe("aimetrics sampler (EPIC-P59)", () => {
  it("liefert volle Daten mit Quelle an jeder Zahl (ADR-0023)", async () => {
    const deps = fakeDeps();
    const s = sampler(deps);
    await s.tickNow();
    const report = s.report();
    const server = report.sources.find((x) => x.kind === "model-server")!;
    expect(server.status.ok).toBe(true);
    const decode = server.fields.find((f) => f.key === "llamacpp:predicted_tokens_seconds")!;
    expect(decode.value).toBe(50);
    expect(decode.source).toBe("gemeldet");
    expect(decode.ts).not.toBeNull();
    const derived = server.fields.find((f) => f.key === "derived:tokens_per_s_total")!;
    expect(derived.source).toBe("abgeleitet");
    // Nach dem zweiten Tick mit Zähler-Delta: abgeleitete Rate verfügbar.
    deps.now = () => new Date("2026-11-14T12:00:10.000Z");
    await s.tickNow();
    const r2: AiMetricsReport = s.report();
    const d2 = r2.sources.find((x) => x.kind === "model-server")!.fields.find((f) => f.key === "derived:tokens_per_s_total")!;
    expect(d2.value).not.toBeNull();
  });

  it("meldet fehlende Familien als „nicht gemeldet“ und nie als 0 (ADR-0023)", async () => {
    const deps = fakeDeps({
      fetch: async () => ({ status: 200, ok: true, async text() { return "llamacpp:requests_processing 3\n"; } }),
    });
    const s = sampler(deps);
    await s.tickNow();
    const server = s.report().sources.find((x) => x.kind === "model-server")!;
    expect(server.status.ok).toBe(true);
    const spec = server.fields.find((f) => f.key === "llamacpp:spec_decode_num_accepted_tokens_per_pos_total")!;
    expect(spec.value).toBeNull();
    expect(server.fields.find((f) => f.key === "llamacpp:requests_processing")!.value).toBe(3);
  });

  it("Probe-Ausfall wird sofort als Zustand sichtbar und löscht keine letzten Werte (K9/K10)", async () => {
    const deps = fakeDeps();
    const s = sampler(deps);
    await s.tickNow();
    const before = s.report().sources.find((x) => x.kind === "model-server")!;
    expect(before.status.ok).toBe(true);
    deps.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await s.tickNow();
    const after = s.report().sources.find((x) => x.kind === "model-server")!;
    expect(after.status.ok).toBe(false);
    const decode = after.fields.find((f) => f.key === "llamacpp:predicted_tokens_seconds")!;
    expect(decode.value).toBe(50);
    expect(decode.ts).not.toBeNull();
  });

  it("Key nur im Header, nie im Report oder Log (Redaction, ADR-0011)", async () => {
    const deps = fakeDeps();
    const s = sampler(deps);
    await s.tickNow();
    expect(deps.authHeader()).toBe(`Bearer ${SECRET}`);
    expect(JSON.stringify(s.report())).not.toContain(SECRET);
    expect(deps.logs.join("\n")).not.toContain(SECRET);
  });

  it("p50/p95 aus dem eigenen Sample-Fenster — Histogramm gibt es nicht (ADR-0078)", async () => {
    let n = 0;
    const deps = fakeDeps({
      fetch: async () => ({ status: 200, ok: true, async text() { return `llamacpp:requests_processing ${++n}\n`; } }),
    });
    const s = sampler(deps);
    for (let i = 1; i <= 100; i++) {
      deps.now = () => new Date(Date.parse("2026-11-14T12:00:00.000Z") + i * 1000);
      await s.tickNow();
    }
    const field = s.report().sources.find((x) => x.kind === "model-server")!.fields.find((f) => f.key === "llamacpp:requests_processing")!;
    expect(field.window!.samples).toBe(100);
    expect(field.window!.p50).toBe(50);
    expect(field.window!.p95).toBe(95);
  });

  it("Host-Probe: sysfs und os; Unlesbares bleibt „nicht gemeldet“ (Spike-Befund power)", async () => {
    const s = sampler(fakeDeps());
    await s.tickNow();
    const host = s.report().sources.find((x) => x.kind === "hub-host")!;
    expect(host.fields.find((f) => f.key === "os:load1")!.value).toBe(1.5);
    expect(host.fields.find((f) => f.key === "sysfs:gpu_busy_percent")!.value).toBe(42);
    expect(host.fields.find((f) => f.key === "sysfs:gpu_temp_celsius")!.value).toBe(51);
    expect(host.fields.find((f) => f.key === "sysfs:power_watts")!.value).toBeNull();
  });

  describe("BUG-0274: PPT aus hwmon — Karte oder CPU-Paket", () => {
    const HWMON = "/sys/class/drm/card0/device/hwmon/hwmon3";
    const probe = async (extra: Record<string, string>) => {
      const files: Record<string, string> = { ...SYSFS, ...extra };
      const s = sampler(fakeDeps({ readFile: async (path) => files[path] ?? null }));
      await s.tickNow();
      const host = s.report().sources.find((x) => x.kind === "hub-host")!;
      const value = (key: string) => host.fields.find((f) => f.key === key)?.value;
      return { gpu: value("sysfs:power_watts"), paket: value("sysfs:package_power_watts") };
    };

    it("gesteckte Karte (power1_cap): GPU-Leistung", async () => {
      expect(await probe({ [`${HWMON}/power1_input`]: "65980000\n", [`${HWMON}/power1_cap`]: "175000000\n" })).toEqual({ gpu: 65.98, paket: null });
    });

    it("APU (vddnb): CPU-Paket, nie GPU-Leistung", async () => {
      expect(await probe({ [`${HWMON}/power1_input`]: "64120000\n", [`${HWMON}/in1_label`]: "vddnb\n" })).toEqual({ gpu: null, paket: 64.12 });
    });

    it("power1_average geht vor, power1_input ist der Rückfall", async () => {
      expect((await probe({ [`${HWMON}/power1_average`]: "50000000", [`${HWMON}/power1_input`]: "70000000", [`${HWMON}/power1_cap`]: "1" })).gpu).toBe(50);
    });

    it("nicht zuordenbar, leer oder keine Zahl: nicht gemeldet, nie 0", async () => {
      const leer = { gpu: null, paket: null };
      expect(await probe({ [`${HWMON}/power1_input`]: "64120000" })).toEqual(leer);
      expect(await probe({ [`${HWMON}/power1_input`]: "\n", [`${HWMON}/power1_cap`]: "1" })).toEqual(leer);
      expect(await probe({ [`${HWMON}/power1_input`]: "<n/a", [`${HWMON}/power1_cap`]: "1" })).toEqual(leer);
      expect(await probe({ [`${HWMON}/power1_input`]: "1", [`${HWMON}/power1_cap`]: "1", [`${HWMON}/in1_label`]: "vddnb" })).toEqual(leer);
    });
  });

  it("K7-Recovery: ein frischer Sampler baut die Felder aus den Live-Proben wieder auf (AC-P59-3)", async () => {
    const deps = fakeDeps();
    const s1 = sampler(deps);
    await s1.tickNow();
    expect(s1.report().sources.find((x) => x.kind === "model-server")!.fields.find((f) => f.key === "llamacpp:n_tokens_max")!.value).toBe(4096);
    const s2 = sampler(deps);
    await s2.tickNow();
    const recovered = s2.report().sources.find((x) => x.kind === "model-server")!.fields.find((f) => f.key === "llamacpp:n_tokens_max")!.value;
    expect(recovered).toBe(4096);
  });

  it("Key aus apiKeyFile wird pro Quellennamen im Report angezeigt, der Key selbst nie", async () => {
    const deps = fakeDeps();
    const s = sampler(deps);
    await s.tickNow();
    const json = JSON.stringify(s.report());
    expect(json).toContain("qwen");
    expect(json).not.toContain(SECRET);
  });
});
