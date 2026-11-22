import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, SessionTextIndex, TokenService, type HubDatabase as HubDb } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/**
 * Suche (Nachschärfe 2026-11-22): die neuen Routen der Sessiontext-Suche —
 * `GET /api/search/transcript` und `GET /api/search/all`. Die Fundstelle ist
 * eine echte Frage in einem echten `events.jsonl` (echter EventStore), der
 * Kopf (Titel, Projekt) kommt aus der Hub-DB. qmd spielt hier nicht mit: die
 * Session-Suche braucht kein qmd, und die Doku-Stufe prüft docs-local.test.ts.
 */

let dataDir: string;
let projectDir: string;
let db: HubDb;
let store: EventStore;
let sessions: SessionManager;
let token: string;

async function buildApp(search?: { transcript: SessionTextIndex }): Promise<FastifyInstance> {
  const registry = new AdapterRegistry();
  const tokens = new TokenService(db);
  sessions = new SessionManager(db, store, registry, new ProcessRunner());
  token = tokens.issue("pixel").token;
  return await createHubApp({
    sessions,
    tokens,
    registry,
    projectRoots: [projectDir],
    dataDir,
    ...(search ? { search } : {}),
    auth: { tokens, enforceTailnetIdentity: false },
  });
}

function addSessionRow(id: string, project: string, title: string): void {
  db.prepare(
    `INSERT INTO sessions (id, adapter, project, status, created_at, adapter_version, title)
     VALUES (?, 'pi', ?, 'idle', '2026-11-22T08:00:00.000Z', '0.1.0', ?)`,
  ).run(id, project, title);
}

async function seedEvent(sessionId: string, type: string, text: string, seq = 1): Promise<void> {
  await store.initSession(sessionId);
  await store.append(sessionId, [
    {
      seq,
      ts: "2026-11-22T08:05:00.000Z",
      sessionId,
      type: type as never,
      summary: "",
      payload: { kind: "session.prompt", text },
      blobRef: null,
    },
  ] as never);
  await store.flush(sessionId);
}

/** Was die Routen zurückgeben — als Lesbart, nicht als Contract-Duplikat:
 * die Werte prüft der Test, die Form ist hier nur grob geschnitten. */
interface SearchBody {
  status?: string;
  scope?: string;
  mode?: string;
  sessionStatus?: string;
  docStatus?: string;
  docEngine?: string;
  total?: number;
  hits: { sessionId: string; role: string; seq: number; snippet: string; sessionTitle: string | null; project: string; sessionHits: number }[];
  sessions: { sessionId: string; role: string; sessionTitle: string | null }[];
  docs: unknown[];
  facets: { role: string; count: number }[];
  index: { engine: string; lines: number };
}

async function get(app: FastifyInstance, url: string): Promise<{ code: number; body: SearchBody }> {
  const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  return { code: res.statusCode, body: res.json() as SearchBody };
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "ancientvoid-search-sessions-"));
  projectDir = await mkdtemp(join(tmpdir(), "ancientvoid-search-project-"));
  db = new HubDatabase(":memory:");
  store = new EventStore(dataDir);
});

afterEach(async () => {
  await sessions?.shutdown();
  // SessionManager schließt die DB mit; ein zweites close() wirft.
  try {
    db?.close();
  } catch {
    /* schon geschlossen */
  }
  await rm(dataDir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

describe("GET /api/search/transcript", () => {
  it("findet die Frage einer Sitzung und hängt Titel und Projekt an", async () => {
    addSessionRow("s1", projectDir, "Kaufberatung Flowkey");
    await seedEvent("s1", "user", "such das Flowkey-Abo unter 60 Euro");
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });

    const res = await get(app, `/api/search/transcript?q=${encodeURIComponent("flowkey")}`);
    expect(res.code).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.total).toBe(1);
    expect(res.body.hits[0]).toMatchObject({
      sessionId: "s1",
      role: "user",
      sessionTitle: "Kaufberatung Flowkey",
      project: projectDir,
      archived: false,
      sessionHits: 1,
    });
    expect(res.body.hits[0].snippet).toContain("\u0002");
    expect(res.body.index.engine).toBe("fts5");
    await app.close();
  });

  it("400 ohne q, 501 wenn die Suche nicht verdrahtet ist, 422 für fremdes Projekt", async () => {
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });
    expect((await get(app, "/api/search/transcript")).code).toBe(400);
    expect((await get(app, `/api/search/transcript?q=x&project=${encodeURIComponent("/etc")}`)).code).toBe(422);
    await app.close();

    const bare = await buildApp();
    expect((await get(bare, "/api/search/transcript?q=irgendwas")).code).toBe(501);
    await bare.close();
  });

  it("Rollenfilter holt die Werkzeugspur dazu und paginiert ehrlich", async () => {
    addSessionRow("s2", projectDir, "Werkzeugkram");
    await seedEvent("s2", "user", "prüf den Zylinderkopf", 1);
    await seedEvent("s2", "tool_use", "Werkzeug: grep nach Zylinderkopf", 2);
    const index = new SessionTextIndex(db, dataDir);
    const app = await buildApp({ transcript: index });

    const plain = await get(app, `/api/search/transcript?q=${encodeURIComponent("Zylinderkopf")}`);
    expect(plain.body.hits.map((h) => h.role)).toEqual(["user"]);
    expect(plain.body.total).toBe(1);
    // Facetten gelten über alle Rollen der Anfrage — sonst rätselt die PWA,
    // was ein ausgegrauter Chip bedeutet.
    expect(plain.body.facets.find((f) => f.role === "tool")?.count).toBe(1);

    const withTool = await get(app, `/api/search/transcript?q=${encodeURIComponent("Zylinderkopf")}&roles=user,assistant,tool`);
    expect(withTool.body.total).toBe(2);
    expect(withTool.body.hits).toHaveLength(2);

    const page = await get(app, `/api/search/transcript?q=${encodeURIComponent("Zylinderkopf")}&roles=user,assistant,tool&limit=1&offset=1`);
    expect(page.body.hits).toHaveLength(1);
    expect(page.body.total).toBe(2);
    await app.close();
  });

  it("begrenzt auf Wunsch auf ein Projekt — und findet sonst hub-weit", async () => {
    addSessionRow("sA", projectDir, "Projekt A");
    addSessionRow("sB", dataDir, "anderes Projekt");
    await seedEvent("sA", "user", "Distanzrohr messen");
    await seedEvent("sB", "user", "Distanzrohr bestellen");
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });

    const all = await get(app, `/api/search/transcript?q=${encodeURIComponent("Distanzrohr")}`);
    expect(all.body.total).toBe(2);

    const scoped = await get(app, `/api/search/transcript?q=${encodeURIComponent("Distanzrohr")}&project=${encodeURIComponent(projectDir)}`);
    expect(scoped.body.total).toBe(1);
    expect(scoped.body.hits[0].sessionId).toBe("sA");

    const underRoot = await get(app, `/api/search/transcript?q=${encodeURIComponent("Distanzrohr")}&projectUnder=${encodeURIComponent(projectDir)}`);
    expect(underRoot.body.total).toBe(1);
    await app.close();
  });
});

describe("GET /api/search/all", () => {
  it("antwortet mit Sitzungs-Treffern und lässt die Doku-Stufe benennen", async () => {
    addSessionRow("s3", projectDir, "Sessionsuche");
    await seedEvent("s3", "assistant", "die Kupplungsmatrix ist gemeint");
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });

    const res = await get(app, `/api/search/all?q=${encodeURIComponent("Kupplungsmatrix")}&scope=sessions`);
    expect(res.code).toBe(200);
    expect(res.body.scope).toBe("sessions");
    expect(res.body.sessionStatus).toBe("ready");
    expect(res.body.docStatus).toBe("skipped");
    expect(res.body.docEngine).toBe("none");
    expect(res.body.docs).toEqual([]);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0]).toMatchObject({ role: "assistant", sessionTitle: "Sessionsuche" });
    await app.close();
  });

  it("ohne verdrahteten Index bleibt die Antwort benutzbar: sessionStatus sagt es", async () => {
    const app = await buildApp();
    const res = await get(app, "/api/search/all?q=irgendwas&scope=sessions");
    expect(res.code).toBe(200);
    expect(res.body.sessionStatus).toBe("unavailable");
    expect(res.body.sessions).toEqual([]);
    expect(res.body.index.lines).toBe(0);
    await app.close();
  });

  it("400 ohne q und 422 für ein Projekt außerhalb der projectRoots", async () => {
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });
    expect((await get(app, "/api/search/all")).code).toBe(400);
    expect((await get(app, `/api/search/all?q=x&project=${encodeURIComponent("/etc")}`)).code).toBe(422);
    await app.close();
  });
});
