import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import type { MainSyncSettings } from "@ancientvoid/contracts";
import { classifyFetchError, currentGitBranch, fetchMainBranch, originRemoteUrl, resolveMainBranch } from "./main-sync-git.ts";

const execFileAsync = promisify(execFile);

/** Auf welcher Basis ein Session-Worktree entstanden ist — der Caller macht daraus Events (fail loud). */
export type WorktreeBaseChoice =
  | { source: "origin"; branch: string }
  | { source: "local"; reason: "off" }
  | { source: "local"; reason: "not-main-branch"; detail?: string }
  | { source: "local"; reason: "no-remote"; detail?: string }
  | { source: "local"; reason: "fetch-failed"; fetchReason: "timeout" | "auth" | "offline" | "unknown"; detail?: string };

/**
 * T2.1: per-session git worktree isolation (EPIC-P2 §3 "Worktree-Manager").
 *
 * A session that works against a real git repo gets its own `git worktree`
 * checked out at the project's current HEAD — the agent's commits land on
 * an isolated branch, never on whatever the user has checked out in the
 * main working copy. Sessions whose `project` isn't a git repo (e.g. this
 * repo's own dummy-adapter tests using a bare temp dir) get no isolation —
 * `create()` returns null and the caller falls back to the raw project
 * path, exactly as before T2.1 existed. That fallback is a real, named
 * choice, not a silent gap: SessionManager surfaces it as a system event
 * (`session.no_worktree_isolation`) rather than pretending isolation
 * happened when it didn't (AGENTS.md Regel 6).
 *
 * "Disk-Quota pro Worktree" (EPIC-P2 §2 In) is implemented as a soft,
 * polled apparent-size check (`diskUsageBytes` / `exceedsQuota`), not an OS-level
 * filesystem quota — this environment has no xfs/btrfs project-quota
 * support to enforce a hard cap without root, so a hard per-worktree quota
 * is honestly out of reach here; the soft check is what SessionManager
 * actually wires up (a `system` warning event, not an enforced kill).
 */
export class WorktreeManager {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async isGitRepo(projectPath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["-C", projectPath, "rev-parse", "--is-inside-work-tree"]);
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  /** Real HEAD sha of the project repo, or null if it isn't a git repo. */
  async headSha(projectPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("git", ["-C", projectPath, "rev-parse", "HEAD"]);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /** Deterministic path for a session's worktree — exposed so callers
   * (K7 recovery) can find an already-created worktree again without
   * re-running `git worktree add`. */
  pathFor(sessionId: string): string {
    return `${this.baseDir}/${sessionId}`;
  }

  private worktreePath(sessionId: string): string {
    return this.pathFor(sessionId);
  }

  /** BUG-0027: uncommitted changes or commits since the session's base that
   * the project does not have yet. */
  async hasWork(sessionId: string, baseSha: string | null, projectPath?: string): Promise<boolean> {
    const path = this.worktreePath(sessionId);
    const { stdout: status } = await execFileAsync("git", ["-C", path, "status", "--porcelain"]);
    if (status.trim() !== "") return true;
    if (!baseSha) return false;
    if (projectPath) {
      const { stdout: head } = await execFileAsync("git", ["-C", path, "rev-parse", "HEAD"]);
      const merged = await execFileAsync("git", ["-C", projectPath, "merge-base", "--is-ancestor", head.trim(), "HEAD"])
        .then(() => true)
        .catch(() => false);
      if (merged) return false;
    }
    const { stdout: ahead } = await execFileAsync("git", ["-C", path, "rev-list", "--count", `${baseSha}..HEAD`]);
    return Number(ahead.trim()) > 0;
  }

  /**
   * Commits everything in the session's worktree on its branch and merges
   * the branch into whatever the project has checked out. Refuses a dirty
   * project folder and aborts a conflicting merge — the user's checkout is
   * never left half-merged.
   */
  async apply(
    sessionId: string,
    projectPath: string,
    message: string,
  ): Promise<{ ok: true; into: string; commit: string; files: number } | { ok: false; detail: string }> {
    const path = this.worktreePath(sessionId);
    const branch = this.branchName(sessionId);
    const git = (cwd: string, ...args: string[]) => execFileAsync("git", ["-C", cwd, ...args]);
    const { stdout: dirty } = await git(projectPath, "status", "--porcelain");
    if (dirty.trim() !== "") {
      const files = dirty.trim().split("\n").map((line) => line.slice(3)).slice(0, 5).join(", ");
      return { ok: false, detail: `Dein Projektordner hat ungesicherte Änderungen (${files}). Bitte erst committen oder verwerfen.` };
    }
    const into = await git(projectPath, "symbolic-ref", "--short", "HEAD").then((r) => r.stdout.trim()).catch(() => "");
    if (!into) return { ok: false, detail: "Im Projektordner ist kein Branch ausgecheckt (detached HEAD)." };

    await git(path, "add", "-A");
    const staged = await git(path, "diff", "--cached", "--quiet").then(() => false).catch(() => true);
    const identity = async (cwd: string) =>
      git(cwd, "config", "user.email").then(() => [] as string[]).catch(() => ["-c", "user.name=AncientVoid", "-c", "user.email=hub@ancientvoid.local"]);
    const gitAs = async (cwd: string, args: string[]) => execFileAsync("git", ["-C", cwd, ...(await identity(cwd)), ...args]);
    if (staged) await gitAs(path, ["commit", "-q", "-m", message]);
    const { stdout: pending } = await git(projectPath, "log", "--format=%H", `HEAD..${branch}`);
    if (pending.trim() === "") return { ok: false, detail: "Keine Änderungen zum Übernehmen." };
    const { stdout: changed } = await git(projectPath, "diff", "--name-only", `HEAD...${branch}`);
    try {
      await gitAs(projectPath, ["merge", "--no-ff", "-m", message, branch]);
    } catch {
      const { stdout: conflicts } = await git(projectPath, "diff", "--name-only", "--diff-filter=U").catch(() => ({ stdout: "" }));
      await git(projectPath, "merge", "--abort").catch(() => undefined);
      const names = conflicts.trim().split("\n").filter(Boolean).join(", ");
      return { ok: false, detail: `Konflikt beim Übernehmen${names ? ` in ${names}` : ""}. Nichts wurde geändert.` };
    }
    const { stdout: commit } = await git(projectPath, "rev-parse", "--short", "HEAD");
    return { ok: true, into, commit: commit.trim(), files: changed.trim().split("\n").filter(Boolean).length };
  }

  branchFor(sessionId: string): string {
    return this.branchName(sessionId);
  }

  private branchName(sessionId: string): string {
    return `ancientvoid/${sessionId}`;
  }

  /**
   * Creates `<baseDir>/<sessionId>` as a new worktree of `projectPath` on a
   * fresh branch `ancientvoid/<sessionId>`, pinned at the project's current HEAD.
   * Returns null (no throw) when `projectPath` isn't a git repo at all —
   * that is the documented, honest non-isolation fallback, not an error.
   *
   * EPIC-P67 / ADR-0088 Stufe 1: with `opts.mainSync` the base is chosen
   * against `origin/<Hauptbranch>` — fetch (hard timeout, never
   * interactive), base on the fetched sha when the project folder is on the
   * main branch, otherwise the local HEAD with a named reason. The start is
   * NEVER blocked by a fetch failure: `base.source` tells the caller what
   * happened, and the caller surfaces it as an event (fail loud, K10).
   */
  async create(
    sessionId: string,
    projectPath: string,
    opts?: { mainSync?: MainSyncSettings | undefined },
  ): Promise<{ path: string; baseSha: string; base: WorktreeBaseChoice } | null> {
    const { choice, sha } = await this.chooseBase(projectPath, opts?.mainSync);
    if (sha === null) return null;
    await mkdir(this.baseDir, { recursive: true });
    const path = this.worktreePath(sessionId);
    await execFileAsync("git", ["-C", projectPath, "worktree", "add", "-b", this.branchName(sessionId), path, sha]);
    return { path, baseSha: sha, base: choice };
  }

  /** Stufe-1-Basiswahl: origin/<Hauptbranch> wenn konfiguriert und möglich, sonst lokaler HEAD mit Grund. */
  private async chooseBase(
    projectPath: string,
    settings: MainSyncSettings | undefined,
  ): Promise<{ choice: WorktreeBaseChoice; sha: string | null }> {
    const localSha = await this.headSha(projectPath);
    if (!settings || settings.startSync === "off") {
      return { choice: { source: "local", reason: "off" }, sha: localSha };
    }
    const branch = await resolveMainBranch(projectPath, settings);
    const projectBranch = await currentGitBranch(projectPath);
    if (projectBranch !== branch) {
      return {
        choice: { source: "local", reason: "not-main-branch", detail: `Projektordner steht auf ${projectBranch ?? "detached HEAD"}, Hauptbranch ist ${branch}` },
        sha: localSha,
      };
    }
    const remoteUrl = await this.remoteUrl(projectPath);
    if (remoteUrl === null) {
      return { choice: { source: "local", reason: "no-remote", detail: "Projekt hat kein Remote 'origin'" }, sha: localSha };
    }
    try {
      await fetchMainBranch(projectPath, branch, settings.fetchTimeoutSec);
    } catch (err) {
      const failure = classifyFetchError(err);
      return { choice: { source: "local", reason: "fetch-failed", fetchReason: failure.reason, detail: failure.detail }, sha: localSha };
    }
    const originSha = await execFileAsync("git", ["-C", projectPath, "rev-parse", `refs/remotes/origin/${branch}`])
      .then((r) => r.stdout.trim())
      .catch(() => "");
    if (originSha === "") {
      return { choice: { source: "local", reason: "fetch-failed", fetchReason: "unknown", detail: `origin/${branch} nicht auflösbar` }, sha: localSha };
    }
    return { choice: { source: "origin", branch }, sha: originSha };
  }

  /** Remote-URL von `origin`, null wenn kein Remote konfiguriert ist. */
  private remoteUrl(projectPath: string): Promise<string | null> {
    return originRemoteUrl(projectPath); // BUG-0260: eine Definition dafuer, ob ein Projekt ein Haupt-Fern hat
  }

  /**
   * Removes the worktree and its branch. Permanent delete must succeed even
   * when the project path is gone or no longer a git repo (BUG-0246) — we own
   * `data/worktrees/<id>` and may remove it after a best-effort git unregister.
   * Only fails if that owned directory still exists afterwards.
   */
  async remove(sessionId: string, projectPath: string): Promise<void> {
    const path = this.worktreePath(sessionId);
    await this.assertOwnedPath(path);
    const isGit = await this.isGitRepo(projectPath);
    if (isGit && existsSync(path)) {
      await execFileAsync("git", ["-C", projectPath, "worktree", "unlock", path]).catch(() => undefined);
      try {
        await execFileAsync("git", ["-C", projectPath, "worktree", "remove", "--force", path]);
      } catch {
        await rm(path, { recursive: true, force: true });
        await execFileAsync("git", ["-C", projectPath, "worktree", "prune"]).catch(() => undefined);
      }
      await execFileAsync("git", ["-C", projectPath, "branch", "-D", this.branchName(sessionId)]).catch(() => undefined);
    } else if (existsSync(path)) {
      await rm(path, { recursive: true, force: true });
    } else if (isGit) {
      await execFileAsync("git", ["-C", projectPath, "worktree", "prune"]).catch(() => undefined);
      await execFileAsync("git", ["-C", projectPath, "branch", "-D", this.branchName(sessionId)]).catch(() => undefined);
    }
    if (existsSync(path)) {
      await rm(path, { recursive: true, force: true });
    }
    if (existsSync(path)) {
      throw new Error(`Worktree-Verzeichnis konnte nicht gelöscht werden: ${path}`);
    }
  }

  /** Refuse deleting anything outside the configured worktree base. */
  private async assertOwnedPath(path: string): Promise<void> {
    const base = await realpath(this.baseDir).catch(() => this.baseDir);
    const resolved = await realpath(path).catch(() => path);
    const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
    if (resolved !== base && !resolved.startsWith(prefix)) {
      throw new Error(`refuse to remove path outside worktree base: ${path}`);
    }
  }

  /**
   * Apparent size in bytes, like GNU `du -sb` (each inode once, symlinks not
   * followed) — measured in Node, because BSD/macOS `du` has no `-b`.
   */
  async diskUsageBytes(path: string): Promise<number> {
    const seen = new Set<string>();
    const walk = async (p: string): Promise<number> => {
      const st = await lstat(p);
      const key = `${st.dev}:${st.ino}`;
      if (seen.has(key)) return 0;
      seen.add(key);
      if (!st.isDirectory()) return st.size;
      let total = st.size;
      for (const name of await readdir(p)) total += await walk(join(p, name));
      return total;
    };
    return walk(path);
  }

  /** Soft quota check (see class doc comment) — true means over budget. */
  async exceedsQuota(path: string, maxBytes: number): Promise<boolean> {
    return (await this.diskUsageBytes(path)) > maxBytes;
  }

  /**
   * K7-style hygiene: worktrees under baseDir whose session id isn't in
   * `liveSessionIds` are orphans (owning session died before cleanup ran,
   * e.g. a hard `kill -9` of the hub itself) — remove them and report what
   * was cleaned up.
   */
  async reapOrphans(projectPath: string, liveSessionIds: ReadonlySet<string>): Promise<string[]> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("git", ["-C", projectPath, "worktree", "list", "--porcelain"]));
    } catch {
      return [];
    }
    // git prints canonical paths: under a symlinked baseDir (macOS /var →
    // /private/var) the raw prefix would never match and orphans would stay.
    const bases = [this.baseDir, await realpath(this.baseDir).catch(() => this.baseDir)];
    const removed: string[] = [];
    for (const block of stdout.split("\n\n")) {
      const pathLine = block.split("\n").find((l) => l.startsWith("worktree "));
      if (!pathLine) continue;
      const wtPath = pathLine.slice("worktree ".length).trim();
      const base = bases.find((b) => wtPath.startsWith(`${b}/`));
      if (!base) continue;
      const sessionId = wtPath.slice(base.length + 1);
      if (liveSessionIds.has(sessionId)) continue;
      try {
        await this.remove(sessionId, projectPath);
        removed.push(this.pathFor(sessionId));
      } catch {
        // leave it — reapOrphans is best-effort hygiene, not a hard guarantee
      }
    }
    return removed;
  }
}
