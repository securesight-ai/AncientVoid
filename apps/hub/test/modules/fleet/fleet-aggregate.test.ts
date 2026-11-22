import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { FLEET_PROTOCOL_VERSION } from "@ancientvoid/contracts";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../../../src/app.ts";

interface Hub {
  app: FastifyInstance;
  url: string;
  token: string;
  tokens: TokenService;
  sessions: SessionManager;
  dir: string;
}

async function hub(hostId: string, port = 0, hostLabel?: string): Promise<Hub> {
  const dir = await mkdtemp(join(tmpdir(), `ancientvoid-${hostId}-`));
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 1 });
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const token = tokens.issue("phone").token;
  const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId, ...(hostLabel ? { hostLabel } : {}) });
  await app.listen({ port, host: "127.0.0.1" });
  return { app, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`, token, tokens, sessions, dir };
}

async function call<T>(h: Hub, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await h.app.inject({
    method: body === undefined ? "GET" : "POST",
    url: path,
    headers: { authorization: `Bearer ${h.token}` },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, body: res.json() as T };
}

interface Fleet {
  self: string;
  hosts: { hostId: string; label?: string; self: boolean; state: string; lastSyncAt: string | null; detail: string | null; sessions: number }[];
  sessions: { id: string; hostId: string; project: string }[];
}

describe("fleet overview (T6.3, AC-P6-1/AC-P6-3)", () => {
  let home: Hub;
  let peer: Hub;

  beforeAll(async () => {
    home = await hub("workstation", 0, "Configured home label");
    peer = await hub("home-server");
    const invite = await call<{ code: string }>(peer, "/api/fleet/invites", {});
    expect((await call(home, "/api/fleet/peers", { url: peer.url, code: invite.body.code })).status).toBe(201);
  });

  afterAll(async () => {
    for (const h of [home, peer]) {
      await h.sessions.shutdown().catch(() => undefined);
      await h.app.close().catch(() => undefined);
      await rm(h.dir, { recursive: true, force: true });
    }
  });

  it("BUG-0089: own overview label respects hostLabel, consistent with hello; default remains hostname", async () => {
    const own = (await call<Fleet>(home, "/api/fleet")).body.hosts.find(h => h.self);
    expect(own?.label).toBe("Configured home label");
    const hello = await home.app.inject({ method: "GET", url: "/api/fleet/hello" });
    expect(hello.json().label).toBe(own?.label);
    const fallback = (await call<Fleet>(peer, "/api/fleet")).body.hosts.find(h => h.self);
    expect(fallback?.label).toBe(hostname());
  });

  it("lists every host's sessions with its host id, same project names apart", async () => {
    await call(home, "/api/sessions", { adapter: "dummy", project: home.dir });
    await call(peer, "/api/sessions", { adapter: "dummy", project: peer.dir });
    await call(peer, "/api/sessions", { adapter: "dummy", project: peer.dir });
    const fleet = (await call<Fleet>(home, "/api/fleet")).body;
    expect(fleet.self).toBe("workstation");
    expect(fleet.hosts.map((h) => [h.hostId, h.self, h.state, h.sessions])).toEqual([
      ["workstation", true, "reachable", 1],
      ["home-server", false, "reachable", 2],
    ]);
    expect(fleet.sessions.filter((s) => s.hostId === "home-server")).toHaveLength(2);
    const keys = fleet.sessions.map((s) => `${s.hostId}/${s.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps a host's last state with its original time when it goes away", async () => {
    const before = (await call<Fleet>(home, "/api/fleet")).body.hosts.find((h) => h.hostId === "home-server")!;
    await peer.app.close();
    const after = (await call<Fleet>(home, "/api/fleet")).body;
    const host = after.hosts.find((h) => h.hostId === "home-server")!;
    expect(host.state).toBe("stale");
    expect(host.lastSyncAt).toBe(before.lastSyncAt);
    expect(after.sessions.filter((s) => s.hostId === "home-server")).toHaveLength(2);
    expect(after.hosts.find((h) => h.self)?.state).toBe("reachable");
  });

  it("names a stopped host offline, not incompatible (tailscale serve answers 502 with no body)", async () => {
    // Der Fall vom 21.11.2026: kaisgamingdesk hatte `tailscale serve` laufen, aber
    // keinen Hub-Prozess mehr — jede Antwort war 502 ohne JSON. Vorher las die
    // Flotte das als „Protokoll undefined statt 1“ (inkompatibel) und schob die
    // Schuld auf eine angebliche Versionsdifferenz.
    let alive = true;
    const server = createServer((req, res) => {
      if (!alive) {
        res.writeHead(502, { "content-type": "text/html" });
        res.end("Hub nicht erreichbar");
        return;
      }
      if (req.url === "/api/fleet/hello") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ hostId: "gamingdesk", protocolVersion: FLEET_PROTOCOL_VERSION, hubVersion: "0.1.0", serverTime: new Date().toISOString() }));
      } else if (req.url === "/api/fleet/pair") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ token: "avt_stubtoken" }));
      } else if (req.url === "/api/sessions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("[]");
      } else {
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      expect((await call(home, "/api/fleet/peers", { url, code: "STUBCODE" })).status).toBe(201);
      alive = false;
      const host = (await call<Fleet>(home, "/api/fleet")).body.hosts.find((h) => h.hostId === "gamingdesk")!;
      expect(host.state).toBe("offline");
      expect(host.detail).toContain("Antwort 502");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("names a revoked pairing instead of pretending the host is fine", async () => {
    const other = await hub("gpubox");
    try {
      const invite = await call<{ code: string }>(other, "/api/fleet/invites", {});
      await call(home, "/api/fleet/peers", { url: other.url, code: invite.body.code });
      other.tokens.revoke("fleet:workstation");
      const fleet = (await call<Fleet>(home, "/api/fleet")).body;
      expect(fleet.hosts.find((h) => h.hostId === "gpubox")?.state).toBe("unauthorized");
    } finally {
      await other.sessions.shutdown();
      await other.app.close();
      await rm(other.dir, { recursive: true, force: true });
    }
  });
});
