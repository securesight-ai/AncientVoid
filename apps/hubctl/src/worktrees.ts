import { execFile } from "node:child_process";
import { readdir, readlink, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_SERVER, discoverTmuxServers, listServerWorkers } from "@ancientvoid/workers";
import { HubDatabase, pruneWorktrees, scanWorktrees, WorktreeManager, type WorktreeEntry, type WorktreeSessionRow } from "@ancientvoid/core";
import { t } from "./i18n/index.ts";

const execFileAsync = promisify(execFile);

/** T17.6/ADR-0037: a live ancientvoid worker carrying this session's @ancientvoid_session
 * marker — prune's primary "in use" signal. Exact session identity, works
 * even when the pane process has left the worktree directory. */
async function markerInUse(servers: readonly string[], sessionId: string): Promise<boolean> {
  for (const server of servers) {
    const listed = await listServerWorkers(server).catch(() => null);
    if (listed?.sessions.some((s) => s.sessionId === sessionId)) return true;
  }
  return false;
}

/** True when a process has its cwd inside `path` (Linux /proc, elsewhere
 * `lsof -d cwd`, e.g. macOS). A persistent worker (ACP, app-server) keeps the
 * worktree as cwd, even across a hub restart — removing it would pull the
 * directory out from under the process. Without /proc and lsof the answer is
 * "yes": unknown means keep (fail safe). */
export async function cwdInside(path: string, procDir = "/proc"): Promise<boolean> {
  // Kernels report canonical cwds (macOS: /var → /private/var).
  const root = await realpath(path).catch(() => resolve(path));
  const inside = (cwd: string): boolean => cwd === root || cwd.startsWith(root + sep);
  let pids: string[] | null = null;
  try {
    pids = (await readdir(procDir)).filter((name) => /^\d+$/.test(name));
  } catch {
    if (procDir !== "/proc") return true;
  }
  if (pids === null) {
    const cwds = await lsofCwds();
    return cwds === null ? true : cwds.some(inside);
  }
  for (const pid of pids) {
    const cwd = await readlink(join(procDir, pid, "cwd")).catch(() => null);
    if (cwd === null) continue; // process gone or not ours to read
    if (inside(cwd)) return true;
  }
  return false;
}

/** cwd of every process lsof may read, or null when lsof is unusable. */
async function lsofCwds(): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-w", "-d", "cwd", "-Fn"], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1));
  } catch (err) {
    // lsof exits 1 when some processes were unreadable but still prints the rest.
    const stdout = (err as { stdout?: unknown }).stdout;
    if (typeof stdout === "string" && stdout.length > 0) return stdout.split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1));
    return null;
  }
}

function rowsOf(dbPath: string): WorktreeSessionRow[] {
  const db = new HubDatabase(dbPath);
  return (
    db.prepare("SELECT id, project, status, archived, worktree_sha FROM sessions WHERE worktree_sha IS NOT NULL").all() as {
      id: string;
      project: string;
      status: string;
      archived: number;
      worktree_sha: string | null;
    }[]
  ).map((r) => ({ id: r.id, project: r.project, status: r.status, archived: r.archived === 1, worktreeSha: r.worktree_sha }));
}

const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

function line(e: WorktreeEntry): string {
  const note = e.prunable ? t("wt_entfernbar") : e.state !== "clean" ? t("wt_arbeit_bleibt") : e.inUse ? t("wt_prozess_aktiv") : t("wt_session_aktiv");
  return `${e.sessionId.slice(0, 8)}  ${e.status.padEnd(16)} ${(e.archived ? t("wt_archiviert") : t("wt_aktiv")).padEnd(10)} ${e.state.padEnd(7)} ${mib(e.sizeBytes).padStart(10)}  ${note}  ${e.project}`;
}

/** `hubctl worktrees [prune [--apply]] [--db <hub.db>]`. Local, like `workers`:
 * the worktrees live on this machine, next to the database. */
export async function runWorktrees(args: string[], print: (text: string) => void = console.log): Promise<void> {
  const dbIdx = args.indexOf("--db");
  const dbPath = dbIdx >= 0 ? (args[dbIdx + 1] ?? "data/hub.db") : "data/hub.db";
  const sub = args[0] && !args[0].startsWith("--") ? args[0] : "list";
  if (sub !== "list" && sub !== "prune") throw new Error(t("unknown_subcommand", { sub }));
  const worktrees = new WorktreeManager(resolve(dirname(dbPath), "worktrees"));
  const sessions = rowsOf(dbPath);
  const servers = [DEFAULT_SERVER, ...discoverTmuxServers()];
  let heuristicHits = 0;
  // T17.6: marker first (exact identity), cwd only as fallback — and the
  // fallback is counted, never silent.
  const inUse = async (path: string, row: WorktreeSessionRow): Promise<boolean> => {
    if (await markerInUse(servers, row.id)) return true;
    if (await cwdInside(path)) {
      heuristicHits++;
      return true;
    }
    return false;
  };
  const entries = await scanWorktrees(worktrees, sessions, inUse);
  if (entries.length === 0) return void print(t("no_session_worktrees"));
  for (const e of entries) print(line(e));
  const total = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  const free = entries.filter((e) => e.prunable).reduce((sum, e) => sum + e.sizeBytes, 0);
  print(t("wt_summary", { n: entries.length, m: mib(total), p: entries.filter((e) => e.prunable).length, m2: mib(free) }));
  if (heuristicHits > 0) {
    print(t("wt_hint", { h: heuristicHits }));
  }
  if (sub === "list") return;
  const apply = args.includes("--apply");
  const result = await pruneWorktrees(worktrees, sessions, entries, inUse, apply);
  for (const path of result.removed) print(t("prune_removed", { verb: apply ? t("verb_removed") : t("verb_would_remove"), path }));
  for (const f of result.failed) print(t("wt_error", { path: f.path, err: f.error }));
  if (!apply && result.removed.length > 0) print(t("trockenlauf"));
}
