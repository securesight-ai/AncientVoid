#!/usr/bin/env node
// EPIC-P61: Migrations-Werkzeug. Findet deutsch lesbare Strings im PWA-Quellcode
// (Liste) und ersetzt gemappte gegen t("key")-Aufrufe (Apply). Escapes
// (i18n-ignore) werden respektiert. Aufruf:
//   node scripts/i18n-migrate.mjs list <file...>
//   node scripts/i18n-migrate.mjs apply <file> <mapping.json>
// Mapping: [{match, key, de, en, params?, only?, skip?}] — match = exakter
// Stringliteral-text oder JSX-Text (getrimmt). params: { "<ausdruck>": "name" }
// für Templates — nur für Einträge mit params-Pflicht (match auf Template-Rohtext).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const PWA_SRC = join(REPO, "apps", "pwa", "src");
const ATTRS = new Set(["title", "aria-label", "placeholder", "alt", "label", "text"]);
const IGNORE = /i18n-ignore:/;

const [mode, ...args] = process.argv.slice(2);
if (!["list", "apply"].includes(mode)) {
  console.error("usage: i18n-migrate.mjs list <file...> | apply <file> <mapping.json>");
  process.exit(2);
}

for (const file of mode === "apply" ? args.slice(0, 1) : args) {
  const abs = file.startsWith("/") ? file : join(REPO, file);
  let source = readFileSync(abs, "utf8");
  const mapping = mode === "apply" ? JSON.parse(readFileSync(args[1], "utf8")).entries.filter((e) => e.match) : null;
  const found = collect(source, abs);
  if (mode === "list") {
    const shown = found.filter((f) => !f.comment && (mapping ? f.listed || mapping.some((m) => m.match === f.match) : true));
    if (shown.length === 0) continue;
    console.log(`## ${relative(REPO, abs)} (${shown.length})`);
    for (const f of shown) console.log(`   [${f.listed ? f.kind : f.kind === "plain" || f.kind === "tpl" ? f.kind.toUpperCase() : f.kind}] ${JSON.stringify(f.match)}`);
    continue;
  }
  const byMatch = new Map();
  for (const m of mapping) byMatch.set(m.match, m);
  const used = new Set();
  const pieces = [];
  let last = 0;
  for (const f of found.sort((a, b) => a.pos - b.pos)) {
    const entry = byMatch.get(f.match);
    if (!entry || (entry.only && !entry.only.some((o) => abs.endsWith(o)))) continue;
    if (f.comment) throw new Error(`${relative(REPO, abs)}: ${JSON.stringify(f.match)} ist i18n-ignore-escape`);
    let call = `t(${JSON.stringify(entry.key)}`;
    if (entry.params) {
      const pairs = Object.entries(entry.params).map(([expr, name]) => `${JSON.stringify(name)}: ${expr}`);
      for (const [expr] of Object.entries(entry.params)) {
        if (!f.rawText.includes("${" + expr + "}")) throw new Error(`params-Ausdruck nicht im String: ${expr}`);
      }
      call += `, { ${pairs.join(", ")} }`;
    }
    call += ")";
    const wsLead = f.rawText.match(/^\s*/)[0];
    const wsTrail = f.rawText.match(/\s*$/)[0];
    const fragment = f.kind === "jsx-text" ? `${wsLead}{${call}}${wsTrail}` : f.kind === "attr" ? `{${call}}` : call;
    pieces.push(source.slice(last, f.pos), fragment);
    last = f.end;
    used.add(entry);
  }
  pieces.push(source.slice(last));
  let out = pieces.join("");
  if (used.size && !/from ".*shared\/i18n(\/index)?\.ts"/.test(out)) {
    const rel = relative(dirname(abs), join(PWA_SRC, "shared", "i18n", "index.ts")).split("\\").join("/");
    out = `import { t } from "${rel.startsWith(".") ? rel : "./" + rel}";\n` + out;
  }
  writeFileSync(abs, out);
  console.log(`${relative(REPO, abs)}: ${used.size} Mapping-Einträge genutzt`);
  for (const m of mapping) if (!used.has(m)) console.log(`  ! Mapping ungenutzt: ${JSON.stringify(m.match)}`);
}

function collect(source, file) {
  const out = [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const lines = source.split("\n");
  const hasWord = (s) => /\p{L}{2}/u.test(s);
  const ignored = (pos) => {
    const line = source.slice(0, pos).split("\n").length;
    return (lines[line - 1] && IGNORE.test(lines[line - 1])) || (lines[line - 2] && IGNORE.test(lines[line - 2]));
  };
  const visit = (node) => {
    const rawText =
      ts.isJsxText(node) ? node.getText(sf) :
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) ? node.getText(sf) : null;
    if (rawText !== null) {
      const bare = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
      const matchText = bare ?? (ts.isJsxText(node) ? rawText.trim() : rawText);
      if (matchText && hasWord(matchText)) {
        const inJsxExpr = ts.isStringLiteral(node) && ts.isJsxExpression(node.parent) && (ts.isJsxElement(node.parent.parent) || ts.isJsxSelfClosingElement(node.parent.parent));
        const isAttr = (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && ts.isJsxAttribute(node.parent) && ATTRS.has(node.parent.name.getText(sf));
        const isImport = ts.isStringLiteral(node) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
        const kind = ts.isJsxText(node) ? "jsx-text" : isAttr ? "attr" : ts.isTemplateExpression(node) ? "tpl" : inJsxExpr || ts.isJsxExpression(node.parent) ? "jsx-expr" : isImport ? "skip" : "plain";
        const listed = ts.isJsxText(node) || isAttr || (ts.isNoSubstitutionTemplateLiteral(node) && ts.isJsxExpression(node.parent));
        if (kind !== "skip") out.push({ pos: node.getStart(sf), end: node.getEnd(), match: matchText, rawText, kind, listed, comment: ignored(node.getStart(sf)) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
