import type { AiMetricsField, AiMetricsReport, AiMetricsSample, AiMetricsSourceReport } from "@ancientvoid/contracts";
import { parseHalogenHealth } from "./halogen-health.ts";
import { parseHalogenLogChunk } from "./halogen-log.ts";
import { parsePrometheus } from "./prometheus.ts";

/**
 * EPIC-P59 (ADR-0078): Sampler im Hub — pollt die llama.cpp-Server (bekannte
 * plus explizit konfigurierte) und den Hub-Host selbst. Retention ist der
 * In-Memory-Ring-Buffer pro Feld; Recovery = nach Neustart aus den Live-Proben
 * (dokumentierter Pfad, K7). Fehlerhafte Proben sind ein Zustand (K9), letzte
 * Werte bleiben mit Zeitstempel stehen (K10); „nicht gemeldet“ ist nie 0
 * (ADR-0023). Secrets nur als Datei-Referenz (ADR-0011), der Key selbst
 * taucht nie in Report oder Log auf.
 */

export interface AiMetricsSamplerDeps {
  fetch(url: string, init?: { headers?: Record<string, string> }): Promise<{ status: number; ok: boolean; text(): Promise<string> }>;
  readFile(path: string): Promise<string | null>;
  readdir(dir: string): Promise<string[]>;
  os: {
    loadavg(): number[];
    cpus(): { times: Record<string, number> }[];
    totalmem(): number;
    freemem(): number;
  };
  now(): Date;
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void };
}

export interface AiMetricsSamplerServer {
  url: string;
  label?: string;
  /** Dateipfad mit dem API-Key (erste Zeile) — nur als Datei, nie als Wert (ADR-0011). */
  apiKeyFile?: string;
  /**
   * Optional: Halogen-Serverlog (Kai-livelog-Format) für Prefill/Decode t/s.
   * Nur Dateipfad; Inhalt wird nicht in Events geschrieben (ADR-0078 Nachtrag).
   */
  halogenLog?: string;
}

export interface AiMetricsSamplerOptions {
  intervalSec: number;
  windowSec: number;
  retentionSamples: number;
  hostProbe: boolean;
  servers: AiMetricsSamplerServer[];
  selfLabel: string;
  deps: AiMetricsSamplerDeps;
  /** Test-Injektion; Default: /sys/class/drm. */
  sysfsRoot?: string;
}

export interface AiMetricsSampler {
  start(): void;
  stop(): void;
  /** Ein Poll-Tick über alle Quellen — auch für Tests direkt aufrufbar. */
  tickNow(): Promise<void>;
  report(): AiMetricsReport;
}

interface FieldDef {
  key: string;
  label: string;
  unit: string;
  source: "gemeldet" | "sysfs" | "os" | "abgeleitet";
  family?: string;
  file?: string;
  derive?: (prev: Record<string, number>, cur: Record<string, number>, dtSec: number) => number | null;
}

const MODEL_FIELDS: FieldDef[] = [
  { key: "derived:tokens_per_s_total", label: "Tokens/s gesamt", unit: "tokens/s", source: "abgeleitet", derive: (p, c, dt) => rate(p, c, dt, ["llamacpp:prompt_tokens_total", "llamacpp:tokens_predicted_total"]) },
  { key: "derived:tokens_per_s_prefill", label: "Prefill tokens/s", unit: "tokens/s", source: "abgeleitet", derive: (p, c, dt) => rate(p, c, dt, ["llamacpp:prompt_tokens_total"]) },
  { key: "derived:tokens_per_s_decode", label: "Decode tokens/s", unit: "tokens/s", source: "abgeleitet", derive: (p, c, dt) => rate(p, c, dt, ["llamacpp:tokens_predicted_total"]) },
  { key: "derived:ttft_s_per_token", label: "Prefill-Zeit je Token", unit: "s/token", source: "abgeleitet", derive: (p, c, dt) => {
    const dTokens = (c["llamacpp:prompt_tokens_total"] ?? NaN) - (p["llamacpp:prompt_tokens_total"] ?? NaN);
    const dSeconds = (c["llamacpp:prompt_seconds_total"] ?? NaN) - (p["llamacpp:prompt_seconds_total"] ?? NaN);
    return dt > 0 && Number.isFinite(dTokens) && Number.isFinite(dSeconds) && dTokens > 0 ? dSeconds / dTokens : null;
  } },
  { key: "llamacpp:prompt_tokens_total", label: "Prompt-Tokens (kumuliert)", unit: "count", source: "gemeldet", family: "llamacpp:prompt_tokens_total" },
  { key: "llamacpp:prompt_seconds_total", label: "Prompt-Zeit (kumuliert)", unit: "s", source: "gemeldet", family: "llamacpp:prompt_seconds_total" },
  { key: "llamacpp:prompt_tokens_seconds", label: "Prefill- Durchschn. (gemeldet)", unit: "tokens/s", source: "gemeldet", family: "llamacpp:prompt_tokens_seconds" },
  { key: "llamacpp:tokens_predicted_total", label: "Generierte Tokens (kumuliert)", unit: "count", source: "gemeldet", family: "llamacpp:tokens_predicted_total" },
  { key: "llamacpp:predicted_tokens_seconds_total", label: "Decode-Zeit (kumuliert)", unit: "s", source: "gemeldet", family: "llamacpp:predicted_tokens_seconds_total" },
  { key: "llamacpp:predicted_tokens_seconds", label: "Decode- Durchschn. (gemeldet)", unit: "tokens/s", source: "gemeldet", family: "llamacpp:predicted_tokens_seconds" },
  { key: "llamacpp:requests_processing", label: "Queue: in Bearbeitung", unit: "count", source: "gemeldet", family: "llamacpp:requests_processing" },
  { key: "llamacpp:requests_deferred", label: "Queue: zurückgestellt", unit: "count", source: "gemeldet", family: "llamacpp:requests_deferred" },
  { key: "llamacpp:n_tokens_max", label: "Kontext high-water", unit: "tokens", source: "gemeldet", family: "llamacpp:n_tokens_max" },
  { key: "llamacpp:n_decode_total", label: "llama_decode-Aufrufe", unit: "count", source: "gemeldet", family: "llamacpp:n_decode_total" },
  { key: "llamacpp:n_busy_slots_per_decode", label: "Busy-Slots je decode", unit: "count", source: "gemeldet", family: "llamacpp:n_busy_slots_per_decode" },
  { key: "llamacpp:spec_decode_num_draft_tokens_total", label: "Spec-Decoding: draft tokens", unit: "count", source: "gemeldet", family: "llamacpp:spec_decode_num_draft_tokens_total" },
  { key: "llamacpp:spec_decode_num_accepted_tokens_total", label: "Spec-Decoding: accepted tokens", unit: "count", source: "gemeldet", family: "llamacpp:spec_decode_num_accepted_tokens_total" },
  { key: "llamacpp:spec_decode_num_drafts_total", label: "Spec-Decoding: drafts", unit: "count", source: "gemeldet", family: "llamacpp:spec_decode_num_drafts_total" },
  { key: "llamacpp:spec_decode_num_accepted_tokens_per_pos_total", label: "Spec-Decoding: accepted je Position (Summe)", unit: "count", source: "gemeldet", family: "llamacpp:spec_decode_num_accepted_tokens_per_pos_total" },
  // Halogen (peonist) — /health und optional Log (ADR-0078 Nachtrag).
  { key: "halogen:queued", label: "Halogen: Warteschlange", unit: "count", source: "gemeldet", family: "halogen:queued" },
  { key: "halogen:in_flight", label: "Halogen: in Bearbeitung", unit: "count", source: "gemeldet", family: "halogen:in_flight" },
  { key: "halogen:busy", label: "Halogen: busy", unit: "bool", source: "gemeldet", family: "halogen:busy" },
  { key: "halogen:busy_for_s", label: "Halogen: busy seit", unit: "s", source: "gemeldet", family: "halogen:busy_for_s" },
  { key: "halogen:slots", label: "Halogen: Slots", unit: "count", source: "gemeldet", family: "halogen:slots" },
  { key: "halogen:context", label: "Halogen: Kontext", unit: "tokens", source: "gemeldet", family: "halogen:context" },
  { key: "halogen:kv_pool_positions", label: "Halogen: KV-Pool", unit: "tokens", source: "gemeldet", family: "halogen:kv_pool_positions" },
  { key: "halogen:decode_tokens_per_s", label: "Halogen: Decode tokens/s", unit: "tokens/s", source: "gemeldet", family: "halogen:decode_tokens_per_s" },
  { key: "halogen:prefill_tokens_per_s", label: "Halogen: Prefill tokens/s", unit: "tokens/s", source: "gemeldet", family: "halogen:prefill_tokens_per_s" },
];

const HOST_FIELDS: FieldDef[] = [
  { key: "os:load1", label: "Last Ø 1 min", unit: "load", source: "os" },
  { key: "os:load5", label: "Last Ø 5 min", unit: "load", source: "os" },
  { key: "os:load15", label: "Last Ø 15 min", unit: "load", source: "os" },
  { key: "derived:cpu_busy_percent", label: "CPU-Auslastung", unit: "%", source: "abgeleitet" },
  { key: "derived:mem_used_bytes", label: "RAM belegt", unit: "bytes", source: "abgeleitet" },
  { key: "os:mem_total_bytes", label: "RAM gesamt", unit: "bytes", source: "os" },
  { key: "sysfs:gpu_busy_percent", label: "GPU busy", unit: "%", source: "sysfs", file: "gpu_busy_percent" },
  { key: "sysfs:gpu_mem_busy_percent", label: "GPU memory busy", unit: "%", source: "sysfs", file: "mem_busy_percent" },
  { key: "sysfs:vram_used_bytes", label: "VRAM belegt", unit: "bytes", source: "sysfs", file: "mem_info_vram_used" },
  { key: "sysfs:vram_total_bytes", label: "VRAM gesamt", unit: "bytes", source: "sysfs", file: "mem_info_vram_total" },
  { key: "sysfs:gtt_used_bytes", label: "GTt belegt", unit: "bytes", source: "sysfs", file: "mem_info_gtt_used" },
  { key: "sysfs:gpu_temp_celsius", label: "GPU-Temperatur", unit: "°C", source: "sysfs" },
  { key: "sysfs:power_watts", label: "GPU-Leistung", unit: "W", source: "sysfs" },
  { key: "sysfs:package_power_watts", label: "CPU-Paket-Leistung", unit: "W", source: "sysfs" },
];

function rate(prev: Record<string, number>, cur: Record<string, number>, dtSec: number, families: string[]): number | null {
  if (dtSec <= 0) return null;
  let delta = 0;
  for (const family of families) {
    const p = prev[family];
    const c = cur[family];
    if (p === undefined || c === undefined) return null;
    delta += c - p;
  }
  return delta / dtSec;
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))] ?? null;
}

interface SourceState {
  report: AiMetricsSourceReport;
  /** Letzte rohe Familienwerte für die abgeleiteten Felder. */
  lastRaw: Record<string, number>;
  lastCpu?: { busy: number; total: number };
  lastRawAt: number;
  /** Byte-Offset im Halogen-Log (Tail). */
  halogenLogOffset?: number;
  halogenLogRates?: { decodeTokensPerS: number | null; prefillTokensPerS: number | null };
}

export function createAiMetricsSampler(options: AiMetricsSamplerOptions): AiMetricsSampler {
  const deps = options.deps;
  const sysfsRoot = options.sysfsRoot ?? "/sys/class/drm";
  const sources: SourceState[] = [];
  for (const server of options.servers) {
    sources.push({
      report: {
        id: server.label ?? server.url,
        kind: "model-server",
        label: server.label ?? server.url,
        url: server.url,
        status: { ok: true },
        lastSampleAt: null,
        fields: [],
      },
      lastRaw: {},
      lastRawAt: 0,
    });
  }
  if (options.hostProbe) {
    sources.push({
      report: { id: "hub-host", kind: "hub-host", label: `Hub-Host (${options.selfLabel})`, url: null, status: { ok: true }, lastSampleAt: null, fields: [] },
      lastRaw: {},
      lastRawAt: 0,
    });
  }
  const rings = new Map<string, Map<string, AiMetricsSample[]>>();
  for (const source of sources) {
    const defs = source.report.kind === "model-server" ? MODEL_FIELDS : HOST_FIELDS;
    rings.set(source.report.id, new Map(defs.map((def) => [def.key, [] as AiMetricsSample[]])));
  }

  function pushSample(sourceId: string, key: string, ts: string, value: number | null): void {
    const ring = rings.get(sourceId)?.get(key);
    if (!ring) return;
    ring.push({ ts, value });
    while (ring.length > options.retentionSamples) ring.shift();
  }

  async function apiKeyFor(server: AiMetricsSamplerServer): Promise<string | undefined> {
    if (!server.apiKeyFile) return undefined;
    const raw = await deps.readFile(server.apiKeyFile).catch(() => null);
    return raw?.split("\n")[0]?.trim() || undefined;
  }

  function metricsUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/metrics")) return parsed.toString();
      return `${parsed.origin}/metrics`;
    } catch {
      return url;
    }
  }

  function healthUrl(url: string): string {
    try {
      return `${new URL(url).origin}/health`;
    } catch {
      return url;
    }
  }

  async function appendHalogenLogRates(source: SourceState, server: AiMetricsSamplerServer, raw: Record<string, number>): Promise<void> {
    if (!server.halogenLog) return;
    const full = await deps.readFile(server.halogenLog);
    if (full === null) return;
    const offset = source.halogenLogOffset ?? 0;
    const chunk = full.length >= offset ? full.slice(offset) : full;
    source.halogenLogOffset = full.length;
    const rates = parseHalogenLogChunk(chunk, source.halogenLogRates ?? { decodeTokensPerS: null, prefillTokensPerS: null });
    source.halogenLogRates = { decodeTokensPerS: rates.decodeTokensPerS, prefillTokensPerS: rates.prefillTokensPerS };
    if (rates.decodeTokensPerS !== null) {
      raw["halogen:decode_tokens_per_s"] = rates.decodeTokensPerS;
      raw["derived:tokens_per_s_decode"] = rates.decodeTokensPerS;
    }
    if (rates.prefillTokensPerS !== null) {
      raw["halogen:prefill_tokens_per_s"] = rates.prefillTokensPerS;
      raw["derived:tokens_per_s_prefill"] = rates.prefillTokensPerS;
    }
  }

  async function tickModelServer(source: SourceState, server: AiMetricsSamplerServer, ts: string): Promise<void> {
    const headers: Record<string, string> = {};
    const key = await apiKeyFor(server);
    if (key) headers.authorization = `Bearer ${key}`;
    const init = Object.keys(headers).length ? { headers } : undefined;
    const raw: Record<string, number> = {};
    let probeError: string | undefined;

    try {
      const res = await deps.fetch(metricsUrl(server.url), init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const families = parsePrometheus(await res.text());
      for (const [family, values] of families) raw[family] = values.reduce((sum, v) => sum + v, 0);
    } catch (err) {
      probeError = err instanceof Error ? err.message : String(err);
      // Halogen: /metrics fehlt oft — Fallback /health (ADR-0078 Nachtrag).
      try {
        const health = await deps.fetch(healthUrl(server.url), init);
        if (!health.ok) throw new Error(`health HTTP ${health.status}`, { cause: err });
        const parsed = parseHalogenHealth(await health.text());
        if (!parsed.recognized) throw new Error(probeError, { cause: err });
        Object.assign(raw, parsed.raw);
        probeError = undefined;
      } catch (healthErr) {
        probeError = healthErr instanceof Error ? healthErr.message : String(healthErr);
      }
    }

    if (probeError) {
      // K9: Ausfall ist ein Zustand — und zwar ab dem nächsten Report.
      source.report.status = { ok: false, error: probeError };
      return;
    }

    await appendHalogenLogRates(source, server, raw);

    source.report.status = { ok: true };
    source.report.lastSampleAt = ts;
    const dtSec = source.lastRawAt ? (Date.parse(ts) - source.lastRawAt) / 1000 : 0;
    for (const def of MODEL_FIELDS) {
      let value: number | null;
      if (def.family) value = raw[def.family] ?? null;
      else if (def.key.startsWith("derived:") && raw[def.key] !== undefined) value = raw[def.key]!;
      else value = def.derive ? def.derive(source.lastRaw, raw, dtSec) : null;
      // ADR-0023: ein Feld, das die Quelle nicht meldet, bleibt „nicht gemeldet“.
      if (value !== null) pushSample(source.report.id, def.key, ts, value);
    }
    source.lastRaw = raw;
    source.lastRawAt = Date.parse(ts);
  }

  async function tickHost(source: SourceState, ts: string): Promise<void> {
    source.report.lastSampleAt = ts;
    const raw: Record<string, number> = {};
    const cards = (await deps.readdir(sysfsRoot).catch(() => [] as string[])).filter((entry) => /^card\d+$/.test(entry));
    let card: string | undefined;
    for (const entry of cards) {
      if ((await deps.readFile(`${sysfsRoot}/${entry}/device/gpu_busy_percent`)) !== null) {
        card = entry;
        break;
      }
    }
    // Eine leere Datei ist keine Messung: Number("") wäre 0 (ADR-0023).
    const readNumber = async (path: string): Promise<number | null> => {
      const text = (await deps.readFile(path).catch(() => null))?.trim();
      const n = text ? Number(text) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const readSysfs = async (file: string): Promise<number | null> => {
      if (!card) return null;
      return readNumber(`${sysfsRoot}/${card}/device/${file}`);
    };
    let hwmonDir: string | null = null;
    if (card) {
      const base = `${sysfsRoot}/${card}/device/hwmon`;
      for (const entry of await deps.readdir(base).catch(() => [] as string[])) {
        const chip = await deps.readFile(`${base}/${entry}/name`).catch(() => null);
        if (chip?.trim() === "amdgpu") hwmonDir = `${base}/${entry}`;
      }
    }
    // BUG-0274: PPT ist auf einer APU (vddnb) das CPU-Paket, auf einer Karte
    // (power1_cap) die GPU. Ohne eindeutiges Merkmal bleibt beides „nicht gemeldet“.
    let pptKind: "card" | "package" | null = null;
    let pptWatts: number | null = null;
    if (hwmonDir !== null) {
      const apu = (await deps.readFile(`${hwmonDir}/in1_label`).catch(() => null))?.trim() === "vddnb";
      const capped = (await readNumber(`${hwmonDir}/power1_cap`)) !== null;
      if (apu !== capped) pptKind = apu ? "package" : "card";
      const micro = (await readNumber(`${hwmonDir}/power1_average`)) ?? (await readNumber(`${hwmonDir}/power1_input`));
      pptWatts = micro === null ? null : micro / 1_000_000;
    }
    raw["os:load1"] = deps.os.loadavg()[0] ?? NaN;
    raw["os:load5"] = deps.os.loadavg()[1] ?? NaN;
    raw["os:load15"] = deps.os.loadavg()[2] ?? NaN;
    raw["os:mem_total_bytes"] = deps.os.totalmem();
    raw["derived:mem_used_bytes"] = deps.os.totalmem() - deps.os.freemem();
    const cpus = deps.os.cpus();
    const busy = (t: Record<string, number>) => (t.user ?? 0) + (t.nice ?? 0) + (t.system ?? 0) + (t.irq ?? 0) + (t.softirq ?? 0) + (t.steal ?? 0);
    const total = (t: Record<string, number>) => busy(t) + (t.idle ?? 0);
    const busyNow = cpus.reduce((sum, c) => sum + busy(c.times), 0);
    const totalNow = cpus.reduce((sum, c) => sum + total(c.times), 0);
    raw["derived:cpu_busy_percent"] = NaN; // beim ersten Tick ohne Delta: nicht gemeldet
    if (source.lastCpu) {
      const dB = busyNow - source.lastCpu.busy;
      const dT = totalNow - source.lastCpu.total;
      if (dT > 0) raw["derived:cpu_busy_percent"] = (dB / dT) * 100;
    }
    for (const def of HOST_FIELDS) {
      let value: number | null;
      if (def.file) value = await readSysfs(def.file);
      else if (def.key === "sysfs:gpu_temp_celsius") {
        const milli = hwmonDir === null ? null : await readNumber(`${hwmonDir}/temp1_input`);
        value = milli === null ? null : milli / 1000;
      } else if (def.key === "sysfs:power_watts") {
        value = pptKind === "card" ? pptWatts : null;
      } else if (def.key === "sysfs:package_power_watts") {
        value = pptKind === "package" ? pptWatts : null;
      } else {
        value = raw[def.key] !== undefined && Number.isFinite(raw[def.key]) ? raw[def.key]! : null;
      }
      if (value !== null && Number.isFinite(value)) pushSample(source.report.id, def.key, ts, value);
    }
    source.lastCpu = { busy: busyNow, total: totalNow };
    source.lastRawAt = Date.parse(ts);
  }

  let timer: ReturnType<typeof setInterval> | undefined;

  const sampler: AiMetricsSampler = {
    start() {
      if (timer) return;
      void sampler.tickNow();
      timer = setInterval(() => void sampler.tickNow(), options.intervalSec * 1000);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    async tickNow() {
      const ts = deps.now().toISOString();
      const modelServers = options.servers;
      let i = 0;
      for (const source of sources) {
        const server = modelServers[i++];
        if (source.report.kind === "model-server" && server) await tickModelServer(source, server, ts);
        else await tickHost(source, ts);
      }
    },
    report() {
      const windowMs = options.windowSec * 1000;
      const nowMs = Date.parse(deps.now().toISOString());
      return {
        generatedAt: deps.now().toISOString(),
        intervalSec: options.intervalSec,
        windowSec: options.windowSec,
        self: { hostLabel: options.selfLabel },
        sources: sources.map((source) => {
          const fields: AiMetricsField[] = [];
          const ringsForSource = rings.get(source.report.id) ?? new Map<string, AiMetricsSample[]>();
          for (const def of (source.report.kind === "model-server" ? MODEL_FIELDS : HOST_FIELDS)) {
            const samples = ringsForSource.get(def.key) ?? [];
            const window = samples.filter((s) => nowMs - Date.parse(s.ts) <= windowMs);
            const values = window.map((s) => s.value).filter((v): v is number => v !== null).sort((a, b) => a - b);
            const last = [...samples].reverse().find((s) => s.value !== null);
            fields.push({
              key: def.key,
              label: def.label,
              unit: def.unit,
              source: def.source,
              value: last?.value ?? null,
              ts: last?.ts ?? null,
              window: { windowSec: options.windowSec, samples: window.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) },
              history: window,
            });
          }
          return { ...source.report, fields };
        }),
      };
    },
  };
  return sampler;
}
