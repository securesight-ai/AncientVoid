#!/usr/bin/env node
// EPIC-P61 T61.3 (ADR-0101): Rückfall-Gate — neue hart kodierte UI-Strings
// in der PWA sind rot. AST-Scan wie §3.1: JSX-Text und
// title/aria-label/placeholder/alt-Literale mit Wortcharakter in
// apps/pwa/src außerhalb shared/i18n/. Ratchet-Baseline
// scripts/check-i18n.baseline.json (Anzahl pro Datei): darf sinken, nie
// steigen; am Epic-Ende leer. Ausnahmen per Kommentar
// `// i18n-ignore: <Grund>` (Zeile direkt davor oder am Zeilenende).
// Aufruf: node scripts/check-i18n.mjs [--write-baseline] [--json]
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(REPO, "apps", "pwa", "src");
const I18N_DIR = join(SRC, "shared", "i18n");
const BASELINE_PATH = join(REPO, "scripts", "check-i18n.baseline.json");
const ATTRS = new Set(["title", "aria-label", "placeholder", "alt"]);

export function scanFile(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const lines = source.split("\n");
  const findings = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const ignored = (line) => {
    const own = lines[line] ?? "";
    const prev = lines[line - 1] ?? "";
    return /(\/\/|\/*)\s*i18n-ignore:/.test(own) || /(\/\/|\/*)\s*i18n-ignore:/.test(prev);
  };
  const hasWord = (s) => /[\p{L}]{2}/u.test(s);

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile).trim();
      if (text && hasWord(text) && !ignored(lineOf(node))) findings.push({ line: lineOf(node) + 1, what: "JSX-Text", text: text.slice(0, 60) });
    }
    if (ts.isStringLiteral(node) && ts.isJsxExpression(node.parent) && (ts.isJsxElement(node.parent.parent) || ts.isJsxSelfClosingElement(node.parent.parent))) {
      if (hasWord(node.text) && !ignored(lineOf(node))) findings.push({ line: lineOf(node) + 1, what: "JSX-Ausdruck", text: node.text.slice(0, 60) });
    }
    if (ts.isJsxAttribute(node) && ATTRS.has(node.name.getText(sourceFile))) {
      const init = node.initializer;
      const str =
        init && ts.isStringLiteral(init)
          ? init.text
          : init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)
            ? init.expression.text
            : null;
      if (str && hasWord(str) && !ignored(lineOf(node))) findings.push({ line: lineOf(node) + 1, what: `Attribut ${node.name.getText(sourceFile)}`, text: str.slice(0, 60) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function listTsx(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTsx(p));
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * EPIC-P79: t("key") mit fehlendem Katalog-Schluessel zeigt zur Laufzeit den
 * rohen Schluessel (sichtbar als „COMMON.INFERENCE“ im Pane-Titel). de/en-Paritaet
 * allein faengt das nicht — ein loser Loeschcommit in einem anderen Zweig erwischt
 * die Seite trotzdem. Jeder literal benutzte Schluessel muss im de-Katalog stehen.
 */
function katalogSchluessel() {
  const keys = new Set();
  const dateien = [...listTs(join(I18N_DIR, "de")), join(I18N_DIR, "de.ts")];
  for (const file of dateien) {
    if (!existsSync(file)) continue;
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
    (function visit(n) {
      if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.name)) keys.add(n.name.text);
      ts.forEachChild(n, visit);
    })(sf);
  }
  return keys;
}

function scanMissingKeys(source, path, keys) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true);
  const out = [];
  (function visit(n) {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "t" && n.arguments.length >= 1 && ts.isStringLiteral(n.arguments[0])) {
      const key = n.arguments[0].text;
      if (!keys.has(key)) out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, key });
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

function listTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

export async function checkI18n({ root = SRC, baselinePath = BASELINE_PATH } = {}) {
  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    /* ohne Baseline: alles über Null ist rot */
  }
  const findings = [];
  for (const file of listTsx(root)) {
    if (file.startsWith(I18N_DIR + sep)) continue;
    const found = scanFile(readFileSync(file, "utf8"), file);
    const rel = relative(REPO, file).split(sep).join("/");
    const allowed = baseline[rel] ?? 0;
    if (found.length > allowed) findings.push({ file: rel, count: found.length, allowed, first: found.slice(0, 3) });
    else if (found.length < allowed) findings.push({ file: rel, ratchet: true, count: found.length, allowed });
  }
  return findings;
}

/**
 * Eigener Ausgang, damit `checkI18n` sein Array behält (der P61-Test und allenfalls
 * andere Aufrufer verlassen sich darauf).
 */
export async function checkMissingKeys({ root = SRC } = {}) {
  const katalog = katalogSchluessel();
  const out = [];
  // .ts UND .tsx: Seiten-Titel und Sidebar-Labels stehen in .ts-Dateien.
  for (const file of [...listTsx(root), ...listTs(root)]) {
    if (file.startsWith(I18N_DIR + sep)) continue;
    for (const m of scanMissingKeys(readFileSync(file, "utf8"), file, katalog)) {
      out.push({ file: relative(REPO, file).split(sep).join("/"), ...m });
    }
  }
  return out;
}

async function main() {
  const json = process.argv.includes("--json");
  const write = process.argv.includes("--write-baseline");
  const findings = await checkI18n();
  const fehlendeKeys = await checkMissingKeys();
  if (write) {
    const baseline = {};
    for (const file of listTsx(SRC)) {
      if (file.startsWith(I18N_DIR + sep)) continue;
      const n = scanFile(readFileSync(file, "utf8"), file).length;
      if (n) baseline[relative(REPO, file).split(sep).join("/")] = n;
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`check-i18n: Baseline geschrieben (${Object.keys(baseline).length} Dateien, ${Object.values(baseline).reduce((a, b) => a + b, 0)} Strings).`);
    process.exit(0);
  }
  const violations = findings.filter((f) => !f.ratchet);
  const couldSink = findings.filter((f) => f.ratchet);
  if (json) console.log(JSON.stringify({ violations, couldSink }, null, 2));
  else {
    for (const v of violations) console.log(`  ${v.file}: ${v.count} Strings > Baseline ${v.allowed} — z. B. Zeile ${v.first?.[0]?.line} (${v.first?.[0]?.what})`);
    for (const c of couldSink) console.log(`  (ratchet) ${c.file}: ${c.count} < ${c.allowed} — Baseline darf sinken`);
    for (const m of fehlendeKeys) console.log(`  fehlender Katalog-Schluessel: ${m.file}:${m.line} — t("${m.key}")`);
    const rot = violations.length + fehlendeKeys.length;
    console.log(`check-i18n: ${rot ? `${violations.length} Dateien über Baseline, ${fehlendeKeys.length} fehlende Schlüssel — ROT` : `OK (${couldSink.length}mal Baseline überholt)`}`);
  }
  process.exit(violations.length || fehlendeKeys.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
