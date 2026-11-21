// Tier A. EPIC-P61 T61.2: t(), Plural, Fallback, Browsersprach-Match.
import { afterEach, describe, expect, it, vi } from "vitest";
import { t, resolveLanguage, matchBrowserLanguage, getLanguageSetting, setLanguageSetting, catalogKeys, resolveNotificationTitle, errorText } from "../../src/shared/i18n/index.ts";
import { fmtDate, fmtDateTime, fmtNumber, fmtTime } from "../../src/shared/i18n/format.ts";
import { en } from "../../src/shared/i18n/en.ts";

function fakeStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("i18n (EPIC-P61)", () => {
  it("Interpolation: {name}-Plätze werden gefüllt", () => {
    fakeStorage();
    setLanguageSetting("en");
    expect(t("error.rate_limited.other", { n: 30 })).toBe("Too many requests — retry in {n} seconds.".replace("{n}", "30"));
    expect(t("error.rate_limited.other", { n: 30 })).toContain("30");
  });

  it("Plural über Intl.PluralRules: count=1 → .one, count=5 → .other", () => {
    fakeStorage();
    setLanguageSetting("de");
    expect(t("error.rate_limited", { count: 1, n: 1 })).toBe("Zu viele Anfragen — noch 1 Sekunde bis zum nächsten Versuch.");
    expect(t("error.rate_limited", { count: 5, n: 5 })).toBe("Zu viele Anfragen — noch 5 Sekunden bis zum nächsten Versuch.");
    setLanguageSetting("en");
    expect(t("error.rate_limited", { count: 1, n: 1 })).toBe("Too many requests — retry in 1 second.");
    expect(t("error.rate_limited", { count: 5, n: 5 })).toBe("Too many requests — retry in 5 seconds.");
  });

  it("fehlender Schlüssel: sichtbarer Fallback (Schlüssel selbst), nie leer", () => {
    fakeStorage();
    setLanguageSetting("en");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("es.gibt.dich.nicht")).toBe("es.gibt.dich.nicht");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("Browsersprach-Match: Präfix gegen die Sprachliste, ohne Treffer Englisch", () => {
    expect(matchBrowserLanguage("de-AT")).toBe("de");
    expect(matchBrowserLanguage("en-GB")).toBe("en");
    expect(matchBrowserLanguage("fr-FR")).toBe("en");
    expect(matchBrowserLanguage(undefined)).toBe("en");
  });

  it("resolveLanguage: manuelle Wahl schlägt Browsersprache; auto matcht", () => {
    expect(resolveLanguage("de", "en-US")).toBe("de");
    expect(resolveLanguage("auto", "de-DE")).toBe("de");
    expect(resolveLanguage("auto", "es")).toBe("en");
  });

  it("Geräte-Einstellung persistiert; ohne localStorage bleibt auto", () => {
    fakeStorage();
    setLanguageSetting("en");
    expect(getLanguageSetting()).toBe("en");
    setLanguageSetting("auto");
    expect(getLanguageSetting()).toBe("auto");
    vi.unstubAllGlobals();
    expect(getLanguageSetting()).toBe("auto");
  });

  it("Katalog-Parität: en deckt jede de-Kategorie ab (AC-P61-2, tsc-verstärkt)", () => {
    expect(Object.keys(en).sort()).toEqual(catalogKeys());
  });

  it("Formatierung folgt der Sprache (Intl)", () => {
    fakeStorage();
    const when = "2026-11-21T14:05:00.000Z";
    setLanguageSetting("de");
    const deDate = fmtDate(when);
    const deTime = fmtTime(when);
    setLanguageSetting("en");
    expect(fmtDate(when)).not.toBe(deDate);
    expect(fmtTime(when)).not.toBe(deTime);
    setLanguageSetting("de");
    expect(fmtNumber(1234.5)).toBe("1.234,5");
    setLanguageSetting("en");
    expect(fmtNumber(1234.5)).toBe("1,234.5");
  });

  it("fmtDateTime: Datum+Zeit folgt der Sprache (EPIC-P61 T61.4)", () => {
    fakeStorage();
    const when = "2026-11-21T14:05:00.000Z";
    setLanguageSetting("de");
    const de = fmtDateTime(when);
    expect(de).toContain("21.11.2026");
    setLanguageSetting("en");
    const en = fmtDateTime(when);
    expect(en).not.toBe(de);
    expect(en).toContain("11/21/2026");
  });
});

// EPIC-P61 T61.7 / ADR-0101: Benachrichtigungs-Schlüssel des Hubs leben auch
// im PWA-Katalog (der Hub sendet messageKey + Params; die PWA rendert in ihrer
// Sprache, deutscher Titel bleibt Fallback für Alt-Journal).
describe("EPIC-P61 T61.7: Benachrichtigungs-Schlüssel im PWA-Katalog", () => {
  it("Deutsch: Schlüssel rendern exakt die bisherigen deutschen Titel", () => {
    fakeStorage();
    setLanguageSetting("de");
    expect(t("notification.start_failed", { project: "tetris", adapter: "fake" })).toBe("tetris · fake: Start fehlgeschlagen");
    expect(t("notification.turn_done", { project: "tetris" })).toBe("tetris · Zug fertig");
    expect(t("notification.process_exit", { project: "tetris", adapter: "fake", code: "1" })).toBe("tetris · fake abgebrochen (Code 1)");
  });

  it("Englisch: derselbe Schlüssel, englische Worte", () => {
    fakeStorage();
    setLanguageSetting("en");
    expect(t("notification.start_failed", { project: "tetris", adapter: "fake" })).toBe("tetris · fake: start failed");
    expect(t("notification.turn_done", { project: "tetris" })).toBe("tetris · turn done");
  });
});

describe("EPIC-P61 T61.7: Titel-Auflösung für Hub-Nachrichten", () => {
  it("messageKey im Katalog → Katalogtext; unbekannter Schlüssel → deutscher Fallback-Titel", () => {
    fakeStorage();
    setLanguageSetting("en");
    expect(resolveNotificationTitle({ title: "tetris · Zug fertig", messageKey: "notification.turn_done", params: { project: "tetris" } })).toBe("tetris · turn done");
    expect(resolveNotificationTitle({ title: "tetris · irgendwas Dynamisches", messageKey: "notification.unbekannt" })).toBe("tetris · irgendwas Dynamisches");
    expect(resolveNotificationTitle({ title: "tetris · Zug fertig" })).toBe("tetris · Zug fertig");
  });
});

describe("EPIC-P61 T61.7: error.<code>-Mapping", () => {
  it("bekannter Code → Katalogtext; unbekannter Code → Hub-Text unverändert", () => {
    fakeStorage();
    setLanguageSetting("en");
    expect(errorText("adapter_not_allowed", "Loop-Adapter sind als Team-Worker nicht freigegeben.")).toBe("Loop adapters are not allowed as team workers.");
    setLanguageSetting("de");
    expect(errorText("adapter_not_allowed", "Loop-Adapter sind als Team-Worker nicht freigegeben.")).toBe("Loop-Adapter sind als Team-Worker nicht freigegeben.");
    setLanguageSetting("en");
    expect(errorText("brandneuer_code", "Der Hub-Text bleibt, was er ist.")).toBe("Der Hub-Text bleibt, was er ist.");
    expect(errorText(undefined, "plain hub text")).toBe("plain hub text");
  });
});
