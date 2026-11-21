import { describe, expect, it } from "vitest";
import { emptyWorkspace, openInNewTile, parseWorkspace, serializeWorkspace, setLayout, setLayoutFixed, visibleTiles } from "../../../src/features/workspace/tiles.ts";

describe("Inhalte ohne Verdrängen öffnen", () => {
  it("gelöst: behält auch beim fünften Inhalt alle Karten und stellt sie wieder her", () => {
    let ws = setLayoutFixed(emptyWorkspace(), false);
    for (const sessionId of ["a", "b", "c", "d", "e"]) ws = openInNewTile(ws, { sessionId });
    expect(visibleTiles(ws).map((ref) => ref?.sessionId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(parseWorkspace(serializeWorkspace(ws))).toEqual(ws);
  });
  it("gelöst: überschreibt keine durch ein kleineres Layout verborgenen Inhalte", () => {
    let ws = setLayoutFixed(emptyWorkspace(), false);
    for (const sessionId of ["a", "b", "c", "d"]) ws = openInNewTile(ws, { sessionId });
    ws = openInNewTile(setLayout(ws, "1"), { sessionId: "e" });
    expect(ws.slots.filter(Boolean).map((ref) => ref?.sessionId)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("gelöst: unterscheidet Session, Graph und Dateien derselben Session", () => {
    let ws = setLayoutFixed(emptyWorkspace(), false);
    ws = openInNewTile(ws, { sessionId: "a" });
    ws = openInNewTile(ws, { sessionId: "a", content: { kind: "session", tab: "graph" } });
    ws = openInNewTile(ws, { sessionId: "a", content: { kind: "session", tab: "datei", file: "a.ts" } });
    expect(visibleTiles(ws)).toHaveLength(3);
    expect(visibleTiles(ws).every(Boolean)).toBe(true);
    expect(parseWorkspace(serializeWorkspace(ws))).toEqual(ws);
  });
  it("fokussiert vorhandene Inhalte ohne ihre Referenz und ihren Render-Key zu ersetzen", () => {
    const ref = { hostId: "remote", sessionId: "a", content: { kind: "session" as const, tab: "graph" as const } };
    const ws = openInNewTile(emptyWorkspace(), ref);
    const focused = openInNewTile(ws, { sessionId: "a", hostId: "remote", content: { tab: "graph", kind: "session" } });
    expect(focused.slots).toBe(ws.slots);
    expect(focused.slots[0]).toBe(ref);
  });

});
