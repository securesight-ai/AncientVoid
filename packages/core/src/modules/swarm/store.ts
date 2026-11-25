import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SwarmFrame, type Swarm, type SwarmStatus } from "@ancientvoid/contracts";

/**
 * EPIC-P40 (ADR-0064 §5), EPIC-P60 (ADR-0077), EPIC-P83 (ADR-0123): Swarm-Store nach dem
 * Reviews-Muster (K7) — Journal (`swarms.jsonl`) + Snapshot (`snapshot.json`)
 * pro Hub-Datenverzeichnis, keine SQLite-Insel. Restore = Snapshot +
 * Journal-Nachlauf; kaputte Zeilen werden gezählt und übersprungen, nie
 * versteckt. Migrationen (je einmalig, solange im Ziel noch kein Journal liegt,
 * Altdateien bleiben liegen): `orchestration/` (Runs, bis P60) und `team/`
 * (Agenten-Teams, bis P83) → `swarm/`.
 */

export interface SwarmRecoveryReport {
  swarms: number;
  skippedLines: number;
  /** ADR-0123-Migration: Anzahl aus `team/` (oder `orchestration/`) übernommener Swarms (nur beim migrierenden Start gesetzt). */
  migratedSwarms?: number;
  migratedSkippedLines?: number;
}

interface JournalLine {
  seq: number;
  at: string;
  op: "put";
  swarm: Swarm;
}

/** Persistierte Grenzform: Journalzeilen bis P83 hießen den Datensatz `run`, Snapshots bis P83 `runs`. */
type LegacyJournalLine = Partial<JournalLine> & { run?: Swarm };
type LegacySnapshot = Partial<Snapshot> & { runs?: Swarm[] };

interface Snapshot {
  appliedSeq: number;
  swarms: Swarm[];
}

/** ADR-0077 §6: Bestands-Swarms bis P60 tragen `frame.model` statt `frame.models` —
 *  beim Laden normalisieren (safeParse wendet die preprocess-Regel an), damit
 *  Journal + Snapshot in der neuen Form weiterlaufen (K7). */
function normalizeSwarm(raw: Swarm): Swarm {
  if ("models" in (raw.frame as object)) return raw;
  const parsed = SwarmFrame.safeParse(raw.frame);
  if (parsed.success) raw.frame = parsed.data;
  return raw;
}

interface Loaded {
  swarms: Map<string, Swarm>;
  seq: number;
  skippedLines: number;
  hasJournal: boolean;
}

export class SwarmStore {
  private readonly dir: string;
  /** ADR-0123 §3: Altbestand in `team/` (bis P83) und `orchestration/` (bis P60). */
  private readonly legacyDirs: string[];
  private seq = 0;
  private runs = new Map<string, Swarm>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "swarm");
    this.legacyDirs = [join(dataDir, "team"), join(dataDir, "orchestration")];
  }

  async init(): Promise<SwarmRecoveryReport> {
    await mkdir(this.dir, { recursive: true });
    const loaded = await this.loadDir(this.dir);
    this.runs = loaded.swarms;
    this.seq = loaded.seq;
    // ADR-0123: einmalige Migration des Altbestands, solange im neuen
    // Verzeichnis noch kein Journal liegt — danach nie wieder (kein Doppelimport).
    let migratedSwarms: number | undefined;
    let migratedSkippedLines: number | undefined;
    if (!loaded.hasJournal) {
      for (const legacyDir of this.legacyDirs) {
        if (!existsSync(legacyDir)) continue;
        const legacy = await this.loadDir(legacyDir);
        if (legacy.swarms.size === 0 && legacy.seq === 0) continue;
        // Übernahme als swarms.jsonl-Zeilen (einmaliges Weiterschreiben, K7), danach Snapshot.
        this.seq = Math.max(this.seq, legacy.seq);
        for (const r of legacy.swarms.values()) {
          this.runs.set(r.id, r);
          const entry: JournalLine = { seq: ++this.seq, at: new Date().toISOString(), op: "put", swarm: r };
          await writeFile(join(this.dir, "swarms.jsonl"), JSON.stringify(entry) + "\n", { flag: "a" });
        }
        await this.persistSnapshot();
        migratedSwarms = legacy.swarms.size;
        migratedSkippedLines = legacy.skippedLines;
        break;
      }
    }
    const report: SwarmRecoveryReport = { swarms: this.runs.size, skippedLines: loaded.skippedLines };
    if (migratedSwarms !== undefined) {
      report.migratedSwarms = migratedSwarms;
      report.migratedSkippedLines = migratedSkippedLines ?? 0;
    }
    return report;
  }

  /** Snapshot + Journal eines Verzeichnisses lesen (kaputter Snapshot → Journal als Wahrheit). */
  private async loadDir(dir: string): Promise<Loaded> {
    const swarms = new Map<string, Swarm>();
    let seq = 0;
    let skippedLines = 0;
    const snapPath = join(dir, "snapshot.json");
    if (existsSync(snapPath)) {
      try {
        const snap = JSON.parse(await readFile(snapPath, "utf8")) as LegacySnapshot;
        seq = snap.appliedSeq ?? 0;
        for (const r of snap.swarms ?? snap.runs ?? []) swarms.set(r.id, normalizeSwarm(r));
      } catch {
        // Kaputter Snapshot: Journal ist die Wahrheit — von Null nachlaufen.
        seq = 0;
        swarms.clear();
      }
    }
    // Journal-Namen der Epochen: swarms.jsonl (P83), teams.jsonl (P60–P83), runs.jsonl (bis P60).
    const journalPathFinal =
      [join(dir, "swarms.jsonl"), join(dir, "teams.jsonl"), join(dir, "runs.jsonl")].find((p) => existsSync(p)) ?? null;
    if (journalPathFinal) {
      const raw = await readFile(journalPathFinal, "utf8");
      for (const line of raw.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const entry = JSON.parse(line) as LegacyJournalLine;
          const record = entry.swarm ?? entry.run;
          if (typeof entry.seq !== "number" || !record) throw new Error("unvollständige Zeile");
          if (entry.seq <= seq) continue;
          swarms.set(record.id, normalizeSwarm(record));
          seq = entry.seq;
        } catch {
          skippedLines++;
        }
      }
    }
    return { swarms, seq, skippedLines, hasJournal: journalPathFinal !== null };
  }

  list(): Swarm[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Swarm | undefined {
    return this.runs.get(id);
  }

  /** Schreib-Queue: Updates serialisieren — parallele FileWriter auf Journal/Snapshot
   * derselben Instanz würden sich gegenseitig Dateien wegrenamen. */
  private writes: Promise<unknown> = Promise.resolve();

  /** Mutiert ein Swarm über die Funktion und persistiert Journal+Snapshot atomar. */
  update(id: string, mutate: (swarm: Swarm) => void): Promise<Swarm | null> {
    const next = this.writes.then(() => this.writeNow(id, mutate));
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async writeNow(id: string, mutate: (swarm: Swarm) => void): Promise<Swarm | null> {
    const swarm = this.runs.get(id);
    if (!swarm) return null;
    mutate(swarm);
    // Verzeichnis idempotent sicherstellen: update kann vor dem asynchronen init() laufen.
    await mkdir(this.dir, { recursive: true });
    const entry: JournalLine = { seq: ++this.seq, at: new Date().toISOString(), op: "put", swarm };
    await writeFile(join(this.dir, "swarms.jsonl"), JSON.stringify(entry) + "\n", { flag: "a" });
    await this.persistSnapshot();
    return swarm;
  }

  private async persistSnapshot(): Promise<void> {
    const snap: Snapshot = { appliedSeq: this.seq, swarms: [...this.runs.values()] };
    const tmp = join(this.dir, `.snapshot-${process.pid}-${this.seq}.tmp`);
    await writeFile(tmp, JSON.stringify(snap));
    await rename(tmp, join(this.dir, "snapshot.json"));
  }

  async put(swarm: Swarm): Promise<Swarm> {
    this.runs.set(swarm.id, swarm);
    await this.update(swarm.id, () => undefined);
    return swarm;
  }

  /** Sichtbarkeit für Tests/Recovery: Zustand nach Restore. */
  statuses(): Map<string, SwarmStatus> {
    const out = new Map<string, SwarmStatus>();
    for (const r of this.runs.values()) out.set(r.id, r.status);
    return out;
  }
}
