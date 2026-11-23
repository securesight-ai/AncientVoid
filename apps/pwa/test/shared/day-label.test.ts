import { describe, expect, it } from "vitest";
import { dayKey, dayLabel, needsDaySeparator, stampLabel } from "../../src/shared/i18n/day-label.ts";
import { fmtDate, fmtTime } from "../../src/shared/i18n/format.ts";
import { t } from "../../src/shared/i18n/index.ts";
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
  it("nennt heute und gestern mit Namen — in der Sprache des Geräts", () => {
    // Die Labels kommen aus dem Katalog; der Test haengt nicht an der Systemsprache des Laufers.
    expect(dayLabel(HEUTE, HEUTE)).toBe(t("common.day_today"));
    expect(dayLabel(new Date(2026, 10, 22, 9, 0, 0), HEUTE)).toBe(t("common.day_yesterday"));
  });

  it("zeigt im selben Jahr Wochentag und Datum, ohne das Jahr", () => {
    const datum = new Date(2026, 10, 21, 8, 0, 0);
    const label = dayLabel(datum, HEUTE);
    expect(label).toBe(fmtDate(datum, { weekday: "short", day: "2-digit", month: "2-digit" }));
    expect(label).not.toContain("2026");
  });

  it("zeigt fuer ein anderes Jahr das Datum mit Jahr", () => {
    const alt = new Date(2025, 0, 3, 8, 0, 0);
    expect(dayLabel(alt, HEUTE)).toBe(fmtDate(alt, { day: "2-digit", month: "2-digit", year: "numeric" }));
  });

  it("zaehlt gestern ueber Monats- und Jahresgrenze richtig", () => {
    expect(dayLabel(new Date(2026, 9, 31, 23, 0, 0), new Date(2026, 10, 1, 1, 0, 0))).toBe(t("common.day_yesterday"));
    expect(dayLabel(new Date(2025, 11, 31, 23, 0, 0), new Date(2026, 0, 1, 1, 0, 0))).toBe(t("common.day_yesterday"));
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

describe("stampLabel (Stempel an der Nachricht)", () => {
  it("heute reicht die Uhrzeit, ab gestern steht der Tag davor", () => {
    // Uhrzeitformat folgt der App-Sprache — verglichen wird gegen dasselbe Format.
    const uhr = (d: Date) => fmtTime(d.toISOString(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const heute = new Date(2026, 10, 23, 9, 57, 50);
    expect(stampLabel(heute.toISOString(), HEUTE)).toBe(uhr(heute));
    const gestern = new Date(2026, 10, 22, 9, 57, 50);
    expect(stampLabel(gestern.toISOString(), HEUTE)).toBe(`${t("common.day_yesterday")} · ${uhr(gestern)}`);
    const vorvier = new Date(2026, 10, 20, 8, 0, 0);
    expect(stampLabel(vorvier.toISOString(), HEUTE)).toContain(`· ${uhr(vorvier)}`);
  });
});
