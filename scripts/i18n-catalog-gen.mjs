#!/usr/bin/env node
// EPIC-P61: generiert die Katalog-Sektionsdateien aus scripts/i18n-catalog/*.json
// (Sortierung nach Schlüssel; de-Werte byte-identisch zum Migrationsoriginal).
// Aufruf: node scripts/i18n-catalog-gen.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const CATALOG = join(REPO, "scripts", "i18n-catalog");
const I18N = join(REPO, "apps", "pwa", "src", "shared", "i18n");
const q = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

for (const name of readdirSync(CATALOG)) {
  if (!name.endsWith(".json")) continue;
  const doc = JSON.parse(readFileSync(join(CATALOG, name), "utf8"));
  const gen = (lang) => {
    void 0;
    const lines = [
      `// EPIC-P61: Katalog-Sektion "${doc.area}" — generiert aus scripts/i18n-catalog/${name}.`,
      `export const ${lang} = {`,
      ...[...new Set(doc.entries.map((e) => e.key))].sort().map((k) => `  ${q(k)}: ${q(doc.entries.find((e) => e.key === k)[lang])},`),
      "} as const;",
      "",
    ];
    if (lang === "en") {
      lines.splice(1, 0, `// Typgeprüft gegen de —Keys dieses Bereichs; tsc gleicht Vollständige ab.`);
      writeFileSync(join(I18N, "en", `${doc.area}.ts`), lines.join("\n"));
    } else {
      writeFileSync(join(I18N, "de", `${doc.area}.ts`), lines.join("\n"));
    }
  };
  gen("de");
  gen("en");
  console.log(`  ${doc.area}: ${new Set(doc.entries.map((e) => e.key)).size} Schlüssel`);
}
