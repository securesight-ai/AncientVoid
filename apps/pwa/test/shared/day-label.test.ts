import { describe, expect, it } from "vitest";
import { dayKey, dayLabel, needsDaySeparator } from "../../src/shared/i18n/day-label.ts";
import { itemTs } from "../../src/features/session/turns.ts";

// Bewusst feste lokale Zeitpunkte: der Trenner hängt am lokalen Kalender, nicht an UTC.
const HEUTE = new Date(2026, 10, 23, 14, 5, 0); // 23.11.2026 14:05 lokal

describe("dayKey (lokaler Kalendertag)", () => {
  it("wechselt um Mitternacht, nicht um 00:00 UTC", () => {
    const vorMitternacht = new Date(2026, 10, 23, 23, 59, 59);
    const nachMitternacht = new Date(2026, 10, 24, 0, 0, 1);
    expect(dayKey(vorMitternacht)).toBe("2026-11-23");
    expect(dayKey(nachMitternacht)).toBe("2026-11-24");
  });
});

describe("dayLabel", () => {
  it("nennt heute und gestern mit Namen", () => {
    expect(dayLabel(HEUTE, HEUTE)).toBe("Heute");
    const gestern = new Date(2026, 10, 22, 9, 0, 0);
    expect(dayLabel(gestern, HEUTE)).toBe("Gestern");
  });

  it("zeigt im selben Jahr Wochentag und Datum, ohne das Jahr", () => {
    const label = dayLabel(new Date(2026, 10, 21, 8, 0, 0), HEUTE);
    expect(label).toContain("21.11.");
    expect(label).not.toContain("2026");
  });

  it("zeigt fuer ein anderes Jahr das Datum mit Jahr", () => {
    expect(dayLabel(new Date(2025, 0, 3, 8, 0, 0), HEUTE)).toContain("03.01.2025");
  });

  it("zaehlt gestern ueber Monats- und Jahresgrenze richtig", () => {
    expect(dayLabel(new Date(2026, 9, 31, 23, 0, 0), new Date(2026, 10, 1, 1, 0, 0))).toBe("Gestern");
    expect(dayLabel(new Date(2025, 11, 31, 23, 0, 0), new Date(2026, 0, 1, 1, 0, 0))).toBe("Gestern");
  });
});

describe("needsDaySeparator", () => {
  it("steht vor dem ersten Eintrag — sonst fehlt der Anker", () => {
    expect(needsDaySeparator(null, HEUTE.toISOString())).toBe(true);
    expect(needsDaySeparator(undefined, HEUTE.toISOString())).toBe(true);
  });

  it("bleicht innerhalb eines Tages aus und kommt am Tageswechsel", () => {
    expect(needsDaySeparator(HEUTE.toISOString(), new Date(2026, 10, 23, 22, 0).toISOString())).toBe(false);
    expect(needsDaySeparator(HEUTE.toISOString(), new Date(2026, 10, 24, 6, 0).toISOString())).toBe(true);
  });
});

describe("itemTs (Chat-Eintrag -> Zeit)", () => {
  it("nutzt Ereigniszeit, Zuganfang, und keine Zeit fuer unbekannte Sammelzeilen", () => {
    expect(itemTs({ kind: "event", event: { ts: "2026-11-23T13:00:00Z" } as never })).toBe("2026-11-23T13:00:00Z");
    expect(itemTs({ kind: "work", key: "w", entries: [], running: false, startTs: "2026-11-22T10:00:00Z", endTs: "2026-11-22T10:05:00Z" })).toBe("2026-11-22T10:00:00Z");
    expect(itemTs({ kind: "unknown", key: "u", count: 3, firstSeq: 7 })).toBeUndefined();
  });
});
