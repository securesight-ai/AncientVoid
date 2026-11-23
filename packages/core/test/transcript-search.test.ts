import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedEvent } from "@ancientvoid/contracts";
import { SNIPPET_MARK_OPEN } from "@ancientvoid/contracts";
import {
  EventStore,
  HubDatabase,
  SessionTextIndex,
  buildFtsQuery,
  editDistance,
  eventText,
  isSubsequence,
  rankCandidates,
  scanSnippet,
} from "../src/index.ts";

/**
 * Suche (Nachschärfe 2026-11-22): der Sessiontext-Index. Er ist der einzige
 * Weg, an **Fragen und Antworten** heranzukommen — qmd erfasst nachweislich
 * nur Markdown. Alles hier läuft gegen den echten Bestand: ein echter
 * `EventStore` schreibt JSONL und Blobs (K5-Offload), der Index liest genau
 * das, was ein Hub auf der Platte hat.
 */

let dir: string;
let db: HubDatabase;
let store: EventStore;

function idx(opts?: { fts?: boolean }): SessionTextIndex {
  return new SessionTextIndex(db, dir, opts);
}

function addSessionRow(id: string, project: string, title: string | null, archived = false): void {
  db.prepare(
    `INSERT INTO sessions (id, adapter, project, status, created_at, adapter_version, title, archived)
     VALUES (?, 'pi', ?, 'idle', '2026-11-22T08:00:00.000Z', '0.1.0', ?, ?)`,
  ).run(id, project, title, archived ? 1 : 0);
}

async function seed(id: string, events: { seq: number; ts?: string; type: string; summary?: string; payload: Record<string, unknown> }[]): Promise<void> {
  await store.initSession(id);
  await store.append(
    id,
    events.map(
      (e): NormalizedEvent => ({
        seq: e.seq,
        ts: e.ts ?? `2026-11-22T08:0${e.seq % 10}:00.000Z`,
        sessionId: id,
        type: e.type as NormalizedEvent["type"],
        summary: e.summary ?? "",
        payload: e.payload,
        blobRef: null,
      }),
    ),
  );
  await store.flush(id);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ancientvoid-transcript-"));
  db = new HubDatabase(join(dir, "hub.db"));
  store = new EventStore(dir);
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("SessionTextIndex — Fundus", () => {
  it("findet Frage und Antwort einer Sitzung und ziert beide mit Markern", async () => {
    addSessionRow("s1", "/home/kaib/repos/AncientVoid", "Flowkey-Angebot");
    await seed("s1", [
      { seq: 1, type: "user", summary: "such das Flowkey-Jahresabo", payload: { kind: "session.prompt", text: "such das Flowkey-Jahresabo unter 60 Euro" } },
      { seq: 2, type: "assistant", summary: "Preis: 85 Euro", payload: { text: "Gefunden: Flowkey Premium kostet 85 Euro im Jahr" } },
    ]);
    const index = idx();
    await index.refresh();

    const byQuestion = await index.search({ q: "Jahresabo" });
    expect(byQuestion.hits).toHaveLength(1);
    expect(byQuestion.hits[0]!.role).toBe("user");
    expect(byQuestion.hits[0]!.seq).toBe(1);
    expect(byQuestion.hits[0]!.sessionTitle).toBe("Flowkey-Angebot");
    expect(byQuestion.hits[0]!.project).toBe("/home/kaib/repos/AncientVoid");
    expect(byQuestion.hits[0]!.snippet).toContain(SNIPPET_MARK_OPEN);

    const byAnswer = await index.search({ q: "85 Euro" });
    expect(byAnswer.hits.map((h) => h.role)).toEqual(["assistant"]);
    // Belege aus dem Index, nicht aus dem Rat: beide Fundstellen gehören zu einer Sitzung.
    expect(byAnswer.hits[0]!.sessionHits).toBe(1);
  });

  it("findet auch, was der K5-Offload in den Blob ausgelagert hat", async () => {
    addSessionRow("s2", "/home/kaib/repos/AncientVoid", null);
    const long = `${"Vorspann ".repeat(900)}Kurbelwellenträger`;
    await seed("s2", [{ seq: 1, type: "assistant", summary: "lange Antwort", payload: { text: long } }]);
    const index = idx();
    await index.refresh();

    // Die JSONL-Zeile trägt nur noch eine 256-Zeichen-Vorschau mit `truncated`.
    const line = await readFile(join(dir, "sessions", "s2", "events.jsonl"), "utf8");
    expect(line).toContain("\"truncated\":true");
    expect(line).not.toContain("Kurbelwellenträger");

    const found = await index.search({ q: "Kurbelwellenträger" });
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]!.role).toBe("assistant");
    expect(found.hits[0]!.snippet).toContain("Kurbelwellenträger");
  });

  it("zieht den Schwanz nach, ohne den Bestand doppelt zu nehmen", async () => {
    addSessionRow("s3", "/home/kaib/repos/AncientVoid", null);
    await seed("s3", [{ seq: 1, type: "user", payload: { kind: "session.prompt", text: "anfangsfrage zum Panzerriegel" } }]);
    const index = idx();
    await index.refresh();
    expect((await index.search({ q: "Panzerriegel" })).hits).toHaveLength(1);

    await seed("s3", [{ seq: 2, type: "assistant", payload: { text: "Antwort: der Panzerriegel ist montiert" } }]);
    const again = await idx().refresh();
    expect(again.lines).toBe(1); // nur das neue Ereignis, der Rest bleibt stehen

    const all = await index.search({ q: "Panzerriegel" });
    expect(all.hits.map((h) => h.seq).sort()).toEqual([1, 2]);
    expect((await index.state()).lines).toBe(2);
  });

  it("stellt sich neu auf, wenn die JSONL neu geschrieben wurde (K7-Restore)", async () => {
    addSessionRow("s4", "/home/kaib/repos/AncientVoid", null);
    await seed("s4", [
      { seq: 1, type: "user", payload: { kind: "session.prompt", text: "Frage zur Windfeder" } },
      { seq: 2, type: "user", payload: { kind: "session.prompt", text: "zweite Frage zur Windfeder" } },
    ]);
    const index = idx();
    await index.refresh();
    expect((await index.search({ q: "Windfeder" })).total).toBe(2);

    await writeFile(join(dir, "sessions", "s4", "events.jsonl"), '{"seq":9,"ts":"2026-11-22T09:00:00.000Z","sessionId":"s4","type":"user","summary":"neu","payload":{"kind":"session.prompt","text":"einzige Frage zur Windfeder"}}\n', "utf8");
    await idx().refresh();
    const after = await index.search({ q: "Windfeder" });
    expect(after.total).toBe(1);
    expect(after.hits[0]!.seq).toBe(9);
  });

  it("hält Denk- und Werkzeugspuren aus der Standardliste draußen — Chips zeigen sie trotzdem", async () => {
    addSessionRow("s5", "/home/kaib/repos/AncientVoid", null);
    await seed("s5", [
      { seq: 1, type: "user", payload: { kind: "session.prompt", text: "such den Kurbelwellenträger" } },
      { seq: 2, type: "thinking", payload: { text: "Kurbelwellenträger könnte im Lager liegen" } },
      { seq: 3, type: "tool_use", summary: "bash: grep Kurbelwellenträger", payload: { name: "bash", input: { command: "grep Kurbelwellenträger" } } },
    ]);
    const index = idx();
    await index.refresh();

    const plain = await index.search({ q: "Kurbelwellenträger" });
    expect(plain.hits.map((h) => h.role)).toEqual(["user"]);
    expect(plain.facets.find((f) => f.role === "user")?.count).toBe(1);
    expect(plain.facets.find((f) => f.role === "thinking")?.count).toBe(1);
    expect(plain.facets.find((f) => f.role === "tool")?.count).toBe(1);

    const withTool = await index.search({ q: "Kurbelwellenträger", roles: ["user", "assistant", "thinking", "tool"] });
    expect(withTool.hits.map((h) => h.role)).toContain("tool");
    expect(withTool.total).toBe(3);
  });

  it("filtert nach Projekt und Projektwurzel — und ignoriert gelöschte Sitzungen", async () => {
    addSessionRow("sA", "/home/kaib/repos/AncientVoid", "A");
    addSessionRow("sB", "/home/kaib/repos/Tools", "B");
    await seed("sA", [{ seq: 1, type: "user", payload: { kind: "session.prompt", text: "Kratzer am Kotflügel" } }]);
    await seed("sB", [{ seq: 1, type: "user", payload: { kind: "session.prompt", text: "Kratzer am Kotflügel" } }]);
    const index = idx();
    await index.refresh();

    expect((await index.search({ q: "Kotflügel" })).total).toBe(2);
    expect((await index.search({ q: "Kotflügel", project: "/home/kaib/repos/Tools" })).total).toBe(1);
    expect((await index.search({ q: "Kotflügel", projectRoot: "/home/kaib/repos" })).total).toBe(2);
    expect((await index.search({ q: "Kotflügel", projectRoot: "/home/kaib/repos/Tools" })).total).toBe(1);

    await rm(join(dir, "sessions", "sB"), { recursive: true, force: true });
    await idx().refresh();
    const left = await index.search({ q: "Kotflügel" });
    expect(left.total).toBe(1);
    expect(left.hits[0]!.sessionId).toBe("sA");
  });

  it("sucht groß/klein, mit Umlauten und als Wortanfang", async () => {
    addSessionRow("s6", "/home/kaib/repos/AncientVoid", null);
    await seed("s6", [{ seq: 1, type: "user", payload: { kind: "session.prompt", text: "Wie passt die Kühlbox in die Grille?" } }]);
    const index = idx();
    await index.refresh();
    expect((await index.search({ q: "GRILLE" })).total).toBe(1);
    // remove_diacritics: «ü» wird «u» — eine Frage ohne Umlauttasten trifft trotzdem.
    expect((await index.search({ q: "kuhlbox" })).total).toBe(1);
    // Präfix: ein Anfang reicht, der Rest des Wortes kommt von selbst dazu.
    expect((await index.search({ q: "kühl" })).total).toBe(1);
  });

  it("findet Begriffe in zusammengesetzten deutschen Wörtern und nennt die Stufe", async () => {
    // „Sonderangebot“ ist EIN Token; das FTS5-Präfix ("angebot"*) findet es
    // nicht. Ohne diese Stufe wäre die Frage „wo ging es um Angebote?“ im
    // eigenen Fundus blind — der häufigste deutsche Suchfall.
    addSessionRow("s6b", "/home/kaib/repos/AncientVoid", null);
    await seed("s6b", [
      { seq: 1, type: "user", payload: { kind: "session.prompt", text: "such das Sonderangebot für die Kuscheldecke" } },
      { seq: 2, type: "assistant", payload: { text: "kein Großangebot unter 60 Euro" } },
      { seq: 3, type: "assistant", payload: { text: "vom Reeperbahn-Besuch" } },
    ]);
    const index = idx();
    await index.refresh();

    const part = await index.search({ q: "Angebot" });
    expect(part.mode).toBe("teil");
    expect(part.hits.map((h) => h.seq)).toEqual([2, 1]);
    // Ein Wortfund im selben Fundus bleibt ein Wortfund — die Stufe wird nicht
    // nachträglich auf Teilwörter gezogen.
    addSessionRow("s6d", "/home/kaib/repos/AncientVoid", null);
    await seed("s6d", [{ seq: 1, type: "user", payload: { kind: "session.prompt", text: "das Angebot gilt noch" } }]);
    await index.refresh();
    const wordHit = await index.search({ q: "Angebot" });
    expect(wordHit.mode).toBe("and");
    expect(wordHit.hits[0]!.seq).toBe(1);
    // Auch in der Teilwortstufe bleibt das Fundwort markiert.
    for (const hit of part.hits) expect(hit.snippet).toContain("\u0002");

    // Wortfund schlägt Teilwortfund: was als Wort trifft, wird nie eine
    // Teilwortliste.
    const word = await index.search({ q: "Kuscheldecke" });
    expect(word.mode).toBe("and");
    expect(word.hits).toHaveLength(1);

    // In der Teilwortstufe gelten weiter alle Begriffe zusammen; erst wenn die
    // leere bleibt, darf einzeln gesucht werden.
    const together = await index.search({ q: "angebot reeperbahn" });
    expect(together.mode).toBe("or");
    // Die ODER-Stufe sucht wieder als Wort — die zusammengesetzten Zeilen der
    // Teilwortstufe tauchen hier nicht nochmal auf, dafür die eine Zeile mit
    // dem ganzen Wort und die mit der Reeperbahn.
    expect(together.hits.map((h) => h.seq)).toEqual([1, 3]);
  });

  it("hält die Stufe über alle Seiten fest — Teilwortfunde mischen sich nicht", async () => {
    addSessionRow("s6c", "/home/kaib/repos/AncientVoid", null);
    await seed("s6c", [
      { seq: 1, type: "user", payload: { kind: "session.prompt", text: "Sonderangebot Kuscheldecke" } },
      { seq: 2, type: "user", payload: { kind: "session.prompt", text: "Großangebots Kuscheldecke" } },
      { seq: 3, type: "assistant", payload: { text: "Billigangebot war weg" } },
    ]);
    const index = idx();
    await index.refresh();
    const first = await index.search({ q: "angebot", limit: 2 });
    expect(first.mode).toBe("teil");
    expect(first.hits).toHaveLength(2);
    const second = await index.search({ q: "angebot", limit: 2, offset: 2 });
    expect(second.mode).toBe("teil");
    expect(second.hits).toHaveLength(1);
  });

  it("says ehrlich, wenn es nur mit einem Teil der Begriffe trifft", async () => {
    addSessionRow("s7", "/home/kaib/repos/AncientVoid", null);
    await seed("s7", [
      { seq: 1, type: "user", payload: { kind: "session.prompt", text: "ein Gedanke zu Glühbirne" } },
      { seq: 2, type: "assistant", payload: { text: "passend dazu der Montageschlüssel" } },
    ]);
    const index = idx();
    await index.refresh();

    // Ein Suchlauf, zwei Bedeutungen: findet AND nichts, probiert der Index
    // von selbst OR und sagt es — die Liste darf nicht wie ein Wörtlicher
    // Fund aussehen, ist aber besser als eine leere Seite.
    const either = await index.search({ q: "Glühbirne Montageschlüssel" });
    expect(either.mode).toBe("or");
    expect(either.hits).toHaveLength(2);

    // Ein einzelner Begriff bleibt bei AND — kein Grund, die Liste aufzublähen.
    const one = await index.search({ q: "Glühbirne" });
    expect(one.mode).toBe("and");
    expect(one.hits).toHaveLength(1);

    // Und was weder AND noch OR findet, bleibt eine leere Liste.
    const none = await index.search({ q: "Phantomwort Trübvolimatratze" });
    expect(none.hits).toHaveLength(0);
    expect(none.total).toBe(0);
  });

  it("ordnet die Unterhaltung über die Denk- und Werkzeugmasse", async () => {
    addSessionRow("s8", "/home/kaib/repos/AncientVoid", null);
    const many = Array.from({ length: 8 }, (_, i) => ({
      seq: i + 2,
      type: "tool_result",
      summary: `Werkzeugzeile ${i}`,
      payload: { content: `Ausgabe enthält Zündkerze ${i}` },
    }));
    await seed("s8", [{ seq: 1, type: "assistant", payload: { text: "die Zündkerze war das Problem" } }, ...many]);
    const index = idx();
    await index.refresh();
    const all = await index.search({ q: "Zündkerze", roles: ["user", "assistant", "thinking", "tool", "system"], limit: 3 });
    expect(all.hits[0]!.role).toBe("assistant");
    expect(all.hits).toHaveLength(3);
    expect(all.total).toBe(9);
  });

  it("funktioniert ohne FTS5 — gleicher Fund, ehrlich als Durchlauf gemeldet", async () => {
    addSessionRow("s9", "/home/kaib/repos/AncientVoid", "Scan-Fund");
    await seed("s9", [{ seq: 1, type: "user", payload: { kind: "session.prompt", text: "wo liegt der Türöffnerhebel" } }]);
    const scan = idx({ fts: false });
    await scan.refresh();
    expect(scan.engine()).toBe("scan");
    const hits = await scan.search({ q: "türöffnerhebel" });
    expect(hits.index.engine).toBe("scan");
    expect(hits.hits).toHaveLength(1);
    expect(hits.hits[0]!.sessionTitle).toBe("Scan-Fund");
    expect(hits.hits[0]!.snippet).toContain(SNIPPET_MARK_OPEN);
  });

  it("räumt eine per Hand entfernte Sitzung aus dem Index", async () => {
    addSessionRow("s10", "/home/kaib/repos/AncientVoid", null);
    await seed("s10", [{ seq: 1, type: "user", payload: { kind: "session.prompt", text: "Sonderfall Distanzrohr" } }]);
    const index = idx();
    await index.refresh();
    expect((await index.search({ q: "Distanzrohr" })).total).toBe(1);
    await index.dropSession("s10");
    expect((await index.search({ q: "Distanzrohr" })).total).toBe(0);
    expect((await index.state()).lines).toBe(0);
  });
});

describe("query-Bau und Snippet des Durchlaufs", () => {
  it("indexiert eine Frage einmal, auch wenn die Kurzzeile sie wiederholt", () => {
    const ev = { type: "user", summary: "Kurbelwellenträger bestellen" };
    expect(eventText(ev as never, { kind: "session.prompt", text: "Kurbelwellenträger bestellen" })).toBe("Kurbelwellenträger bestellen");
    // Eine Kurzzeile mit eigenem Wortlaut bleibt stehen — sie trägt Begriffe,
    // die im Text fehlen (hier: „gesucht in Alternate“).
    const note = eventText({ type: "assistant", summary: "gesucht in Alternate" } as never, { text: "Im Sortiment" });
    expect(note).toContain("gesucht in Alternate");
    expect(note).toContain("Im Sortiment");
  });

  it("macht aus Begriffen Präfix-Phrasen und lässt Phrasen ganz", () => {
    expect(buildFtsQuery("Flowkey Jahres")).toEqual({ match: '"Flowkey"* "Jahres"*', terms: ["Flowkey", "Jahres"] });
    expect(buildFtsQuery('"exakte Phrase"')).toEqual({ match: '"exakte Phrase"', terms: ["exakte Phrase"] });
    expect(buildFtsQuery("—")).toBeNull();
    // FTS5-Syntax aus einer Eingabe darf nicht als Syntax wirken.
    expect(buildFtsQuery("or (und) NOT")?.match).toBe('"or"* "und"* "NOT"*');
    // Trenner sind keine Wortbestandteile: der Index zerlegt `tokdeck.env.key`
    // in vier Tokens, also muss auch die Suche als Phrase dieser Tokens laufen.
    expect(buildFtsQuery("tokdeck.env.key")).toEqual({ match: '"tokdeck env key"*', terms: ["tokdeck.env.key"] });
    expect(buildFtsQuery("EPIC-P75")?.match).toBe('"EPIC P75"*');
    // Pfade bleiben suchbar, auch mitten im Begriff.
    expect(buildFtsQuery("repos/tokdeck/README.md")?.match).toBe('"repos tokdeck README md"*');
  });

  it("findet einen Begriff mit Punkten und Schrägstrichen (Toolnamen, Pfade)", async () => {
    addSessionRow("spath", "/home/kaib/repos/tokdeck", "Token-Widget");
    await seed("spath", [
      { seq: 1, type: "user", payload: { kind: "session.prompt", text: "Wo liegt der Schlüssel für tokdeck?" } },
      { seq: 2, type: "assistant", payload: { kind: "message", text: "Der Schlüssel liegt in tokdeck.env.key im Repo." } },
    ]);
    const index = idx();
    await index.refresh();
    const res = await index.search({ q: "tokdeck.env.key" });
    expect(res.mode).toBe("and");
    expect(res.total).toBe(1);
    expect(res.hits[0]?.seq).toBe(2);
    // Auch der Pfad eines Dokuments ist ein Suchbegriff.
    const path = await index.search({ q: "repos/tokdeck/README.md" });
    expect(path.total).toBe(0);
    const other = await index.search({ q: "env.key" });
    expect(other.total).toBe(1);
  });

  it("sagt auch ohne Treffer, in welcher Rolle es läge", async () => {
    addSessionRow("srolle", "/home/kaib/repos/tokdeck", "Rollen");
    await seed("srolle", [
      { seq: 1, type: "user", payload: { kind: "session.prompt", text: "Wie heißt das Widget?" } },
      { seq: 2, type: "tool_result", payload: { name: "bash", input: { command: "cat tokdeck.env.key" }, text: "ergab vier Zeilen" } },
    ]);
    const index = idx();
    await index.refresh();
    // Standardrollen sind Frage und Antwort: hier liegt nichts — aber die Facetten
    // sagen, wo es liegt, sonst liest sich die leere Liste wie „nichts im Hub“.
    const empty = await index.search({ q: "tokdeck.env.key" });
    expect(empty.total).toBe(0);
    expect(empty.facets).toEqual([{ role: "tool", count: 1 }]);
    // Mit der Rolle an: derselbe Fund.
    const found = await index.search({ q: "tokdeck.env.key", roles: ["tool"] });
    expect(found.total).toBe(1);
  });

  it("markiert jeden Fund im Fensterausschnitt", () => {
    const snip = scanSnippet("nichts hier, aber Kurbel und wieder Kurbel am Ende", ["Kurbel"]);
    expect(snip.split(SNIPPET_MARK_OPEN).length - 1).toBe(2);
    expect(scanSnippet("ganz ohne Fund", ["fehit"]).includes(SNIPPET_MARK_OPEN)).toBe(false);
  });

  it("rätselt nicht, sondern berichtigt gegen die Wörter des Index", () => {
    expect(editDistance("tokdek", "tokdeck", 1)).toBe(1);
    expect(editDistance("tokdek", "token", 1)).toBeGreaterThan(1);
    expect(isSubsequence("tokdek", "tokdeck")).toBe(true);
    expect(isSubsequence("tokdek", "decktok")).toBe(false);
    // Ein Zeichen Unterschied, gleiche Länge: Kandidat. Völlig anderes Wort: nicht.
    expect(rankCandidates("tokdek", ["tokdeck", "token", "tokenses"])).toEqual(["tokdeck"]);
    // Kurze Begriffe werden nicht geraten — „und“ findet sonst „undd“.
    expect(rankCandidates("undd", ["und", "uns", "under"])).toEqual([]);
    // Ab acht Zeichen sind zwei Tippfehler erlaubt.
    expect(rankCandidates("sessiontextt", ["sessiontext", "session"])).toEqual(["sessiontext"]);
  });

  it("findet einen vertippten Begriff und sagt, welches Wort gemeint war", async () => {
    addSessionRow("stypo", "/home/kaib/repos/tokdeck", "Token-Widget");
    await seed("stypo", [
      { seq: 1, type: "user", payload: { kind: "session.prompt", text: "Wie heißt das Widget für Token-Tempo?" } },
      { seq: 2, type: "assistant", payload: { kind: "message", text: "Es heißt tokdeck und läuft auf 127.0.0.1:7474." } },
    ]);
    const index = idx();
    await index.refresh();
    // „tokdek“ ist Präfix von nichts und Teilwort von nichts: ohne die vierte
    // Stufe wäre das ein stiller Null-Treffer, obwohl jede Zeile „tokdeck“ kennt.
    const res = await index.search({ q: "tokdek" });
    expect(res.mode).toBe("typo");
    expect(res.total).toBe(1);
    expect(res.hits[0]?.seq).toBe(2);
    expect(res.corrected).toContain("tokdeck");
    // Ein Wort, das im Index nirgends vorkommt, bleibt leer — die vierte Stufe
    // erfindet keine Funde.
    const none = await index.search({ q: "zwerchfellpumpe" });
    expect(none.total).toBe(0);
    expect(none.mode).toBe("and");
    expect(none.corrected).toBeUndefined();
  });

});
