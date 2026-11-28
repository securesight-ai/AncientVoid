import { evaluationTable, EvalSeriesSummary } from "@ancientvoid/contracts";

const cell = (text) => String(text).replaceAll("|", "\\|");
const row = (cells) => `| ${cells.map(cell).join(" | ")} |`;

/**
 * Markdown-Report einer Serie aus der Hub-Zusammenfassung (dieselbe Quelle wie der PWA-Reiter
 * „Evaluation“). Die Rohwert-Tabelle ist `evaluationTable` — Zeichen für Zeichen dieselbe Zeichenkette.
 */
export function renderPilotReport(rawSummary, plan, meta) {
  const summary = EvalSeriesSummary.parse(rawSummary);
  if (!summary.consistent) throw new Error("Series mixes corpus or protocol versions; refusing to report it");
  if (summary.corpusHashes[0] !== plan.corpus.hash || summary.protocolHashes[0] !== plan.protocolHash) {
    throw new Error("Series was recorded with a different corpus or protocol than the one given");
  }
  const table = evaluationTable(summary);
  const comparison = summary.comparison;
  const complete = meta.valid && summary.runs === plan.jobs.length;
  const canEnableScan = complete && comparison?.tasks.length >= 10 &&
    comparison.tasks.some(({ status }) => status === "improved") &&
    comparison.tasks.every(({ status }) => status === "improved" || status === "unchanged");
  const lines = [
    `# P84 — Pilotserie ${summary.series} (${meta.date})`, "",
    "**Art:** bericht · Messlatte: K8-Klasse (kein Lauf geht still verloren), K9 (Fehler sichtbar), K7 (aus Journalen rekonstruierbar) · EPIC-P84", "",
    "## Pflichtangaben", "",
    `- Prüfstand: ${plan.config.setup}`,
    `- Datum: ${meta.date} · erster Lauf ${summary.firstRecordedAt}, letzter Lauf ${summary.lastRecordedAt}`,
    `- Messwerkzeug: npm run messlauf:eval @ ${meta.commit} · ${meta.runtime}`,
    `- Korpus SHA-256: ${summary.corpusHashes[0]}`, `- Protokoll SHA-256: ${summary.protocolHashes[0]}`,
    `- Läufe: ${summary.runs} erfasst von ${plan.jobs.length} geplant · Wiederholungen je Zelle: ${plan.config.repetitions}`,
    `- Gültigkeit: ${complete ? "gültig" : `**ungültig** — ${meta.invalidReason || "nicht alle geplanten Läufe sind erfasst"}`}`, "",
    "## Zellen (Modell, Version, Abrechnung)", "",
    row(["Zelle", "Harness", "CLI-Version", "Modell", "Fingerprint", "Provider", "Abrechnung"]), row(["---", "---", "---", "---", "---", "---", "---"]),
    ...plan.config.cells.map((entry) => row([entry.id, entry.harness, entry.version, entry.model, entry.fingerprint, entry.provider,
      entry.billing.kind === "cloud"
        ? `Cloud ${entry.billing.date}: ${entry.billing.inputUsdPerMillion}/${entry.billing.cacheInputUsdPerMillion ?? "–"}/${entry.billing.outputUsdPerMillion} USD/Mio. (Input/Cache/Output)`
        : `P81 ${entry.billing.host} ${entry.billing.date}: ${entry.billing.usdPerKwh} USD/kWh`])), "",
    "## Rohwerte", "",
    "Jede Zelle: Median; Mittelwert; Minimum–Maximum über n Läufe. Einheiten stehen im Spaltenkopf. `n/a` gibt es nicht: nicht erfasste Läufe fehlen in n.", "",
    row(table.columns), row(table.columns.map(() => "---")), ...table.rows.map(row), "",
    ...(comparison ? [
      "## Repo-Vergleich", "",
      `- Geänderte Quelle: ${comparison.kind} · ${comparison.source}`,
      `- Referenz: ${comparison.reference} · Kandidat: ${comparison.candidate}`,
      `- Mindestverbesserung: ${comparison.minimumEffect * 100} Prozentpunkte Qualität oder Prozent Zeitersparnis`,
      `- Scan als Standard: ${canEnableScan ? "Go-Kriterien der Serie erfüllt" : "aus"}`, "",
      row(["Aufgabe", "Paare", "Befund", "Grund"]), row(["---", "---", "---", "---"]),
      ...comparison.tasks.map((task) => row([task.task, task.pairs, task.status, task.reason])), "",
    ] : []),
    "### Maschinenlesbar (CSV, Trennzeichen `,`, Zellen als `Median;Mittel;Min–Max`)", "", "```csv",
    table.columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(","),
    ...table.rows.map((entry) => entry.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")), "```", "",
    "## Was das nicht sagt", "",
    "- Eine Pilotserie ist keine Rangfolge. Ohne Vollkorpus, n ≥ 3 und eine unabhängige Wiederholungsserie trägt sie keine Aussage über „besser“.",
    "- Cloud-Kosten sind Listenpreisäquivalente zum eingefrorenen Preisdatum; Abo-Zugänge (z. B. Coding-Plan, Cursor) kosten real anders.",
    "- Adapter ohne getrennte Cache-Meldung rechnen den Cache zum Eingabepreis (obere Schranke).",
    "- Lokale Energie umfasst die P81-Komponenten des Messhosts inklusive Grundlast; fehlende Komponenten sind im Prüfstand zu nennen.", "",
  ];
  return lines.join("\n");
}
