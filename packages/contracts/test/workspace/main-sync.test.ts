import { describe, expect, it } from "vitest";
import {
  MAIN_SYNC_DEFAULTS,
  MAIN_SYNC_EVENT_KINDS,
  MAIN_SYNC_EVENT_PAYLOAD,
  MAIN_SYNC_SETTINGS_KEYS,
  MainSyncApplyRequest,
  MainSyncApplyResult,
  MainSyncCheckResult,
  MainSyncChecked,
  MainSyncFilesList,
  MainSyncProjectOverride,
  MainSyncSettings,
  readMainSyncOverride,
  readMainSyncSettings,
  resolveMainSyncSettings,
} from "../../src/workspace/main-sync.ts";

describe("EPIC-P67 T67.1: MainSyncSettings (ADR-0088)", () => {
  it("nimmt die Defaults an — sie sind selbst gültig", () => {
    expect(MainSyncSettings.parse(MAIN_SYNC_DEFAULTS)).toEqual(MAIN_SYNC_DEFAULTS);
  });

  it("lehnt unbekannte Felder ab (strict — kein stilles Ignorieren beim Schreiben)", () => {
    expect(MainSyncSettings.safeParse({ ...MAIN_SYNC_DEFAULTS, extra: 1 }).success).toBe(false);
  });

  it("checkIntervalMin: 0 (aus) und 5–1440 sind gültig, 1–4 und 1441 werden abgelehnt", () => {
    const withInterval = (v: number) => ({ ...MAIN_SYNC_DEFAULTS, checkIntervalMin: v });
    expect(MainSyncSettings.safeParse(withInterval(0)).success).toBe(true);
    expect(MainSyncSettings.safeParse(withInterval(5)).success).toBe(true);
    expect(MainSyncSettings.safeParse(withInterval(1440)).success).toBe(true);
    expect(MainSyncSettings.safeParse(withInterval(4)).success).toBe(false);
    expect(MainSyncSettings.safeParse(withInterval(1)).success).toBe(false);
    expect(MainSyncSettings.safeParse(withInterval(1441)).success).toBe(false);
    expect(MainSyncSettings.safeParse(withInterval(60.5)).success).toBe(false);
  });

  it("fetchTimeoutSec ist ganze Zahl in [2, 60]", () => {
    expect(MainSyncSettings.safeParse({ ...MAIN_SYNC_DEFAULTS, fetchTimeoutSec: 1 }).success).toBe(false);
    expect(MainSyncSettings.safeParse({ ...MAIN_SYNC_DEFAULTS, fetchTimeoutSec: 61 }).success).toBe(false);
    expect(MainSyncSettings.safeParse({ ...MAIN_SYNC_DEFAULTS, fetchTimeoutSec: 10 }).success).toBe(true);
  });

  it("onlyWhenIdle ist nicht abschaltbar im ersten Wurf (Premortem 2)", () => {
    expect(MainSyncSettings.safeParse({ ...MAIN_SYNC_DEFAULTS, onlyWhenIdle: false }).success).toBe(false);
  });

  it("Projekt-Override: jedes Feld optional, Werte werden weiter streng geprüft", () => {
    expect(MainSyncProjectOverride.parse({})).toEqual({});
    expect(MainSyncProjectOverride.parse({ startSync: "off" })).toEqual({ startSync: "off" });
    expect(MainSyncProjectOverride.safeParse({ startSync: "vielleicht" }).success).toBe(false);
    expect(MainSyncProjectOverride.safeParse({ checkIntervalMin: 3 }).success).toBe(false);
  });

  it("resolveMainSyncSettings: Defaults ← global ← Projekt-Patch", () => {
    const global = { ...MAIN_SYNC_DEFAULTS, checkIntervalMin: 30, behindAction: "ask" as const };
    expect(resolveMainSyncSettings(global, null)).toEqual(global);
    expect(resolveMainSyncSettings(global, { checkIntervalMin: 0 })).toEqual({ ...global, checkIntervalMin: 0 });
    expect(resolveMainSyncSettings(null, { startSync: "off" })).toEqual({ ...MAIN_SYNC_DEFAULTS, startSync: "off" });
  });

  it("AC-P67-8 — additives Lesen: fehlender Eintrag ⇒ Defaults, fallback 'missing'", () => {
    const read = readMainSyncSettings(undefined);
    expect(read).toEqual({ value: MAIN_SYNC_DEFAULTS, fallback: "missing" });
  });

  it("AC-P67-8 — additives Lesen: ein Eintrag aus einer künftigen Version (neues Feld) liest sich weiter", () => {
    const future = { ...MAIN_SYNC_DEFAULTS, fetchTimeoutSec: 25, futureMode: "hyper" };
    const read = readMainSyncSettings(future);
    expect(read.fallback).toBe("none");
    expect(read.value.fetchTimeoutSec).toBe(25);
    expect("futureMode" in read.value).toBe(false);
  });

  it("AC-P67-8 — additives Lesen: unvollständiger Eintrag wird mit Defaults ergänzt", () => {
    const read = readMainSyncSettings({ behindAction: "auto" });
    expect(read.fallback).toBe("none");
    expect(read.value).toEqual({ ...MAIN_SYNC_DEFAULTS, behindAction: "auto" });
  });

  it("AC-P67-8 — additives Lesen: ungültiger Eintrag fällt auf Defaults und wird als 'invalid' markiert (fail loud beim Aufrufer)", () => {
    const read = readMainSyncSettings({ fetchTimeoutSec: "schnell" });
    expect(read.fallback).toBe("invalid");
    expect(read.value).toEqual(MAIN_SYNC_DEFAULTS);
  });

  it("readMainSyncOverride: unknown Felder entfallen, ungültiger Eintrag ⇒ leer + 'invalid'", () => {
    expect(readMainSyncOverride({ startSync: "off", neu: true })).toEqual({ value: { startSync: "off" }, fallback: "none" });
    expect(readMainSyncOverride({ checkIntervalMin: 2 })).toEqual({ value: {}, fallback: "invalid" });
    expect(readMainSyncOverride(null)).toEqual({ value: {}, fallback: "missing" });
  });

  it("MAIN_SYNC_SETTINGS_KEYS deckt jedes Settings-Feld (kein Feld fällt aus dem additiven Lesen)", () => {
    expect(new Set(MAIN_SYNC_SETTINGS_KEYS)).toEqual(new Set(Object.keys(MAIN_SYNC_DEFAULTS)));
  });
});

describe("EPIC-P67 T67.1: Main-Sync-Events und API (K5)", () => {
  it("alle Event-Kinds tragen das workspace.main_sync_-Präfix und haben ein Payload-Schema", () => {
    for (const kind of MAIN_SYNC_EVENT_KINDS) {
      expect(kind.startsWith("workspace.main_sync_")).toBe(true);
      expect(MAIN_SYNC_EVENT_PAYLOAD[kind]).toBeDefined();
    }
  });

  it("MainSyncChecked: stricter Payload mit behind/ahead/clean/checkedAt", () => {
    expect(MainSyncChecked !== undefined).toBe(true);
    const Checked = MAIN_SYNC_EVENT_PAYLOAD["workspace.main_sync_checked"];
    expect(Checked.safeParse({ behind: 3, ahead: 0, clean: true, checkedAt: new Date().toISOString() }).success).toBe(true);
    expect(Checked.safeParse({ behind: 3, ahead: 0, clean: true }).success).toBe(false);
    expect(Checked.safeParse({ behind: -1, ahead: 0, clean: true, checkedAt: "x" }).success).toBe(false);
  });

  it("MainSyncFilesList kapselt die Liste auf 20 Einträge à 400 Zeichen (K5)", () => {
    expect(MainSyncFilesList.safeParse(["a", "b"]).success).toBe(true);
    expect(MainSyncFilesList.safeParse(Array.from({ length: 21 }, (_, i) => `f${i}`)).success).toBe(false);
    expect(MainSyncFilesList.safeParse(["x".repeat(401)]).success).toBe(false);
    expect(MainSyncFilesList.safeParse([""]).success).toBe(false);
  });

  it("MainSyncApplied und MainSyncConflict: from/to gekürzt, files gekappt", () => {
    const Applied = MAIN_SYNC_EVENT_PAYLOAD["workspace.main_sync_applied"];
    expect(Applied.safeParse({ from: "abc123", to: "def456", files: ["pwa/src/a.ts"] }).success).toBe(true);
    expect(Applied.safeParse({ from: "abc123", to: "def456" }).success).toBe(false);
    const Conflict = MAIN_SYNC_EVENT_PAYLOAD["workspace.main_sync_conflict"];
    expect(Conflict.safeParse({ files: ["a.ts", "b.ts"] }).success).toBe(true);
    expect(Conflict.safeParse({ files: [] }).success).toBe(true);
  });

  it("MainSyncSkipped/MainSyncFailed: Grund ist begrenzter Freitext (dokumentierte Werte, kein Enum-Break)", () => {
    const Skipped = MAIN_SYNC_EVENT_PAYLOAD["workspace.main_sync_skipped"];
    expect(Skipped.safeParse({ reason: "not-main-branch" }).success).toBe(true);
    expect(Skipped.safeParse({ reason: "" }).success).toBe(false);
    expect(Skipped.safeParse({ reason: "x".repeat(201) }).success).toBe(false);
    const Failed = MAIN_SYNC_EVENT_PAYLOAD["workspace.main_sync_failed"];
    expect(Failed.safeParse({ reason: "timeout", detail: "10 s" }).success).toBe(true);
  });

  it("MainSyncCheckResult: Messung plus Probelauf, Konflikte nullable, lastSyncedAt nullable", () => {
    const ok = MainSyncCheckResult.safeParse({
      sessionId: "s1",
      branch: "main",
      behind: 2,
      ahead: 1,
      clean: true,
      conflicts: null,
      checkedAt: new Date().toISOString(),
      lastSyncedAt: null,
    });
    expect(ok.success).toBe(true);
    expect(
      MainSyncCheckResult.safeParse({
        sessionId: "s1",
        branch: "main",
        behind: 2,
        ahead: 1,
        clean: false,
        conflicts: ["a.ts"],
        checkedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
    expect(MainSyncCheckResult.safeParse({ sessionId: "s1" }).success).toBe(false);
  });

  it("MainSyncApplyResult: diskriminiert nach outcome — applied/conflict/skipped/failed", () => {
    expect(MainSyncApplyResult.safeParse({ outcome: "applied", from: "a", to: "b", files: [] }).success).toBe(true);
    expect(MainSyncApplyResult.safeParse({ outcome: "conflict", files: ["x.ts"] }).success).toBe(true);
    expect(MainSyncApplyResult.safeParse({ outcome: "skipped", reason: "disabled" }).success).toBe(true);
    expect(MainSyncApplyResult.safeParse({ outcome: "failed", reason: "offline", detail: "kein Netz" }).success).toBe(true);
    expect(MainSyncApplyResult.safeParse({ outcome: "applied", from: "a" }).success).toBe(false);
    expect(MainSyncApplyResult.safeParse({ outcome: "mercurial" }).success).toBe(false);
  });
});

describe("ADR-0102: Anwenden mit Konfliktgunst der Session", () => {
  it("MainSyncApplyRequest: leer/abort/favor-session gültig, alles andere abgelehnt (strict)", () => {
    expect(MainSyncApplyRequest.safeParse({}).success).toBe(true);
    expect(MainSyncApplyRequest.safeParse({ conflictStrategy: "abort" }).success).toBe(true);
    expect(MainSyncApplyRequest.safeParse({ conflictStrategy: "favor-session" }).success).toBe(true);
    expect(MainSyncApplyRequest.safeParse({ conflictStrategy: "bogus" }).success).toBe(false);
    expect(MainSyncApplyRequest.safeParse({ conflictStrategy: "abort", extra: 1 }).success).toBe(false);
  });

  it("MainSyncApplyResult: applied nennt optional autoResolved; alte Payloads (ohne das Feld) bleiben gültig", () => {
    expect(MainSyncApplyResult.safeParse({ outcome: "applied", from: "a", to: "b", files: [], autoResolved: ["x.ts"] }).success).toBe(true);
    expect(MainSyncApplyResult.safeParse({ outcome: "applied", from: "a", to: "b", files: [] }).success).toBe(true);
    expect(MainSyncApplyResult.safeParse({ outcome: "applied", from: "a", to: "b", files: [], autoResolved: "x.ts" }).success).toBe(false);
  });

  it("Event-Payload main_sync_applied nimmt autoResolved ebenfalls additiv", () => {
    const schema = MAIN_SYNC_EVENT_PAYLOAD["workspace.main_sync_applied"];
    expect(schema.safeParse({ from: "a", to: "b", files: [] }).success).toBe(true);
    expect(schema.safeParse({ from: "a", to: "b", files: [], autoResolved: ["x.ts"] }).success).toBe(true);
  });
});
