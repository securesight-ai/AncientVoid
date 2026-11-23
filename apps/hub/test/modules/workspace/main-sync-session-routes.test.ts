import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { basicFeatures } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry, TokenService, WorktreeManager } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

const execFileAsync = promisify(execFile);

/** EPIC-P67 T67.6: GET/POST /api/sessions/:id/main-sync + Aktionsknopf-Roundtrip. */
describe("main-sync session routes", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let human: string;
  let agent: string;
  let repo: string;
  let origin: string;
  let sessionId: string;

  async function git(args: string[]) {
    return execFileAsync("git", args);
  }

  async function call(method: "GET" | "POST", url: string, token: string, payload?: Record<string, unknown>) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(method === "POST" ? { payload: payload ?? {} } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-ms-routes-"));
    origin = join(dir, "origin.git");
    await git(["init", "-q", "--bare", "-b", "main", origin]);
    repo = join(dir, "repo");
    await git(["init", "-q", "-b", "main", repo]);
    await git(["-C", repo, "config", "user.email", "test@ancientvoid.local"]);
    await git(["-C", repo, "config", "user.name", "ancientvoid test"]);
    await git(["-C", repo, "remote", "add", "origin", origin]);
    await writeFile(join(repo, "a.txt"), "initial\n");
    await git(["-C", repo, "add", "-A"]);
    await git(["-C", repo, "commit", "-q", "-m", "initial"]);
    await git(["-C", repo, "push", "-q", "-u", "origin", "main"]);

    const db = new HubDatabase(":memory:");
    tokens = new TokenService(db);
    const registry = new AdapterRegistry();
    registry.register("idle", () => ({
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
    }));
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner(), undefined, new WorktreeManager(join(dir, "wt")));
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:cli").token;
    const record = await sessions.create({ adapter: "idle", project: repo, prompt: "arbeite" }, "pc");
    sessionId = record.id;
    const deadline = Date.now() + 8000;
    while (sessions.get(sessionId)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    // origin vorrücken: Session läuft danach hinter main her
    const other = join(dir, "other");
    await git(["clone", "-q", origin, other]);
    await git(["-C", other, "config", "user.email", "other@ancientvoid.local"]);
    await git(["-C", other, "config", "user.name", "ancientvoid other"]);
    await writeFile(join(other, "neu.txt"), "neuer stand\n");
    await git(["-C", other, "add", "-A"]);
    await git(["-C", other, "commit", "-q", "-m", "neuer-stand"]);
    await git(["-C", other, "push", "-q", "origin", "main"]);
    await rm(other, { recursive: true, force: true });
  });

  afterAll(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("404 für unbekannte Session, auf GET und POST", async () => {
    expect((await call("GET", "/api/sessions/gibtsnicht/main-sync", human)).status).toBe(404);
    expect((await call("POST", "/api/sessions/gibtsnicht/main-sync", human)).status).toBe(404);
  });

  it("GET misst und probet: behind 1, Konflikte null, lastSyncedAt null", async () => {
    const res = await call("GET", `/api/sessions/${sessionId}/main-sync`, human);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId, branch: "main", behind: 1, ahead: 0, clean: true, conflicts: null, lastSyncedAt: null });
  });

  it("POST wendet an: applied, zweiter GET sieht behind 0 und lastSyncedAt gesetzt", async () => {
    const res = await call("POST", `/api/sessions/${sessionId}/main-sync`, human);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: "applied" });
    const after = await call("GET", `/api/sessions/${sessionId}/main-sync`, human);
    expect(after.body).toMatchObject({ behind: 0 });
    expect(typeof after.body.lastSyncedAt).toBe("string");
  });

  it("ADR-0102: ungültiger Body antwortet 400 statt still weiterzumachen", async () => {
    const res = await call("POST", `/api/sessions/${sessionId}/main-sync`, human, { conflictStrategy: "bogus" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("conflictStrategy");
  });

  it("ADR-0102: favor-session löst einen echten Konflikt gunsten der Session und nennt die Datei", async () => {
    const record = await sessions.create({ adapter: "idle", project: repo, prompt: "konflikt" }, "pc");
    const deadline = Date.now() + 8000;
    while (sessions.get(record.id)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const workdir = sessions.mainSyncCandidates().find((c) => c.sessionId === record.id)?.workdir;
    expect(workdir).toBeTruthy();
    // Session-Seite und Origin-Seite ändern dieselbe Datei — Default wäre `conflict`.
    await writeFile(join(workdir!, "gemeinsam.txt"), "session\n");
    await git(["-C", workdir!, "add", "-A"]);
    await git(["-C", workdir!, "commit", "-q", "-m", "session-seite"]);
    const other = join(dir, "konflikt-other");
    await git(["clone", "-q", origin, other]);
    await git(["-C", other, "config", "user.email", "other@ancientvoid.local"]);
    await git(["-C", other, "config", "user.name", "ancientvoid other"]);
    await writeFile(join(other, "gemeinsam.txt"), "origin\n");
    await git(["-C", other, "add", "-A"]);
    await git(["-C", other, "commit", "-q", "-m", "origin-seite"]);
    await git(["-C", other, "push", "-q", "origin", "main"]);
    await rm(other, { recursive: true, force: true });

    const res = await call("POST", `/api/sessions/${record.id}/main-sync`, human, { conflictStrategy: "favor-session" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: "applied", autoResolved: ["gemeinsam.txt"] });
    const { stdout: inhalt } = await execFileAsync("git", ["-C", workdir!, "show", "HEAD:gemeinsam.txt"]);
    expect(inhalt).toBe("session\n");
    // Der alte Weg bleibt ehrlich: Default-Body bricht bei Konflikt ab.
  });

  it("Policy main-sync.apply: Agenten-Token schreibt nicht (403) — Menschenfläche", async () => {
    expect((await call("POST", `/api/sessions/${sessionId}/main-sync`, agent)).status).toBe(403);
  });

  it("BUG-0260: Projekt ohne Haupt-Fern — 501 mit Grund no_remote statt 502, auf GET und POST", async () => {
    const stille = join(dir, "ohne-fern-repo");
    await git(["init", "-q", "-b", "main", stille]);
    await git(["-C", stille, "config", "user.email", "test@ancientvoid.local"]);
    await git(["-C", stille, "config", "user.name", "ancientvoid test"]);
    await writeFile(join(stille, "a.txt"), "initial\n");
    await git(["-C", stille, "add", "-A"]);
    await git(["-C", stille, "commit", "-q", "-m", "initial"]);
    const record = await sessions.create({ adapter: "idle", project: stille, prompt: "arbeite" }, "pc");
    const deadline = Date.now() + 8000;
    while (sessions.get(record.id)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const get = await call("GET", `/api/sessions/${record.id}/main-sync`, human);
    expect(get.status).toBe(501);
    expect(get.body.reason).toBe("no_remote");
    const post = await call("POST", `/api/sessions/${record.id}/main-sync`, human);
    expect(post.status).toBe(501); // ohne Fern gibt es nichts anzuwenden — kein 502, kein Fehler-Event
  });

  it("409 ohne Worktree-Isolation (direkter Modus)", async () => {
    const db2 = new HubDatabase(":memory:");
    const tokens2 = new TokenService(db2);
    const registry2 = new AdapterRegistry();
    registry2.register("idle", () => ({
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
    }));
    const direct = new SessionManager(db2, new EventStore(dir), registry2, new ProcessRunner());
    const bare = await createHubApp({ sessions: direct, tokens: tokens2, registry: registry2, auth: { tokens: tokens2, enforceTailnetIdentity: false } });
    const record = await direct.create({ adapter: "idle", project: dir, prompt: "direkt" }, "pc");
    const deadline = Date.now() + 8000;
    while (direct.get(record.id)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const res = await bare.inject({ method: "GET", url: `/api/sessions/${record.id}/main-sync`, headers: { authorization: `Bearer ${tokens2.issue("pixel").token}` } });
    expect(res.statusCode).toBe(409);
    const post = await bare.inject({ method: "POST", url: `/api/sessions/${record.id}/main-sync`, headers: { authorization: `Bearer ${tokens2.issue("pixel").token}` }, payload: {} });
    expect(post.statusCode).toBe(409);
    await direct.shutdown();
    await bare.close();
  });

  it("Aktionsknopf-Roundtrip: pushNotification mit action → /api/notifications liefert ihn geparst zurück (Migration 38)", async () => {
    const stored = sessions.pushNotification(
      sessionId,
      { level: "warning", title: "Repo · 2 Commits hinter main", detail: "origin/main ist vorgerückt", kind: "mainsync.behind_ask" },
      { label: "Jetzt aktualisieren", method: "POST", path: `/api/sessions/${sessionId}/main-sync` },
    );
    expect(stored?.action).toEqual({ label: "Jetzt aktualisieren", method: "POST", path: `/api/sessions/${sessionId}/main-sync` });
    const res = await app.inject({ method: "GET", url: "/api/notifications?after=0&limit=10", headers: { authorization: `Bearer ${human}` } });
    const items = (res.json() as { items: Array<{ kind: string; action?: { label: string } | null }> }).items;
    const ours = items.find((i) => i.kind === "mainsync.behind_ask");
    expect(ours?.action).toEqual({ label: "Jetzt aktualisieren", method: "POST", path: `/api/sessions/${sessionId}/main-sync` });
    // Bestand ohne Aktion bleibt ohne (additiv)
    expect(items.some((i) => i.action === null || i.action === undefined)).toBe(true);
  });
});
