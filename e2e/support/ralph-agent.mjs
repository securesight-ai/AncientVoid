#!/usr/bin/env node
// EPIC-P54 (ADR-0110): Stand-in für eine promptbare Agenten-CLI. Der Ralph-Loop
// übergibt den Protokoll-Prompt als letztes Argument; dieser Ersatz liest die
// darin genannte State-Datei, arbeitet genau eine Aufgabe ab (deterministisch,
// ohne LLM) und beendet sich — wie ein echter Agententurn. Ohne offene Aufgabe
// setzt er status "wartend" (Gate grün, Menschen-Gate).

import { readFileSync, writeFileSync } from "node:fs";

const prompt = process.argv.at(-1) ?? "";
// EPIC-P54 / ADR-0113: die Agent-Review-Session bekommt ihren eigenen Prompt
// (Review-State-Datei, „Wahrheit über diesen Review“). Der Stand-in schreibt
// das deterministische Fazit: Aufgaben laut Arbeits-State geprüft, grün.
const reviewHit = /Review-State-Datei \(Wahrheit über diesen Review\): (\S+)/.exec(prompt);
if (reviewHit) {
  const file = reviewHit[1];
  const doc = JSON.parse(readFileSync(file, "utf8"));
  doc.status = "wartend";
  doc.notes = "Stand-in-Review (deterministisch, kein LLM): Aufgaben laut Arbeits-State erledigt und geprüft.";
  doc.last_progress_at = new Date().toISOString();
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  console.log("ralph-agent: Review grün — wartend");
  process.exit(0);
}
const hit = /State-Datei \(Wahrheit über Fortschritt\): (\S+)/.exec(prompt);
const file = hit[1];
const doc = JSON.parse(readFileSync(file, "utf8"));
const total = Array.isArray(doc.tasks_total) ? doc.tasks_total : [];
const done = Array.isArray(doc.tasks_done) ? doc.tasks_done : [];
const next = total.find((t) => !done.includes(t));
if (next) {
  done.push(next);
  doc.tasks_done = done;
  doc.current_task = total.find((t) => !done.includes(t)) ?? null;
  console.log(`ralph-agent: ${next} erledigt (${done.length}/${total.length}), verifiziert`);
} else if (doc.status === "running") {
  doc.status = "wartend";
  console.log("ralph-agent: alle Aufgaben grün — wartend");
}
doc.last_progress_at = new Date().toISOString();
writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
