import { describe, expect, it } from "vitest";
import { showActorSuffix } from "../../../src/features/session/actor-display.ts";

// BUG-0281: Der Geräte-Kurzlabel (Token-Name) ist nur Information, wenn mehrere
// verschiedene Akteure im Chat erscheinen. Mit genau einem Akteur ist er
// mehrdeutig oder veraltet und soll dem nackten „Du“ weichen.

describe("showActorSuffix (BUG-0281)", () => {
  it("zeigt den Suffix nicht, wenn nur ein Akteur auftritt", () => {
    expect(showActorSuffix(["handy", "handy", undefined])).toBe(false);
  });

  it("zeigt den Suffix, wenn zwei verschiedene Akteure auftreten", () => {
    expect(showActorSuffix(["handy", "pc"])).toBe(true);
  });

  it("ohne Akteure gibt es keinen Suffix", () => {
    expect(showActorSuffix([undefined, null, ""])).toBe(false);
  });

  it("leere und fehlende Labels zählen nicht als zweiter Akteur", () => {
    expect(showActorSuffix(["pc", "", undefined, null, "pc"])).toBe(false);
  });
});
