import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, AttachmentStore, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

/** Pi-Form: nimmt Meldungen erst im nächsten Zug an, kann aber lenken (ADR-0085). */
const prompts: string[] = [];
const piLike: Adapter = {
    id: "pitest",
    version: "0.0.1",
    capabilities: () => ({
      promptDelivery: "next-turn",
      midTurnInput: true,
      reasoning: false,
      tools: false,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "none",
      features: basicFeatures({ followUp: true, interrupt: true }),
    }),
    async start(_spec, ctx) {
      return { sessionId: ctx.sessionId };
    },
    async steer(_h, input) {
      if (input.kind === "prompt") prompts.push(input.text);
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
};



/** So antwortet `GET /api/sessions/<id>/queue`. */
interface QueuedPrompt {
  id: string;
  text: string;
  createdAt: string;
  position?: number;
  delivery?: string;
}

interface Hub {
  app: FastifyInstance;
  url: string;
  token: string;
  dir: string;
}

async function hub(hostId: string): Promise<Hub> {
  const dir = await mkdtemp(join(tmpdir(), `ancientvoid-fltsch-${hostId}-`));
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  registry.register("pitest", () => piLike);
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const token = tokens.issue("phone").token;
  const app = await createHubApp({
    sessions,
    tokens,
    registry,
    auth: { tokens, enforceTailnetIdentity: false },
    hostId,
    projectRoots: [],
    settings: new SettingsStore(db),
    attachments: new AttachmentStore(db, join(dir, "attachments")),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`, token, dir };
}

async function call(h: Hub, method: string, path: string, body?: unknown) {
  const res = await h.app.inject({
    method: method as "GET",
    url: path,
    headers: { authorization: `Bearer ${h.token}` },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, body: res.json() as unknown };
}

describe("Warteschlange einer fremden Sitzung über die Fleet-Strecke", () => {
  let home: Hub;
  let peer: Hub;
  let sitzung = "";

  beforeAll(async () => {
    home = await hub("cachyos-ai");
    peer = await hub("kaisgamingdesk");
    const invite = await call(peer, "POST", "/api/fleet/invites", {});
    const paired = await call(home, "POST", "/api/fleet/peers", { url: peer.url, code: (invite.body as { code: string }).code });
    expect(paired.status).toBe(201);
    const start = await call(peer, "POST", "/api/sessions", { adapter: "pitest", prompt: "erster Auftrag", project: "/tmp" });
    expect(start.status).toBe(201);
    sitzung = (start.body as { id: string }).id;
    // Ein Zug läuft noch; die zweite Meldung wird vorgemerkt — genau wie die PWA es tut.
    const vorgemerkt = await call(home, "POST", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/steer`, { kind: "prompt", text: "zweite Meldung", clientId: "c1", queue: true });
    expect(vorgemerkt.status).toBe(200);
    expect((vorgemerkt.body as { detail?: string }).detail).toBe("queued");
  });

  afterAll(async () => {
    for (const h of [home, peer]) {
      await h.app.close();
      if (existsSync(h.dir)) await rm(h.dir, { recursive: true, force: true });
    }
  });

  it("listet die Vorgemerkt-Einträge samt Position (ohne Position sind ✎ ↑ ↓ zu)", async () => {
    const liste = await call(home, "GET", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue`);
    expect(liste.status).toBe(200);
    const eintraege = liste.body as QueuedPrompt[];
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]!.text).toBe("zweite Meldung");
    expect(typeof eintraege[0]!.position).toBe("number");
    expect(eintraege[0]!.delivery).not.toBe("unknown");
  });

  it("ändert den Text eines vorgemerkten Eintrags beim Peer", async () => {
    const liste = await call(home, "GET", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue`);
    const qid = (liste.body as QueuedPrompt[])[0]!.id;
    const edit = await call(home, "PATCH", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue/${qid}`, { text: "verbesserte Meldung" });
    expect(edit.status).toBe(200);
    const danach = await call(peer, "GET", `/api/sessions/${sitzung}/queue`);
    expect((danach.body as QueuedPrompt[])[0]!.text).toBe("verbesserte Meldung");
  });

  it("hängt um und streicht — der Peer hat danach genau einen Eintrag", async () => {
    const zweite = await call(home, "POST", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/steer`, { kind: "prompt", text: "dritte Meldung", clientId: "c1", queue: true });
    expect(zweite.status).toBe(200);
    let liste = (await call(home, "GET", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue`)).body as QueuedPrompt[];
    expect(liste).toHaveLength(2);
    const letzter = liste[1]!;
    const um = await call(home, "PATCH", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue/${letzter.id}`, { move: "front" });
    if (um.status !== 200) throw new Error(`UMHANG: ${JSON.stringify(um.body)} IDs ${liste.map((x) => x.id.slice(0, 6)).join(",")}`);
    expect(um.status).toBe(200);
    liste = (await call(home, "GET", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue`)).body as QueuedPrompt[];
    expect(liste[0]!.text).toBe("dritte Meldung");
    const streichen = await call(home, "DELETE", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue/${liste[1]!.id}`);
    expect(streichen.status).toBe(200);
    const beimPeer = (await call(peer, "GET", `/api/sessions/${sitzung}/queue`)).body as QueuedPrompt[];
    expect(beimPeer).toHaveLength(1);
    expect(beimPeer[0]!.text).toBe("dritte Meldung");
  });

  it("sendet eine Vorgemerkt-Eintrag sofort in den laufenden Zug des Peers", async () => {
    const liste = (await call(home, "GET", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue`)).body as QueuedPrompt[];
    const qid = liste[0]!.id;
    const vorweg = prompts.length;
    const senden = await call(home, "POST", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue/${qid}/send`, {});
    expect(senden.status).toBe(200);
    expect(prompts.length).toBeGreaterThan(vorweg);
    expect(prompts[prompts.length - 1]).toBe("dritte Meldung");
    const danach = (await call(home, "GET", `/api/hosts/kaisgamingdesk/sessions/${sitzung}/queue`)).body as QueuedPrompt[];
    expect(danach).toHaveLength(0);
  });
});
