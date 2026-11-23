import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MAX_MAIN_SYNC_FILES } from "@ancientvoid/contracts";

const execFileAsync = promisify(execFile);

/** Messung: wie weit liegt der Session-Branch hinter/vor dem Hauptbranch, ist der Worktree sauber. */
export interface MainSyncMeasure {
  branch: string;
  behind: number;
  ahead: number;
  clean: boolean;
  checkedAt: string;
}

/** Probelauf (`merge-tree`, lesend): sauber oder die Konfliktdateien, gekappt (K5). */
export interface MainSyncDryRun {
  clean: boolean;
  conflicts: string[];
}

export type MainSyncApplyOutcome =
  | { outcome: "applied"; from: string; to: string; files: string[]; autoResolved?: string[] }
  | { outcome: "conflict"; files: string[] }
  | { outcome: "skipped"; reason: "dirty-worktree" | "up-to-date"; detail?: string };

/** Notation-konforme Merge-Nachricht — der commit-msg-Hook dieses Repos nimmt sie an (ADR-0088 §4, AC-P67-11). */
export const MAIN_SYNC_MERGE_MESSAGE = ". a worktree: origin/main eingemischt";

/**
 * EPIC-P67 / ADR-0088 T67.4: Sync-Engine — messen, probelaufen, anwenden,
 * in dieser Reihenfolge. Reines Git, keine Events (der SessionManager
 * journalt). Das Anwenden bricht bei jedem Fehler sofort ab
 * (`git merge --abort`) und lässt den Worktree unverändert — Hash-Gleichheit
 * nach Abbruch ist Testkriterium (AC-P67-7).
 */
export class MainSyncEngine {
  private readonly now: () => Date;

  constructor(deps: { now?: () => Date } = {}) {
    this.now = deps.now ?? (() => new Date());
  }

  private async git(cwd: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", ["-C", cwd, ...args]);
  }

  async revParse(cwd: string, ref: string): Promise<string> {
    const { stdout } = await this.git(cwd, "rev-parse", ref);
    return stdout.trim();
  }

  /** Zählung gegen den Remote-Tracking-Ref (der Scheduler hat zuvor gefetcht). */
  async measure(worktreePath: string, branch: string): Promise<MainSyncMeasure> {
    const [counts, status] = await Promise.all([
      this.git(worktreePath, "rev-list", "--left-right", "--count", `HEAD...refs/remotes/origin/${branch}`),
      this.git(worktreePath, "status", "--porcelain"),
    ]);
    // links = HEAD (ahead), rechts = origin/<branch> (behind)
    const [aheadRaw, behindRaw] = counts.stdout.trim().split(/\s+/);
    const ahead = Number.parseInt(aheadRaw ?? "0", 10);
    const behind = Number.parseInt(behindRaw ?? "0", 10);
    return {
      branch,
      behind: Number.isFinite(behind) ? behind : 0,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      clean: status.stdout.trim() === "",
      checkedAt: this.now().toISOString(),
    };
  }

  /**
   * Probelauf per `git merge-tree --write-tree` — berührt weder Index noch
   * Worktree. Exit 0 mit Tree-OID = sauber; Exit 1, danach die Dateinamen
   * (mit `--name-only`) = Konflikt.
   */
  async dryRun(worktreePath: string, branch: string): Promise<MainSyncDryRun> {
    const ref = `refs/remotes/origin/${branch}`;
    const result = await this.git(worktreePath, "merge-tree", "--write-tree", "--name-only", "HEAD", ref).then(
      (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
      (err: { code?: number; stdout?: string; stderr?: string }) => ({
        code: typeof err.code === "number" ? err.code : 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      }),
    );
    if (result.code === 0) return { clean: true, conflicts: [] };
    if (result.code !== 1) {
      // git merge-tree: 1 = Konflikt, alles andere (128…) = Fehler — kein stilles "clean"
      throw new Error(`merge-tree fehlgeschlagen (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
    }
    // Aufbau: Zeile 1 = Tree-OID, dann die Konfliktdateien (--name-only),
    // Leerzeile, danach die "Conflict information"-Sektion (Auto-merging/CONFLICT).
    const lines = result.stdout.split("\n").map((l) => l.trim());
    const fileEnd = lines.findIndex((l) => l === "");
    const fileLines = (fileEnd === -1 ? lines.slice(1) : lines.slice(1, fileEnd)).filter(Boolean);
    return { clean: false, conflicts: cap(fileLines) };
  }

  /**
   * Anwenden: `git merge` des Remote-Tracking-Refs in den Session-Branch.
   * Fast-Forward bleibt Fast-Forward (kein leerer Merge-Knoten); echte
   * Merges tragen die notation-konforme Nachricht. Bei Konflikt/Fehler
   * sofort `--abort` — der Worktree steht danach wieder auf `from`.
   *
   * ADR-0102: `conflictStrategy: "favor-session"` löst Konflikt-Hunks
   * automatisch gunsten des Session-Branchs (`git merge -X ours`) und nennt
   * die betroffenen Dateien im Ergebnis (`autoResolved`) — der Default
   * `abort` bleibt bei AC-P67-7: abbrechen, nichts verändern.
   */
  async apply(worktreePath: string, branch: string, opts: { message?: string; allowDirty?: boolean; conflictStrategy?: "abort" | "favor-session" } = {}): Promise<MainSyncApplyOutcome> {
    const ref = `refs/remotes/origin/${branch}`;
    const from = await this.revParse(worktreePath, "HEAD");
    const { stdout: dirty } = await this.git(worktreePath, "status", "--porcelain");
    if (dirty.trim() !== "" && !opts.allowDirty) {
      return { outcome: "skipped", reason: "dirty-worktree", detail: `${dirty.trim().split("\n").slice(0, 5).join(", ")}` };
    }
    const behind = await this.git(worktreePath, "rev-list", "--count", `HEAD..${ref}`).then((r) => Number.parseInt(r.stdout.trim(), 10));
    if (!Number.isFinite(behind) || behind === 0) return { outcome: "skipped", reason: "up-to-date" };

    // favor-session: der Probelauf entscheidet, ob -X ours nötig ist (und
    // nennt hinterher ehrlich, welche Dateien automatisch gelöst wurden).
    const favorSession = opts.conflictStrategy === "favor-session";
    const dry = favorSession ? await this.dryRun(worktreePath, branch) : null;
    const autoResolved = dry !== null && !dry.clean ? dry.conflicts : [];
    const identity = await this.git(worktreePath, "config", "user.email").then(() => [] as string[]).catch(() => ["-c", "user.name=AncientVoid", "-c", "user.email=hub@ancientvoid.local"]);
    try {
      await execFileAsync("git", ["-C", worktreePath, ...identity, "merge", ...(autoResolved.length > 0 ? ["-X", "ours"] : []), ref, "-m", opts.message ?? MAIN_SYNC_MERGE_MESSAGE]);
    } catch {
      const { stdout: conflicts } = await this.git(worktreePath, "diff", "--name-only", "--diff-filter=U").catch(() => ({ stdout: "" }));
      await this.git(worktreePath, "merge", "--abort").catch(() => undefined);
      if (conflicts.trim() !== "") return { outcome: "conflict", files: cap(conflicts.trim().split("\n")) };
      // kein Konflikt, aber gescheitert (z. B. lokale Änderungen würden überschrieben) — abgebrochen, unverändert
      return { outcome: "skipped", reason: "dirty-worktree", detail: "Merge abgelehnt (ungesicherte Änderungen), abgebrochen" };
    }
    const to = await this.revParse(worktreePath, "HEAD");
    const { stdout: changed } = await this.git(worktreePath, "diff", "--name-only", `${from}..${to}`);
    return { outcome: "applied", from: short(from), to: short(to), files: cap(changed.trim().split("\n").filter(Boolean)), ...(autoResolved.length > 0 ? { autoResolved } : {}) };
  }
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

function cap(files: string[]): string[] {
  return files.filter(Boolean).slice(0, MAX_MAIN_SYNC_FILES);
}
