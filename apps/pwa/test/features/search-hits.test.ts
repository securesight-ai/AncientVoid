import { describe, it, expect } from "vitest";
import type { HubSearchStatus, SessionTextHit } from "@ancientvoid/contracts";
import { DEFAULT_ROLES, ROLE_KEYS, ROLE_ORDER, groupHits, hiddenFacetRoles, hubStatusLine, roleLabel, splitSnippet, toggleRole } from "../../src/features/search/session-hits.tsx";
import { projectName } from "../../src/shared/project-name.ts";

/**
 * Suche (Nachschärfe 2026-11-22): die Fundstellen-Logik der PWA. Hier sitzt
 * genau das, was im Browser schwer zu sehen ist — Marker in Fundtexten,
 * Gruppierung pro Sitzung, und die Frage, was passiert, wenn man den letzten
 * Rollen-Chip abschaltet.
 */

function hit(over: Partial<SessionTextHit> & { sessionId: string; seq: number }): SessionTextHit {
  return {
    ts: "2026-11-22T08:00:00.000Z",
    role: "user",
    snippet: "text",
    score: 1,
    sessionTitle: null,
    project: "/home/kaib/repos/x",
    archived: false,
    sessionHits: 1,
    ...over,
  };
}

describe("splitSnippet — Fundwort als eigenes Stück", () => {
  it("zerlegt markierte Snippets in Text und Funde", () => {
    const pieces = splitSnippet("vorher \u0002Flowkey\u0003 danach \u0002Jahresabo\u0003 ende");
    expect(pieces.map((p) => p.text)).toEqual(["vorher ", "Flowkey", " danach ", "Jahresabo", " ende"]);
    expect(pieces.map((p) => p.hit)).toEqual([false, true, false, true, false]);
  });

  it("ein Snippet ohne Marker bleibt ein Stück — qmd markiert nicht", () => {
    expect(splitSnippet("nur text ohne fund")).toEqual([{ text: "nur text ohne fund", hit: false }]);
  });

  it("ein halbes Markerpaar wird nicht zur Markierung", () => {
    // Agententexte können Einzelzeichen enthalten. Markiert wird nur, wenn das
    // Paar komplett da ist — sonst entstünde ein Scheintreffer aus Müll.
    const pieces = splitSnippet("nur \u0002ein stück");
    expect(pieces).toEqual([{ text: "nur \u0002ein stück", hit: false }]);
  });

  it("jede Rolle ist beschriftet, nie roh", () => {
    for (const role of ROLE_ORDER) {
      expect(ROLE_KEYS[role], role).toBeTruthy();
      expect(roleLabel(role)).not.toBe(ROLE_KEYS[role]);
      expect(roleLabel(role).length).toBeGreaterThan(0);
    }
  });
});

describe("groupHits — eine Sitzung, ein Block", () => {
  it("gruppiert in Reihenfolge der besten Fundstelle und zählt pro Sitzung", () => {
    const groups = groupHits([
      hit({ sessionId: "a", seq: 10, sessionTitle: "Sitzung A", sessionHits: 4 }),
      hit({ sessionId: "b", seq: 3, sessionTitle: "Sitzung B", sessionHits: 1 }),
      hit({ sessionId: "a", seq: 11, sessionTitle: "Sitzung A", sessionHits: 4 }),
    ]);
    expect(groups.map((g) => g.sessionId)).toEqual(["a", "b"]);
    expect(groups[0]!.total).toBe(4);
    expect(groups[0]!.hits.map((h) => h.seq)).toEqual([10, 11]);
  });

  it("blättert pro Sitzung ab, aber die Gesamtzahl bleibt ehrlich", () => {
    const many = Array.from({ length: 7 }, (_, i) => hit({ sessionId: "a", seq: i + 1, sessionHits: 7 }));
    const groups = groupHits(many);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.hits).toHaveLength(3);
    expect(groups[0]!.total).toBe(7);
  });

  it("ohne Titel bleibt die Kurzform der Session-id als Kopf", () => {
    const groups = groupHits([hit({ sessionId: "27069f67-a3da-4397-9dfd-28fbe3101fa0", seq: 1, sessionTitle: null })]);
    expect(groups[0]!.title).toBe("");
  });
});

describe("Rollen-Chips", () => {
  it("Standard ist die Unterhaltung, nicht die Denk- und Werkzeugmasse", () => {
    expect(DEFAULT_ROLES).toEqual(["user", "assistant"]);
    expect(ROLE_ORDER).toEqual(["user", "assistant", "thinking", "tool", "system"]);
  });

  it("trägt den Rechner einer Fremdsitzung an die Gruppe", () => {
    const groups = groupHits([
      hit({ sessionId: "a", seq: 1 }),
      hit({ sessionId: "b", seq: 2, hub: "kaisgamingdesk", hubUrl: "https://kaisgamingdesk.tail" } as never),
    ]);
    expect(groups[0]?.hub).toBeUndefined();
    expect(groups[1]).toMatchObject({ sessionId: "b", hub: "kaisgamingdesk", hubUrl: "https://kaisgamingdesk.tail" });
  });

  it("benennt den Zustand jedes Hub-Rechners — ein toter ist ein Ergebnis", () => {
    const line = (over: Partial<HubSearchStatus> & Pick<HubSearchStatus, "state">) =>
      hubStatusLine({ hostId: "andre", label: "andre.tail", sessions: 3, docs: 1, ...over });
    expect(line({ state: "ok" })).toEqual({ key: "search.hub_ok", params: { label: "andre.tail", sessions: 3, docs: 1 } });
    expect(line({ state: "offline" }).key).toBe("search.hub_offline");
    expect(line({ state: "denied" }).key).toBe("search.hub_denied");
    expect(line({ state: "unsupported" }).key).toBe("search.hub_unsupported");
    expect(line({ state: "skipped" }).key).toBe("search.hub_skipped");
    expect(line({ state: "error", note: "HTTP 500" })).toEqual({ key: "search.hub_error", params: { label: "andre.tail", note: "HTTP 500" } });
    // Ohne lesbaren Namen bleibt die Kurzform des Rechners stehen.
    expect(hubStatusLine({ hostId: "andre", state: "offline", sessions: 0, docs: 0 }).params.label).toBe("andre");
  });

  it("schaltet zu und ab, und der letzte Chip bleibt stehen", () => {
    const withThinking = toggleRole(DEFAULT_ROLES, "thinking");
    expect(withThinking).toContain("thinking");
    expect(toggleRole(withThinking, "thinking")).toEqual(DEFAULT_ROLES);
    // Eine Suche ohne jede Rolle gibt es nicht — sonst füllt der Hub still die
    // Standardrolle auf, und die Oberfläche zeigt etwas anderes als gewählt.
    expect(toggleRole(["assistant"], "assistant")).toEqual(["assistant"]);
  });

  it("nennt den Kurznamen eines Projekts, auch mit Schrägstrichen am Ende", () => {
    expect(projectName("/home/kaib/repos/tokdeck")).toBe("tokdeck");
    expect(projectName("/home/kaib/repos/tokdeck/")).toBe("tokdeck");
    expect(projectName("/")).toBe("/");
  });

  it("zählt die Fundstellen in abgeschalteten Rollen, damit eine leere Liste nicht lügt", () => {
    const facets = [
      { role: "user" as const, count: 2 },
      { role: "assistant" as const, count: 18 },
      { role: "thinking" as const, count: 284 },
      { role: "tool" as const, count: 765 },
    ];
    const hidden = hiddenFacetRoles(facets, DEFAULT_ROLES);
    expect(hidden.roles).toEqual(["thinking", "tool"]);
    expect(hidden.count).toBe(1049);
    // Alles an: nichts verborgen — der Hinweis darf nicht stehenbleiben.
    expect(hiddenFacetRoles(facets, ROLE_ORDER)).toEqual({ roles: [], count: 0 });
    // Eine Facette mit 0 ist keine versteckte Fundstelle.
    expect(hiddenFacetRoles([{ role: "system", count: 0 }], DEFAULT_ROLES).count).toBe(0);
  });
});
