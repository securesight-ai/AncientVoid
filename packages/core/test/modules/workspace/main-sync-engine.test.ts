import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "@ancientvoid/contracts";
import { basicFeatures, MAIN_SYNC_DEFAULTS } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, MainSyncEngine, MAIN_SYNC_MERGE_MESSAGE, SessionManager, AdapterRegistry, WorktreeManager } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

const execFileAsync = promisify(execFile);

async function commit(repo: string, message: string, file: string, content = `${message}\n`): Promise<string> {
  await writeFile(join(repo, file), content);
  await execFileAsync("git", ["-C", repo, "add", "-A"]);
  await execFileAsync("git", ["-C", repo, "commit", "-q", "-m", message]);
  const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"]);
  return stdout.trim();
}

async function headSha(repo: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"]);
  return stdout.trim();
}

/** Bare-origin + Projekt auf main, Remote konfiguriert (T67.2-Muster). */
async function mkProject(base: string, name: string): Promise<{ repo: string; origin: string }> {
  const origin = join(base, `${name}-origin.git`);
  await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const repo = join(base, `${name}-repo`);
  await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
  await execFileAsync("git", ["-C", repo, "config", "user.email", "test@ancientvoid.local"]);
  await execFileAsync("git", ["-C", repo, "config", "user.name", "ancientvoid test"]);
  await execFileAsync("git", ["-C", repo, "remote", "add", "origin", origin]);
  await commit(repo, "initial", "a.txt");
  await execFileAsync("git", ["-C", repo, "push", "-q", "-u", "origin", "main"]);
  return { repo, origin };
}

/** origin/main vorrücken lassen, ohne das Projekt zu aktualisieren. */
async function advanceOrigin(origin: string, base: string, name: string, message: string, file?: string): Promise<string> {
  const other = join(base, `${name}-other`);
  await execFileAsync("git", ["clone", "-q", origin, other]);
  await execFileAsync("git", ["-C", other, "config", "user.email", "other@ancientvoid.local"]);
  await execFileAsync("git", ["-C", other, "config", "user.name", "ancientvoid other"]);
  const sha = await commit(other, message, file ?? `${message}.txt`);
  await execFileAsync("git", ["-C", other, "push", "-q", "origin", "main"]);
  await rm(other, { recursive: true, force: true });
  return sha;
}

async function fetchOrigin(repo: string): Promise<void> {
  await execFileAsync("git", ["-C", repo, "fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
}

/** Worktree auf dem lokalen HEAD anlegen (ohne Fetch — Stufe-1-Mechanik bleibt außen vor). */
async function mkWorktree(repo: string, out: string, name: string): Promise<string> {
  const wt = new WorktreeManager(out);
  const created = await wt.create(name, repo);
  if (!created) throw new Error("worktree creation failed");
  return created.path;
}

describe("EPIC-P67 T67.4 — MainSyncEngine: messen, probelaufen, anwenden", () => {
  let base: string;
  let out: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "ancientvoid-p67e-"));
    out = await mkdtemp(join(tmpdir(), "ancientvoid-p67e-wt-"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  });

  it("Messen: behind/ahead gegen origin/main; Probelauf sauber; Anwenden fast-forward (Session ohne eigene Commits)", async () => {
    const { repo, origin } = await mkProject(base, "ff");
    const wt = await mkWorktree(repo, out, "ff-session");
    const advanced = await advanceOrigin(origin, base, "ff", "neuer-stand");
    await fetchOrigin(repo);
    const engine = new MainSyncEngine();
    const measure = await engine.measure(wt, "main");
    expect(measure).toMatchObject({ behind: 1, ahead: 0, clean: true });
    const dry = await engine.dryRun(wt, "main");
    expect(dry).toEqual({ clean: true, conflicts: [] });
    const result = await engine.apply(wt, "main");
    expect(result).toMatchObject({ outcome: "applied", to: advanced.slice(0, 12) });
    expect(await headSha(wt)).toBe(advanced);
    // Fast-Forward: kein Merge-Knoten, kein Commit entstanden
    const { stdout: log } = await execFileAsync("git", ["-C", wt, "log", "--oneline"]);
    expect(log).not.toContain(MAIN_SYNC_MERGE_MESSAGE);
  });

  it("Echter Merge: Session hat eigene Commits, origin andere Datei — notation-konforme Merge-Nachricht (AC-P67-11)", async () => {
    const { repo, origin } = await mkProject(base, "merge");
    const wt = await mkWorktree(repo, out, "merge-session");
    await commit(wt, "session-arbeit", "session.txt");
    const advanced = await advanceOrigin(origin, base, "merge", "origin-arbeit");
    await fetchOrigin(repo);
    const engine = new MainSyncEngine();
    expect(await engine.measure(wt, "main")).toMatchObject({ behind: 1, ahead: 1, clean: true });
    const result = await engine.apply(wt, "main");
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("unreachable");
    expect(result.files).toEqual(["origin-arbeit.txt"]);
    const { stdout: log } = await execFileAsync("git", ["-C", wt, "log", "--format=%s", "-3"]);
    expect(log).toContain(MAIN_SYNC_MERGE_MESSAGE);
    expect(await headSha(wt)).not.toBe(advanced); // echter Merge-Knoten, kein Fast-Forward
  });

  it("AC-P67-7 — Konflikt: Probelauf nennt die Datei, Merge scheitert, --abort lässt den Worktree unverändert (Hash vorher = nachher)", async () => {
    const { repo, origin } = await mkProject(base, "konflikt");
    const wt = await mkWorktree(repo, out, "konflikt-session");
    await commit(wt, "session-seite", "gemeinsam.txt", "session\n");
    await advanceOrigin(origin, base, "konflikt", "origin-seite", "gemeinsam.txt");
    await fetchOrigin(repo);
    const engine = new MainSyncEngine();
    const dry = await engine.dryRun(wt, "main");
    expect(dry).toEqual({ clean: false, conflicts: ["gemeinsam.txt"] });
    const before = await headSha(wt);
    const result = await engine.apply(wt, "main");
    expect(result).toEqual({ outcome: "conflict", files: ["gemeinsam.txt"] });
    expect(await headSha(wt)).toBe(before);
    const { stdout: status } = await execFileAsync("git", ["-C", wt, "status", "--porcelain"]);
    expect(status.trim()).toBe(""); // keine Konfliktmarker, nichts halb angewendet
  });

  it("Dirty Worktree: Apply wird übersprungen, nichts angewendet", async () => {
    const { repo, origin } = await mkProject(base, "dirty");
    const wt = await mkWorktree(repo, out, "dirty-session");
    await advanceOrigin(origin, base, "dirty", "neuer-stand");
    await fetchOrigin(repo);
    await writeFile(join(wt, "ungesichert.txt"), "noch nicht committet\n");
    const before = await headSha(wt);
    const engine = new MainSyncEngine();
    const result = await engine.apply(wt, "main");
    expect(result).toMatchObject({ outcome: "skipped", reason: "dirty-worktree" });
    expect(await headSha(wt)).toBe(before);
  });

  it("Up-to-date: kein Apply ohne Rückstand", async () => {
    const { repo } = await mkProject(base, "uptodate");
    const wt = await mkWorktree(repo, out, "uptodate-session");
    const engine = new MainSyncEngine();
    const result = await engine.apply(wt, "main");
    expect(result).toEqual({ outcome: "skipped", reason: "up-to-date" });
  });
});

function adapter(sleepMs: number): Adapter {
  return {
    id: sleepMs > 0 ? "busy" : "idle",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(_spec, ctx) {
      await ctx.spawnWorker(["sh", "-c", sleepMs > 0 ? `sleep ${sleepMs}` : "true"]);
      return { sessionId: ctx.sessionId };
    },
    async steer() {
      return { ok: true };
    },
    async status() {
      return { state: "healthy" as const };
    },
    async stop() {},
  };
}

describe("EPIC-P67 T67.4 — SessionManager: Check/Apply, Gating, Journal, K7-Faltung", () => {
  let base: string;
  let out: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "ancientvoid-p67sm-"));
    out = await mkdtemp(join(tmpdir(), "ancientvoid-p67sm-wt-"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  });

  async function setupManager(repo: string, name: string, busy = false) {
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("a", () => adapter(busy ? 30 : 0));
    const worktrees = new WorktreeManager(join(out, name));
    const manager = new SessionManager(db, new EventStore(join(out, name)), registry, new ProcessRunner(), undefined, worktrees, undefined, null, [], {}, undefined, null, () => ({ ...MAIN_SYNC_DEFAULTS }));
    return manager;
  }

  async function waitStatus(manager: SessionManager, id: string, status: string) {
    const deadline = Date.now() + 10_000;
    while (manager.get(id)?.status !== status && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  }

  it("Check: fetcht, misst, probet — Event main_sync_checked im Verlauf, lastSyncedAt null", async () => {
    const { repo, origin } = await mkProject(base, "sm-check");
    const manager = await setupManager(repo, "sm-check");
    try {
      const record = await manager.create({ adapter: "a", project: repo, prompt: "arbeite" }, "pc");
      await waitStatus(manager, record.id, "idle");
      await advanceOrigin(origin, base, "sm-check", "neuer-stand");
      const check = await manager.mainSyncCheck(record.id);
      expect(check).toMatchObject({ branch: "main", behind: 1, ahead: 0, clean: true, conflicts: null, lastSyncedAt: null });
      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).toContain("workspace.main_sync_checked");
    } finally {
      await manager.shutdown();
    }
  });

  it("Apply auf wartender Session: Merge läuft, Event main_sync_applied, Worktree steht auf neuem Stand", async () => {
    const { repo, origin } = await mkProject(base, "sm-apply");
    const manager = await setupManager(repo, "sm-apply");
    try {
      const record = await manager.create({ adapter: "a", project: repo, prompt: "arbeite" }, "pc");
      await waitStatus(manager, record.id, "idle");
      await advanceOrigin(origin, base, "sm-apply", "neuer-stand");
      const result = await manager.mainSyncApply(record.id);
      expect(result.outcome).toBe("applied");
      const wt = manager.workdirOf(record.id)!;
      expect(await headSha(wt)).not.toBe(record.worktreeSha);
      const events = await manager.tail(record.id, 0);
      const applied = events.find((e) => (e.payload as { kind?: string }).kind === "workspace.main_sync_applied");
      expect(applied?.payload).toMatchObject({ kind: "workspace.main_sync_applied", from: expect.any(String), to: expect.any(String) });
      // K7: lastSyncedAt faltet sich aus dem Event-Strom (JSONL), nicht aus Speicher
      const check = await manager.mainSyncCheck(record.id);
      expect(check.lastSyncedAt).toBe(applied!.ts);
      expect(check.behind).toBe(0);
    } finally {
      await manager.shutdown();
    }
  });

  it("AC-P67-6 — laufender Zug: kein Merge, skipped session-busy mit Event, Worktree unverändert", async () => {
    const { repo, origin } = await mkProject(base, "sm-busy");
    await advanceOrigin(origin, base, "sm-busy", "neuer-stand");
    const manager = await setupManager(repo, "sm-busy", true);
    try {
      const record = await manager.create({ adapter: "a", project: repo, prompt: "arbeite" }, "pc");
      await waitStatus(manager, record.id, "working");
      const before = await headSha(manager.workdirOf(record.id)!);
      const result = await manager.mainSyncApply(record.id);
      expect(result).toMatchObject({ outcome: "skipped", reason: "session-busy" });
      expect(await headSha(manager.workdirOf(record.id)!)).toBe(before);
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "workspace.main_sync_skipped")).toBe(true);
      await manager.stop(record.id, "pc");
    } finally {
      await manager.shutdown();
    }
  });

  it("Konflikt über den SessionManager: Event main_sync_conflict mit Dateiliste (AC-P67-7)", async () => {
    const { repo, origin } = await mkProject(base, "sm-konflikt");
    const manager = await setupManager(repo, "sm-konflikt");
    try {
      const record = await manager.create({ adapter: "a", project: repo, prompt: "arbeite" }, "pc");
      await waitStatus(manager, record.id, "idle");
      const wt = manager.workdirOf(record.id)!;
      await commit(wt, "session-seite", "gemeinsam.txt", "session\n");
      await advanceOrigin(origin, base, "sm-konflikt", "origin-seite", "gemeinsam.txt");
      const check = await manager.mainSyncCheck(record.id);
      expect(check.conflicts).toEqual(["gemeinsam.txt"]);
      const result = await manager.mainSyncApply(record.id);
      expect(result).toEqual({ outcome: "conflict", files: ["gemeinsam.txt"] });
      const events = await manager.tail(record.id, 0);
      const conflict = events.find((e) => (e.payload as { kind?: string }).kind === "workspace.main_sync_conflict");
      expect(conflict?.payload).toMatchObject({ kind: "workspace.main_sync_conflict", files: ["gemeinsam.txt"] });
    } finally {
      await manager.shutdown();
    }
  });

  it("Fetch-Fehler beim Check: main_sync_failed-Event, Check wirft ehrlich (Regel 6)", async () => {
    const { repo } = await mkProject(base, "sm-offline");
    await execFileAsync("git", ["-C", repo, "remote", "set-url", "origin", join(base, "gibt-es-nicht.git")]);
    const manager = await setupManager(repo, "sm-offline");
    try {
      const record = await manager.create({ adapter: "a", project: repo, prompt: "arbeite" }, "pc");
      await waitStatus(manager, record.id, "idle");
      await expect(manager.mainSyncCheck(record.id)).rejects.toThrow(/gescheitert/);
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "workspace.main_sync_failed")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("BUG-0260: Projekt ohne Haupt-Fern — benannter Grund statt Fehler-Event in der Sessions-Akte", async () => {
    const repo = join(base, "nofern-repo");
    await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
    await execFileAsync("git", ["-C", repo, "config", "user.email", "test@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repo, "config", "user.name", "ancientvoid test"]);
    await commit(repo, "initial", "a.txt");
    const manager = await setupManager(repo, "nofern");
    try {
      const record = await manager.create({ adapter: "a", project: repo, prompt: "arbeite" }, "pc");
      await waitStatus(manager, record.id, "idle");
      await expect(manager.mainSyncCheck(record.id)).rejects.toThrow(/kein Haupt-Fern/);
      const kinds = (await manager.tail(record.id, 0)).map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).not.toContain("workspace.main_sync_failed");
      expect(kinds).toContain("workspace.main_sync_skipped"); // Grund no-remote, benannt statt Fehler
      // Stufe 1 bleibt unberuehrt: der Worktree entstand auf lokalem HEAD (reason no-remote)
      expect(manager.workdirOf(record.id)).toBeTruthy();
    } finally {
      await manager.shutdown();
    }
  });

  it("Ohne Worktree-Isolation (direkter Modus): Check/Apply werfen mit benanntem Grund", async () => {
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("a", () => adapter(0));
    const manager = new SessionManager(db, new EventStore(join(out, "sm-direct")), registry, new ProcessRunner()); // kein WorktreeManager
    const nonGit = await mkdtemp(join(tmpdir(), "ancientvoid-p67-nongit-"));
    try {
      const record = await manager.create({ adapter: "a", project: nonGit, prompt: "arbeite" }, "pc");
      await waitStatus(manager, record.id, "idle");
      await expect(manager.mainSyncCheck(record.id)).rejects.toThrow(/Worktree-Isolation/);
      await expect(manager.mainSyncApply(record.id)).rejects.toThrow(/Worktree-Isolation/);
    } finally {
      await manager.shutdown();
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});
