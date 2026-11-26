#!/usr/bin/env node
// EPIC-P72 T72.6/T72.8: Run-Extraktor und Sequenz-Mining ueber events.jsonl +
// turn_metrics. Deterministisch, ohne Modellaufruf (ADR-0100).
// Aufruf: node scripts/skill-runs.mjs extract [--root <data-dir>] [--project <p>] [--since <ISO>] [--json]
//         node scripts/skill-runs.mjs mine [--root <data-dir>] [--project <p>] [--since <ISO>] [--json]
// Exit 0 ok / 1 Befund / 2 Fehler.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Shell-Namen-Tabelle (Spec T72.6): diese Namen (in jeder Gross-/Kleinschreibung)
// gelten als Shell-Tools; Shell-Formate ausserhalb der Tabelle -> unknownShape.
const SHELL_TOOLS = new Set(["bash", "shell", "sh", "exec", "exec_command"]);
const SHELL_IN_TABLE = new Set(["bash", "shell"]);
// Ablehnung/Blockade: Praefix-Klassen auf der ERSTEN Zeile des tool_result.
const EXIT_RE = /\bexit(?:ed)?\s+(?:with\s+)?code:?\s+(\d+)\b/i;
const PREFIX_CLASSES = [
  [/^permission\b.*\bdenied\b/i, "permission-denied"],
  [/^blocked:/i, "blocked"],
  [/^keine freigabe innerhalb/i, "approval-timeout"],
];
// Lesebefehle fuer Mining (T72.8): zaehlen nicht als Folge.
const READ_CMDS = [/^ls\b/, /^cat\b/, /^sed -n\b/, /^grep\b/, /^git status\b/, /^git log\b/, /^git diff\b/];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (key === "json") args.json = true;
      else args[key] = argv[++i];
    } else args._.push(argv[i]);
  }
  return args;
}

function toolName(payload) {
  if (typeof payload?.name === "string") return payload.name;
  if (typeof payload?.tool === "string") return payload.tool; // opencode-Normalizer
  return null;
}

function firstLine(text) {
  return String(text ?? "").split("\n", 1)[0] ?? "";
}

// Nur die erste Zeile gegen die fuenf belegten Exit-Formate; nur die Zahl wird uebernommen.
export function classifyResult(firstLineText, isError) {
  const line = firstLine(firstLineText);
  const exitMatch = line.match(EXIT_RE);
  if (exitMatch) {
    const exit = Number(exitMatch[1]);
    return { error: exit === 0 ? null : "exit-nonzero", exit };
  }
  for (const [re, cls] of PREFIX_CLASSES) if (re.test(line)) return { error: cls, exit: null };
  if (isError) return { error: "error", exit: null };
  return { error: null, exit: null };
}

function resolvePayload(event, root, sessionId, unparsed) {
  // K5: grosses Payload liegt im Blob (sessions/<id>/blobs/<sha256>), JSONL-Zeile
  // traegt nur Anker + blobRef.
  let payload = event.payload;
  if ((payload?.truncated || payload === null) && event.blobRef) {
    const blobPath = join(root, "sessions", sessionId, "blobs", String(event.blobRef).replace(/^sha256:/, ""));
    if (existsSync(blobPath)) {
      try { payload = JSON.parse(readFileSync(blobPath, "utf8")); } catch { unparsed.blobMissing++; return null; }
    } else { unparsed.blobMissing++; return null; }
  }
  return payload;
}

export function extractRuns(root, { project = null, since = null, sessionIds = null } = {}) {
  const sessionsDir = join(root, "sessions");
  const turnMetrics = readTurnMetrics(root);
  const runs = [];
  if (!existsSync(sessionsDir)) return runs;
  for (const sessionId of readdirSync(sessionsDir).sort()) {
    if (sessionIds && !sessionIds.has(sessionId)) continue;
    const file = join(sessionsDir, sessionId, "events.jsonl");
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    if (since && lines[0] && String(JSON.parse(lines[0]).ts ?? "") < since) continue;
    const unparsed = { shellWithoutCommand: 0, blobMissing: 0, unknownShape: 0 };
    const run = {
      sessionId, adapter: null, project: null,
      skills: { chain: [], invoked: [] },
      commands: [], prompts: [], cost: null, unparsed,
    };
    const resultsByCall = new Map();
    const pending = []; // {seq, cmd, callId}
    for (const line of lines) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "stream_event") continue; // uebersprungen (Spec)
      const payload = resolvePayload(event, root, sessionId, unparsed);
      if (payload?.kind === "session.created") {
        run.adapter = payload.adapter ?? null;
        run.project = payload.project ?? null;
        if (typeof payload.args?.skill === "string" && !run.skills.chain.includes(payload.args.skill)) run.skills.chain.push(payload.args.skill);
      } else if (payload?.kind === "session.skill_chain") {
        for (const n of payload.names ?? []) if (!run.skills.chain.includes(n)) run.skills.chain.push(n);
      } else if (event.type === "tool_use") {
        const name = toolName(payload);
        if (name?.toLowerCase() === "skill") {
          const skill = payload?.input?.skill ?? payload?.input?.name;
          if (typeof skill === "string" && !run.skills.invoked.includes(skill)) run.skills.invoked.push(skill);
        } else if (name?.toLowerCase() === "read") {
          const path = payload?.input?.path ?? payload?.input?.file_path ?? payload?.input?.filePath;
          const match = typeof path === "string" && /(?:^|\/)(?:\.claude|\.agents|\.pi|\.opencode)\/skills\/([a-zA-Z0-9_-]+)\/SKILL\.md$/.exec(path);
          if (match && !run.skills.invoked.includes(match[1])) run.skills.invoked.push(match[1]);
        } else if (name && SHELL_IN_TABLE.has(name.toLowerCase())) {
          const cmd = payload?.input?.command;
          if (typeof cmd === "string" && cmd.trim()) pending.push({ seq: event.seq, cmd, callId: payload.id ?? null });
          else unparsed.shellWithoutCommand++; // maki/opencode-Luecke (BUG-0247/0248)
        } else if (name && SHELL_TOOLS.has(name.toLowerCase())) {
          unparsed.unknownShape++; // Shell-Form ausserhalb der Tabelle
        }
      } else if (event.type === "user") {
        const text = payload?.text ?? event.summary;
        if (typeof text === "string" && text) run.prompts.push(text);
      } else if (event.type === "tool_result") {
        const id = payload?.toolUseId;
        if (id) resultsByCall.set(id, { text: payload?.content ?? payload?.output ?? payload?.error, isError: Boolean(payload?.isError) });
      }
    }
    if (project && run.project !== project && !(run.project ?? "").endsWith("/" + project)) continue;
    pending.sort((a, b) => a.seq - b.seq);
    run.commands = pending.map((c) => {
      const res = c.callId ? resultsByCall.get(c.callId) : null;
      const { error, exit } = classifyResult(res?.text, res?.isError);
      return { seq: c.seq, cmd: c.cmd, error, exit };
    });
    run.cost = turnMetrics?.(sessionId) ?? null;
    runs.push(run);
  }
  return runs;
}

function readTurnMetrics(root) {
  const dbPath = join(root, "hub.db");
  if (!existsSync(dbPath)) return null;
  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return null; }
  const stmt = db.prepare("SELECT tokens, tokens_source, cost_usd FROM turn_metrics WHERE session_id = ?");
  return (sessionId) => {
    const rows = stmt.all(sessionId);
    if (!rows.length) return null;
    const tokens = rows.reduce((s, r) => s + (r.tokens ?? 0), 0);
    const usd = rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
    const sources = [...new Set(rows.map((r) => r.tokens_source).filter(Boolean))].sort();
    return { usd: Math.round(usd * 1e6) / 1e6, tokens, source: sources.length === 1 ? sources[0] : sources.length ? "mixed" : null, turns: rows.length };
  };
}

// --- T72.7: Regelkatalog-Auswertung (evaluate) --------------------------------

// Treffer je Regel; scope invoked nur bei zugeordnetem Skill, scope project für alle Runs.
// unless literal-in-user-prompt: guard=true (Ausnahme greift; im Report sichtbar, nie still).
export function evaluateRuns(runs, catalog) {
  const hits = [];
  for (const [skillKey, rules] of Object.entries(catalog)) {
    if (skillKey === "$config") continue;
    for (const rule of rules) {
      for (const run of runs) {
        const applies =
          rule.scope === "invoked"
            ? run.skills.chain.includes(skillKey) || run.skills.invoked.includes(skillKey)
            : true;
        if (!applies) continue;
        const re = new RegExp(rule.match);
        if (rule.kind === "order") {
          const before = new RegExp(rule.before);
          const after = new RegExp(rule.after);
          const firstAfter = run.commands.find((c) => after.test(c.cmd));
          if (firstAfter && !run.commands.some((c) => before.test(c.cmd) && c.seq < firstAfter.seq)) {
            hits.push({ ruleId: rule.id, skill: skillKey, sessionId: run.sessionId, seq: firstAfter.seq, cmd: firstAfter.cmd, guard: false });
          }
          continue;
        }
        for (const c of run.commands) {
          if (!re.test(c.cmd)) continue;
          const guard = rule.unless === "literal-in-user-prompt" && (run.prompts ?? []).some((p) => p.includes(c.cmd));
          hits.push({ ruleId: rule.id, skill: skillKey, sessionId: run.sessionId, seq: c.seq, cmd: c.cmd, guard });
        }
      }
    }
  }
  hits.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq);
  return hits;
}

// --- T72.8: Signatur-Normalisierung + Mining ---------------------------------

// Pfade, UUIDs, Zahlen, Quoted-Strings -> Platzhalter; Pipes/&& in Einzelbefehle.
export function normalizeCommand(cmd) {
  return String(cmd)
    .split(/\s*(?:\|\||&&|\|)\s*/)
    .filter((part) => part.trim())
    .map((part) =>
      part
        .replace(/(["'])(?:[^"'\\]|\\.)*\1/g, "<str>")
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
        .replace(/\b[\w.@-]+(?:\/[\w.@-]+)+\b/g, "<path>")
        .replace(/(?:\/|\.\/|~\/)[\w./@-]+/g, "<path>")
        .replace(/\b\d+\b/g, "<n>")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join(" | ");
}

export function signature(cmd, error) {
  return normalizeCommand(cmd) + "#" + (error ?? "ok");
}

// Pipes/&& zerlegen: jeder Teil-Schritt ist ein Signatur-Element der Folge.
export function signatureParts(cmd, error) {
  const cls = error ?? "ok";
  const parts = String(cmd).split(/\s*(?:\|\||&&|\|)\s*/).filter((p) => p.trim());
  return (parts.length ? parts : [String(cmd).trim()]).map((p) => normalizeCommand(p) + "#" + cls);
}

export function mineSequences(runs, { minHits = 3, minSessions = 2 } = {}) {
  const seqs = runs.map((run) => ({
    sessionId: run.sessionId,
    sigs: run.commands
      .flatMap((c) => signatureParts(c.cmd, c.error))
      .filter((s) => !READ_CMDS.some((re) => re.test(s.split("#")[0]))),
  }));
  const costBySession = new Map(runs.map((r) => [r.sessionId, r.cost?.usd ?? 0]));
  const counts = new Map();
  for (const { sessionId, sigs } of seqs) {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= sigs.length; i++) {
        const gram = sigs.slice(i, i + n).join(" ; ");
        if (!counts.has(gram)) counts.set(gram, { sessions: new Set(), hits: 0 });
        counts.get(gram).sessions.add(sessionId);
        counts.get(gram).hits++;
      }
    }
  }
  const candidates = [];
  for (const [gram, v] of counts) {
    if (v.hits < minHits || v.sessions.size < minSessions) continue;
    const avgCost = [...v.sessions].reduce((s, id) => s + (costBySession.get(id) ?? 0), 0) / v.sessions.size;
    candidates.push({ gram, hits: v.hits, sessions: [...v.sessions].sort(), score: Math.round(v.hits * avgCost * 1e6) / 1e6, suggestion: suggestScriptName(gram) });
  }
  candidates.sort((a, b) => b.score - a.score || b.hits - a.hits || (a.gram < b.gram ? -1 : 1));
  return candidates;
}

// Deterministischer Skriptname-Vorschlag aus dem ersten Befehl der Folge.
function suggestScriptName(gram) {
  const words = gram.split(" ; ")[0].replace(/#\S+/g, "").replace(/[#<>()]/g, "").replace(/&{1,2}/g, " ").split(/[\s./-]+/).filter((w) => w && !/^\d+$/.test(w));
  const slug = words.slice(0, 2).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  return `scripts/${slug || "run"}.mjs`;
}

// --- CLI ----------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ?? join(REPO_ROOT, "data");
  try {
    const runs = extractRuns(root, { project: args.project, since: args.since });
    if (args._[0] === "extract") {
      if (args.json) { process.stdout.write(JSON.stringify(runs, null, 2) + "\n"); return 0; }
      process.stdout.write(`# Skill-Runs (${runs.length})\n\n`);
      for (const r of runs.slice(0, 38)) process.stdout.write(`- ${r.sessionId.slice(0, 8)} ${r.adapter ?? "?"} ${r.project ?? "?"} chain=[${r.skills.chain.join(",")}] invoked=[${r.skills.invoked.join(",")}] cmds=${r.commands.length} unparsed=${JSON.stringify(r.unparsed)}\n`);
      return 0;
    }
    if (args._[0] === "evaluate") {
      const catalogPath = args.catalog ?? join(REPO_ROOT, ".claude", "skills", "_shared", "skill-checks.json");
      const runs = args.runs ? JSON.parse(readFileSync(args.runs, "utf8")) : extractRuns(root, { project: args.project, since: args.since });
      const hits = evaluateRuns(Array.isArray(runs) ? runs : [runs], JSON.parse(readFileSync(catalogPath, "utf8")));
      if (args.json) { process.stdout.write(JSON.stringify(hits, null, 2) + "\n"); return 0; }
      process.stdout.write(`# Regeltreffer (${hits.length})\n\n`);
      for (const h of hits) process.stdout.write(`- ${h.ruleId} @ ${h.sessionId.slice(0, 8)} seq ${h.seq}: \`${h.cmd}\`${h.guard ? " (Ausnahme: wörtlich im Prompt)" : ""}\n`);
      return hits.some((h) => !h.guard) ? 1 : 0; // Befund = echter Treffer
    }
    if (args._[0] === "mine") {
      const candidates = mineSequences(runs);
      if (args.json) { process.stdout.write(JSON.stringify(candidates, null, 2) + "\n"); return 0; }
      process.stdout.write("# Skript-Kandidaten (>= 3 Vorkommen in >= 2 Sessions)\n\n");
      for (const c of candidates.slice(0, 10)) process.stdout.write(`- ${c.hits}x in ${c.sessions.length} Sessions — score ${c.score}: \`${c.gram}\` → ${c.suggestion}\n`);
      return candidates.length ? 1 : 0; // Befund = Kandidaten vorhanden
    }
    process.stderr.write("usage: skill-runs.mjs extract|evaluate|mine [--root <dir>] [--runs <file>] [--catalog <file>] [--project <p>] [--since <ISO>] [--json]\n");
    return 2;
  } catch (err) {
    process.stderr.write(`skill-runs: ${err.message}\n`);
    return 2;
  }
}

if (process.argv[1] && process.argv[1].endsWith("skill-runs.mjs")) process.exit(main());
