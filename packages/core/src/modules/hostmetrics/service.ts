import { COMPONENT_POWER_KEY, type HostMetricRange, type HostMetricsDetail, type HostMetricsHistory, type HostMetricsHost, type HostMetricsSample } from "@ancientvoid/contracts";
import type { HostCollector } from "./collector.ts";
import type { HostMetricsHistoryStore } from "./history.ts";
import { summarizeHost } from "./summary.ts";

export interface HostMetricsSource {
  id: string;
  label: string;
  kind: "hub" | "ssh";
  intervalSec: number;
  collector: HostCollector;
}

export interface HostMetricsService {
  start(): void;
  stop(): void;
  /** Ein Durchgang einer Quelle — auch für Tests direkt aufrufbar. */
  tick(id: string): Promise<void>;
  hosts(): HostMetricsHost[];
  detail(id: string): HostMetricsDetail | null;
  history(id: string, key: string, range: HostMetricRange): HostMetricsHistory | null;
}

interface State {
  source: HostMetricsSource;
  sample: HostMetricsSample | null;
  error: string | null;
  running: boolean;
  /** Der erste Durchgang hat noch keine Raten und zählt nicht in den Verlauf. */
  warm: boolean;
}

export function createHostMetricsService(options: {
  sources: HostMetricsSource[];
  history: HostMetricsHistoryStore;
  nowMs(): number;
  logger: { warn(message: string, fields?: Record<string, unknown>): void };
}): HostMetricsService {
  const { history, nowMs, logger } = options;
  const states = new Map<string, State>(options.sources.map((source) => [source.id, { source, sample: null, error: null, running: false, warm: false }]));
  const timers: ReturnType<typeof setInterval>[] = [];
  let stopped = false;

  async function tick(id: string): Promise<void> {
    const state = states.get(id);
    if (!state || state.running) return; // ein hängender Durchgang stapelt sich nicht
    state.running = true;
    try {
      const sample = await state.source.collector.collect();
      if (stopped) return;
      state.sample = sample;
      state.error = null;
      if (state.warm) history.record(id, sample, state.source.intervalSec * 3000);
      state.warm = true;
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      if (state.error === null) logger.warn("host metrics source failed", { host: id, error });
      state.error = error;
    } finally {
      state.running = false;
    }
  }

  function status(state: State): HostMetricsHost["status"] {
    if (state.error !== null) return { ok: false, error: state.error };
    if (!state.sample) return { ok: false, error: "noch kein Messwert" };
    // Auch ein Durchgang, der nie zurückkommt, muss sichtbar werden (K9).
    const age = nowMs() - Date.parse(state.sample.ts);
    const limit = Math.max(30_000, state.source.intervalSec * 2000);
    return age > limit ? { ok: false, error: `keine Antwort seit ${Math.round(age / 1000)} s` } : { ok: true };
  }

  function view(state: State): HostMetricsHost {
    const { source, sample } = state;
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      status: status(state),
      ts: sample?.ts ?? null,
      intervalSec: source.intervalSec,
      summary: sample ? summarizeHost(sample.points) : null,
      spark: history.history(source.id, COMPONENT_POWER_KEY, "1h", nowMs()).points.slice(-60).map(([ts, avg]) => [ts, avg]),
      today: history.today(source.id, nowMs()),
    };
  }

  return {
    start() {
      for (const { source } of states.values()) {
        void tick(source.id);
        const timer = setInterval(() => void tick(source.id), source.intervalSec * 1000);
        timer.unref?.();
        timers.push(timer);
      }
    },
    stop() {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      history.close();
    },
    tick,
    hosts: () => [...states.values()].map(view),
    detail(id) {
      const state = states.get(id);
      return state ? { host: view(state), sample: state.sample } : null;
    },
    history: (id, key, range) => (states.has(id) ? history.history(id, key, range, nowMs()) : null),
  };
}
