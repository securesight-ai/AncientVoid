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

interface EventsMsg {
  type: string;
  events?: { seq: number }[];
  baseline?: boolean;
}

/** Collects frames until no new one arrived for `quietMs`. */
function collect(url: string, token: string, hello: number, quietMs = 600): Promise<EventsMsg[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    const frames: EventsMsg[] = [];
    let timer: NodeJS.Timeout | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        ws.close();
        resolve(frames);
      }, quietMs);
    };
    ws.on("error", reject);
    ws.on("message", (raw: Buffer) => {
      frames.push(JSON.parse(String(raw)) as EventsMsg);
      settle();
    });
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", lastSeq: hello }));
      settle();
    });
  });
}

describe("WS history beyond one page (BUG-0026)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let token = "";
  let base = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-wshist-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 100, autoStopAfterEvents: 0 });
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("t").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    base = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function sessionWith(events: number): Promise<string> {
    const record = await sessions.create({ adapter: "dummy", project: dir });
    while ((sessions.get(record.id)?.lastSeq ?? 0) < events) await new Promise((r) => setTimeout(r, 20));
    await sessions.stop(record.id);
    return record.id;
  }

  const seqs = (frames: EventsMsg[]) => frames.filter((f) => f.type === "events").flatMap((f) => f.events!.map((e) => e.seq));

  it("an opened session gets its newest events, up to the end", async () => {
    const id = await sessionWith(250);
    const last = sessions.get(id)!.lastSeq;
    const got = seqs(await collect(`${base}/api/events/${id}/tail`, token, 0));
    expect(got.at(-1)).toBe(last);
    expect(got).toEqual(Array.from({ length: got.length }, (_, i) => got[0]! + i));
    expect(got.length).toBe(last);
  });

  it("a very long session starts at the newest 500, marked as baseline", async () => {
    const id = await sessionWith(620);
    const last = sessions.get(id)!.lastSeq;
    const frames = await collect(`${base}/api/events/${id}/tail`, token, 0);
    const got = seqs(frames);
    expect(got.length).toBe(500);
    expect(got.at(-1)).toBe(last);
    expect(frames.find((f) => f.type === "events")?.baseline).toBe(true);
  });

  it("a reconnect gets everything it missed", async () => {
    const id = await sessionWith(180);
    const last = sessions.get(id)!.lastSeq;
    const got = seqs(await collect(`${base}/api/events/${id}/tail`, token, 30));
    expect(got[0]).toBe(31);
    expect(got.at(-1)).toBe(last);
  });
});
