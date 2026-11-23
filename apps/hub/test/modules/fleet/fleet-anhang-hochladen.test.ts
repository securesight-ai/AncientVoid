import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, AttachmentStore, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../../../src/app.ts";

/** Echtes 1×1-PNG — ein absichtlich kaputtes Byte-Knäuel würde der Hub zu Recht ablehnen. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

interface Hub {
  app: FastifyInstance;
  url: string;
  token: string;
  dir: string;
}

async function hub(hostId: string): Promise<Hub> {
  const dir = await mkdtemp(join(tmpdir(), `ancientvoid-anhang-${hostId}-`));
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, { eventsPerSecond: 20, autoStopAfterEvents: 0 });
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const settings = new SettingsStore(db);
  const attachments = new AttachmentStore(db, join(dir, "attachments"));
  const token = tokens.issue("phone").token;
  const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId, projectRoots: [], settings, attachments });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`, token, dir };
}

async function json<T>(h: Hub, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await h.app.inject({ method: "POST", url: path, headers: { authorization: `Bearer ${h.token}` }, payload: body as object });
  return { status: res.statusCode, body: res.json() as T };
}

function uploadHeaders(h: Hub) {
  return {
    authorization: `Bearer ${h.token}`,
    "content-type": "image/png",
    "x-filename": encodeURIComponent("screenshot.png"),
  };
}

describe("Bild-Anhang durch die Fleet-Strecke (Nutzerfund 23.11.2026)", () => {
  let home: Hub;
  let peer: Hub;

  beforeAll(async () => {
    home = await hub("cachyos-ai");
    peer = await hub("kaisgamingdesk");
    const invite = await json<{ code: string }>(peer, "/api/fleet/invites", {});
    const paired = await json(home, "/api/fleet/peers", { url: peer.url, code: invite.body.code });
    expect(paired.status).toBe(201);
  });

  afterAll(async () => {
    for (const h of [home, peer]) {
      await h.app.close();
      if (existsSync(h.dir)) await rm(h.dir, { recursive: true, force: true });
    }
  });

  it("lädt ein Rohbild zum anderen Hub hoch und legt es DORT ab", async () => {
    const res = await home.app.inject({
      method: "POST",
      url: "/api/hosts/kaisgamingdesk/attachments",
      headers: uploadHeaders(home),
      payload: PNG,
    });
    expect(res.statusCode).toBe(201);
    const record = res.json() as { id: string; kind: string; bytes: number; name: string };
    expect(record.kind).toBe("image");
    expect(record.bytes).toBe(PNG.length);
    expect(record.name).toBe("screenshot.png");

    // Beim Peer wirklich angekommen — nicht nur eine Quittung unterwegs.
    const beimPeer = await peer.app.inject({ method: "GET", url: `/api/attachments/${record.id}`, headers: { authorization: `Bearer ${peer.token}` } });
    expect(beimPeer.statusCode).toBe(200);
    const bytes = await peer.app.inject({ method: "GET", url: `/api/attachments/${record.id}/content`, headers: { authorization: `Bearer ${peer.token}` } });
    expect(Buffer.from(bytes.rawPayload).equals(PNG)).toBe(true);
  });

  it("eigener Rechner: dieselbe Route, lokale Ablage", async () => {
    const res = await home.app.inject({
      method: "POST",
      url: "/api/hosts/cachyos-ai/attachments",
      headers: uploadHeaders(home),
      payload: PNG,
    });
    expect(res.statusCode).toBe(201);
    const record = res.json() as { id: string; kind: string };
    expect(record.kind).toBe("image");
    const lokal = await home.app.inject({ method: "GET", url: `/api/attachments/${record.id}/content`, headers: { authorization: `Bearer ${home.token}` } });
    expect(Buffer.from(lokal.rawPayload).equals(PNG)).toBe(true);
  });

  it("unbekannter Rechner: 404 mit Grund, nicht 415", async () => {
    const res = await home.app.inject({
      method: "POST",
      url: "/api/hosts/nirgendwo/attachments",
      headers: uploadHeaders(home),
      payload: PNG,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toContain("unknown host");
  });

  it("leere Datei wird abgewiesen, bevor sie losgeschickt wird", async () => {
    const res = await home.app.inject({
      method: "POST",
      url: "/api/hosts/kaisgamingdesk/attachments",
      headers: uploadHeaders(home),
      payload: Buffer.alloc(0),
    });
    expect(res.statusCode).toBe(400);
  });
});
