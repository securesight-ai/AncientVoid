import { renameSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { COMPONENT_POWER_KEY, type HostMetricRange, type HostMetricsDay, type HostMetricsHistory, type HostMetricsSample } from "@ancientvoid/contracts";
import { sumComponentPower } from "./power.ts";

const MINUTE = 60_000;
const QUARTER = 15 * MINUTE;
const DAY = 86_400_000;
const KEEP_MINUTES = 7 * DAY;
const KEEP_QUARTERS = 90 * DAY;

const RANGES: Record<HostMetricRange, { span: number; table: "minutes" | "quarters"; step: number }> = {
  "1h": { span: 3_600_000, table: "minutes", step: MINUTE },
  "24h": { span: DAY, table: "minutes", step: 2 * MINUTE },
  "7d": { span: 7 * DAY, table: "quarters", step: QUARTER },
  "90d": { span: 90 * DAY, table: "quarters", step: 3 * 3_600_000 },
};

interface Bucket { sum: number; min: number; max: number; n: number }
interface HostBuffer {
  minute: number;
  buckets: Map<string, Bucket>;
  last: { ts: number; watts: number } | null;
  energy: Map<string, { wh: number; sec: number }>;
}

/** Je Kern und Spannung/Takt zeigt die Seite nur live; als Verlauf kosten sie den meisten Platz. */
const keepsHistory = (group: string, key: string): boolean => group !== "clock" && group !== "voltage" && !/^cpu:cpu\d/.test(key);

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Verlauf der Host-Metriken (ADR-0117 §5): die Datei ist selbst Quelle. Geschrieben
 * wird je abgeschlossener Minute in einer Transaktion (Verlust ≤ 60 s).
 */
export class HostMetricsHistoryStore {
  private readonly db: DatabaseSync;
  private readonly buffers = new Map<string, HostBuffer>();
  private lastPrune = 0;
  /** Gesetzt, wenn eine defekte Datei beiseitegelegt wurde. */
  readonly recoveredFrom: string | null;

  constructor(path: string, now = Date.now()) {
    let recovered: string | null = null;
    let db: DatabaseSync;
    try {
      db = open(path);
    } catch (err) {
      if (path === ":memory:" || !isCorrupt(err)) throw err;
      recovered = `${path}.defekt-${now}`;
      renameSync(path, recovered);
      for (const suffix of ["-wal", "-shm"]) {
        try {
          renameSync(path + suffix, recovered + suffix);
        } catch {
          /* gab es nicht */
        }
      }
      db = open(path);
    }
    this.db = db;
    this.recoveredFrom = recovered;
  }

  /** `maxGapMs`: über längere Lücken wird keine Energie gerechnet. */
  record(host: string, sample: HostMetricsSample, maxGapMs: number): void {
    const ts = Date.parse(sample.ts);
    const minute = Math.floor(ts / MINUTE) * MINUTE;
    let buffer = this.buffers.get(host);
    if (buffer && buffer.minute !== minute) this.flush(host);
    buffer = this.buffers.get(host);
    if (!buffer) this.buffers.set(host, (buffer = { minute, buckets: new Map(), last: null, energy: new Map() }));
    buffer.minute = minute;
    const add = (key: string, value: number) => {
      const b = buffer.buckets.get(key);
      if (!b) buffer.buckets.set(key, { sum: value, min: value, max: value, n: 1 });
      else {
        b.sum += value;
        b.min = Math.min(b.min, value);
        b.max = Math.max(b.max, value);
        b.n += 1;
      }
    };
    for (const p of sample.points) if (p.value !== null && keepsHistory(p.group, p.key)) add(p.key, p.value);
    const { watts } = sumComponentPower(sample.points);
    if (watts === null) {
      buffer.last = null;
      return;
    }
    add(COMPONENT_POWER_KEY, watts);
    const gap = buffer.last ? ts - buffer.last.ts : 0;
    if (buffer.last && gap > 0 && gap <= maxGapMs) {
      const day = localDay(buffer.last.ts);
      const e = buffer.energy.get(day) ?? { wh: 0, sec: 0 };
      e.wh += (((buffer.last.watts + watts) / 2) * gap) / 3_600_000;
      e.sec += gap / 1000;
      buffer.energy.set(day, e);
    }
    buffer.last = { ts, watts };
  }

  private flush(host: string): void {
    const buffer = this.buffers.get(host);
    if (!buffer || (buffer.buckets.size === 0 && buffer.energy.size === 0)) return;
    this.db.exec("BEGIN");
    try {
      const keyId = this.db.prepare("INSERT INTO keys (host, key) VALUES (?, ?) ON CONFLICT (host, key) DO UPDATE SET key = excluded.key RETURNING id");
      const insert = this.db.prepare("INSERT OR REPLACE INTO minutes (key_id, ts, avg, min, max, n) VALUES (?, ?, ?, ?, ?, ?)");
      for (const [key, b] of buffer.buckets) {
        const { id } = keyId.get(host, key) as { id: number };
        insert.run(id, buffer.minute / 1000, b.sum / b.n, b.min, b.max, b.n);
      }
      const energy = this.db.prepare("INSERT INTO energy (host, day, wh, sec) VALUES (?, ?, ?, ?) ON CONFLICT (host, day) DO UPDATE SET wh = wh + excluded.wh, sec = sec + excluded.sec");
      for (const [day, e] of buffer.energy) energy.run(host, day, e.wh, e.sec);
      this.rollup(host, buffer.minute);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      buffer.buckets.clear();
      buffer.energy.clear();
    }
    if (buffer.minute - this.lastPrune > 3_600_000) this.prune(buffer.minute);
  }

  /** Viertelstunden aus Minuten; die laufende wird bei jeder Minute erneuert. */
  private rollup(host: string, minute: number): void {
    const from = Math.floor(minute / QUARTER) * QUARTER;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO quarters (key_id, ts, avg, min, max, n)
         SELECT m.key_id, ?, SUM(m.avg * m.n) / SUM(m.n), MIN(m.min), MAX(m.max), SUM(m.n)
         FROM minutes m JOIN keys k ON k.id = m.key_id
         WHERE k.host = ? AND m.ts >= ? AND m.ts < ? GROUP BY m.key_id`,
      )
      .run(from / 1000, host, from / 1000, (from + QUARTER) / 1000);
  }

  private prune(now: number): void {
    this.lastPrune = now;
    this.db.prepare("DELETE FROM minutes WHERE ts < ?").run((now - KEEP_MINUTES) / 1000);
    this.db.prepare("DELETE FROM quarters WHERE ts < ?").run((now - KEEP_QUARTERS) / 1000);
    this.db.exec("DELETE FROM keys WHERE id NOT IN (SELECT key_id FROM minutes UNION SELECT key_id FROM quarters)");
  }

  history(host: string, key: string, range: HostMetricRange, now: number): HostMetricsHistory {
    const { span, table, step } = RANGES[range];
    const stepSec = step / 1000;
    // Schrittweite als Literal: gebunden wäre sie REAL, und die Division damit nicht ganzzahlig.
    const rows = this.db
      .prepare(
        `SELECT (t.ts / ${stepSec}) * ${stepSec} AS ts, SUM(t.avg * t.n) / SUM(t.n) AS avg, MIN(t.min) AS min, MAX(t.max) AS max
         FROM ${table} t JOIN keys k ON k.id = t.key_id
         WHERE k.host = ? AND k.key = ? AND t.ts > ? AND t.ts <= ? GROUP BY 1 ORDER BY 1`,
      )
      .all(host, key, Math.floor((now - span) / 1000), Math.floor(now / 1000)) as { ts: number; avg: number; min: number; max: number }[];
    return {
      key,
      range,
      stepSec,
      points: rows.slice(-720).map((r) => [r.ts * 1000, r.avg, r.min, r.max] as [number, number, number, number]),
      days: this.days(host),
    };
  }

  days(host: string): HostMetricsDay[] {
    const rows = this.db.prepare("SELECT day, wh, sec FROM energy WHERE host = ? ORDER BY day DESC LIMIT 90").all(host) as { day: string; wh: number; sec: number }[];
    const out = new Map(rows.map((r) => [r.day, { day: r.day, wh: r.wh, coveredSec: r.sec }]));
    for (const [day, e] of this.buffers.get(host)?.energy ?? []) {
      const prev = out.get(day);
      out.set(day, { day, wh: (prev?.wh ?? 0) + e.wh, coveredSec: (prev?.coveredSec ?? 0) + e.sec });
    }
    return [...out.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-90);
  }

  today(host: string, now: number): HostMetricsDay | null {
    const day = localDay(now);
    return this.days(host).find((d) => d.day === day) ?? null;
  }

  close(): void {
    for (const host of this.buffers.keys()) this.flush(host);
    this.db.close();
  }
}

function isCorrupt(err: unknown): boolean {
  const code = (err as { errcode?: number }).errcode;
  return code === 11 || code === 26; // SQLITE_CORRUPT, SQLITE_NOTADB
}

function open(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS keys (id INTEGER PRIMARY KEY, host TEXT NOT NULL, key TEXT NOT NULL, UNIQUE (host, key));
      CREATE TABLE IF NOT EXISTS minutes (key_id INTEGER NOT NULL, ts INTEGER NOT NULL, avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (key_id, ts)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS quarters (key_id INTEGER NOT NULL, ts INTEGER NOT NULL, avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (key_id, ts)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS energy (host TEXT NOT NULL, day TEXT NOT NULL, wh REAL NOT NULL, sec REAL NOT NULL, PRIMARY KEY (host, day));`);
    const check = db.prepare("PRAGMA quick_check(1)").get() as { quick_check: string };
    if (check.quick_check !== "ok") throw Object.assign(new Error(check.quick_check), { errcode: 11 });
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
