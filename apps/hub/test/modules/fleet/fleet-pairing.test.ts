import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
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

async function hub(hostId: string): Promise<Hub> {
  const dir = await mkdtemp(join(tmpdir(), `ancientvoid-${hostId}-`));
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, { eventsPerSecond: 20, autoStopAfterEvents: 0 });
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const token = tokens.issue("phone").token;
  const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`, token, tokens, sessions, dir };
}

async function call<T>(h: Hub, path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; body: T }> {
  const res = await h.app.inject({
    method: (init.method ?? (init.body === undefined ? "GET" : "POST")) as "GET",
    url: path,
    headers: { authorization: `Bearer ${init.token ?? h.token}` },
    ...(init.body === undefined ? {} : { payload: init.body as object }),
  });
  return { status: res.statusCode, body: res.json() as T };
}

describe("fleet pairing (T6.2, ADR-0017)", () => {
  let home: Hub;
  let peer: Hub;

  beforeAll(async () => {
    home = await hub("workstation");
    peer = await hub("home-server");
  });

  afterAll(async () => {
    for (const h of [home, peer]) {
      await h.sessions.shutdown();
      await h.app.close();
      await rm(h.dir, { recursive: true, force: true });
    }
  });

  it("pairs with a one-time code and never shows the peer token", async () => {
    const invite = await call<{ code: string; expiresAt: string }>(peer, "/api/fleet/invites", { body: {} });
    expect(invite.status).toBe(201);
    expect(invite.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const paired = await call<{ hostId: string; url: string }>(home, "/api/fleet/peers", { body: { url: peer.url, code: invite.body.code } });
    expect(paired.status).toBe(201);
    expect(paired.body).toMatchObject({ hostId: "home-server", url: peer.url });
    expect(JSON.stringify(paired.body)).not.toMatch(/token/i);

    const peers = await call<{ hostId: string }[]>(home, "/api/fleet/peers");
    expect(peers.body.map((p) => p.hostId)).toEqual(["home-server"]);
    expect(JSON.stringify(peers.body)).not.toMatch(/token/i);
    expect(peer.tokens.list().map((t) => t.label)).toContain("fleet:workstation");

    const reused = await call<{ error: string }>(home, "/api/fleet/peers", { body: { url: peer.url, code: invite.body.code } });
    expect(reused.status).toBe(422);
  });

  it("rejects a wrong code, an unknown URL scheme and pairing with itself", async () => {
    expect((await call(home, "/api/fleet/peers", { body: { url: peer.url, code: "AAAA-BBBB-CCCC" } })).status).toBe(422);
    expect((await call(home, "/api/fleet/peers", { body: { url: "file:///etc/passwd", code: "AAAA-BBBB-CCCC" } })).status).toBe(400);
    const own = await call<{ code: string }>(home, "/api/fleet/invites", { body: {} });
    expect((await call(home, "/api/fleet/peers", { body: { url: home.url, code: own.body.code } })).status).toBe(422);
  });

  it("limits a fleet token to the routable paths", async () => {
    const fleetToken = peer.tokens.issue("fleet:test-home").token;
    expect((await call(peer, "/api/sessions", { token: fleetToken })).status).toBe(200);
    expect((await call(peer, "/api/tokens", { token: fleetToken })).status).toBe(403);
    expect((await call(peer, "/api/fleet/invites", { body: {}, token: fleetToken })).status).toBe(403);
    expect((await call(peer, "/api/webauthn/status", { token: fleetToken })).status).toBe(403);
    peer.tokens.revoke("fleet:test-home");
  });

  it("revoke blocks new requests at once and closes open streams within 5 s", async () => {
    const fleetToken = peer.tokens.issue("fleet:revoke-me").token;
    const id = (await call<{ id: string }>(peer, "/api/sessions", { body: { adapter: "dummy", project: peer.dir } })).body.id;
    const ws = new WebSocket(`${peer.url.replace("http", "ws")}/api/events/${id}/tail`, { headers: { authorization: `Bearer ${fleetToken}` } });
    await new Promise((r) => ws.once("open", r));
    const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
    const t0 = Date.now();
    peer.tokens.revoke("fleet:revoke-me");
    expect((await call(peer, "/api/sessions", { token: fleetToken })).status).toBe(401);
    expect(await closed).toBe(4401);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("removing a peer also revokes its token on the peer", async () => {
    const res = await call(home, "/api/fleet/peers/home-server", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await call<unknown[]>(home, "/api/fleet/peers")).body).toEqual([]);
    expect(peer.tokens.list().map((t) => t.label)).not.toContain("fleet:workstation");
  });
});
