// EPIC-P61 T61.8: hubctl-i18n — Sprachauflösung --lang > AV_LANG > LANG, Default en;
// t() ist Map-Lookup; --json bleibt sprachneutral. (AC-P61-7)
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolveLang, t, translate } from "../src/i18n/index.ts";

describe("hubctl i18n", () => {
  it("resolveLang: --lang schlägt AV_LANG, AV_LANG schlägt LANG", () => {
    expect(resolveLang("de", "en", "de")).toBe("de");
    expect(resolveLang(undefined, "en", "de")).toBe("en");
    expect(resolveLang(undefined, undefined, "de")).toBe("de");
    expect(resolveLang(undefined, undefined, undefined)).toBe("en");
  });
  it("resolveLang: Locale-Muster (de_DE.UTF-8) werden erkannt, Unpassendes fällt auf en", () => {
    expect(resolveLang(undefined, undefined, "de_DE.UTF-8")).toBe("de");
    expect(resolveLang("en", undefined, undefined)).toBe("en");
    expect(resolveLang(undefined, "fr_FR", "de")).toBe("de"); // unbediente Sprache: nächster Slot der Kette
  });
  it("Katalog deckt beide Sprachen ab, interpolation funktioniert", () => {
    expect(translate("de", "no_automations")).toBe("(keine Automationen)");
    expect(translate("en", "no_automations")).toBe("(no automations)");
    expect(translate("en", "prune_removed", { verb: "would remove", path: "/x.backup" })).toBe("would remove: /x.backup");
    expect(translate("de", "prune_removed", { verb: "würde entfernen", path: "/x.backup" })).toBe("würde entfernen: /x.backup");
  });
  it("t() folgt der Umgebungsauflösung (AV_LANG)", () => {
    process.env.AV_LANG = "en";
    expect(t("no_automations")).toBe("(no automations)");
    process.env.AV_LANG = "de";
    expect(t("no_automations")).toBe("(keine Automationen)");
    delete process.env.AV_LANG;
  });
  it("unbekannter Schlüssel schlägt sichtbar fehl (Fail loud)", () => {
    expect(() => translate("de", "hat_spaziergang" as never)).toThrow(/hat_spaziergang/);
  });
  it("usage-Ausgabe folgt --lang (AC-P61-7)", () => {
    const run = (lang: string) => spawnSync("node", ["apps/hubctl/src/cli.ts", "--lang", lang], { encoding: "utf8", env: { ...process.env, LANG: "", AV_LANG: "" } }).stdout;
    const de = run("de");
    const en = run("en");
    expect(de).not.toBe(en);
    expect(de).toContain("Benutzung");
    expect(en).toContain("Usage:");
  });
});
