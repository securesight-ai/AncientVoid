#!/usr/bin/env node
// Generierte Referenz (EPIC-P57 T57.3): Fakten kommen aus dem Code, nicht aus
// Handtext — hubctl-Befehle (usage), Hub-Config-Felder (zod-Schema),
// Wizard-Flags/Exit-Codes (setup.sh-Kopf). Ausgabe wird committet;
// `check:context` (Regel reference-fresh) ruft `--check` und scheitert bei Abweichung.
//   npm run docs:reference          schreibt docs/referenz-*.md
//   node scripts/gen-reference.mjs --check   Exit 1, wenn der Stand veraltet ist
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const HEADER = (title, quelle) =>
  `# ${title}\n\n**Art:** referenz\n\n> Generiert von \`scripts/gen-reference.mjs\` (\`npm run docs:reference\`) aus ${quelle}.\n> Nicht von Hand bearbeiten — \`npm run check:context\` scheitert bei veraltetem Stand.\n\n`;

const cell = (v) => String(v).replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderHubctl(usageText) {
  return `${HEADER("Referenz: hubctl", "der `usage()`-Ausgabe von `apps/hubctl/src/cli.ts`")}\`\`\`text\n${usageText.trimEnd()}\n\`\`\`\n`;
}

/** Wizard-Kopf: `# Flags:`-Block bis `# Exit:`, Exit-Codes als Tabelle. */
export function renderWizard(script) {
  const head = script.split("\n").filter((l) => l.startsWith("#") && !l.startsWith("#!")).map((l) => l.replace(/^# ?/, ""));
  const fi = head.findIndex((l) => l.startsWith("Flags:"));
  const ei = head.findIndex((l) => l.startsWith("Exit:"));
  if (fi < 0 || ei < fi) throw new Error("setup.sh: Kopf ohne Flags:/Exit:-Block");
  const flags = [head[fi].replace(/^Flags:\s*/, ""), ...head.slice(fi + 1, ei).map((l) => l.replace(/^ {8}/, ""))].join("\n");
  const exitText = [head[ei].replace(/^Exit:\s*/, ""), ...head.slice(ei + 1).filter((l) => /^\s+\S/.test(l)).map((l) => l.trim())].join(" ");
  const rows = exitText.split(" · ").map((p) => /^(\d+)\s+(.+)$/.exec(p.trim())).filter(Boolean);
  if (rows.length === 0) throw new Error("setup.sh: keine Exit-Codes gefunden");
  const table = rows.map((m) => `| ${m[1]} | ${cell(m[2])} |`).join("\n");
  return `${HEADER("Referenz: Setup-Wizard (`setup.sh`)", "dem Skriptkopf von `setup.sh`")}## Flags\n\n\`\`\`text\n${flags}\n\`\`\`\n\n## Exit-Codes\n\n| Code | Bedeutung |\n|---|---|\n${table}\n`;
}

function typeOf(s) {
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(" \\| ");
  if (s.type === "array") return `array<${s.items ? typeOf(s.items) : "?"}>`;
  if (s.type) return Array.isArray(s.type) ? s.type.join("|") : s.type;
  const alt = s.anyOf ?? s.oneOf;
  return alt ? alt.map(typeOf).join(" \\| ") : "?";
}

export function flatten(schema, prefix = "", out = []) {
  for (const [key, s] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (s.type === "object" && s.properties) flatten(s, path, out);
    else out.push({ path, type: typeOf(s), def: "default" in s ? JSON.stringify(s.default) : "—" });
  }
  return out;
}

export function renderConfig(jsonSchema) {
  const rows = flatten(jsonSchema).map((r) => `| \`${r.path}\` | ${cell(r.type)} | ${cell(r.def.length > 60 ? `${r.def.slice(0, 57)}…` : r.def)} |`);
  return `${HEADER("Referenz: Hub-Config-Felder", "dem zod-Schema `HubConfig` in `packages/core/src/platform/config.ts`")}Felder von \`hub.config.json\`; Erklärung und Beispiele: [\`configuration.md\`](configuration.md). Typ und Default stammen aus dem Schema, **nicht** aus der Doku.\n\n| Feld | Typ | Default |\n|---|---|---|\n${rows.join("\n")}\n`;
}

async function generate(root) {
  let usage;
  try {
    execFileSync("node", ["apps/hubctl/src/cli.ts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AV_LANG: "en" } }); // Referenzdocs sind sprachfest (EPIC-P61 T61.8)
  } catch (e) {
    usage = e.stdout; // usage() beendet mit Exit 1 und schreibt auf stdout
  }
  if (!usage?.includes("Usage:")) throw new Error("hubctl: keine usage-Ausgabe");
  const { z } = await import(pathToFileURL(join(root, "node_modules/zod/index.js")).href).catch(() => import("zod"));
  const { HubConfig } = await import(pathToFileURL(join(root, "packages/core/src/platform/config.ts")).href);
  return {
    "docs/referenz-hubctl.md": renderHubctl(usage),
    "docs/referenz-wizard.md": renderWizard(readFileSync(join(root, "setup.sh"), "utf8").replace(/\r\n/g, "\n")), // Windows-Checkout liefert CRLF; ohne Normalisierung fallen Exit-Zeilen weg
    "docs/referenz-config.md": renderConfig(z.toJSONSchema(HubConfig, { io: "input" })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const root = args.includes("--root") ? resolve(args[args.indexOf("--root") + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = await generate(root);
  const stale = [];
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    if (args.includes("--check")) {
      // Windows-Checkout: Git liefert CRLF, der Generator schreibt LF. Ohne
      // Normalisierung gilt die Referenz auf Windows als veraltet, obwohl der
      // Inhalt gleich ist (BUG-0170-Umfeld, dasselbe Muster wie bei setup.sh).
      if (!existsSync(p) || readFileSync(p, "utf8").replace(/\r\n/g, "\n") !== text) stale.push(rel);
    } else writeFileSync(p, text);
  }
  if (stale.length) {
    console.error(`veraltet: ${stale.join(", ")} — \`npm run docs:reference\` ausführen`);
    process.exit(1);
  }
  console.log(args.includes("--check") ? "gen-reference: Referenz ist frisch" : `gen-reference: ${Object.keys(files).length} Dateien geschrieben`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
