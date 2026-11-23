import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter, MainSyncSettings } from "@ancientvoid/contracts";
import { basicFeatures, MAIN_SYNC_DEFAULTS } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, MainSyncScheduler, SessionManager, AdapterRegistry, WorktreeManager, type MainSyncCandidate, type MainSyncSchedulerNotice } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

const execFileAsync = promisify(execFile);

async function commit(repo: string, message: string, file: string, content = `${message}\n`): Promise<string> {
  await writeFile(join(repo, file), content);
  await execFileAsync("git", ["-C", repo, "add", "-A"]);
  await execFileAsync("git", ["-C", repo, "commit", "-q", "-m", message]);
  const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"]);
  return stdout.trim();
}

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

async function advanceOrigin(origin: string, base: string, name: string, message: string, file?: string): Promise<void> {
  const other = join(base, `${name}-other`);
  await execFileAsync("git", ["clone", "-q", origin, other]);
  await execFileAsync("git", ["-C", other, "config", "user.email", "other@ancientvoid.local"]);
  await execFileAsync("git", ["-C", other, "config", "user.name", "ancientvoid other"]);
  await commit(other, message, file ?? `${message}.txt`);
  await execFileAsync("git", ["-C", other, "push", "-q", "origin", "main"]);
  await rm(other, { recursive: true, force: true });
}

const settings = (patch: Partial<MainSyncSettings> = {}): MainSyncSettings => ({ ...MAIN_SYNC_DEFAULTS, ...patch });

/** Zählbarer Fetch + ein Fake-Worktree, an dem measure/dryRun echte Ergebnisse liefern. */
function countingFetch(counter: { calls: number }, repo: string, impl?: (p: string, b: string, t: number) => Promise<void>) {
  return async (projectPath: string, branch: string, timeoutSec: number) => {
    counter.calls += 1;
    if (impl) await impl(projectPath, branch, timeoutSec);
    else await execFileAsync("git", ["-C", repo, "fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  };
}

describe("EPIC-P67 T67.5 — MainSyncScheduler: Takt, Modi, Entprellen", () => {
  let base: string;
  let out: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "ancientvoid-p67s-"));
    out = await mkdtemp(join(tmpdir(), "ancientvoid-p67s-wt-"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  });

  function fakeCandidate(sessionId: string, projectPath: string, workdir: string, waiting: boolean): MainSyncCandidate {
    return { sessionId, projectPath, workdir, waiting };
  }

  it("AC-P67-4 (K8) — 20 Sessions eines Projekts: ein Takt, GENAU ein Fetch", async () => {
    const { repo, origin } = await mkProject(base, "k8");
    await advanceOrigin(origin, base, "k8", "neuer-stand");
    const counter = { calls: 0 };
    const notices: MainSyncSchedulerNotice[] = [];
    const wt = new WorktreeManager(join(out, "k8"));
    const created = await wt.create("k8-session", repo); // lokaler Stand (1 Commit hinter origin)
    const candidates = Array.from({ length: 20 }, (_, i) => fakeCandidate(`s-${i}`, repo, created!.path, true));
    const clock = { value: Date.parse("2026-11-18T12:00:00Z") };
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5 }),
      candidates: () => candidates,
      apply: async () => ({ outcome: "skipped", reason: "session-busy" }),
      notice: (n) => notices.push(n),
      now: () => new Date(clock.value),
      fetch: countingFetch(counter, repo),
    });
    await scheduler.tick();
    expect(counter.calls).toBe(1);
    // BUG-0224: eine behind-Meldung je Projekt und Stand — 20 Sessions
    // erzeugen einen Row mit Anzahl, nicht 20 identische Rows.
    const behind = notices.filter((n) => n.kind === "behind");
    expect(behind).toHaveLength(1);
    expect(behind[0]).toMatchObject({ behind: 1, sessions: 20 });
  });

  it("BUG-0260: Projekt ohne Haupt-Fern — kein Fetch, keine fetch-failed-Meldung", async () => {
    const repo = join(base, "nofern-repo");
    await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
    await execFileAsync("git", ["-C", repo, "config", "user.email", "test@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repo, "config", "user.name", "ancientvoid test"]);
    await commit(repo, "initial", "a.txt");
    const counter = { calls: 0 };
    const notices: MainSyncSchedulerNotice[] = [];
    const wt = new WorktreeManager(join(out, "nofern"));
    const created = await wt.create("nofern-session", repo); // Stufe 1: Grund no-remote, Basis lokaler HEAD
    const clock = { value: Date.parse("2026-11-22T12:00:00Z") };
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings(),
      candidates: () => [fakeCandidate("s-nofern", repo, created!.path, true)],
      apply: async () => ({ outcome: "skipped", reason: "session-busy" }),
      notice: (n) => notices.push(n),
      now: () => new Date(clock.value),
      fetch: countingFetch(counter, repo),
    });
    await scheduler.tick();
    expect(counter.calls).toBe(0); // kein Fetch gegen ein Fern, das es nicht gibt
    expect(notices.length).toBe(0); // und keine Projekt-Meldung „fetch-failed“
  });

  it("Intervall: zweiter Takt innerhalb des Intervalls fetcht nicht; nach Ablauf wieder — und 0 = aus", async () => {
    const { repo } = await mkProject(base, "intervall");
    const counter = { calls: 0 };
    const clock = { value: Date.parse("2026-11-18T12:00:00Z") };
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 60 }),
      candidates: () => [fakeCandidate("s1", repo, repo, true)],
      apply: async () => ({ outcome: "skipped", reason: "up-to-date" }),
      notice: () => undefined,
      now: () => new Date(clock.value),
      fetch: countingFetch(counter, repo, async () => undefined),
    });
    await scheduler.tick();
    clock.value += 10 * 60_000; // 10 min später: Intervall (60) nicht erreicht
    await scheduler.tick();
    expect(counter.calls).toBe(1);
    clock.value += 55 * 60_000; // Intervall erreicht
    await scheduler.tick();
    expect(counter.calls).toBe(2);

    const off = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 0 }),
      candidates: () => [fakeCandidate("s1", repo, repo, true)],
      apply: async () => ({ outcome: "skipped", reason: "up-to-date" }),
      notice: () => undefined,
      now: () => new Date(clock.value),
      fetch: countingFetch(counter, repo, async () => undefined),
    });
    await off.tick();
    expect(counter.calls).toBe(2); // aus: kein zusätzlicher Fetch
  });

  it("AC-P67-5 — Entprellen: gleicher Rückstand meldet sich nicht erneut, neuer meldet sich, 0 setzt zurück", async () => {
    const { repo, origin } = await mkProject(base, "debounce");
    await advanceOrigin(origin, base, "debounce", "stand-1");
    const counter = { calls: 0 };
    const notices: MainSyncSchedulerNotice[] = [];
    const wt = new WorktreeManager(join(out, "debounce"));
    const created = await wt.create("debounce-session", repo);
    const clock = { value: Date.parse("2026-11-18T12:00:00Z") };
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5 }),
      candidates: () => [fakeCandidate("s1", repo, created!.path, true)],
      apply: async () => ({ outcome: "skipped", reason: "session-busy" }),
      notice: (n) => notices.push(n),
      now: () => new Date(clock.value),
      fetch: countingFetch(counter, repo),
    });
    await scheduler.tick();
    expect(notices.filter((n) => n.kind === "behind")).toHaveLength(1);
    expect((notices[0] as { behind: number }).behind).toBe(1);

    clock.value += 10 * 60_000;
    await scheduler.tick(); // gleicher Stand
    expect(notices.filter((n) => n.kind === "behind")).toHaveLength(1);

    await advanceOrigin(origin, base, "debounce", "stand-2"); // neuer Rückstand
    clock.value += 10 * 60_000;
    await scheduler.tick();
    expect(notices.filter((n) => n.kind === "behind")).toHaveLength(2);
    expect((notices[1] as { behind: number }).behind).toBe(2);

    //Fetch-Fehler entprellt: kaputtes Remote, zwei Takte → eine failed-Meldung
    await execFileAsync("git", ["-C", repo, "remote", "set-url", "origin", join(base, "weg.git")]);
    clock.value += 10 * 60_000;
    await scheduler.tick();
    clock.value += 10 * 60_000;
    await scheduler.tick();
    expect(notices.filter((n) => n.kind === "failed")).toHaveLength(1);
  });

  it("auto + clean-only + wartende Session: Merge läuft real, 'applied'-Meldung, kein zweiter Fetch durch apply", async () => {
    const { repo, origin } = await mkProject(base, "auto");
    const counter = { calls: 0 };
    const notices: MainSyncSchedulerNotice[] = [];

    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("idle", idleAdapter);
    const worktrees = new WorktreeManager(join(out, "auto"));
    const manager = new SessionManager(db, new EventStore(join(out, "auto")), registry, new ProcessRunner(), undefined, worktrees, undefined, null, [], {}, undefined, null, () => settings({ checkIntervalMin: 5 }));
    try {
      // Session startet per Stufe-1 auf origin/main (fetch-base)
      const record = await manager.create({ adapter: "idle", project: repo, prompt: "arbeite" }, "pc");
      const deadline = Date.now() + 8000;
      while (manager.get(record.id)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      await advanceOrigin(origin, base, "auto", "neuer-stand");

      const clock = { value: Date.parse("2026-11-18T12:00:00Z") };
      const scheduler = new MainSyncScheduler({
        settingsFor: () => settings({ checkIntervalMin: 5, behindAction: "auto", autoMerge: "clean-only" }),
        candidates: () => manager.mainSyncCandidates(),
        apply: (sessionId) => manager.mainSyncApply(sessionId, { skipFetch: true }),
        notice: (n) => notices.push(n),
        now: () => new Date(clock.value),
        fetch: countingFetch(counter, repo),
      });
      await scheduler.tick();
      expect(counter.calls).toBe(1); // ein Fetch je Projekt — apply hat KEINEN zweiten gemacht
      const applied = notices.find((n) => n.kind === "applied");
      expect(applied).toBeDefined();
      const wt = manager.workdirOf(record.id)!;
      const { stdout: head } = await execFileAsync("git", ["-C", wt, "rev-parse", "HEAD"]);
      const { stdout: originHead } = await execFileAsync("git", ["--git-dir", origin, "rev-parse", "main"]);
      expect(head.trim()).toBe(originHead.trim()); // Fast-Forward auf origin/main
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "workspace.main_sync_applied")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("auto + busy Session: nur Meldung, kein Merge-Versuch (AC-P67-6)", async () => {
    const { repo, origin } = await mkProject(base, "autobusy");
    await advanceOrigin(origin, base, "autobusy", "neuer-stand");
    const counter = { calls: 0 };
    const notices: MainSyncSchedulerNotice[] = [];
    const wt = new WorktreeManager(join(out, "autobusy"));
    const created = await wt.create("autobusy-session", repo);
    let applyCalls = 0;
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5, behindAction: "auto", autoMerge: "clean-only" }),
      candidates: () => [fakeCandidate("s1", repo, created!.path, false)], // nicht wartend
      apply: async () => {
        applyCalls += 1;
        return { outcome: "skipped", reason: "session-busy" };
      },
      notice: (n) => notices.push(n),
      now: () => new Date(Date.parse("2026-11-18T12:00:00Z")),
      fetch: countingFetch(counter, repo),
    });
    await scheduler.tick();
    expect(applyCalls).toBe(0);
    expect(notices.filter((n) => n.kind === "behind")).toHaveLength(1);
  });

  it("auto + Konflikt (Probelauf): 'conflict'-Meldung mit Dateiliste, kein apply", async () => {
    const { repo, origin } = await mkProject(base, "autoconflict");
    const wt = new WorktreeManager(join(out, "autoconflict"));
    const created = await wt.create("autoconflict-session", repo);
    await commit(created!.path, "session-seite", "gemeinsam.txt", "session\n");
    await advanceOrigin(origin, base, "autoconflict", "origin-seite", "gemeinsam.txt");
    const counter = { calls: 0 };
    const notices: MainSyncSchedulerNotice[] = [];
    let applyCalls = 0;
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5, behindAction: "auto", autoMerge: "clean-only" }),
      candidates: () => [fakeCandidate("s1", repo, created!.path, true)],
      apply: async () => {
        applyCalls += 1;
        return { outcome: "conflict", files: [] };
      },
      notice: (n) => notices.push(n),
      now: () => new Date(Date.parse("2026-11-18T12:00:00Z")),
      fetch: countingFetch(counter, repo),
    });
    await scheduler.tick();
    expect(applyCalls).toBe(0);
    expect(notices).toContainEqual(expect.objectContaining({ kind: "conflict", files: ["gemeinsam.txt"] }));
  });

  it("autoMerge: off verhält sich wie notify — kein autonomer Merge", async () => {
    const { repo, origin } = await mkProject(base, "automeroff");
    await advanceOrigin(origin, base, "automeroff", "neuer-stand");
    const counter = { calls: 0 };
    const notices: MainSyncSchedulerNotice[] = [];
    const wt = new WorktreeManager(join(out, "automeroff"));
    const created = await wt.create("automeroff-session", repo);
    let applyCalls = 0;
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5, behindAction: "auto", autoMerge: "off" }),
      candidates: () => [fakeCandidate("s1", repo, created!.path, true)],
      apply: async () => {
        applyCalls += 1;
        return { outcome: "skipped", reason: "session-busy" };
      },
      notice: (n) => notices.push(n),
      now: () => new Date(Date.parse("2026-11-18T12:00:00Z")),
      fetch: countingFetch(counter, repo),
    });
    await scheduler.tick();
    expect(applyCalls).toBe(0);
    expect(notices.filter((n) => n.kind === "behind")).toHaveLength(1);
  });

  it("zwei Projekte: zwei Fetches, je Projekt einer", async () => {
    const a = await mkProject(base, "multi-a");
    const b = await mkProject(base, "multi-b");
    const counter = { calls: 0 };
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5 }),
      candidates: () => [
        fakeCandidate("s1", a.repo, a.repo, true),
        fakeCandidate("s2", a.repo, a.repo, true),
        fakeCandidate("s3", b.repo, b.repo, true),
      ],
      apply: async () => ({ outcome: "skipped", reason: "up-to-date" }),
      notice: () => undefined,
      now: () => new Date(Date.parse("2026-11-18T12:00:00Z")),
      fetch: async (projectPath) => {
        counter.calls += 1;
        await execFileAsync("git", ["-C", projectPath, "fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
      },
    });
    await scheduler.tick();
    expect(counter.calls).toBe(2);
  });

  it("BUG-0224 — Fetch-Fehler meldet je Projekt, nicht je Session; gleiche Lage nicht je Takt", async () => {
    const { repo } = await mkProject(base, "fetchfail");
    const notices: MainSyncSchedulerNotice[] = [];
    const clock = { value: Date.parse("2026-11-19T12:00:00Z") };
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5 }),
      candidates: () => [fakeCandidate("s1", repo, repo, true), fakeCandidate("s2", repo, repo, true), fakeCandidate("s3", repo, repo, true)],
      apply: async () => ({ outcome: "skipped", reason: "up-to-date" }),
      notice: (n) => notices.push(n),
      now: () => new Date(clock.value),
      fetch: async () => {
        throw new Error("netz weg");
      },
    });
    await scheduler.tick();
    clock.value += 10 * 60_000;
    await scheduler.tick();
    expect(notices.filter((n) => n.kind === "failed")).toHaveLength(1);
  });

  it("BUG-0224 — dauerhaft scheiterndes apply: eine Meldung je Ursache, nicht je Takt", async () => {
    const { repo, origin } = await mkProject(base, "applyfail");
    await advanceOrigin(origin, base, "applyfail", "neuer-stand");
    const notices: MainSyncSchedulerNotice[] = [];
    const wt = new WorktreeManager(join(out, "applyfail"));
    const created = await wt.create("applyfail-session", repo);
    const clock = { value: Date.parse("2026-11-19T12:00:00Z") };
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5, behindAction: "auto", autoMerge: "clean-only" }),
      candidates: () => [fakeCandidate("s1", repo, created!.path, true)],
      apply: async () => ({ outcome: "failed", reason: "merge-lock" }),
      notice: (n) => notices.push(n),
      now: () => new Date(clock.value),
      fetch: countingFetch({ calls: 0 }, repo),
    });
    await scheduler.tick();
    clock.value += 10 * 60_000;
    await scheduler.tick();
    expect(notices.filter((n) => n.kind === "failed" && n.reason === "merge-lock")).toHaveLength(1);
  });

  it("BUG-0224 — stehender Konflikt: gleiche Dateiliste meldet sich je Session nur einmal", async () => {
    const { repo, origin } = await mkProject(base, "conflictdedup");
    const wt = new WorktreeManager(join(out, "conflictdedup"));
    const created = await wt.create("conflictdedup-session", repo);
    await commit(created!.path, "session-seite", "gemeinsam.txt", "session\n");
    await advanceOrigin(origin, base, "conflictdedup", "origin-seite", "gemeinsam.txt");
    const notices: MainSyncSchedulerNotice[] = [];
    const clock = { value: Date.parse("2026-11-19T12:00:00Z") };
    const scheduler = new MainSyncScheduler({
      settingsFor: () => settings({ checkIntervalMin: 5, behindAction: "auto", autoMerge: "clean-only" }),
      candidates: () => [fakeCandidate("s1", repo, created!.path, true)],
      apply: async () => ({ outcome: "conflict", files: [] }),
      notice: (n) => notices.push(n),
      now: () => new Date(clock.value),
      fetch: countingFetch({ calls: 0 }, repo),
    });
    await scheduler.tick();
    clock.value += 10 * 60_000;
    await scheduler.tick();
    expect(notices.filter((n) => n.kind === "conflict")).toHaveLength(1);
  });
});

function idleAdapter(): Adapter {
  return {
    id: "idle",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(_spec, ctx) {
      await ctx.spawnWorker(["sh", "-c", "true"]);
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
