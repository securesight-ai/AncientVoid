import type { RequestRecord } from "./engine.ts";

/**
 * EPIC-P79 T79.2: eigene Request-Historie. Die Engines behalten nur ihre letzten
 * Requests (Strata: 12) — Perzentile über Stunden brauchen eine eigene Ablage.
 * K7: JSONL, beim Start gelesen, dedupliziert über die Request-ID; ein Neustart
 * verliert nichts außer dem, was außerhalb des Aufbewahrungsfensters liegt.
 */

export interface StoreDeps {
  readFile(path: string): Promise<string | null>;
  appendFile(path: string, data: string): Promise<void>;
  now(): Date;
}

export interface StoreOptions {
  /** aufbewahrtes Zeitfenster in Stunden (K5/K7: kein unbegrenztes Wachstum) */
  maxAgeH?: number;
  /** harte Obergrenze der Zeilen in der Datei */
  cap?: number;
}

export interface RequestStore {
  load(): Promise<{ geladen: number; verworfen: number }>;
  add(records: RequestRecord[]): Promise<number>;
  /** Requests im Fenster (aufsteigend nach Zeit). */
  window(hours?: number, nowMs?: number, quelle?: string): RequestRecord[];
  count(): number;
  oldest(): string | null;
}

function parseLine(line: string): RequestRecord | null {
  try {
    const o = JSON.parse(line) as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.at !== "string") return null;
    const n = (k: string): number | null => (typeof o[k] === "number" && Number.isFinite(o[k] as number) ? (o[k] as number) : null);
    return {
      id: o.id,
      at: o.at,
      prompt: n("prompt"),
      reused: n("reused"),
      read: n("read"),
      output: n("output"),
      prefillTokS: n("prefillTokS"),
      decodeTokS: n("decodeTokS"),
      ttftS: n("ttftS"),
      prefillS: n("prefillS"),
      decodeS: n("decodeS"),
      finish: typeof o.finish === "string" ? o.finish : null,
      source: typeof o.source === "string" ? o.source : "",
    };
  } catch {
    return null;
  }
}

export function createRequestStore(deps: StoreDeps, file: string, opts: StoreOptions = {}): RequestStore {
  const maxAgeH = opts.maxAgeH ?? 72;
  const cap = opts.cap ?? 5_000;
  const records = new Map<string, RequestRecord>();

  function prune(nowMs: number): number {
    let verworfen = 0;
    const grenze = nowMs - maxAgeH * 3_600_000;
    for (const [id, r] of records) {
      const t = Date.parse(r.at);
      if (!Number.isFinite(t) || t < grenze) {
        records.delete(id);
        verworfen += 1;
      }
    }
    if (records.size > cap) {
      const übers = [...records.entries()].sort((a, b) => Date.parse(a[1].at) - Date.parse(b[1].at)).slice(0, records.size - cap);
      for (const [id] of übers) records.delete(id);
      verworfen += übers.length;
    }
    return verworfen;
  }

  return {
    async load() {
      const text = await deps.readFile(file);
      if (!text) return { geladen: 0, verworfen: 0 };
      let geladen = 0;
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const r = parseLine(line);
        if (!r) continue;
        records.set(r.id, r);
        geladen += 1;
      }
      const verworfen = prune(deps.now().getTime());
      return { geladen, verworfen: verworfen + Math.max(0, geladen - records.size) };
    },
    async add(neue) {
      let neu = 0;
      const zeilen: string[] = [];
      for (const r of neue) {
        if (!r.id || records.has(r.id)) continue;
        records.set(r.id, r);
        zeilen.push(`${JSON.stringify(r)}\n`);
        neu += 1;
      }
      if (zeilen.length) await deps.appendFile(file, zeilen.join(""));
      prune(deps.now().getTime());
      return neu;
    },
    window(hours = maxAgeH, nowMs = deps.now().getTime(), quelle?: string) {
      const grenze = nowMs - hours * 3_600_000;
      return [...records.values()]
        .filter((r) => {
          if (quelle != null && r.source !== quelle) return false;
          const t = Date.parse(r.at);
          return Number.isFinite(t) && t >= grenze;
        })
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    },
    count: () => records.size,
    oldest: () => {
      const at = [...records.values()].map((r) => r.at).sort();
      return at[0] ?? null;
    },
  };
}
