import { describe, it, expect } from "vitest";
import type { SessionTextHit } from "@ancientvoid/contracts";
import { filterWithHits, hitKey, hitsBySession, topHit } from "../../src/features/overview/content-hits.ts";

/**
 * Sitzungsfilter der Übersicht: er muss nach **Inhalt** finden, nicht nur nach
 * Titel. Die Fundstellen kommen aus dem Sessiontext-Index (`/api/search/all`,
 * scope=sessions) und werden hier gebündelt, vermischt und ausgewählt.
 */

function hit(sessionId: string, seq: number, role: string, sessionHits: number, over: Partial<SessionTextHit> = {}): SessionTextHit {
  return {
    sessionId,
    seq,
    ts: "2026-11-23T08:00:00.000Z",
    role,
    snippet: "…",
    score: 1,
    sessionTitle: "Sitzung",
    project: "/home/kaib/repos/tokdeck",
    archived: false,
    sessionHits,
    ...over,
  } as SessionTextHit;
}

describe("Sitzungsfilter mit Inhaltstreffer", () => {
  it("bündelt Fundstellen pro Sitzung und merkt sich die früheste als Sprungziel", () => {
    const map = hitsBySession([hit("a", 40, "assistant", 3), hit("a", 12, "user", 3), hit("b", 7, "user", 1)]);
    expect(map.get(hitKey("a"))).toEqual({ count: 3, seq: 12, roles: ["assistant", "user"] });
    expect(map.get(hitKey("b"))?.seq).toBe(7);
  });

  it("mischt Fundstellen anderer Hub-Rechner nicht in die Übersicht", () => {
    // Der Sitzungsfilter sucht auf diesem Rechner; Cross-Hub bleibt die Suche.
    const map = hitsBySession([hit("a", 1, "user", 1), hit("a", 2, "user", 4, { hub: "kaisgamingdesk" } as never)]);
    expect(map.get(hitKey("a"))?.count).toBe(4);
    expect(map.size).toBe(1);
  });

  it("lässt Sitzungen durch, die nur inhaltlich passen", () => {
    const sessions = [
      { id: "a", hostId: null, title: "Tokdeck" },
      { id: "b", hostId: null, title: "Powermeter" },
      { id: "c", hostId: null, title: "Unbeteiligt" },
    ];
    const hits = hitsBySession([hit("b", 9, "assistant", 6)]);
    const out = filterWithHits(sessions, (x) => (x.title ?? "").toLowerCase().includes("tokdeck"), hits);
    // Inhalt vor Titel: die gesuchte Sitzung steht vorn, der Titel-Treffer bleibt.
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("ohne Fundstellen bleibt der alte Titelfilter gelten", () => {
    const sessions = [{ id: "a", hostId: null, title: "Tokdeck" }, { id: "c", hostId: null, title: "Andere" }];
    const out = filterWithHits(sessions, (x) => (x.title ?? "").toLowerCase().includes("tokdeck"), new Map());
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });

  it("Enter nimmt die Sitzung mit den meisten Fundstellen", () => {
    const sessions = [{ id: "a", hostId: null }, { id: "b", hostId: null }];
    const hits = hitsBySession([hit("a", 3, "user", 2), hit("b", 88, "user", 9)]);
    const top = topHit(sessions, hits);
    expect(top?.session.id).toBe("b");
    expect(top?.hit.seq).toBe(88);
    expect(topHit(sessions, new Map())).toBeNull();
  });
});
