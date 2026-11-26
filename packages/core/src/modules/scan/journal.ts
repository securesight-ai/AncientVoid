import { createHash } from "node:crypto";
import { PentestScanJob, SCAN_EVENT_MAX_BYTES } from "@ancientvoid/contracts";

/**
 * EPIC-P80 (ADR-0118): Scan-Journal — K7: Zustand aus JSONL + Snapshot
 * rekonstruierbar. Append-only-JSONL (letzte Zeile je Job gewinnt, Muster
 * `modules/inference/store.ts`), beim Start gelesen; der Snapshot schreibt die
 * gefilterte Last als Redundanz. K5: die Zeile trägt Zusammenfassung +
 * Blob-Referenz, nie den Volltext; Volltexte liegen als Blob-Dateien.
 */

export interface JournalDeps {
  readFile(path: string): Promise<string | null>;
  appendFile(path: string, data: string): Promise<void>;
  /** Ruft beim Schreiben das Verzeichnis mit auf (mkdir -p) — Blob-Ordner. */
  writeFile(path: string, data: string): Promise<void>;
  now(): Date;
}

export interface ScanJournal {
  /** JSONL neu aufbauen (K7); danach Snapshot schreiben. */
  load(): Promise<void>;
  append(job: PentestScanJob): Promise<void>;
  jobs(nowMs?: number): PentestScanJob[];
  get(id: string): PentestScanJob | null;
  blobPut(content: string): Promise<{ hash: string; bytes: number }>;
  blobGet(hash: string): Promise<string | null>;
}

export function createScanJournal(deps: JournalDeps, dir: string, opts: { windowHours?: number } = {}): ScanJournal {
  const windowMs = (opts.windowHours ?? 720) * 3_600_000;
  const jobs = new Map<string, PentestScanJob>();
  const file = `${dir}/journal.jsonl`;
  const snapshot = `${dir}/snapshot.json`;
  const blobDir = `${dir}/blobs`;

  async function loadLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return; // Zeile ohne Wiederkehr — sie war schon beim Schreiben kaputt
    }
    const parsed = PentestScanJob.safeParse(raw);
    if (!parsed.success) return;
    jobs.set(parsed.data.id, parsed.data);
  }

  return {
    async load() {
      jobs.clear();
      const text = (await deps.readFile(file)) ?? (await deps.readFile(snapshot));
      // Immer zurückschreiben — auch leer: der Snapshot-Anker hält das Verzeichnis
      // am Leben und macht den Recovery-Pfad unabhängig davon, wann die erste Zeile kommt.
      if (text) for (const line of text.split("\n")) await loadLine(line);
      const jetzt = deps.now().getTime();
      await deps.writeFile(snapshot, `${JSON.stringify([...jobs.values()].filter((j) => jetzt - Date.parse(j.createdAt) <= windowMs))}\n`);
    },
    async append(job) {
      PentestScanJob.parse(job);
      // K5-Grenze für die Zeile selbst — der Volltext gehört nicht hinein.
      if (Buffer.byteLength(JSON.stringify(job), "utf8") > SCAN_EVENT_MAX_BYTES) {
        throw new Error(`Journal-Zeile über ${SCAN_EVENT_MAX_BYTES} Bytes — Volltext gehört als Blob ausgelagert (K5)`);
      }
      jobs.set(job.id, job);
      await deps.appendFile(file, `${JSON.stringify(job)}\n`);
    },
    jobs(nowMs = deps.now().getTime()) {
      const grenze = nowMs - windowMs;
      return [...jobs.values()]
        .filter((j) => Date.parse(j.createdAt) >= grenze)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
    get(id) {
      return jobs.get(id) ?? null;
    },
    async blobPut(content) {
      const hash = createHash("sha256").update(content, "utf8").digest("hex");
      const bytes = Buffer.byteLength(content, "utf8");
      await deps.writeFile(`${blobDir}/${hash}.json`, content);
      return { hash, bytes };
    },
    async blobGet(hash) {
      if (!/^[a-f0-9]{64}$/.test(hash)) return null;
      return await deps.readFile(`${blobDir}/${hash}.json`);
    },
  };
}
