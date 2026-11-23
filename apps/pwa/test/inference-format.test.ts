import { describe, expect, it } from "vitest";

import { anteil, byteGroesse, dauer, hatVerlauf, tempo, uhrzeit, zahl } from "../src/features/statistics/inference-format.ts";

/**
 * EPIC-P79 T79.4: die Zahlformate der Token-Tempo-Seite sind die Grenzlinie
 * zwischen „nicht gemeldet“ und „null“. Ein null, das als 0 erscheint, ist hier
 * ein Messfehler — deshalb steht der Gedankengang als Test, nicht nur im Code.
 */
describe("uhrzeit", () => {
  it("zeigt HH:MM:SS und bleibt bei Unsinn leer", () => {
    expect(uhrzeit("2026-11-22T07:51:05.188Z")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(uhrzeit("kein Zeitstempel")).toBe("—");
  });
});

describe("inference-Format (P79)", () => {
  it("null und undefined bleiben Gedankenstrich, 0 bleibt 0", () => {
    expect(zahl(null)).toBe("—");
    expect(zahl(undefined)).toBe("—");
    expect(tempo(null)).toBe("—");
    expect(anteil(null)).toBe("—");
    expect(dauer(null)).toBe("—");
    expect(byteGroesse(null)).toBe("—");
    expect(zahl(0)).toBe("0");
    expect(anteil(0)).toBe("0 %");
  });

  it("NaN und Infinity sind kein Messwert", () => {
    expect(zahl(Number.NaN)).toBe("—");
    expect(tempo(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("Großzahlen kompakt, aber unterscheidbar", () => {
    expect(zahl(127_414_980)).toBe("127,4 Mio");
    expect(zahl(12_734_123)).toBe("12,73 Mio");
    expect(zahl(12_506_524)).toBe("12,51 Mio");
    expect(zahl(2_379_251)).toBe("2,38 Mio");
    expect(zahl(922)).toBe("922");
    expect(zahl(696_724)).toBe("696.724");
  });

  it("Prompt und wiederverwendet bei 98 % Reuse nicht deckungsgleich", () => {
    const prompt = 127_414_980;
    const read = 2_379_251;
    expect(zahl(prompt)).not.toBe(zahl(prompt - read));
  });

  it("Tempo unter 100 mit einer Nachkommastelle", () => {
    expect(tempo(67.92564)).toBe("67,9");
    expect(tempo(1479.8)).toBe("1.480");
  });

  it("Anteil mit einer Nachkommastelle", () => {
    expect(anteil(0.9813267)).toBe("98,1 %");
  });

  it("Dauer in ms, Sekunden, Minuten — aufsteigend geraten", () => {
    expect(dauer(0.398)).toBe("398 ms");
    expect(dauer(2.1)).toBe("2,1 s");
    expect(dauer(75)).toBe("75 s"); // bis 120 s Sekunden — „75 s“ ist lesbarer als „1 min 15 s“
    expect(dauer(3_700)).toBe("1 h 1 min");
  });

  it("Bytes binär: GiB ab 1 GiB, sonst MiB", () => {
    expect(byteGroesse(32_751_632_384)).toBe("30,5 GiB");
    expect(byteGroesse(5 * 1024 ** 2)).toBe("5 MiB");
  });

  it("Verlauf braucht zwei unterschiedliche Punkte, sonst keine Linie", () => {
    expect(hatVerlauf([])).toBe(false);
    expect(hatVerlauf([7])).toBe(false);
    expect(hatVerlauf([5, 5, 5])).toBe(false);
    expect(hatVerlauf([1, 2, 3])).toBe(true);
  });
});
