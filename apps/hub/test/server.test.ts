import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService, ApprovalService, WebAuthnStore } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../src/app.ts";
import { isQmdAvailable, removeIndex } from "../src/modules/search/search.ts";

describe("hub server", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  let baseUrl: string;
  let tokens: TokenService;
  let sessions: SessionManager;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 10, autoStopAfterEvents: 25 });
    sessions = new SessionManager(db, store, registry, new ProcessRunner());
    tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("health stays open without auth (tailnet monitoring)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().status).toBe("ok");
    expect(res.json().checks.database.ok).toBe(true);
  });

  it("rejects requests without device token (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(401);
  });

  it("BUG-0006: does not gate non-/api/ paths behind a token", async () => {
    // The PWA shell (index.html, its JS/CSS bundle, manifest, sw.js) must
    // be reachable without a token — a real browser never carries a
    // URL's ?token= onto the <script>/<link> requests the document
    // triggers, so gating the shell itself made TokenGate unreachable on
    // a fresh device. No pwaDir is configured in this test app, so the
    // request 404s past Fastify's default handler — the point here is
    // that it's NOT 401, proving the auth hook let it through.
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).not.toBe(401);
  });

  it("still gates every /api/ path, including ones added after auth.ts's exemption list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/does-not-exist/events" });
    expect(res.statusCode).toBe(401);
  });

  it("T2.4: /api/approvals answers a real 501 when no ApprovalService is configured, not a crash or a 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/approvals",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(501);
  });

  it("T2.5: /api/webauthn/status answers a real 501 when webauthn isn't configured", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/webauthn/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(501);
  });

  it("rejects invalid tokens (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts valid device tokens", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("ADR-0004: GET /api/adapters/:id/usage reports supported+no-snapshot honestly for an adapter without usage", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/adapters/dummy/usage",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    // dummy: capabilities().usage === false — never guessed as 0% or omitted.
    expect(res.json()).toEqual({ adapterId: "dummy", supported: false, quota: null, observedAt: null });
  });

  it("GET /api/adapters/:id/usage 404s for an unregistered adapter id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/adapters/does-not-exist/usage",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("creates a session via POST /api/sessions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    expect(res.statusCode).toBe(201);
    const record = res.json() as { id: string; status: string };
    expect(record.status).toBe("working");
  });

  it("rejects invalid session specs (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces tailnet identity when configured", async () => {
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const t = tokens.issue("tailnet-test").token;
    const strictApp = await createHubApp({
      sessions: new SessionManager(
        db,
        new EventStore(join(dir, "strict")),
        new AdapterRegistry(),
        new ProcessRunner(),
      ),
      tokens,
      registry: new AdapterRegistry(),
      auth: { tokens, enforceTailnetIdentity: true },
    });
    const noHeader = await strictApp.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${t}` },
    });
    expect(noHeader.statusCode).toBe(401);
    const withHeader = await strictApp.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${t}`, "tailscale-user-login": "jan@tailnet" },
    });
    expect(withHeader.statusCode).toBe(200);
    await strictApp.close();
  });

  async function createTailSession(): Promise<string> {
    const created = await app.inject({
      method: "POST", url: "/api/sessions", headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    await sessions.stop(id);
    return id;
  }

  it("WS tail closes a header-authenticated socket when the device token is revoked", async () => {
    const id = await createTailSession();
    const device = tokens.issue("header-tail-device");
    const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/api/events/${id}/tail`, {
      headers: { authorization: `Bearer ${device.token}` },
    });
    try {
      await once(ws, "open");
      const pong = once(ws, "message");
      ws.send(JSON.stringify({ type: "ping" }));
      expect(JSON.parse(String((await pong)[0]))).toEqual({ type: "pong" });
      const closed = once(ws, "close", { signal: AbortSignal.timeout(3_500) });
      tokens.revoke(device.label);
      expect((await closed)[0]).toBe(4401);
    } finally {
      ws.terminate();
    }
  });

  it("WS tail tickets are scoped, single-use and subject to device revocation", async () => {
    const id = await createTailSession();
    const path = `/api/events/${id}/tail`;
    const device = tokens.issue("ticket-tail-device");
    const issue = () => app.inject({
      method: "POST", url: `${path}-ticket`, headers: { authorization: `Bearer ${device.token}` },
    });
    const queryIssuer = await app.inject({ method: "POST", url: `${path}-ticket?token=${device.token}` });
    expect(queryIssuer.statusCode).toBe(401);
    const issued = await issue();
    expect(issued.statusCode).toBe(201);
    expect(issued.headers["cache-control"]).toBe("no-store");
    const { ticket } = issued.json<{ ticket: string }>();
    const expiring = (await issue()).json<{ ticket: string; expiresAt: number }>();
    const revoked = (await issue()).json<{ ticket: string }>();
    const base = baseUrl.replace("http", "ws");
    async function denied(path: string): Promise<void> {
      const ws = new WebSocket(`${base}${path}`);
      try {
        expect((await once(ws, "close"))[0]).toBe(4401);
      } finally {
        ws.terminate();
      }
    }
    await denied(`${path}?token=${device.token}`);
    await denied(`${path}?ticket=invalid`);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiring.expiresAt);
    try {
      await denied(`${path}?ticket=${expiring.ticket}`);
    } finally {
      clock.mockRestore();
    }
    await denied(`/api/events/${crypto.randomUUID()}/tail?ticket=${ticket}`);
    const ws = new WebSocket(`${base}${path}?ticket=${ticket}`);
    try {
      await once(ws, "open");
      const pong = once(ws, "message");
      ws.send(JSON.stringify({ type: "ping" }));
      expect(JSON.parse(String((await pong)[0]))).toEqual({ type: "pong" });
      await denied(`${path}?ticket=${ticket}`);
      const closed = once(ws, "close", { signal: AbortSignal.timeout(3_500) });
      tokens.revoke(device.label);
      expect((await closed)[0]).toBe(4401);
      await denied(`${path}?ticket=${revoked.ticket}`);
    } finally {
      ws.terminate();
    }
  });

  it("hubctl tail -f prints events and exits when its device is revoked", async () => {
    const id = await createTailSession();
    const device = tokens.issue("hubctl-tail-device");
    const cli = fileURLToPath(new URL("../../hubctl/src/cli.ts", import.meta.url));
    const child = spawn(process.execPath, [cli, "tail", id, "-f"], {
      env: { ...process.env, ANCIENTVOID_URL: baseUrl, ANCIENTVOID_TOKEN: device.token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let error = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { error += chunk; });
    try {
      const exited = once(child, "close");
      const [chunk] = await Promise.race([
        once(child.stdout, "data", { signal: AbortSignal.timeout(5_000) }),
        exited.then(([code]) => { throw new Error(`hubctl exited early (${code}): ${error}`); }),
      ]);
      expect(String(chunk)).toMatch(/#\s*1\s/);
      tokens.revoke(device.label);
      expect((await exited)[0]).toBe(1);
      expect(error).toContain("4401");
    } finally {
      child.kill();
    }
  });

  it("hubctl tail -f survives a hub that is briefly unreachable", async () => {
    let posts = 0;
    const hellos: number[] = [];
    const wss = new WebSocketServer({ noServer: true });
    const stub = createServer((req, res) => {
      posts += 1;
      // Neustart: erst keine Verbindung, dann ein Proxy ohne Upstream.
      if (posts === 2) {
        req.socket.destroy();
        return;
      }
      res.writeHead(posts === 3 ? 502 : 201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ticket: `ticket-${posts}`, expiresAt: Date.now() + 30_000 }));
    });
    stub.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (raw: Buffer) => {
        hellos.push((JSON.parse(String(raw)) as { lastSeq: number }).lastSeq);
        const seq = hellos.length;
        const event = { seq, ts: "2026-11-25T00:00:00.000Z", type: "message", summary: `Ereignis ${seq}` };
        ws.send(JSON.stringify({ type: "events", sessionId: "s", events: [event], highWater: seq, dropped: false }));
        ws.close(hellos.length === 1 ? 1012 : 1000);
      });
    }));
    await new Promise<void>((resolve) => { stub.listen(0, "127.0.0.1", resolve); });
    const cli = fileURLToPath(new URL("../../hubctl/src/cli.ts", import.meta.url));
    const child = spawn(process.execPath, [cli, "tail", "s", "-f"], {
      env: { ...process.env, ANCIENTVOID_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`, ANCIENTVOID_TOKEN: "t" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let error = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { error += chunk; });
    child.stdout.resume();
    try {
      const [code] = await once(child, "close", { signal: AbortSignal.timeout(12_000) });
      expect({ code, error }).toEqual({ code: 0, error: "" });
      expect(hellos).toEqual([0, 1]);
      expect(posts).toBe(4);
    } finally {
      child.kill();
      wss.close();
      stub.close();
    }
  }, 15_000);

  it("WS tail: hello → events flow with gapless seq deltas", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    const { id } = created.json() as { id: string };
    const wsUrl = baseUrl.replace("http", "ws");
    const ws = new WebSocket(`${wsUrl}/api/events/${id}/tail`, { headers: { authorization: `Bearer ${token}` } });
    const received: { type: string; events?: { seq: number }[]; highWater?: number }[] = [];
    const done = new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as { type: string; events?: { seq: number }[] };
        received.push(msg);
        if (received.filter((m) => m.type === "events" && (m.events?.length ?? 0) > 0).length >= 2) {
          ws.close();
          resolve();
        }
      });
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", lastSeq: 0 })));
      setTimeout(() => reject(new Error("ws timeout")), 8000);
    });
    await done;

    const eventBatches = received.filter((m) => m.type === "events");
    let prev = 0;
    for (const batch of eventBatches) {
      for (const e of batch.events ?? []) {
        expect(e.seq).toBe(prev + 1);
        prev = e.seq;
      }
    }
    expect(prev).toBeGreaterThan(2);
  });

  it("WS resync: client-requested replay from store fills gaps", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    const { id } = created.json() as { id: string };
    await new Promise((r) => setTimeout(r, 400));
    const wsUrl = baseUrl.replace("http", "ws");
    const ws = new WebSocket(`${wsUrl}/api/events/${id}/tail`, { headers: { authorization: `Bearer ${token}` } });
    const resynced = new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as { type: string; events?: { seq: number }[] };
        if (msg.type === "events" && (msg.events?.length ?? 0) > 3) {
          const seqs = (msg.events ?? []).map((e) => e.seq);
          expect(seqs[0]).toBe(1); // resync from 0 replays from the first event
          ws.close();
          resolve();
        }
      });
      ws.on("open", () => ws.send(JSON.stringify({ type: "resync", since: 0 })));
      setTimeout(() => reject(new Error("ws resync timeout")), 8000);
    });
    await resynced;
  });

  it("404s GET /api/sessions/:id/diff for an unknown session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions/nope/diff",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/sessions/:id/diff returns a real diff for a session in a real git repo (T1.6-4/5)", async () => {
    const { mkdtemp: mkdtempFs, writeFile } = await import("node:fs/promises");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const repo = await mkdtempFs(join(tmpdir(), "ancientvoid-diff-repo-"));
    await execFileAsync("git", ["init", "-q", repo]);
    await execFileAsync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", repo, "config", "user.name", "Test"]);
    await writeFile(join(repo, "a.txt"), "one\n");
    await execFileAsync("git", ["-C", repo, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repo, "commit", "-q", "-m", "init"]);
    await writeFile(join(repo, "a.txt"), "one\ntwo\n");

    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: repo },
    });
    const { id } = created.json() as { id: string };
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${id}/diff`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { files: { path: string; additions: number }[]; patch: string };
    expect(body.files).toMatchObject([{ path: "a.txt", additions: 1, deletions: 0, binary: false }]);
    expect(body.patch).toContain("+two");
    await rm(repo, { recursive: true, force: true });
  });
});

describe("hub server — pwaDir resolution (BUG-0009)", () => {
  async function buildApp(pwaDir?: string) {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-pwa-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      ...(pwaDir ? { pwaDir } : {}),
    });
    return { app, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("a pwaDir that doesn't resolve to an existing directory doesn't crash the app and still serves /api/*", async () => {
    // Found via a real end-to-end run: the shipped hub.config.example.json
    // had a pwaDir that resolved outside the repo when the README's own
    // Quick Start was followed literally (cp to repo root, run from repo
    // root) — this used to fail with zero log output, just a bare 404 on
    // every non-/api/ request with no clue why.
    const { app, cleanup } = await buildApp("./this-directory-does-not-exist");
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(404);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("a valid pwaDir serves the SPA shell for non-/api/ routes", async () => {
    const pwaDir = await mkdtemp(join(tmpdir(), "ancientvoid-pwa-dist-"));
    await import("node:fs/promises").then((fs) => fs.writeFile(join(pwaDir, "index.html"), "<!doctype html><title>ancientvoid</title>"));
    const { app, cleanup } = await buildApp(pwaDir);
    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain("ancientvoid");
      // SPA fallback: any non-/api/ path (client-side routing) serves the
      // same shell, not a 404.
      const spaRoute = await app.inject({ method: "GET", url: "/some/client/route" });
      expect(spaRoute.statusCode).toBe(200);
      expect(spaRoute.body).toContain("ancientvoid");
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(pwaDir, { recursive: true, force: true });
    }
  });
});

describe("hub server — project auto-discovery (T1.5-4, AC-P1.5-4/5)", () => {
  async function buildApp(projectRoots: string[]) {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-projects-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("test-device").token;
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots,
    });
    return { app, token, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("GET /api/projects lists real repos under a configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-projects-root-"));
    const repo = join(root, "AncientVoid");
    await import("node:fs/promises").then((fs) => fs.mkdir(join(repo, ".git"), { recursive: true }));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { projects: { name: string; path: string }[]; warnings: string[] };
      expect(body.warnings).toEqual([]);
      expect(body.projects.map((p) => p.name)).toEqual(["AncientVoid"]);
      expect(body.projects[0]!.path).toBe(repo);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("POST /api/sessions rejects a project path outside the configured roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-projects-root-"));
    const outside = await mkdtemp(join(tmpdir(), "ancientvoid-projects-outside-"));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "dummy", project: outside },
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("POST /api/sessions accepts a project path inside a configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-projects-root-"));
    const repo = join(root, "AncientVoid");
    await import("node:fs/promises").then((fs) => fs.mkdir(repo, { recursive: true }));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "dummy", project: repo },
      });
      expect(res.statusCode).toBe(201);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("hub server — POST /api/prompt-enhance (T1.5-8)", () => {
  async function buildApp(projectRoots: string[]) {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-enhance-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    // BUG-0061: a dsh ACP registration under a free-form id — same shape
    // as a real hub.config.json entry (module @ancientvoid/adapter-acp, preset dsh).
    registry.register("deepseek", createDummy, { preset: "dsh" }, "@ancientvoid/adapter-acp");
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("test-device").token;
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots,
    });
    return { app, token, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("reports per-registration enhance support in /api/adapters — true for dsh ACP, false for dummy (BUG-0061)", async () => {
    const { app, token, cleanup } = await buildApp([]);
    try {
      const res = await app.inject({ method: "GET", url: "/api/adapters", headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(200);
      const adapters = res.json() as { id: string; enhance: boolean }[];
      // 2026-10-25: enhancePrompt falls back to opencode for ANY adapter —
      // the per-registration flag is true everywhere now (Verbessern-Button
      // must never be dead for a valid adapter selection).
      expect(adapters.find((a) => a.id === "deepseek")?.enhance).toBe(true);
      expect(adapters.find((a) => a.id === "dummy")?.enhance).toBe(true);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("400s on an invalid body (missing project)", async () => {
    const { app, token, cleanup } = await buildApp([]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/prompt-enhance",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "claude", text: "hello" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("422s when the project path is outside configured projectRoots — same guard as session creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-enhance-root-"));
    const outside = await mkdtemp(join(tmpdir(), "ancientvoid-enhance-outside-"));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/prompt-enhance",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "claude", text: "hello", project: outside },
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("falls back to opencode when the adapter has no native enhancer", async () => {
    // Hermetisch: das echte `opencode` der Maschine (Netz, Login) ließ den Test sporadisch ins Timeout laufen.
    vi.stubEnv("PATH", "");
    const { app, token, cleanup } = await buildApp([]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/prompt-enhance",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "dummy", text: "hello", project: "/tmp" },
      });
      // 2026-10-25: fallback to opencode — never "no enhancer wired up".
      expect(res.statusCode).toBe(502);
      expect(res.json().error ?? "").not.toContain("no enhancer wired up");
    } finally {
      vi.unstubAllEnvs();
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });
});

describe("hub server — GET /api/skills (T1.5-10)", () => {
  async function buildApp(projectRoots: string[]) {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-skills-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("test-device").token;
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots,
    });
    return { app, token, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("400s without a project query param", async () => {
    const { app, token, cleanup } = await buildApp([]);
    try {
      const res = await app.inject({ method: "GET", url: "/api/skills", headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("422s when the project is outside configured projectRoots", async () => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-skills-root-"));
    const outside = await mkdtemp(join(tmpdir(), "ancientvoid-skills-outside-"));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/skills?project=${encodeURIComponent(outside)}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns a real project's skills/agents when the project is allowed", async () => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-skills-root-"));
    const repo = join(root, "repo");
    const skillDir = join(repo, ".claude", "skills", "demo");
    await import("node:fs/promises").then((fs) => fs.mkdir(skillDir, { recursive: true }));
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: a demo skill\n---\n"),
    );
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/skills?project=${encodeURIComponent(repo)}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: { kind: string; name: string; layer?: string }[] };
      expect(body.items).toEqual(
        expect.arrayContaining([
          { kind: "skill", name: "demo", description: "a demo skill" },
          expect.objectContaining({ kind: "skill", name: "task", layer: "base" }),
        ]),
      );
      expect(body.items.filter((item) => item.layer === "base").map((item) => item.name).sort()).toEqual([
        "change",
        "investigate",
        "review",
        "task",
      ]);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("hub server — approval queue, real end-to-end (T2.4/T2.6, ADR-0007)", () => {
  async function buildApp() {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-approvals-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const approvals = new ApprovalService(db, 60_000);
    const sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, approvals);
    const tokens = new TokenService(db);
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      approvals,
    });
    return { app, tokens, approvals, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("a steer(prompt) is parked as a pending write-class approval instead of reaching the adapter immediately", async () => {
    const { app, tokens, cleanup } = await buildApp();
    try {
      const deviceToken = tokens.issue("reviewer-phone").token;
      const created = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { adapter: "dummy", project: "/tmp" },
      });
      const { id: sessionId } = created.json() as { id: string };

      const steer = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/steer`,
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { kind: "prompt", text: "refactor the auth flow" },
      });
      expect(steer.statusCode).toBe(422); // ack.ok === false, same as any other rejected steer
      expect((steer.json() as { detail?: string }).detail).toMatch(/pending approval/);

      const list = await app.inject({
        method: "GET",
        url: "/api/approvals?status=pending",
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      const pending = list.json() as { id: string; class: string; action: string; sessionId: string }[];
      expect(pending).toHaveLength(1);
      expect(pending[0]!.class).toBe("write");
      expect(pending[0]!.action).toBe("steer.prompt");
      expect(pending[0]!.sessionId).toBe(sessionId);

      // Not yet applied — the adapter never saw the prompt.
      const eventsBefore = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}/events`,
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      expect(JSON.stringify(eventsBefore.json())).not.toContain("refactor the auth flow");
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("approving the pending request really forwards the prompt to the adapter, signed by the approving device", async () => {
    const { app, tokens, cleanup } = await buildApp();
    try {
      const creatorToken = tokens.issue("reviewer-phone").token;
      const approverToken = tokens.issue("second-device").token;
      const created = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${creatorToken}` },
        payload: { adapter: "dummy", project: "/tmp" },
      });
      const { id: sessionId } = created.json() as { id: string };
      await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/steer`,
        headers: { authorization: `Bearer ${creatorToken}` },
        payload: { kind: "prompt", text: "refactor the auth flow" },
      });
      const pendingList = (
        await app.inject({
          method: "GET",
          url: "/api/approvals?status=pending",
          headers: { authorization: `Bearer ${creatorToken}` },
        })
      ).json() as { id: string }[];
      const approvalId = pendingList[0]!.id;

      const decide = await app.inject({
        method: "POST",
        url: `/api/approvals/${approvalId}/decide`,
        headers: { authorization: `Bearer ${approverToken}` },
        payload: { decision: "approve" },
      });
      expect(decide.statusCode).toBe(200);
      const decided = decide.json() as { status: string; decidedByLabel: string; signature: string | null };
      expect(decided.status).toBe("approved");
      expect(decided.decidedByLabel).toBe("second-device"); // real device attribution, not the creator
      expect(decided.signature).not.toBeNull();

      // Real proof the adapter actually received it now (dummy emits a
      // "user" event echoing the steered text — see adapter-dummy/src/index.ts).
      let sawIt = false;
      for (let i = 0; i < 40 && !sawIt; i++) {
        const events = await app.inject({
          method: "GET",
          url: `/api/sessions/${sessionId}/events`,
          headers: { authorization: `Bearer ${creatorToken}` },
        });
        sawIt = JSON.stringify(events.json()).includes("refactor the auth flow");
        if (!sawIt) await new Promise((r) => setTimeout(r, 25));
      }
      expect(sawIt).toBe(true);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("rejecting the pending request never forwards the prompt", async () => {
    const { app, tokens, cleanup } = await buildApp();
    try {
      const deviceToken = tokens.issue("reviewer-phone").token;
      const created = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { adapter: "dummy", project: "/tmp" },
      });
      const { id: sessionId } = created.json() as { id: string };
      await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/steer`,
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { kind: "prompt", text: "delete everything" },
      });
      const approvalId = (
        (
          await app.inject({
            method: "GET",
            url: "/api/approvals?status=pending",
            headers: { authorization: `Bearer ${deviceToken}` },
          })
        ).json() as { id: string }[]
      )[0]!.id;

      const decide = await app.inject({
        method: "POST",
        url: `/api/approvals/${approvalId}/decide`,
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { decision: "reject", reason: "not now" },
      });
      expect((decide.json() as { status: string }).status).toBe("rejected");

      await new Promise((r) => setTimeout(r, 100));
      const events = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}/events`,
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      expect(JSON.stringify(events.json())).not.toContain("delete everything");

      // T2.8: the rejection itself is a real audit event on the SESSION's
      // own tail, not only a row in the separate approvals table — a
      // reviewer reading just this session's history must be able to see
      // that a prompt was requested and denied, and by whom.
      const decided = (events.json() as { payload: { kind?: string; status?: string; actor?: string } }[]).find(
        (e) => e.payload.kind === "session.approval_decided",
      );
      expect(decided).toBeDefined();
      expect(decided!.payload.status).toBe("rejected");
      expect(decided!.payload.actor).toBe("reviewer-phone");
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("AC-P2-5-adjacent: a destructive approval is refused with 422 through the real route, never silently approved", async () => {
    const { app, tokens, approvals, cleanup } = await buildApp();
    try {
      const deviceToken = tokens.issue("reviewer-phone").token;
      const req = approvals.create("some-session", "destructive", "force-push", "force-push origin main");
      const decide = await app.inject({
        method: "POST",
        url: `/api/approvals/${req.id}/decide`,
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { decision: "approve", reason: "CI is broken" },
      });
      expect(decide.statusCode).toBe(422);
      expect(JSON.stringify(decide.json())).toMatch(/WebAuthn/);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });
});

describe("hub server — WebAuthn routes (T2.5)", () => {
  // Real cryptographic ceremonies (attestation/assertion) need an actual
  // browser + authenticator — verified live with Playwright's CDP virtual
  // authenticator against a real running hub (see EPIC-P2's T2.5 evidence),
  // not fabricated here. These tests cover the parts that don't require a
  // real ceremony: option-generation shape, and refusing to proceed
  // without a registered credential.
  async function buildApp() {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-webauthn-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const approvals = new ApprovalService(db, 60_000);
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const webauthnStore = new WebAuthnStore(db);
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      approvals,
      webauthn: { store: webauthnStore, config: { rpId: "localhost", rpName: "AncientVoid test", origin: "http://localhost" } },
    });
    return { app, tokens, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("register/options returns a real PublicKeyCredentialCreationOptionsJSON shape", async () => {
    const { app, tokens, cleanup } = await buildApp();
    try {
      const deviceToken = tokens.issue("phone-a").token;
      const res = await app.inject({
        method: "POST",
        url: "/api/webauthn/register/options",
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { rp: { id: string; name: string }; user: { name: string }; challenge: string };
      expect(body.rp.id).toBe("localhost");
      expect(body.user.name).toBe("phone-a");
      expect(typeof body.challenge).toBe("string");
      expect(body.challenge.length).toBeGreaterThan(10);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("assert-options refuses with a named reason when no passkey is registered for this device yet", async () => {
    const { app, tokens, cleanup } = await buildApp();
    try {
      const deviceToken = tokens.issue("phone-b").token;
      const created = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { adapter: "dummy", project: "/tmp" },
      });
      const { id: sessionId } = created.json() as { id: string };
      const res = await app.inject({
        method: "POST",
        url: `/api/approvals/does-not-matter/webauthn/assert-options`,
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.stringify(res.json())).toMatch(/no passkey registered/);
      void sessionId;
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("status reflects whether the caller's own device has a registered credential", async () => {
    const { app, tokens, cleanup } = await buildApp();
    try {
      const deviceToken = tokens.issue("phone-c").token;
      const res = await app.inject({
        method: "GET",
        url: "/api/webauthn/status",
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ registered: false });
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });
});

describe("hub server — budget top-up (T2.7)", () => {
  async function buildApp(withApprovals: boolean) {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-budget-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const approvals = withApprovals ? new ApprovalService(db, 60_000) : undefined;
    const sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, approvals);
    const tokens = new TokenService(db);
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      ...(approvals ? { approvals } : {}),
    });
    return { app, tokens, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("without approvals configured, applies a budget change immediately", async () => {
    const { app, tokens, cleanup } = await buildApp(false);
    try {
      const deviceToken = tokens.issue("d").token;
      const created = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { adapter: "dummy", project: "/tmp", budgetUsd: 1 },
      });
      const { id } = created.json() as { id: string };
      const res = await app.inject({
        method: "POST",
        url: `/api/sessions/${id}/budget`,
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { budgetUsd: 10 },
      });
      expect(res.statusCode).toBe(200);
      const session = await app.inject({
        method: "GET",
        url: `/api/sessions/${id}`,
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      expect((session.json() as { budgetUsd: number }).budgetUsd).toBe(10);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("with approvals configured, requires a reason and only applies after real approval", async () => {
    const { app, tokens, cleanup } = await buildApp(true);
    try {
      const deviceToken = tokens.issue("d").token;
      const created = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { adapter: "dummy", project: "/tmp", budgetUsd: 1 },
      });
      const { id } = created.json() as { id: string };
      const request = await app.inject({
        method: "POST",
        url: `/api/sessions/${id}/budget`,
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { budgetUsd: 10 },
      });
      expect(request.statusCode).toBe(422); // pending, not applied yet
      const pending = (
        await app.inject({
          method: "GET",
          url: "/api/approvals?status=pending",
          headers: { authorization: `Bearer ${deviceToken}` },
        })
      ).json() as { id: string; reasonRequired: boolean; action: string }[];
      expect(pending[0]!.action).toBe("budget.increase");
      expect(pending[0]!.reasonRequired).toBe(true);

      const withoutReason = await app.inject({
        method: "POST",
        url: `/api/approvals/${pending[0]!.id}/decide`,
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { decision: "approve" },
      });
      expect(withoutReason.statusCode).toBe(422); // AC-P2-5: no reason, no approval

      const decide = await app.inject({
        method: "POST",
        url: `/api/approvals/${pending[0]!.id}/decide`,
        headers: { authorization: `Bearer ${deviceToken}` },
        payload: { decision: "approve", reason: "mehr Budget für Debugging" },
      });
      expect(decide.statusCode).toBe(200);

      const session = await app.inject({
        method: "GET",
        url: `/api/sessions/${id}`,
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      expect((session.json() as { budgetUsd: number }).budgetUsd).toBe(10);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });
});

describe("hub server — POST /api/prompt-optimizer/feedback (T3.9)", () => {
  it("501s when no dataDir is configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-optfb-501-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
    try {
      const token = tokens.issue("d").token;
      const res = await app.inject({
        method: "POST",
        url: "/api/prompt-optimizer/feedback",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "claude", project: "/tmp", original: "x", enhanced: "y", decision: "accepted", latencyMs: 1 },
      });
      expect(res.statusCode).toBe(501);
    } finally {
      await app.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("really writes a local JSONL entry when dataDir is configured — real file, no mock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-optfb-"));
    const dataDir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-optfb-data-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      dataDir,
    });
    try {
      const token = tokens.issue("d").token;
      const res = await app.inject({
        method: "POST",
        url: "/api/prompt-optimizer/feedback",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          adapter: "claude",
          project: "/tmp",
          original: "mach das besser",
          enhanced: "Ziel: ...",
          decision: "rejected",
          latencyMs: 3000,
        },
      });
      expect(res.statusCode).toBe(200);
      const raw = await readFile(join(dataDir, "prompt-optimizer-feedback.jsonl"), "utf8");
      const entry = JSON.parse(raw.trim());
      expect(entry.decision).toBe("rejected");
      expect(entry.original).toBe("mach das besser");
    } finally {
      await app.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

// T3.8: real HTTP routes, real `qmd`, gated the same way as
// apps/hub/test/search.test.ts's own tests — see that file's doc
// comment for why (an unusual, not-guaranteed-installed dependency).
const hasQmd = await isQmdAvailable();
const itQmd = hasQmd ? it : it.skip;

describe("hub server — /api/search* routes (T3.8)", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-search-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await removeIndex(dir).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects a missing project param with 400, not a crash", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=x", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
  });

  it("/api/search/status reports a real, never-indexed project honestly", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/search/status?project=${encodeURIComponent(dir)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.indexed).toBe(false);
  });

  itQmd(
    "a search on a never-indexed project starts real indexing (202) and later serves real results (200)",
    async () => {
      await writeFile(join(dir, "note.md"), "the launch code is banana-quasar-77", "utf8");
      const first = await app.inject({
        method: "GET",
        url: `/api/search?project=${encodeURIComponent(dir)}&q=launch+code`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(first.statusCode).toBe(202);
      expect(first.json()).toEqual({ status: "indexing", results: [] });

      // Real embedding of one tiny file — bounded, not instant.
      await new Promise((r) => setTimeout(r, 8000));

      const second = await app.inject({
        method: "GET",
        url: `/api/search?project=${encodeURIComponent(dir)}&q=launch+code+banana`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(second.statusCode).toBe(200);
      const body = second.json();
      expect(body.status).toBe("ready");
      expect(body.results.some((r: { file: string }) => r.file === "note.md")).toBe(true);
    },
    30_000,
  );

  it("/api/search/file reads a real file and rejects a path outside the project", async () => {
    await writeFile(join(dir, "hello.txt"), "hi there", "utf8");
    const ok = await app.inject({
      method: "GET",
      url: `/api/search/file?project=${encodeURIComponent(dir)}&path=hello.txt`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().content).toBe("hi there");

    const escape = await app.inject({
      method: "GET",
      url: `/api/search/file?project=${encodeURIComponent(dir)}&path=${encodeURIComponent("../../etc/passwd")}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(escape.statusCode).toBe(404);
  });

  it("/api/search/docs lists every markdown doc with its first heading, without qmd", async () => {
    await writeFile(join(dir, "readme.md"), "# Lesemich\n\nInhalt", "utf8");
    await mkdir(join(dir, "docs", "adr"), { recursive: true });
    await writeFile(join(dir, "docs", "adr", "0001.md"), "# Erste Entscheidung\n", "utf8");
    await writeFile(join(dir, "docs", "ohne-titel.md"), "nur Text", "utf8");
    await writeFile(join(dir, "ignored.txt"), "kein Markdown", "utf8");
    await mkdir(join(dir, "node_modules", "dep"), { recursive: true });
    await writeFile(join(dir, "node_modules", "dep", "pack.md"), "# weg hier", "utf8");

    const res = await app.inject({
      method: "GET",
      url: `/api/search/docs?project=${encodeURIComponent(dir)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const docs = res.json().docs as { path: string; title: string | null }[];
    const paths = docs.map((d) => d.path);
    // Der qmd-Test derselben Suite kann ein „note.md“ hinterlassen — hier
    // zählt, was dieser Test anlegt (und was nie auftaucht).
    expect(paths).toContain("readme.md");
    expect(paths).toContain("docs/adr/0001.md");
    expect(paths).toContain("docs/ohne-titel.md");
    expect(paths).not.toContain("ignored.txt");
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    expect(docs.find((d) => d.path === "readme.md")?.title).toBe("Lesemich");
    expect(docs.find((d) => d.path === "docs/ohne-titel.md")?.title).toBeNull();
  });
});

describe("hub server — session attachCmd (real user request 2026-09-19: same session on desktop + phone)", () => {
  it("omits attachCmd when the hub isn't tmux-backed — the default test setup (ProcessRunner)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-attach-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("t").token;
    // workerRunnerKind omitted — exactly what main.ts passes for a real
    // ProcessRunner fallback (runner.kind === "process").
    const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
    try {
      const record = await sessions.create({ adapter: "dummy", project: dir });
      const res = await app.inject({ method: "GET", url: `/api/sessions/${record.id}`, headers: { authorization: `Bearer ${token}` } });
      expect(res.json().attachCmd).toBeUndefined();
    } finally {
      await app.close().catch(() => undefined);
      await sessions.shutdown().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("includes the real tmux attach command only when the runner lists a live worker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-srv-attach-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const listed = new Set<string>();
    const runner = new ProcessRunner();
    const sessions = new SessionManager(db, store, registry, {
      kind: "process",
      isAvailable: () => runner.isAvailable(),
      spawn: (spec) => runner.spawn(spec),
      list: async () => [...listed].map((name) => ({ name, fullName: `ancientvoid-${name}` })),
      killByName: async () => undefined,
      reapOrphans: async () => [],
    });
    const tokens = new TokenService(db);
    const token = tokens.issue("t").token;
    // ADR-0011: the tmux flag alone is not a pane. CI often has no tmux
    // (ADR-0002), so the route asks the runner whether this session is listed.
    const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, workerRunnerKind: "tmux" });
    try {
      const record = await sessions.create({ adapter: "dummy", project: dir });
      const hidden = await app.inject({ method: "GET", url: `/api/sessions/${record.id}`, headers: { authorization: `Bearer ${token}` } });
      expect(hidden.json().attachCmd).toBeUndefined();
      listed.add(record.id);
      const res = await app.inject({ method: "GET", url: `/api/sessions/${record.id}`, headers: { authorization: `Bearer ${token}` } });
      expect(res.json().attachCmd).toBe(`tmux attach -t ancientvoid-${record.id}`);

      const list = await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${token}` } });
      expect(list.json()[0].attachCmd).toBe(`tmux attach -t ancientvoid-${record.id}`);

      await sessions.stop(record.id);
      const afterStop = await app.inject({ method: "GET", url: `/api/sessions/${record.id}`, headers: { authorization: `Bearer ${token}` } });
      // A stopped session's real tmux pane is gone (TmuxRunner kills it on
      // stop) — showing an attach command for it would point at nothing.
      expect(afterStop.json().attachCmd).toBeUndefined();
    } finally {
      await app.close().catch(() => undefined);
      await sessions.shutdown().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
