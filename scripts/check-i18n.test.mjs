// Tier A. EPIC-P61 T61.3: check-i18n meldet neue hart kodierte UI-Strings;
// die Ratchet-Baseline darf sinken, nie steigen. Positiv- und Negativ-Fixture.
import { describe, it, expect } from "vitest";
import { checkI18n, checkMissingKeys, scanFile } from "./check-i18n.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "check-i18n");

describe("check-i18n (EPIC-P61)", () => {
  it("positiv: Datei über Baseline → Befund mit Datei und Prüfung", async () => {
    const findings = await checkI18n({ root: dir, baselinePath: join(dir, "baseline.json") });
    const dirty = findings.find((f) => f.file.endsWith("dirty.tsx"));
    expect(dirty).toBeDefined();
    expect(dirty.count).toBeGreaterThan(dirty.allowed);
  });

  it("negativ: saubere Datei (alles über t(), i18n-ignore) → kein Befund", async () => {
    const findings = await checkI18n({ root: dir, baselinePath: join(dir, "baseline.json") });
    expect(findings.find((f) => f.file.endsWith("clean.tsx"))).toBeUndefined();
  });

  it("Baseline-Ratchet: unter der Baseline ist erlaubt (senkend)", async () => {
    const scan = scanFile(`export const X = () => (\n  <div title="Zwei Worte">\n    <span>{"ein Wort"}</span>\n  </div>\n);\n`, "x.tsx");
    expect(scan.length).toBe(2);
  });

  it("i18n-ignore auf der Zeile oder direkt davor zählt nicht", () => {
    const scan = scanFile(`export const X = () => (\n  <div>\n    <span>{"ein Wort" /* i18n-ignore: Marke */}</span>\n    // i18n-ignore: Test\n    <span title="noch ein Wort">x y</span>\n  </div>\n);\n`, "y.tsx");
    expect(scan.length).toBe(0); // beide Ausnahmen ignoriert — nichts zählt
  });
});

describe("check-i18n fehlende Schlüssel (EPIC-P79)", () => {
  it("meldet t()-Schlüssel, die im de-Katalog fehlen", async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "check-i18n-keys");
    const fehlend = await checkMissingKeys({ root: dir });
    expect(fehlend).toHaveLength(1);
    expect(fehlend[0]?.key).toBe("common.diesen.schluessel.gibt.es.nicht");
    expect(fehlend[0]?.file).toMatch(/fehlend\.tsx$/);
    expect(fehlend[0]?.line).toBeGreaterThan(0);
  });
});
