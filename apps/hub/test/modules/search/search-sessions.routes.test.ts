import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, FleetStore, HubDatabase, SessionManager, SessionTextIndex, TokenService, type HubDatabase as HubDb } from "@ancientvoid/core";
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
  corrected?: string[];
  sessionStatus?: string;
  docStatus?: string;
  docEngine?: string;
  total?: number;
  sessionTotal?: number;
  hits: { sessionId: string; role: string; seq: number; snippet: string; sessionTitle: string | null; project: string; sessionHits: number }[];
  docs: { file: string; project?: string; hub?: string }[];
  docProjects?: string[];
  docTruncated?: boolean;
  peers?: number;
  hubs?: { hostId: string; state: string; sessions: number }[];
  sessions: { sessionId: string; role: string; sessionTitle: string | null; hub?: string; hubUrl?: string }[];
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
    expect(res.body.hits[0]!.snippet).toContain("\u0002");
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
    expect(scoped.body.hits[0]!.sessionId).toBe("sA");

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

  it("Sitzungen und Doku haben getrennte Projekt-Schalter", async () => {
    addSessionRow("s4", projectDir, "Projekt A");
    addSessionRow("s5", dataDir, "Projekt B");
    await seedEvent("s4", "user", "Kotflügel richten", 1);
    await seedEvent("s5", "user", "Kotflügel bestellen", 1);
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });

    const s4 = await get(app, `/api/search/all?q=${encodeURIComponent("Kotflügel")}&scope=sessions`);
    expect(s4.body.sessionTotal).toBe(2);

    const here = await get(app, `/api/search/all?q=${encodeURIComponent("Kotflügel")}&scope=sessions&sessionProject=${encodeURIComponent(projectDir)}`);
    expect(here.body.sessionTotal).toBe(1);
    expect(here.body.sessions[0]).toMatchObject({ sessionId: "s4", sessionTitle: "Projekt A" });

    // Ein Projekt außerhalb der projectRoots — auch als Sitzungsfilter — ist
    // eine 422, nie eine Suche, die so tut, als fände sie nichts.
    const foreign = await get(app, `/api/search/all?q=${encodeURIComponent("Kotflügel")}&sessionProject=${encodeURIComponent("/etc")}`);
    expect(foreign.code).toBe(422);
    await app.close();
  });

  it("400 ohne q und 422 für ein Projekt außerhalb der projectRoots", async () => {
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });
    expect((await get(app, "/api/search/all")).code).toBe(400);
    expect((await get(app, `/api/search/all?q=x&project=${encodeURIComponent("/etc")}`)).code).toBe(422);
    await app.close();
  });

  it(" finds die Sitzung eines anderen Hub-Rechners und sagt, welcher offline ist", async () => {
    // Der Fall, den keine lokale Suche lösen kann: die Sitzung, in der etwas
    // gebaut wurde, liegt in der dataDir eines anderen Rechners.
    const peer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ready",
          sessions: [{ sessionId: "s-rem", seq: 4, ts: "2026-11-23T07:00:00.000Z", role: "user", snippet: "baue tokdeck", score: 1, sessionTitle: "tokdeck-Abend", project: "C:\\repos\\tokdeck", archived: false, sessionHits: 1 }],
          sessionTotal: 1,
          docs: [],
          docTotal: 0,
        }),
      );
    });
    await new Promise<void>((r) => peer.listen(0, "127.0.0.1", r));
    const peerUrl = `http://127.0.0.1:${(peer.address() as { port: number }).port}`;

    const tokens = new TokenService(db);
    const fleet = new FleetStore(db, tokens);
    fleet.savePeer({ hostId: "andre", url: peerUrl, token: "egal", protocolVersion: 1, pairedAt: "2026-11-23T07:00:00.000Z" });
    fleet.savePeer({ hostId: "tot", url: "http://127.0.0.1:1", token: "egal", protocolVersion: 1, pairedAt: "2026-11-23T07:00:00.000Z" });

    addSessionRow("s1", projectDir, "Eigene Sitzung");
    await seedEvent("s1", "user", "tokdeck auf dem eigenen Rechner");
    const registry = new AdapterRegistry();
    token = tokens.issue("pixel").token;
    const app = await createHubApp({
      sessions: new SessionManager(db, new EventStore(dataDir), registry, new ProcessRunner()),
      tokens,
      registry,
      projectRoots: [projectDir],
      dataDir,
      search: { transcript: new SessionTextIndex(db, dataDir) },
      fleet,
      auth: { tokens, enforceTailnetIdentity: false },
    });

    const one = await get(app, `/api/search/all?q=${encodeURIComponent("tokdeck")}&scope=sessions`);
    expect(one.body.peers).toBe(2);
    expect(one.body.hubs).toBeUndefined();

    const wide = await get(app, `/api/search/all?q=${encodeURIComponent("tokdeck")}&scope=sessions&hubs=1`);
    expect(wide.body.hubs?.map((h) => [h.hostId, h.state])).toEqual([
      ["andre", "ok"],
      ["tot", "offline"],
    ]);
    expect(wide.body.sessionTotal).toBe(2);
    const remote = (wide.body.sessions as { sessionId: string; hub?: string; hubUrl?: string }[]).find((h) => h.sessionId === "s-rem");
    expect(remote?.hub).toBe("andre");
    expect(remote?.hubUrl).toBe(peerUrl);

    // Projektauswahl gilt nur auf diesem Rechner — die anderen werden nicht
    // mit einer fremden Pfadschnur losschickt, sondern als übersprungen gemeldet.
    const scoped = await get(app, `/api/search/all?q=${encodeURIComponent("tokdeck")}&scope=sessions&hubs=1&sessionProject=${encodeURIComponent(projectDir)}`);
    expect(scoped.body.hubs?.every((h) => h.state === "skipped")).toBe(true);
    await app.close();
    await new Promise<void>((r) => peer.close(() => r()));
  });

  it("berichtigt einen Tippfehler bis in die Route hinein", async () => {
    addSessionRow("s1", projectDir, "Token-Widget");
    await seedEvent("s1", "assistant", "tokdeck läuft auf 127.0.0.1:7474");
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });
    const res = await get(app, `/api/search/all?q=${encodeURIComponent("tokdek")}&scope=sessions`);
    expect(res.body.mode).toBe("typo");
    expect(res.body.sessionTotal).toBe(1);
    expect(res.body.corrected).toContain("tokdeck");
    await app.close();
  });

  it(" findet die Doku eines anderen Projekts und nennt das Projekt dazu", async () => {
    // Der Fall, der in der Oberfläche wehtut: man sucht ein Tool, an dem man
    // gerade nicht arbeitet. Ohne „alle Projekte“ ist die Doku-Seile leer, weil
    // sie ans Projekt der laufenden Sitzung gebunden ist.
    await mkdir(join(projectDir, "tokdeck"), { recursive: true });
    await mkdir(join(projectDir, "powermeter"), { recursive: true });
    await writeFile(join(projectDir, "tokdeck", "README.md"), "# tokdeck\n\nDer Wächter über dem Strata-Server.\n", "utf8");
    await writeFile(join(projectDir, "powermeter", "PROGRESS.md"), "# powermeter\n\nMisst Strom. Die GPU steht bei tokdeck.\n", "utf8");
    const app = await buildApp({ transcript: new SessionTextIndex(db, dataDir) });

    const wide = await get(app, `/api/search/all?q=${encodeURIComponent("tokdeck")}&scope=docs&allProjects=1`);
    expect(wide.code).toBe(200);
    expect(wide.body.docStatus).toBe("ready");
    expect(wide.body.docEngine).toBe("local");
    expect(wide.body.docProjects?.length).toBe(2);
    expect(wide.body.docs.length).toBeGreaterThanOrEqual(2);
    expect(wide.body.docs.every((h) => typeof h.project === "string")).toBe(true);
    expect(wide.body.docs.some((h) => h.project?.endsWith("/tokdeck") && h.file === "README.md")).toBe(true);

    // Ohne das Kreuz bleibt die Doku ans Projekt gebunden; ohne Projekt ist sie
    // nicht verfügbar — und sagt das, statt eine leere Liste zu erfinden.
    const narrow = await get(app, `/api/search/all?q=${encodeURIComponent("tokdeck")}&scope=docs`);
    expect(narrow.body.docStatus).toBe("unavailable");
    expect(narrow.body.docProjects).toBeUndefined();
    await app.close();
  });
});
