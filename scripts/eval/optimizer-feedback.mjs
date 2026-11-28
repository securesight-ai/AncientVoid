import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * EPIC-P90 T90.7 (§3.5 Metrik b): Akzeptanzrate der Verbesserer-Vorschläge
 * aus `prompt-optimizer-feedback.jsonl` — das Nutzungs­signal der Messung.
 * Reines Lesen, kein LLM, keine Cloud: dieselbe Datei, die T3.9 schreibt.
 */

export function summariseFeedback(entries) {
  const valid = entries.filter((entry) => entry && typeof entry === "object"
    && (entry.decision === "accepted" || entry.decision === "rejected"));
  const malformed = entries.length - valid.length;
  const accepted = valid.filter((entry) => entry.decision === "accepted");
  const group = (key) => Object.entries(valid.reduce((acc, entry) => {
    const name = typeof entry[key] === "string" && entry[key] ? entry[key] : "unbekannt";
    acc[name] = (acc[name] ?? { accepted: 0, total: 0 });
    acc[name].total += 1;
    if (entry.decision === "accepted") acc[name].accepted += 1;
    return acc;
  }, {})).map(([name, { accepted: ok, total }]) => ({ name, accepted: ok, total, rate: total > 0 ? ok / total : 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const latency = valid.length > 0 ? Math.round(valid.reduce((sum, entry) => sum + (Number.isFinite(entry.latencyMs) ? entry.latencyMs : 0), 0) / valid.length) : null;
  return {
    total: valid.length,
    accepted: accepted.length,
    rejected: valid.length - accepted.length,
    rate: valid.length > 0 ? accepted.length / valid.length : null,
    malformed,
    window: valid.length > 0 ? { first: valid[0].ts, last: valid[valid.length - 1].ts } : null,
    engines: group("engine"),
    projects: group("project"),
    meanLatencyMs: latency,
  };
}

export async function readFeedback(dataDir) {
  let raw;
  try {
    raw = await readFile(join(dataDir, "prompt-optimizer-feedback.jsonl"), "utf8");
  } catch {
    return [];
  }
  return raw.split("\n").filter((line) => line.trim().length > 0).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  });
}

const percent = (rate) => rate === null ? "–" : `${Math.round(rate * 1000) / 10} %`;

export function renderFeedback(summary) {
  if (summary.total === 0) {
    return ["Vorschlags-Rückmeldung: keine Einträge. Die Akzeptanzrate ist noch nicht messbar.", ""].join("\n");
  }
  const lines = [
    `Vorschlags-Rückmeldung: ${summary.accepted}/${summary.total} angenommen (${percent(summary.rate)})`,
    `· Zeitraum: ${summary.window.first} – ${summary.window.last}`,
    `· mittlere Latenz je Vorschau: ${summary.meanLatencyMs} ms`,
  ];
  if (summary.malformed > 0) lines.push(`· unlesbare Zeilen (gezählt, nicht gedeutet): ${summary.malformed}`);
  for (const [label, groups] of [["Engine", summary.engines], ["Projekt", summary.projects]]) {
    for (const group of groups.slice(0, 5)) {
      lines.push(`· ${label} ${group.name}: ${group.accepted}/${group.total} (${percent(group.rate)})`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = arg("data");
  if (!dataDir) {
    console.log("Usage: node scripts/eval/optimizer-feedback.mjs --data <hub-datadir>");
    process.exitCode = 2;
  } else {
    process.stdout.write(renderFeedback(summariseFeedback(await readFeedback(dataDir))));
  }
}
