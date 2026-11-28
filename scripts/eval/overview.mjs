import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * T84.15: Serienübersicht im Benchmark-Repo (Serie × Zelle × Aufgabe) aus den
 * exportierten Lauf-Ordnern (lauf.yaml + ergebnisse.jsonl). Serien mit
 * unterschiedlichem Korpus- oder Protokollstand werden getrennt ausgewiesen
 * und nie zusammengerechnet — die Gruppen sind das Strukturprinzip, nicht
 * ein Warnhinweis. Kein Hub, kein Protokoll nötig; Quelle ist der Export (K7
 * bleibt der Hub, der Export ist dessen Ablage).
 */

const cellOf = (arm, cells) => {
  const hit = cells.filter((cell) => arm === cell.id || arm.startsWith(`${cell.id}-`)).sort((a, b) => b.id.length - a.id.length)[0];
  return hit?.id ?? "?";
};

const passed = (row) => row.input.outcome === "completed" && row.input.acceptance && row.input.lint && row.input.typecheck;

export function readSeriesFolders(root) {
  const laufDir = join(root, "evaluation", "laeufe");
  if (!existsSync(laufDir)) throw new Error(`No evaluation/laeufe under ${root}`);
  const series = readdirSync(laufDir)
    .filter((name) => statSync(join(laufDir, name)).isDirectory())
    .sort()
    .map((name) => {
      const folder = join(laufDir, name);
      const manifest = JSON.parse(readFileSync(join(folder, "lauf.yaml"), "utf8"));
      for (const field of ["lauf_id", "datum", "suite_version", "protokoll_sha256", "messung_gueltig", "zellen"]) {
        if (manifest[field] === undefined) throw new Error(`${name}: lauf.yaml lacks ${field}`);
      }
      const rows = readFileSync(join(folder, "ergebnisse.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => {
        const row = JSON.parse(line);
        // Vor ADR-0128 exportierte Serien haben kein outcome — ihre Zeilen sind
        // ausschließlich vollendete Läufe (Abbrüche kamen nie in die Ergebnisse).
        const { arm, task } = row.input ?? {};
        const outcome = row.input?.outcome ?? "completed";
        if (typeof arm !== "string" || typeof task !== "string" || !["completed", "timeout", "approval"].includes(outcome)) {
          throw new Error(`${name}: ergebnisse.jsonl lacks arm/task or has an unknown outcome`);
        }
        row.input.outcome = outcome;
        return row;
      });
      return { name, folder, manifest, rows };
    });
  if (!series.length) throw new Error(`No exported series under ${laufDir}`);
  return series;
}

/** Gruppierung nach Korpus- und Protokollstand: nur innerhalb einer Gruppe ist Vergleichbarkeit behauptet. */
export function groupKey(manifest) {
  return `${manifest.suite_version} · ${manifest.protokoll_sha256.slice(0, 12)}`;
}

export function renderOverview(root, { generatedAt }) {
  const series = readSeriesFolders(root);
  const groups = new Map();
  for (const entry of series) {
    const key = groupKey(entry.manifest);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const lines = [
    "# Serienübersicht der Evaluation (generiert)", "",
    `Generiert ${generatedAt} aus \`evaluation/laeufe/\` (lauf.yaml, ergebnisse.jsonl).`,
    "Diese Übersicht ist eine Sicht auf die Exporte — Quelle bleibt der Hub (K7). Sie wird neu generiert, nie von Hand gepflegt.", "",
  ];
  if (groups.size > 1) {
    lines.push(`**${groups.size} inkompatible Stände:** Serien mit unterschiedlichem Korpus- oder Protokollstand werden ausschließlich je Abschnitt ausgewiesen und **nie zusammengerechnet**.`, "");
  }
  for (const [key, entries] of groups) {
    lines.push(`## Stand: ${key}`, "",
      `- Serien: ${entries.map((entry) => `${entry.name} (${entry.manifest.laeufe_erfasst} Läufe${entry.manifest.messung_gueltig ? "" : ", **ungültig**"})`).join(", ")}`,
      `- Korpus: ${entries[0].manifest.suite_version} · Protokoll: ${entries[0].manifest.protokoll_sha256}`, "");
    const cells = entries[0].manifest.zellen;
    for (const entry of entries) {
      lines.push(`### ${entry.name} (${entry.manifest.datum}${entry.manifest.messung_gueltig ? "" : " · messung_gueltig=false"})`, "",
        "| Zelle | Arm | Aufgabe | n | bestanden | timeout | approval | Fehlerquote |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |");
      const byArm = new Map();
      for (const row of entry.rows) {
        const bucket = byArm.get(row.input.arm) ?? new Map();
        bucket.set(row.input.task, [...(bucket.get(row.input.task) ?? []), row]);
        byArm.set(row.input.arm, bucket);
      }
      for (const [arm, tasks] of [...byArm.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
        for (const [task, rows] of [...tasks.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
          const timeouts = rows.filter((row) => row.input.outcome === "timeout").length;
          const approvals = rows.filter((row) => row.input.outcome === "approval").length;
          const ok = rows.filter(passed).length;
          lines.push(`| ${cellOf(arm, cells)} | ${arm} | ${task} | ${rows.length} | ${ok} | ${timeouts} | ${approvals} | ${((rows.length - ok) / rows.length).toFixed(2)} |`);
        }
        const rows = [...tasks.values()].flat();
        const ok = rows.filter(passed).length;
        const timeouts = rows.filter((row) => row.input.outcome === "timeout").length;
        const approvals = rows.filter((row) => row.input.outcome === "approval").length;
        lines.push(`| ${cellOf(arm, cells)} | ${arm} | **gesamt** | ${rows.length} | ${ok} | ${timeouts} | ${approvals} | ${((rows.length - ok) / rows.length).toFixed(2)} |`);
      }
      lines.push("");
    }
  }
  lines.push("## Nicht aufsumiert", "",
    "Gesamtzeilen gelten je Arm je Serie. Über Serien, Zellen oder Stände hinweg gibt es bewusst keine Summe: die Stände trennen Korpus und Konfiguration, und n je Zelle bleibt die Messlatte der Reports (Median + Streuung, AC-P84-2).", "");
  return { markdown: lines.join("\n"), groups: [...groups.keys()], series: series.map((entry) => entry.name) };
}
