#!/usr/bin/env node
// Kontext-Hygiene-Gate: haelt Kontextdateien klein, ihre Links intakt,
// docs/ und scripts/ referenziert und lebende Dokumente frisch.
// Regeln + Begründung (u. a. Adhärenz- und Context-Rot-Recherche):
// docs/check-context.md
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";

// ——— Konfiguration ———

// Zeilen-Budgets. Anthropic-Empfehlung: < 200 Zeilen pro immer geladener
// Kontextdatei (laengere Dateien reduzieren die Befolgung); on-demand
// geladene Skills duerfen groesser sein.
export const LINE_BUDGETS = [
  { glob: "AGENTS.md", limit: 200 },
  { glob: "CONTRIBUTING.md", limit: 200 },
  { glob: "README.md", limit: 300 },
  { glob: "epics/README.md", limit: 415 }, // +10 am 2026-11-20: P75-Epoche (Sprachausgabe); +15 am 2026-11-24: P82-Epoche (Audit-Räumen); +15 am 2026-11-25: P85-Epoche (Links/Bildvorschau)
  { glob: ".claude/skills/README.md", limit: 120 },
  { glob: ".claude/skills/*/SKILL.md", limit: 250 },
  { glob: ".claude/agents/*.md", limit: 150 },
  // EPIC-P62 T62.1: Guide- und Video-Doku sind on-demand, duerfen laenger sein.
  { glob: "docs/guide/*.md", limit: 410 }, // +10 am 2026-11-25: EPIC-P80 (Pentest-Sektionen)
  { glob: "docs/videos/*.md", limit: 250 },
];

// Markdown-Links in diesen Dateien muessen auf existierende Pfade zeigen.
const LINK_ROOTS = ["AGENTS.md", "CONTRIBUTING.md", "README.md", "epics/README.md", ".claude"];

// Datum im Dateinamen (Präfix oder Suffix) = eingefrorener Snapshot:
// referenzfrei zulaessig, altert bewusst (Konvention, AGENTS.md).
const DATED_NAME = /(^|[-_])\d{4}-\d{2}-\d{2}([-_.]|$)/;

// Frischhalte-Map: lebendes Dokument → Beobachtungsbereiche (Git-Pfade)
// und erlaubte Drift = Commits, die die Bereiche seit der letzten
// Berührung des Dokuments anfassen durften.
export const REFRESH_MAP = [
  { doc: "docs/architecture.md", areas: ["packages/", "apps/"], maxDrift: 150 },
  { doc: "docs/adapters.md", areas: ["packages/adapters/"], maxDrift: 60 },
  { doc: "docs/configuration.md", areas: ["packages/core/src/platform/", "apps/hub/src/modules/system/"], maxDrift: 60 },
  { doc: "docs/design-system.md", areas: ["apps/pwa/src/"], maxDrift: 100 },
  { doc: "docs/operations-runbook.md", areas: ["apps/hub/", "scripts/hub.sh"], maxDrift: 100 },
  { doc: "docs/testing-e2e.md", areas: ["e2e/", "playwright.config.ts"], maxDrift: 100 },
  { doc: "docs/funktionsinventar.md", areas: ["apps/pwa/src/"], maxDrift: 100 },
  { doc: "docs/commit-notation.md", areas: [".githooks/", "scripts/check-commits.mjs"], maxDrift: 40 },
  { doc: "docs/issues.md", areas: ["scripts/ci-pipeline.mjs", ".github/workflows/nightly-bugs.yml"], maxDrift: 40 },
  { doc: "docs/onboarding.md", areas: ["setup.sh", "scripts/setup-git.mjs"], maxDrift: 60 },
  { doc: "docs/tutorial-erste-schritte.md", areas: ["setup.sh", "apps/hubctl/", "apps/pwa/src/app/", "scripts/setup-tailscale-serve.sh"], maxDrift: 30 },
  { doc: "docs/ci-gate-inventar.md", areas: [".github/workflows/ci.yml", "package.json"], maxDrift: 40 },
  { doc: "docs/backup-restore.md", areas: ["packages/core/src/modules/sessions/", "apps/hubctl/"], maxDrift: 80 },
  { doc: "docs/fleet.md", areas: ["packages/core/src/modules/fleet/", "packages/core/src/modules/connections/"], maxDrift: 60 },
];

const SCRIPT_EXTS = [".mjs", ".ts", ".sh"];
const SKIP_DIRS = new Set([".git", "node_modules", "data", "dist", "dev-dist", "test-results", "playwright-report", "worktrees"]);

// ——— Helfer ———

export function walk(root, rel, out) {
  for (const name of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (name.isDirectory()) {
      if (!SKIP_DIRS.has(name.name)) walk(root, join(rel, name.name), out);
    } else out.push(join(rel, name.name).replaceAll("\\", "/"));
  }
  return out.sort();
}

function globToRe(glob) {
  const re = glob
    .split("*")
    .map((p) => p.replace(/[.+^${}()|[\]\\?]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${re}$`);
}

function readLines(root, file) {
  return readFileSync(join(root, file), "utf8").split("\n");
}

// Referenz-Korpus: getrackte Textdateien des Repos (Contents gehashed, einmal gelesen).
function textCorpus(root) {
  return walk(root, ".", [])
    .filter((f) => /\.(md|mjs|ts|tsx|js|json|yml|yaml|cjs|sh|example|gitmessage|gitignore)$/.test(f) || f.endsWith("Dockerfile") || f === ".gitmessage")
    .map((f) => ({ file: f, text: readFileSync(join(root, f), "utf8") }));
}

// ——— Checks ———

export function checkBudgets(root, files) {
  const findings = [];
  for (const { glob, limit } of LINE_BUDGETS) {
    const re = globToRe(glob);
    for (const file of files.filter((f) => re.test(f))) {
      const lines = readFileSync(join(root, file), "utf8").replace(/\n$/, "").split("\n").length;
      if (lines > limit) findings.push({ rule: "budget", file, detail: `${lines} Zeilen > Budget ${limit}` });
    }
  }
  return findings;
}

export function checkLinks(root, files) {
  const findings = [];
  const targets = files.filter((f) => LINK_ROOTS.includes(f) || f.startsWith(".claude/"));
  const linkRe = /\]\(([^)\s]+)\)/g;
  for (const file of targets) {
    for (const m of readLines(root, file).join("\n").matchAll(linkRe)) {
      const ref = m[1];
      if (/^(https?:|mailto:|#|\/)/.test(ref)) continue;
      const clean = ref.split("#")[0].replace(/^<|>$/g, "");
      if (!clean) continue;
      const target = resolve(root, dirname(file), clean);
      // Repo-externe Ziele (z. B. Nachbar-Checkouts) sind nicht portabel
      // prüfbar und werden bewusst übersprungen.
      if (!target.startsWith(resolve(root) + "/")) continue;
      if (!existsSync(target)) findings.push({ rule: "link", file, detail: `toter Link → ${ref}` });
    }
  }
  return findings;
}

export function checkReferences(root, files) {
  const findings = [];
  const corpus = textCorpus(root);
  const referenced = (needle, self) => corpus.some((c) => c.file !== self && c.text.includes(needle));

  for (const file of files) {
    if (!file.startsWith("docs/") || file.startsWith("docs/adr/") || file.startsWith("docs/assets/") || file.startsWith("docs/messlauf/")) continue;
    const base = file.split("/").pop();
    if (DATED_NAME.test(base.replace(/\.md$/, ""))) continue; // Snapshot: eingefroren
    if (!referenced(base, file)) findings.push({ rule: "docs-ref", file, detail: "von keiner Stelle im Repo referenziert (Snapshot: Datum in den Namen)" });
  }

  for (const file of files) {
    if (!file.startsWith("scripts/")) continue;
    const base = file.split("/").pop();
    if (!SCRIPT_EXTS.some((e) => base.endsWith(e))) continue;
    if (base.includes(".test.")) continue;
    const stem = base.replace(/\.(mjs|ts|sh)$/, "");
    const hasTest = files.some((f) => f === `scripts/${stem}.test.mjs` || f === `scripts/${stem}.test.ts`);
    if (!hasTest && !referenced(base, file)) {
      findings.push({ rule: "script-ref", file, detail: "weder referenziert (package.json/CI/Doku) noch getestet (*.test.mjs/.ts)" });
    }
  }
  return findings;
}

// Lebende Doku-Seite = docs/*.md (flach), kein datierter Snapshot.
export const DOC_KINDS = ["tutorial", "how-to", "referenz", "erklaerung"];
const DOC_KIND_LINE = /^\*\*Art:\*\*\s*(.+?)\s*$/;
export const DOC_INDEX = "docs/uebersicht.md";

function livingDocs(files) {
  // EPIC-P62 T62.1: docs/guide/ ist lebende Doku (Art + Index wie flache
  // docs/*.md). docs/videos/ sind Clip-Skripte — nur Zeilen-Budget, kein
  // Index (sonst bläht jede Episode die Übersicht auf).
  return files.filter(
    (f) =>
      (/^docs\/[^/]+\.md$/.test(f) || /^docs\/guide\/[^/]+\.md$/.test(f)) &&
      !DATED_NAME.test(f.slice(5).replace(/\.md$/, "")),
  );
}

// Diátaxis: jede lebende Seite trägt genau eine Art (Kopfzeile `**Art:** …`,
// in den ersten 12 Zeilen) und steht in der Übersichtsseite.
export function checkDocKind(root, files) {
  const findings = [];
  const index = files.includes(DOC_INDEX) ? readFileSync(join(root, DOC_INDEX), "utf8") : null;
  for (const file of livingDocs(files)) {
    const arts = readLines(root, file).slice(0, 12).map((l) => DOC_KIND_LINE.exec(l)?.[1]).filter(Boolean);
    if (arts.length !== 1) findings.push({ rule: "doc-kind", file, detail: `genau eine Zeile \`**Art:** ${DOC_KINDS.join("|")}\` erwartet, gefunden: ${arts.length}` });
    else if (!DOC_KINDS.includes(arts[0])) findings.push({ rule: "doc-kind", file, detail: `unbekannte Art „${arts[0]}“ (erlaubt: ${DOC_KINDS.join(", ")})` });
    if (file !== DOC_INDEX && index !== null && !index.includes(file.slice(5))) findings.push({ rule: "doc-index", file, detail: `fehlt in ${DOC_INDEX}` });
  }
  if (index === null) findings.push({ rule: "doc-index", file: DOC_INDEX, detail: "Übersichtsseite fehlt" });
  return findings;
}

// Generierte Referenz (EPIC-P57 T57.3): committeter Stand muss dem frisch
// generierten entsprechen. Ohne Generator im Root (Fixtures) entfällt die Regel.
export function realReferenceRun(root) {
  const r = spawnSync("node", ["scripts/gen-reference.mjs", "--check", "--root", root], { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, message: (r.stderr || r.stdout || "").trim() };
}

export function checkReferenceFresh(root, files, run = realReferenceRun) {
  if (!files.includes("scripts/gen-reference.mjs")) return [];
  const { ok, message } = run(root);
  return ok ? [] : [{ rule: "reference-fresh", file: "docs/referenz-*.md", detail: message || "generierte Referenz veraltet" }];
}

// EPIC-P63 T63.10: Token-Tabelle in design-system.md muss dem Stand von
// 00-tokens.css entsprechen. Ohne Generator im Root (Fixtures) entfällt die Regel.
export function realDesignTokensRun(root) {
  const r = spawnSync("node", ["scripts/design-tokens-doc.mjs", "--check"], { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, message: (r.stderr || r.stdout || "").trim() };
}

export function checkDesignTokensFresh(root, files, run = realDesignTokensRun) {
  if (!files.includes("scripts/design-tokens-doc.mjs")) return [];
  const { ok, message } = run(root);
  return ok ? [] : [{ rule: "design-tokens-fresh", file: "docs/design-system.md", detail: message || "Token-Tabelle veraltet" }];
}

export function checkDrift(root, git, map = REFRESH_MAP) {
  const findings = [];
  for (const { doc, areas, maxDrift } of map) {
    if (!existsSync(join(root, doc))) {
      findings.push({ rule: "drift-map", file: doc, detail: "in REFRESH_MAP, aber Datei fehlt — Map pflegen" });
      continue;
    }
    const iso = git.lastCommitIso(doc);
    if (!iso) continue;
    // Eine uncommittete Überarbeitung gilt als laufendes Review — sonst wäre
    // das Gate vor dem eigenen Commit nie grün (Henne-Ei).
    if (git.isDirty(doc)) continue;
    const drift = git.countSince(iso, areas);
    if (drift > maxDrift) {
      findings.push({ rule: "drift", file: doc, detail: `${drift} Commits in [${areas.join(", ")}] seit letzter Berührung — Review fällig (max ${maxDrift})` });
    }
  }
  return findings;
}

// Realer git-Zugriff; Tests injizieren einen Fake.
export function realGit(root) {
  const run = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  return {
    lastCommitIso: (doc) => {
      try {
        return run(["log", "-1", "--format=%aI", "--", doc]);
      } catch {
        return null;
      }
    },
    isDirty: (doc) => {
      try {
        execFileSync("git", ["diff", "--quiet", "HEAD", "--", doc], { cwd: root, stdio: "ignore" });
        return false;
      } catch {
        return true; // Exit-Code != 0 → Datei weicht von HEAD ab
      }
    },
    countSince: (iso, areas) => Number(run(["rev-list", "--count", "HEAD", `--since=${iso}`, "--", ...areas])),
  };
}

// ——— Zusammenführung ———

export function runAll(root, { git } = {}) {
  const files = walk(root, ".", []);
  const findings = [
    ...checkBudgets(root, files),
    ...checkLinks(root, files),
    ...checkReferences(root, files),
    ...checkDocKind(root, files),
    ...checkReferenceFresh(root, files),
    ...checkDesignTokensFresh(root, files),
    ...checkDrift(root, git ?? realGit(root)),
  ];
  return { ok: findings.length === 0, findings, checked: files.length };
}

function main() {
  const args = process.argv.slice(2);
  const root = args.includes("--root") ? resolve(args[args.indexOf("--root") + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { ok, findings, checked } = runAll(root);
  for (const f of findings) console.error(`check:context: [${f.rule}] ${f.file} — ${f.detail}`);
  if (ok) console.log(`check:context: OK (${checked} Dateien: Budgets, Links, Referenzen, Doku-Arten, generierte Referenz, Script-Inventar, Frischhalte-Map)`);
  else {
    console.error(`check:context: ${findings.length} Befund/Befunde (Regeln: docs/check-context.md)`);
    process.exit(1);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
