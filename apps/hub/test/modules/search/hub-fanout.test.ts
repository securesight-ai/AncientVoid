import { describe, it, expect, afterAll } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { searchPeers, peerLabel } from "../../../src/modules/search/hub-fanout.ts";

/**
 * Cross-Hub-Suche: die Runde zu den gekoppelten Rechnern wird gegen echte HTTP-
 * Antworten geprüft — ein funktionierender Peer, ein abgelehnter (401), einer ohne
 * Antwort. Ein toter Rechner darf in der Trefferliste nicht wie „nichts gefunden“
 * aussehen, deshalb ist sein Status Teil des Vertrags.
 */

const servers: Server[] = [];

function peerServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const srv = createServer(handler);
  servers.push(srv);
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => {
    const addr = srv.address();
    resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`);
  }));
}

afterAll(() => servers.forEach((s) => s.close()));

describe("searchPeers — Runde über die gekoppelten Hub-Rechner", () => {
  it("liefert Funde mit Hub-Marke und zählt die Fremdfunde in die Gesamtzahl", async () => {
    const url = await peerServer((req, res) => {
      const q = new URL(req.url ?? "/", "http://peer").searchParams;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ready",
          query: q.get("q"),
          mode: "and",
          scope: q.get("scope"),
          sessions: [
            {
              sessionId: "s-remote",
              seq: 7,
              ts: "2026-11-23T07:00:00.000Z",
              role: "user",
              snippet: "baue das Tool tokdeck",
              score: 1,
              sessionTitle: "tokdeck gebaut",
              project: "C:\\repos\\tokdeck",
              archived: false,
              sessionHits: 3,
            },
          ],
          sessionTotal: 3,
          docs: [{ file: "README.md", line: 1, title: "tokdeck", snippet: "tokdeck", score: 1 }],
          docTotal: 1,
          docEngine: "local",
          docStatus: "ready",
          facets: [],
          index: { engine: "fts5", sessions: 4, lines: 900, indexedAt: null },
          sessionStatus: "ready",
        }),
      );
    });

    const res = await searchPeers([{ hostId: "kaisgamingdesk", url, token: "fleet-token" }], {
      q: "tokdeck",
      scope: "all",
      limit: 20,
      projectScoped: false,
    });
    expect(res.hubs).toEqual([{ hostId: "kaisgamingdesk", label: "127.0.0.1", state: "ok", sessions: 3, docs: 1 }]);
    expect(res.sessions[0]).toMatchObject({ sessionId: "s-remote", hub: "kaisgamingdesk", hubUrl: url });
    expect(res.docs[0]).toMatchObject({ file: "README.md", hub: "kaisgamingdesk" });
  });

  it("meldet abgelehnte und unerreichbare Rechner als Status, nicht als Null-Treffer", async () => {
    const denied = await peerServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad token" }));
    });
    const res = await searchPeers(
      [
        { hostId: "denied-hub", url: denied, token: "falsch" },
        { hostId: "fort", url: "http://127.0.0.1:1", token: "x" },
      ],
      { q: "tokdeck", scope: "all", limit: 5, projectScoped: false },
    );
    expect(res.hubs.map((h) => h.state)).toEqual(["denied", "offline"]);
    expect(res.sessions).toEqual([]);
  });

  it("lässt die Peers weg, wenn nach Projekt gefiltert ist — der Filter gilt hier, nicht dort", async () => {
    const res = await searchPeers([{ hostId: "anders", url: "http://127.0.0.1:1", token: "x" }], {
      q: "tokdeck",
      scope: "all",
      limit: 5,
      projectScoped: true,
    });
    expect(res.hubs).toEqual([
      { hostId: "anders", label: "127.0.0.1", state: "skipped", sessions: 0, docs: 0, note: "project_scope" },
    ]);
  });

  it("nennt den Rechner der Peer-URL, nicht nur die Zahl", () => {
    expect(peerLabel("https://kaisgamingdesk.taila03493.ts.net")).toBe("kaisgamingdesk.taila03493.ts.net");
    expect(peerLabel("keine url")).toBe("keine url");
  });
});
