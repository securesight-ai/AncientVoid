import { describe, expect, it } from "vitest";
import { clearViewHistory, peekView, popEntry, popView, rememberView } from "../../src/shared/nav-history.ts";
/** Navigations-Historie: überlagernde Ansichten merken sich den Zustand davor
 * (LIFO) — Schließen stellt exakt die zuletzt sichtbare Ansicht wieder her. */
describe("nav-history", () => {
  it("merkt und poppt in LIFO-Reihenfolge", () => {
    clearViewHistory();
    rememberView("#/sessions/a");
    rememberView("#/notizen");
    expect(peekView()).toBe("#/notizen");
    expect(popView()).toBe("#/notizen");
    expect(popView()).toBe("#/sessions/a");
  });

  it("doppelter gleicher Schritt hintereinander ist kein eigener Eintrag", () => {
    clearViewHistory();
    rememberView("#/sessions/a");
    rememberView("#/sessions/a");
    expect(popView()).toBe("#/sessions/a");
    expect(popView()).toBeNull();
  });

  it("leerer Hash fällt auf die Übersicht zurück, nie auf leer", () => {
    clearViewHistory();
    rememberView("");
    expect(popView()).toBe("#/");
  });

  it("gleicher Hash erneut: Kachel-Referenz wird am bestehenden Eintrag nachgetragen", () => {
    clearViewHistory();
    rememberView("#/sessions/a");
    rememberView("#/sessions/a", { sessionId: "a" });
    const entry = popEntry();
    expect(entry?.hash).toBe("#/sessions/a");
    expect(entry?.tileRef).toEqual({ sessionId: "a" });
    expect(popEntry()).toBeNull();
  });
  it("Stack ist gedeckelt — ältestes fällt zuerst raus", () => {
    clearViewHistory();
    for (let i = 0; i < 40; i++) rememberView(`#/x/${i}`);
    expect(peekView()).toBe("#/x/39");
    expect(popView()).toBe("#/x/39");
    expect(popView()).toBe("#/x/38");
    for (let i = 0; i < 29; i++) popView();
    expect(popView()).toBe("#/x/8");
    expect(popView()).toBeNull();
  });

  it("pop auf leerem Stack ergibt null (Aufrufer fällt auf Übersicht zurück)", () => {
    clearViewHistory();
    expect(popView()).toBeNull();
    expect(peekView()).toBeNull();
  });
});
