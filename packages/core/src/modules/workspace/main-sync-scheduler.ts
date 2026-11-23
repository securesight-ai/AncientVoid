import type { MainSyncSettings } from "@ancientvoid/contracts";
import type { MainSyncApplyResult } from "@ancientvoid/contracts";
import { MainSyncEngine } from "./main-sync-engine.ts";
import { fetchMainBranch, originRemoteUrl, resolveMainBranch } from "./main-sync-git.ts";

/** Was der Scheduler über eine Sync-fähige Session wissen muss (SessionManager liefert das). */
export interface MainSyncCandidate {
  sessionId: string;
  projectPath: string;
  workdir: string;
  /** Gating AC-P67-6: nur wartende Sessions werden jemals gemergt. */
  waiting: boolean;
}

/** Debounce-Zustand je Projekt — bewusst nur im Speicher (K7: kein persistenter Timer). */
interface ProjectSeen {
  /** zuletzt gemeldeter Rückstand (Maximum über die Sessions) — gleicher Stand meldet nicht neu. */
  behind?: number;
  /** zuletzt gemeldeter Fetch-Fehler — gleiche Lage meldet sich nicht erneut (BUG-0224). */
  failure?: string;
}

/** Debounce-Zustand je Session — was wirklich nur diese Session betrifft (BUG-0224). */
interface SessionSeen {
  /** zuletzt gemeldete Konflikt-Dateiliste — gleiche Liste nicht erneut. */
  conflict?: string;
  /** zuletzt gemeldeter Fehler (`reason|detail`) — gleiche Ursache nicht erneut. */
  failed?: string;
}

/** Was der Scheduler nach draußen meldet — T67.6 macht daraus Hub-Benachrichtigungen + Push. */
export type MainSyncSchedulerNotice =
  | { kind: "behind"; sessionId: string; projectPath: string; behind: number; branch: string; mode: "notify" | "ask"; sessions: number }
  | { kind: "conflict"; sessionId: string; projectPath: string; files: string[] }
  | { kind: "applied"; sessionId: string; projectPath: string; result: Extract<MainSyncApplyResult, { outcome: "applied" }> }
  | { kind: "failed"; sessionId: string; projectPath: string; reason: string; detail?: string };

export interface MainSyncSchedulerDeps {
  /** Effektive Einstellungen je Projekt (Defaults ← global ← Override). */
  settingsFor: (projectPath: string) => MainSyncSettings;
  /** Live-Sessions mit Worktree-Isolation (SessionManager.mainSyncCandidates). */
  candidates: () => MainSyncCandidate[];
  /** Merge ausführen — SessionManager.mainSyncApply(sessionId, { skipFetch: true }), Gating inklusive. */
  apply: (sessionId: string) => Promise<MainSyncApplyResult>;
  notice: (n: MainSyncSchedulerNotice) => void;
  now?: () => Date;
  /** Takt des Timers in ms (Production 30 s; Tests treiben tick() direkt). */
  pollMs?: number;
  /** Fetch — injizierbar für den K8-Nachweis (ein Fetch je Projekt); Standard der echte harte Fetch. */
  fetch?: (projectPath: string, branch: string, timeoutSec: number) => Promise<void>;
}

/**
 * EPIC-P67 / ADR-0088 T67.5: ein Takt, ein Fetch — je Projekt, nicht je
 * Session (K8). Der Timer-Zustand (zuletzt gelaufen, bereits gemeldet)
 * lebt nur im Speicher: Beim Hub-Start wird einmal nachgeholt, danach
 * gelten die Intervalle — kein Recovery-Aufwand, kein driftender Zustand
 * (K7, Premortem 7). Modi bei `behind > 0`:
 *
 * - `notify`: Meldung „N hinter main" — je Session einmal pro behind-Stand,
 *   nicht je Takt (Premortem 5).
 * - `auto` + `autoMerge: clean-only`: Probelauf sauber → Merge auf
 *   wartender Session (Gating macht mainSyncApply, AC-P67-6); Konflikt →
 *   Meldung mit Dateiliste.
 * - `auto` + `autoMerge: off|ask` und `behindAction: ask`: nur melden —
 *   autonomes Mergen ohne ausdrückliche Wahl gibt es nicht (ADR-0088 §6).
 */
export class MainSyncScheduler {
  private readonly deps: MainSyncSchedulerDeps;
  private readonly now: () => Date;
  private readonly pollMs: number;
  private readonly fetch: (projectPath: string, branch: string, timeoutSec: number) => Promise<void>;
  private readonly lastRun = new Map<string, number>();
  /** BUG-0224: behind/Fetch-Fehler je Projekt deduplizieren — ein Fetch und ein
   * Rückstand sind Projekt-Zustände; je Session meldeten 41 Sessions 41 Rows. */
  private readonly seenProject = new Map<string, ProjectSeen>();
  private readonly seenSession = new Map<string, SessionSeen>();
  private readonly running = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> | null = null;

  constructor(deps: MainSyncSchedulerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.pollMs = deps.pollMs ?? 30_000;
    this.fetch = deps.fetch ?? fetchMainBranch;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Ein Takt: fällige Projekte prüfen — ein Fetch je Projekt, dann je Session messen und handeln. */
  async tick(): Promise<void> {
    if (this.ticking) return this.ticking; // gleichzeitige Läufe zusammenfassen (§3.4)
    this.ticking = this.runDueProjects().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async runDueProjects(): Promise<void> {
    const byProject = new Map<string, MainSyncCandidate[]>();
    for (const candidate of this.deps.candidates()) {
      const list = byProject.get(candidate.projectPath) ?? [];
      list.push(candidate);
      byProject.set(candidate.projectPath, list);
    }
    const nowMs = this.now().getTime();
    await Promise.all(
      [...byProject.entries()].map(async ([projectPath, sessions]) => {
        const settings = this.deps.settingsFor(projectPath);
        if (settings.checkIntervalMin === 0) return; // aus — kein Fetch, kein Takt
        const intervalMs = settings.checkIntervalMin * 60_000;
        const last = this.lastRun.get(projectPath) ?? 0;
        if (nowMs - last < intervalMs) return;
        if (this.running.has(projectPath)) return; // zusammenfassen
        this.running.add(projectPath);
        try {
          await this.runProject(projectPath, sessions, settings);
        } finally {
          this.lastRun.set(projectPath, this.now().getTime());
          this.running.delete(projectPath);
        }
      }),
    );
  }

  private async runProject(projectPath: string, sessions: MainSyncCandidate[], settings: MainSyncSettings): Promise<void> {
    // BUG-0260: ohne Haupt-Fern ist nichts zu holen — kein Fetch, keine
    // Projekt-Meldung „fetch-failed“ (die Lage heisst „kein Fern“, nicht „Fern
    // nicht erreichbar“). Stufe 1 meldet sie beim Session-Start ohnehin.
    if ((await originRemoteUrl(projectPath)) === null) return;
    let branch: string;
    try {
      branch = await resolveMainBranch(projectPath, settings);
    } catch {
      return; // kein Git/kein Remote: Stufe 1 meldet das beim Start, hier gibt es nichts zu holen
    }
    try {
      await this.fetch(projectPath, branch, settings.fetchTimeoutSec);
    } catch {
      // BUG-0224: ein Fetch je Projekt → eine Meldung je Projekt und Fehlerlage
      // (vorher je Session); erfolgreiche Fetches löschen die Lage (Flattern
      // meldet je Wechsel, aber je Projekt).
      const seen = this.seenProject.get(projectPath);
      if (seen?.failure === "fetch-failed") return;
      this.seenProject.set(projectPath, { ...seen, failure: "fetch-failed" });
      const anchor = sessions[0];
      if (anchor) {
        this.deps.notice({ kind: "failed", sessionId: anchor.sessionId, projectPath, reason: "fetch-failed", detail: `Fetch von origin/${branch} gescheitert${sessions.length > 1 ? ` (${sessions.length} Sessions betroffen)` : ""}` });
      }
      return;
    }
    const { failure: _fetchLage, ...ohneLage } = this.seenProject.get(projectPath) ?? {};
    if (_fetchLage !== undefined) this.seenProject.set(projectPath, ohneLage);
    const engine = new MainSyncEngine({ now: this.now });
    const behind: { session: MainSyncCandidate; behind: number }[] = [];
    for (const session of sessions) {
      try {
        const measure = await engine.measure(session.workdir, branch);
        if (measure.behind > 0) behind.push({ session, behind: measure.behind });
        else this.seenSession.delete(session.sessionId); // Stand aktuell — Session-Lagen zurücksetzen
      } catch {
        // Worktree weg/kaputt: Recovery der Session ist deren eigene Aufgabe
      }
    }
    if (behind.length === 0) {
      const { behind: _stand, ...ohneStand } = this.seenProject.get(projectPath) ?? {};
      if (_stand !== undefined) this.seenProject.set(projectPath, ohneStand);
      return;
    }
    const mode = resolveBehindMode(settings);
    let remaining = behind;
    if (mode === "auto-merge") {
      const after: { session: MainSyncCandidate; behind: number }[] = [];
      for (const entry of behind) {
        const applied = await this.runAutoMerge(entry, engine, branch, projectPath);
        if (!applied) after.push(entry);
      }
      remaining = after;
    }
    if (remaining.length > 0) this.notifyBehindPerProject(projectPath, branch, remaining, mode === "auto-merge" ? "notify" : mode);
  }

  /** auto-merge: Probelauf + Merge nur bei wartender Session; true = Session ist aktuell. */
  private async runAutoMerge(entry: { session: MainSyncCandidate; behind: number }, engine: MainSyncEngine, branch: string, projectPath: string): Promise<boolean> {
    const { session } = entry;
    if (!session.waiting) return false;
    let clean: boolean;
    let conflicts: string[];
    try {
      const dry = await engine.dryRun(session.workdir, branch);
      clean = dry.clean;
      conflicts = dry.conflicts;
    } catch {
      this.noticeSessionFailureOnce(session, "dry-run-failed");
      return false;
    }
    if (!clean) {
      this.noticeConflictOnce(session, conflicts);
      return false;
    }
    const result = await this.deps.apply(session.sessionId);
    if (result.outcome === "applied") {
      this.seenSession.delete(session.sessionId);
      this.deps.notice({ kind: "applied", sessionId: session.sessionId, projectPath, result });
      return true;
    }
    if (result.outcome === "failed") {
      this.noticeSessionFailureOnce(session, result.reason, result.detail ?? undefined);
      return false;
    }
    return false; // skipped/conflict (z. B. doch dirty geworden): beim nächsten Takt erneut bewerten
  }

  /** BUG-0224 (Premortem 5): eine Meldung je Projekt und Stand — nicht je Session, nicht je Takt. */
  private notifyBehindPerProject(projectPath: string, branch: string, remaining: { session: MainSyncCandidate; behind: number }[], mode: "notify" | "ask"): void {
    const stand = Math.max(...remaining.map((r) => r.behind));
    const seen = this.seenProject.get(projectPath);
    if (seen?.behind === stand) return;
    this.seenProject.set(projectPath, { ...seen, behind: stand });
    const anchor = (remaining.find((r) => r.session.waiting) ?? remaining[0])!.session;
    this.deps.notice({ kind: "behind", sessionId: anchor.sessionId, projectPath, behind: stand, branch, mode, sessions: remaining.length });
  }

  /** Konflikt je Session und Dateiliste einmal — steht er, meldet er sich nicht je Takt. */
  private noticeConflictOnce(session: MainSyncCandidate, files: string[]): void {
    const key = [...files].sort().join("\u0000");
    const seen = this.seenSession.get(session.sessionId);
    if (seen?.conflict === key) return;
    this.seenSession.set(session.sessionId, { ...seen, conflict: key });
    this.deps.notice({ kind: "conflict", sessionId: session.sessionId, projectPath: session.projectPath, files });
  }

  /** Fehler je Session und Ursache einmal — dauerhaft Gescheitertes meldet nicht je Takt. */
  private noticeSessionFailureOnce(session: MainSyncCandidate, reason: string, detail?: string): void {
    const key = `${reason}|${detail ?? ""}`;
    const seen = this.seenSession.get(session.sessionId);
    if (seen?.failed === key) return;
    this.seenSession.set(session.sessionId, { ...seen, failed: key });
    this.deps.notice({ kind: "failed", sessionId: session.sessionId, projectPath: session.projectPath, reason, ...(detail ? { detail } : {}) });
  }
}

/** auto hinter `autoMerge` zurück: ohne ausdrückliches clean-only wird nichts autonom gemergt; ask bleibt Rückfrage. */
function resolveBehindMode(settings: MainSyncSettings): "notify" | "ask" | "auto-merge" {
  if (settings.behindAction === "auto" && settings.autoMerge === "clean-only") return "auto-merge";
  if (settings.behindAction === "ask" || (settings.behindAction === "auto" && settings.autoMerge === "ask")) return "ask";
  return "notify";
}
