import { describe, expect, it } from "vitest";
import { closeTile, compactTiles, detachTile, focusOpenSession, isDetached, isLayoutFixed, openInTile, reattach, cycleLayout, emptyWorkspace, focusTile, openInNewTile, openSession, parseWorkspace, serializeWorkspace, setLayout, setLayoutFixed, swapWith, tileCount, visibleTiles } from "../../../src/features/workspace/tiles.ts";

const a = { sessionId: "a" };
const b = { sessionId: "b" };
const c = { sessionId: "c", hostId: "h2" };

describe("Kachel-Zustand (T18.2)", () => {
  it("startet mit einer leeren, fixierten Kachel", () => {
    const ws = emptyWorkspace();
    expect(ws.layout).toBe("1");
    expect(ws.layoutFixed).toBe(true);
    expect(visibleTiles(ws)).toEqual([null]);
  });

  it("Öffnen füllt die Fokus-Kachel, eine schon sichtbare Session bekommt nur den Fokus", () => {
    let ws = setLayout(emptyWorkspace(), "2v");
    ws = openSession(ws, a);
    expect(visibleTiles(ws)).toEqual([a, null]);
    ws = focusTile(ws, 1);
    ws = openSession(ws, b);
    expect(visibleTiles(ws)).toEqual([a, b]);
    ws = openSession(ws, a);
    expect(ws.focus).toBe(0);
    expect(visibleTiles(ws)).toEqual([a, b]);
  });

  it("eine belegte Fokus-Kachel lässt freie Kacheln zuerst füllen", () => {
    let ws = openSession(setLayout(emptyWorkspace(), "2v"), a);
    ws = openSession(ws, b);
    expect(visibleTiles(ws)).toEqual([a, b]);
    expect(ws.focus).toBe(1);
  });

  it("gelöst: in einer neuen Kachel öffnen wächst 1 → 2v → 1+2 → 2x2, danach wächst das Grid ohne Verdrängen", () => {
    let ws = setLayoutFixed(openSession(emptyWorkspace(), a), false);
    ws = openInNewTile(ws, b);
    expect(ws.layout).toBe("2v");
    ws = openInNewTile(ws, c);
    expect(ws.layout).toBe("1+2");
    ws = openInNewTile(ws, { sessionId: "d" });
    expect(ws.layout).toBe("2x2");
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "b", "c", "d"]);
    ws = openInNewTile(ws, { sessionId: "e" });
    expect(ws.layout).toBe("2x2");
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("kleineres Layout verliert nichts: zurück auf 2x2 sind alle wieder da", () => {
    let ws = setLayout(emptyWorkspace(), "2x2");
    for (const [i, s] of ["a", "b", "c", "d"].entries()) ws = openSession(focusTile(ws, i), { sessionId: s });
    ws = setLayout(ws, "2v");
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "b"]);
    expect(ws.focus).toBe(1);
    ws = setLayout(ws, "2x2");
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("Layout-Zyklus vor und zurück", () => {
    expect(cycleLayout(emptyWorkspace(), 1).layout).toBe("2v");
    expect(cycleLayout(cycleLayout(emptyWorkspace(), 1), 1).layout).toBe("3v");
    expect(cycleLayout(emptyWorkspace(), -1).layout).toBe("2x2");
    expect(tileCount("1+2")).toBe(3);
    expect(tileCount("3v")).toBe(3);
  });

  it("3v zeigt drei Kacheln; ein versteckter Slot bleibt beim Wechsel erhalten", () => {
    let ws = setLayout(emptyWorkspace(), "3v");
    for (const s of ["a", "b", "c"]) ws = openSession(ws, { sessionId: s });
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "b", "c"]);
    ws = setLayout(ws, "2x2");
    expect(visibleTiles(ws).map((t) => t?.sessionId ?? null)).toEqual(["a", "b", "c", null]);
    expect(ws.focus).toBe(2);
  });

  it("Fokus nur auf sichtbare Kacheln", () => {
    expect(focusTile(emptyWorkspace(), 3).focus).toBe(0);
    expect(focusTile(setLayout(emptyWorkspace(), "3v"), 3).focus).toBe(0);
  });

  it("Tauschen bewegt die Fokus-Session, der Fokus wandert mit", () => {
    let ws = setLayout(emptyWorkspace(), "2v");
    ws = openSession(ws, a);
    ws = openSession(ws, b);
    ws = focusTile(ws, 0);
    ws = swapWith(ws, 1);
    expect(visibleTiles(ws)).toEqual([b, a]);
    expect(ws.focus).toBe(1);
  });

  it("fixiert: Schließen lässt leere Slots; gelöst: Schließen schrumpft", () => {
    let ws = openSession(setLayout(emptyWorkspace(), "2v"), a);
    ws = openSession(ws, b);
    ws = closeTile(ws, 1);
    expect(visibleTiles(ws)).toEqual([a, null]);
    expect(ws.layout).toBe("2v");
    ws = setLayoutFixed(openSession(setLayout(setLayoutFixed(ws, false), "2v"), b), false);
    ws = closeTile(ws, 1);
    expect(visibleTiles(ws)).toEqual([a]);
    expect(ws.layout).toBe("1");
  });

  it("Speichern und Laden, kaputte Daten ergeben einen leeren Arbeitsplatz", () => {
    let ws = openInNewTile(openSession(setLayout(emptyWorkspace(), "2v"), a), c);
    expect(parseWorkspace(serializeWorkspace(ws))).toEqual(ws);
    expect(parseWorkspace("{kaputt")).toEqual(emptyWorkspace());
    expect(parseWorkspace(JSON.stringify({ layout: "9x9", slots: [], focus: 7 }))).toEqual(emptyWorkspace());
    ws = parseWorkspace(JSON.stringify({ layout: "2v", slots: [{ sessionId: "a" }, { sessionId: 5 }, null, null], focus: 1 }));
    expect(visibleTiles(ws)).toEqual([a, null]);
    expect(isLayoutFixed(ws)).toBe(true);
  });
});

describe("Layout fixieren und Session-Reuse", () => {
  it("Default ist fixiert: wächst nicht und ersetzt die Fokus-Kachel", () => {
    let ws = openSession(setLayout(emptyWorkspace(), "2v"), a);
    expect(isLayoutFixed(ws)).toBe(true);
    ws = openInNewTile(ws, b);
    expect(ws.layout).toBe("2v");
    expect(visibleTiles(ws)).toEqual([a, b]);
    ws = openInNewTile(ws, c);
    expect(ws.layout).toBe("2v");
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "c"]);
    expect(ws.focus).toBe(1);
  });

  it("fixiert: anderer Tab derselben Session aktualisiert die Karte statt neu zu öffnen", () => {
    let ws = openInNewTile(emptyWorkspace(), { sessionId: "a", content: { kind: "session", tab: "chat" } });
    ws = openInNewTile(ws, { sessionId: "a", content: { kind: "session", tab: "graph" } });
    expect(visibleTiles(ws)).toHaveLength(1);
    expect(visibleTiles(ws)[0]).toEqual({ sessionId: "a", content: { kind: "session", tab: "graph" } });
  });

  it("fixiert: Schließen lässt leere Slots stehen; Lösen kompaktiert", () => {
    let ws = openSession(openSession(setLayout(emptyWorkspace(), "2v"), a), b);
    ws = closeTile(ws, 0);
    expect(ws.layout).toBe("2v");
    expect(visibleTiles(ws)).toEqual([null, b]);
    ws = setLayoutFixed(ws, false);
    expect(visibleTiles(ws)).toEqual([b]);
    expect(ws.layout).toBe("1");
    expect(ws.layoutFixed).toBe(false);
  });

  it("focusOpenSession springt zur offenen Session, ohne Inhalt zu überschreiben", () => {
    const graph = { sessionId: "a", content: { kind: "session" as const, tab: "graph" as const } };
    let ws = openInNewTile(setLayout(emptyWorkspace(), "2v"), graph);
    ws = openInNewTile(ws, b);
    const focused = focusOpenSession(ws, { sessionId: "a", content: { kind: "session", tab: "chat" } });
    expect(focused?.focus).toBe(0);
    expect(focused?.slots[0]).toEqual(graph);
    expect(focusOpenSession(ws, { sessionId: "missing" })).toBeNull();
  });

  it("layoutFixed Default an; explizit false übersteht Speichern und Laden", () => {
    expect(parseWorkspace(serializeWorkspace(emptyWorkspace())).layoutFixed).toBe(true);
    expect(parseWorkspace(JSON.stringify({ layout: "1", slots: [null, null, null, null], focus: 0 })).layoutFixed).toBe(true);
    const unlocked = setLayoutFixed(emptyWorkspace(), false);
    expect(parseWorkspace(serializeWorkspace(unlocked)).layoutFixed).toBe(false);
  });
});

describe("BUG-0244: Neue Session in Kachel 1", () => {
  const neu = { sessionId: "", content: { kind: "page" as const, page: "new" as const } };

  it("pinnt Neue Session auf Index 0 und verschiebt die alte Kachel 1", () => {
    let ws = openSession(setLayout(emptyWorkspace(), "2v"), a);
    ws = openInTile(ws, neu, 0);
    expect(visibleTiles(ws)[0]).toEqual(neu);
    expect(visibleTiles(ws).some((t) => t?.sessionId === "a")).toBe(true);
    expect(ws.focus).toBe(0);
  });

  it("erneutes Öffnen fokussiert Kachel 1, ohne zu verdoppeln", () => {
    let ws = openInTile(openSession(emptyWorkspace(), a), neu, 0);
    ws = openInTile(ws, neu, 0);
    expect(visibleTiles(ws).filter((t) => t && JSON.stringify(t) === JSON.stringify(neu))).toHaveLength(1);
    expect(ws.focus).toBe(0);
  });
});

describe("Abgelöste Kacheln (EPIC-P34 T34.10)", () => {
  it("ablösen entfernt die Kachel kompakt und merkt die Session; zurückholen öffnet sie wieder", () => {
    let ws = openSession(setLayout(emptyWorkspace(), "2v"), a);
    ws = openSession(ws, b);
    ws = detachTile(ws, 0);
    // BUG-0245: keine leere Nachbar-Kachel — Layout schrumpft auf die Rest-Session.
    expect(visibleTiles(ws)).toEqual([b]);
    expect(ws.layout).toBe("1");
    expect(isDetached(ws, a)).toBe(true);
    ws = reattach(ws, a);
    expect(isDetached(ws, a)).toBe(false);
    expect(visibleTiles(ws).some((t) => t?.sessionId === "a")).toBe(true);
  });

  it("compactTiles schließt Lücken und schrumpft das Layout", () => {
    const ws = compactTiles({ layout: "2x2", slots: [null, a, null, b], focus: 3 });
    expect(visibleTiles(ws)).toEqual([a, b]);
    expect(ws.layout).toBe("2v");
  });

  it("eine leere Kachel löst nichts ab; doppeltes Ablösen führt die Session nur einmal", () => {
    const ws = setLayout(emptyWorkspace(), "2v");
    expect(detachTile(ws, 1)).toBe(ws);
    const once = detachTile(openSession(ws, a), 0);
    expect(once.detached).toEqual([a]);
    expect(reattach(reattach(once, a), a).detached ?? []).toEqual([]);
  });

  it("detached übersteht Speichern und Laden; alte Stände ohne das Feld bleiben gültig", () => {
    const ws = detachTile(openSession(emptyWorkspace(), c), 0);
    expect(parseWorkspace(serializeWorkspace(ws)).detached).toEqual([c]);
    expect(parseWorkspace(JSON.stringify({ layout: "1", slots: [a, null, null, null], focus: 0 })).detached).toBeUndefined();
    expect(parseWorkspace(JSON.stringify({ layout: "1", slots: [null, null, null, null], focus: 0, detached: [{ sessionId: 5 }, "x", a] })).detached).toEqual([a]);
  });
});
