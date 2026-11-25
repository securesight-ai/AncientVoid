import { describe, expect, it } from "vitest";
import { parseAppHash, pageHash } from "../../../src/app/route.ts";
import { popoutUrl, tileWindowTarget, type WindowTarget } from "../../../src/features/windows/protocol.ts";
import type { TileRef } from "../../../src/features/workspace/tiles.ts";

/** BUG-0262: eine Kachel muss sich als das Fenster lösen, das sie ist. Seiten-Kacheln wurden
 * als `{ kind: "session", sessionId: "" }` geöffnet — `#/sessions/` ist keine Route, das
 * Fenster zeigte „Dieses Fenster hat kein Ziel." und die Kachel war trotzdem abgelöst. */
describe("tileWindowTarget (BUG-0262)", () => {
  const tile = (ref: Omit<TileRef, "content"> & Partial<Pick<TileRef, "content">>): TileRef =>
    ({ ...ref, content: ref.content ?? undefined }) as TileRef;

  /** Das Ziel muss durch die URL zurück in dieselbe Ansicht parsen — genau das brach. */
  const roundTrip = (target: WindowTarget) => {
    const url = new URL(popoutUrl(target), "http://hub.local");
    expect(url.searchParams.get("window")).toBe("1");
    return parseAppHash(url.hash);
  };

  it("Notizen-Kachel wird Vault-Fenster (hello-Schlüssel rundet), nicht leeres Session-Fenster", () => {
    const target = tileWindowTarget(tile({ sessionId: "", content: { kind: "page", page: "vault" } }));
    expect(target).toEqual({ kind: "vault" });
    expect(roundTrip(target!)).toEqual({ view: "list", page: "vault" });
  });

  it("Vault-Datei-Kachel öffnet die Datei, nicht die Leere", () => {
    const target = tileWindowTarget(tile({ sessionId: "", content: { kind: "page", page: "vault", vaultFile: "team/handbuch.md" } }));
    expect(target).toEqual({ kind: "vault", path: "team/handbuch.md" });
    expect(roundTrip(target!)).toEqual({ view: "list", page: "vault", vaultFile: "team/handbuch.md" });
  });

  it("jede Werkzeugseite wird als Werkzeugfenster gelöst", () => {
    for (const page of ["settings", "status", "swarms", "statistics", "terminal"] as const) {
      expect(tileWindowTarget(tile({ sessionId: "", content: { kind: "page", page } }))).toEqual({ kind: "tool", page });
    }
  });

  it("Session-Kachel bleibt Session-Fenster — mit und ohne Inhaltsreiter", () => {
    expect(tileWindowTarget(tile({ sessionId: "abc" }))).toEqual({ kind: "session", sessionId: "abc" });
    expect(tileWindowTarget(tile({ sessionId: "abc", hostId: "h1", content: { kind: "session", tab: "diff" } }))).toEqual({ kind: "session", sessionId: "abc", hostId: "h1" });
  });

  it("Geräte- und Browser-Kacheln werden zu ihren Fenstern", () => {
    expect(tileWindowTarget(tile({ sessionId: "", content: { kind: "devices" } }))).toEqual({ kind: "device" });
    expect(roundTrip({ kind: "device" })).toEqual({ view: "devices" });
    expect(tileWindowTarget(tile({ sessionId: "s1", content: { kind: "browser" } }))).toEqual({ kind: "browser", sessionId: "s1" });
    // Browser-Kachel ohne Session hat keine Fensteradresse — keins statt eines kaputten.
    expect(tileWindowTarget(tile({ sessionId: "", content: { kind: "browser" } }))).toBeNull();
  });

  it("Karten ohne Fensteradresse lösen sich gar nicht ab (Neu, Suche, Datei)", () => {
    expect(tileWindowTarget(tile({ sessionId: "", content: { kind: "page", page: "new" } }))).toBeNull();
    expect(tileWindowTarget(tile({ sessionId: "s1", content: { kind: "search" } }))).toBeNull();
    expect(tileWindowTarget(tile({ sessionId: "", content: { kind: "file", target: "session=x", path: "a.md" } }))).toBeNull();
  });

  it("Dokumentation des alten Fehlers: eine leere Session-ID ist keine Fensteradresse", () => {
    // Vor dem Fix baute popoutTile genau dieses Ziel für jede Seiten-Kachel.
    const hash = new URL(popoutUrl({ kind: "session", sessionId: "" }), "http://hub.local").hash;
    expect(parseAppHash(hash)).toEqual({ view: "list", page: "dashboard" });
    expect(pageHash("vault")).not.toBe(hash);
  });
});
