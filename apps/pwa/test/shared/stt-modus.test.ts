import { beforeEach, describe, expect, it, vi } from "vitest";

// Der Testlauftrog ist Knoten — wie in clipboard-shelf.test.ts brauchen wir den
// Browser-Speicher als Attrappe. Dazu ein kleiner EventBus, damit das Mitteilen
// an andere Offnungen derselben App testbar bleibt.
const lagern = new Map<string, string>();
const hoerer = new Map<string, Set<(e: Event) => void>>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => lagern.get(k) ?? null,
  setItem: (k: string, v: string) => void lagern.set(k, v),
  removeItem: (k: string) => void lagern.delete(k),
  clear: () => lagern.clear(),
};
(globalThis as Record<string, unknown>).addEventListener = (typ: string, fn: (e: Event) => void) => {
  if (!hoerer.has(typ)) hoerer.set(typ, new Set());
  hoerer.get(typ)!.add(fn);
};
(globalThis as Record<string, unknown>).removeEventListener = (typ: string, fn: (e: Event) => void) => {
  hoerer.get(typ)?.delete(fn);
};
(globalThis as Record<string, unknown>).dispatchEvent = (e: Event) => {
  for (const fn of hoerer.get(e.type) ?? []) fn(e);
  return true;
};

import {
  EREIGNIS,
  grund,
  liesstModus,
  modusHinweis,
  titelDesKnopfs,
  setzeModus,
  waehlePfad,
  type SttFaehigkeiten,
} from "../../src/shared/stt-mode.ts";

// Der Schalter entscheidet pro Geraet, WELCHE Erkennung laeuft. Er darf nie
// stillschweigend in der Cloud landen, wenn jemand "lokal" gewaehlt hat.

const alles = { lokalVerfuegbar: true, aufnahmeMoeglich: true, browserFaehig: true } satisfies SttFaehigkeiten;

describe("STT-Modus: Speichern und Lesen", () => {
  beforeEach(() => {
    lagern.clear();
  });

  it("ohne gespeicherte Wahl steht Automatisch", () => {
    expect(liesstModus()).toBe("auto");
  });

  it("die Wahl bleibt über Neustarts erhalten", () => {
    expect(setzeModus("browser")).toBe("browser");
    expect(liesstModus()).toBe("browser");
    setzeModus("lokal");
    expect(liesstModus()).toBe("lokal");
  });

  it("unsinniger Speicherstand faellt auf Automatisch zurueck", () => {
    lagern.set("ancientvoid.stt-modus.v1", "wolke");
    expect(liesstModus()).toBe("auto");
  });

  it("ohne Speicher (Privacy-Modus) laeuft es trotzdem, auf Automatisch", () => {
    const vorher = globalThis.localStorage;
    (globalThis as Record<string, unknown>).localStorage = {
      getItem() {
        throw new Error("quota");
      },
      setItem() {
        throw new Error("quota");
      },
    };
    expect(liesstModus()).toBe("auto");
    expect(setzeModus("browser")).toBe("auto");
    (globalThis as Record<string, unknown>).localStorage = vorher;
  });

  it("andere Offnungen der App hoeren die Wahl sofort", () => {
    const horcht = vi.fn();
    globalThis.addEventListener(EREIGNIS, horcht);
    setzeModus("browser");
    globalThis.removeEventListener(EREIGNIS, horcht);
    expect(horcht).toHaveBeenCalledTimes(1);
  });
});

describe("STT-Modus: die Entscheidung", () => {
  // Bestands-Tests festigen Deutsch (EPIC-P61); der T61.9-Fall setzt en selbst.
  beforeEach(() => {
    lagern.set("ancientvoid.language", "de");
  });

  it("Automatisch nimmt die lokale, wenn sie da ist", () => {
    expect(waehlePfad("auto", alles)).toBe("lokal");
  });

  it("Automatisch weicht auf den Browser aus, wenn lokale fehlt", () => {
    expect(waehlePfad("auto", { ...alles, lokalVerfuegbar: false })).toBe("browser");
    expect(waehlePfad("auto", { ...alles, aufnahmeMoeglich: false })).toBe("browser");
  });

  it("Browser-Wahl bleibt im Browser, auch wenn lokale da waere", () => {
    expect(waehlePfad("browser", alles)).toBe("browser");
  });

  it("Lokal-Wahl geht NIE in die Cloud — sie sagt lieber Bescheid", () => {
    expect(waehlePfad("lokal", { ...alles, lokalVerfuegbar: false })).toBe("kein");
    expect(grund("lokal", { ...alles, lokalVerfuegbar: false })).toMatch(/nicht erreichbar/);
    expect(waehlePfad("lokal", { ...alles, aufnahmeMoeglich: false })).toBe("kein");
    expect(grund("lokal", { ...alles, aufnahmeMoeglich: false })).toMatch(/Mikrofon/);
  });

  it("kein Pfad moeglich -> klarer Hinweis statt toter Knopf", () => {
    expect(waehlePfad("auto", { ...alles, lokalVerfuegbar: false, aufnahmeMoeglich: false, browserFaehig: false })).toBe("kein");
    expect(waehlePfad("browser", { ...alles, browserFaehig: false })).toBe("kein");
    expect(grund("browser", { ...alles, browserFaehig: false })).toMatch(/keine Spracherkennung/);
  });

  it("EPIC-P61 T61.9: Titel und Hinweise folgen der gewählten Sprache", () => {
    lagern.set("ancientvoid.language", "en");
    expect(titelDesKnopfs("browser")).toBe("Speech input (browser, usually cloud)");
    expect(titelDesKnopfs("kein")).toBe("Speech input not available right now");
    expect(titelDesKnopfs("lokal", "whisper.cpp turbo")).toBe("Speech input local (whisper.cpp turbo)");
    expect(modusHinweis("browser", alles)).toMatch(/leave the device/i);
    expect(modusHinweis("lokal", alles, "whisper.cpp turbo")).toBe("Local on the hub: whisper.cpp turbo");
    lagern.set("ancientvoid.language", "de");
  });

  it("die Titel und Hinweise nennen die Quelle beim Namen", () => {
    // Der Knopf beschreibt, was ein Druck tut — nicht die Einstellung dahinter.
    expect(titelDesKnopfs("lokal", "whisper.cpp turbo")).toBe("Spracheingabe lokal (whisper.cpp turbo)");
    expect(titelDesKnopfs("browser")).toBe("Spracheingabe (Browser, meist Cloud)");
    expect(titelDesKnopfs("kein")).toBe("Spracheingabe gerade nicht möglich");
    expect(titelDesKnopfs("lokal")).toBe("Spracheingabe lokal (whisper)");
    expect(modusHinweis("browser", alles)).toMatch(/verlässt das Gerät/);
    expect(modusHinweis("lokal", alles, "whisper.cpp turbo")).toBe("lokal am Hub: whisper.cpp turbo");
  });
});
