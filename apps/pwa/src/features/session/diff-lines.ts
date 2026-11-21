import { fmtNumber, fmtTime, fmtDateTime } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";
/** Pure diff helpers (EPIC-P20 T20.1) — split from DiffPane.tsx so they are unit-testable. */

export function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-line-file";
  if (line.startsWith("+")) return "diff-line-add";
  if (line.startsWith("-")) return "diff-line-del";
  if (line.startsWith("@@")) return "diff-line-hunk";
  if (line.startsWith("diff --git")) return "diff-line-header";
  return "diff-line-ctx";
}

/** Text für einen Commit über der Größenkante (BUG-0204): Zahl und Befund statt Ballast —
 * und nie so formuliert, als wäre die Session schuld. */
export function oversizeNote(oversize: { files: number | null; changedLines: number | null } | undefined): string {
  if (!oversize) return "";
  if (oversize.files === null || oversize.changedLines === null) {
    return "Diff zu groß zum Aufzählen — im Terminal ansehen: git show <sha>";
  }
  const dateien = oversize.files === 1 ? t("diff.file_one") : t("diff.files_n", { n: fmtNumber(oversize.files) });
  return t("diff.oversize_note", { dateien, lines: fmtNumber(oversize.changedLines) });
}

/** EPIC-P36: eine Unified-Zeile mit ihren echten Seiten-Nummern — Basis
 * für Review-Anker (Zeile im Diff antippen → old/new-Nummer + Text). */
export interface MappedDiffLine {
  type: "ctx" | "add" | "del";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export function mapHunkLines(hunk: { oldStart: number; newStart: number; body: string }): MappedDiffLine[] {
  const out: MappedDiffLine[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const raw of hunk.body.split("\n")) {
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("-")) {
      out.push({ type: "del", text: raw.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (raw.startsWith("+")) {
      out.push({ type: "add", text: raw.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (raw.startsWith(" ")) {
      out.push({ type: "ctx", text: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return out;
}

interface SplitCell {
  type: "ctx" | "add" | "del" | "empty";
  text: string;
}

export interface SplitRow {
  left: SplitCell;
  right: SplitCell;
}

/**
 * Unified hunk body → side-by-side rows (T2.3 "Querformat side-by-side").
 * Classic run-pairing: consecutive `-` lines are paired against the
 * consecutive `+` lines that follow them, index by index, empty cells
 * filling whichever side ran out first; a context line flushes any
 * pending run and appears on both sides unchanged.
 */
export function pairHunkLines(body: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let delBuf: string[] = [];
  let addBuf: string[] = [];
  const flush = () => {
    const n = Math.max(delBuf.length, addBuf.length);
    for (let i = 0; i < n; i++) {
      rows.push({
        left: i < delBuf.length ? { type: "del", text: delBuf[i]! } : { type: "empty", text: "" },
        right: i < addBuf.length ? { type: "add", text: addBuf[i]! } : { type: "empty", text: "" },
      });
    }
    delBuf = [];
    addBuf = [];
  };
  // A body ends with "\n": the empty string after it is no context line (it made a pure addition two-sided).
  const lines = body.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (line.startsWith("-")) delBuf.push(line.slice(1));
    else if (line.startsWith("+")) addBuf.push(line.slice(1));
    else if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    else {
      flush();
      const text = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ left: { type: "ctx", text }, right: { type: "ctx", text } });
    }
  }
  flush();
  return rows;
}

/** A hunk with nothing on one side (a new or a deleted file): side by side would leave half the width empty. */
export function isOneSided(rows: readonly SplitRow[]): boolean {
  return rows.length > 0 && (rows.every((r) => r.left.type === "empty") || rows.every((r) => r.right.type === "empty"));
}

