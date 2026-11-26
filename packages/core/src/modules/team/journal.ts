import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TeamEvent } from "@ancientvoid/contracts";
import { checkEventChain, decodeTeamEvent, encodeTeamEvent, teamEventHash } from "./envelope.ts";

/**
 * EPIC-P83 T83.4 S2 (ADR-0119 §4, K7): Team-Journal —
 * `data/teams/<teamId>/events.jsonl`, fsync vor Bestätigung, defekte letzte
 * Zeile abschneiden und melden; Lücke/falscher Hash in der Mitte → Strom
 * eingefroren. Snapshot atomar. Signierte Bytes bleiben die Quelle.
 */

export type JournalAppendResult =
  | { ok: true; hash: string; seq: number }
  | { ok: false; error: "frozen" | "bad_hash" | "incompatible" | "conflict"; detail: string };

export interface TeamJournal {
  teamId: string;
  stream: string;
  /** Rohzeilen (Bytes je Ereignis) in Sequenzordnung. */
  readonly entries: Uint8Array[];
  frozen: boolean;
  freezeReason: string | null;
  truncatedTail: boolean;
  append(event: TeamEvent): JournalAppendResult;
  headHash(): string | null;
  persist(): void;
}

function eventsPath(dataDir: string, teamId: string): string {
  return join(dataDir, "teams", teamId, "events.jsonl");
}

function snapshotPath(dataDir: string, teamId: string): string {
  return join(dataDir, "teams", teamId, "snapshot.json");
}

/** Journal laden: kaputte letzte Zeile abschneiden; Bruch in der Mitte friert. */
export function openTeamJournal(opts: {
  dataDir: string;
  teamId: string;
  stream: string;
}): TeamJournal {
  const dir = join(opts.dataDir, "teams", opts.teamId);
  mkdirSync(dir, { recursive: true });
  const path = eventsPath(opts.dataDir, opts.teamId);
  const entries: Uint8Array[] = [];
  let frozen = false;
  let freezeReason: string | null = null;
  let truncatedTail = false;

  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    const lines = raw.length === 0 ? [] : raw.split("\n");
    // Trailing newline → leere letzte Zeile verwerfen.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      try {
        const bytes = Buffer.from(line, "utf8");
        const ev = decodeTeamEvent(bytes);
        if (ev === null) throw new Error("unlesbar");
        if (ev.stream !== opts.stream) throw new Error("anderer Strom");
        const prev = entries.length === 0 ? null : entries[entries.length - 1]!;
        const chainErr = checkEventChain(prev, ev);
        if (chainErr !== null) {
          frozen = true;
          freezeReason = `Kette gebrochen bei seq=${ev.seq}: ${chainErr}`;
          break;
        }
        entries.push(new Uint8Array(bytes));
      } catch (err) {
        if (i === lines.length - 1) {
          // Defekte letzte Zeile: abschneiden und melden (ADR-0119 §4).
          truncatedTail = true;
          const kept = lines.slice(0, i).join("\n");
          const fd = openSync(path, "w");
          try {
            if (kept.length > 0) writeSync(fd, kept + "\n");
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          break;
        }
        frozen = true;
        freezeReason = `Zeile ${i} unlesbar: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }
  }

  const journal: TeamJournal = {
    teamId: opts.teamId,
    stream: opts.stream,
    entries,
    frozen,
    freezeReason,
    truncatedTail,
    append(event: TeamEvent): JournalAppendResult {
      if (journal.frozen) return { ok: false, error: "frozen", detail: journal.freezeReason ?? "Strom eingefroren" };
      const prev = entries.length === 0 ? null : entries[entries.length - 1]!;
      const err = checkEventChain(prev, event);
      if (err === "bad_hash") return { ok: false, error: "bad_hash", detail: "prevHash/seq stimmt nicht" };
      if (err === "conflict") return { ok: false, error: "conflict", detail: "epoch/stream/teamId weicht ab" };
      if (err === "incompatible") return { ok: false, error: "incompatible", detail: "Vorgänger unlesbar" };
      if (err !== null) return { ok: false, error: "bad_hash", detail: err };
      const bytes = encodeTeamEvent(event);
      entries.push(bytes);
      // fsync vor Bestätigung (ADR-0119 §4).
      const fd = openSync(path, "a");
      try {
        writeSync(fd, Buffer.from(bytes));
        writeSync(fd, Buffer.from("\n"));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      return { ok: true, hash: teamEventHash(bytes), seq: event.seq };
    },
    headHash() {
      if (entries.length === 0) return null;
      return teamEventHash(entries[entries.length - 1]!);
    },
    persist() {
      const snap = {
        v: 1 as const,
        teamId: opts.teamId,
        stream: opts.stream,
        count: entries.length,
        headHash: journal.headHash(),
        frozen: journal.frozen,
        freezeReason: journal.freezeReason,
        at: new Date().toISOString(),
      };
      const tmp = `${snapshotPath(opts.dataDir, opts.teamId)}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(snap));
      renameSync(tmp, snapshotPath(opts.dataDir, opts.teamId));
    },
  };
  return journal;
}
