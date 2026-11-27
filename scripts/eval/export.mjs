import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { diagnosisTable } from "./diagnose.mjs";
import { validateSeries } from "./report.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Legt den auswertbaren Export einer Serie in ein Benchmark-Repo (nie überschreiben, R9.6):
 * lauf.yaml (JSON ist gültiges YAML), ergebnisse.jsonl, sessions.jsonl, invalid.jsonl, manifest.sha256, dazu
 * neben den Belegen liegende aborted.jsonl/verdicts.jsonl und mit `diagnosis` die Laufdiagnose.
 * Eine unvollständige Serie wird nur mit `partial` exportiert und ist dann nie `messung_gueltig`.
 */
export function exportSeries({ rows, receipts, invalid, plan, meta, out, partial = false, diagnosis }) {
  let series;
  let reason = null;
  try {
    ({ series, rows } = validateSeries(rows, plan));
  } catch (error) {
    if (!partial) throw error;
    reason = `Serie unvollständig oder inkonsistent: ${error.message}`;
    series = rows[0]?.input.series ?? "unbekannt";
  }
  const invalidLines = invalid ? readFileSync(invalid, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const beside = ["aborted.jsonl", "verdicts.jsonl"].filter((name) => existsSync(join(dirname(receipts), name)));
  const aborted = beside.includes("aborted.jsonl") ? readFileSync(join(dirname(receipts), "aborted.jsonl"), "utf8").split("\n").filter(Boolean).length : 0;
  const spent = {};
  for (const row of rows) {
    row.input.phases.forEach((info, index) => {
      if (info.billing.kind === "cloud") {
        const cell = plan.config.cells.find((entry) => entry.fingerprint === info.modelFingerprint && entry.billing.kind === "cloud");
        const provider = cell?.provider ?? "unbekannt";
        spent[provider] = (spent[provider] ?? 0) + row.phases[index].costUsd;
      }
    });
  }
  const manifest = {
    schema_version: 1,
    lauf_id: `${meta.date}-${series}`,
    datum: meta.date,
    // Pflichtangaben (R9.7): Prüfstand, Modell(e), Messwerkzeug, Suite
    pruefstand: plan.config.setup,
    messwerkzeug: `npm run messlauf:eval @ ${meta.commit}`,
    suite_version: `p84-korpus ${plan.corpus.hash}`,
    protokoll_sha256: plan.protocolHash,
    wiederholungen: plan.config.repetitions,
    zellen: plan.config.cells.map(({ id, harness, adapter, version, configurationFingerprint, model, fingerprint, provider, billing }) =>
      ({ id, harness, adapter, version, configurationFingerprint, model, fingerprint, provider, billing })),
    laeufe_erwartet: plan.jobs.length,
    laeufe_erfasst: rows.length,
    infrastruktur_versuche_verworfen: invalidLines.length,
    laeufe_abgebrochen: aborted,
    kosten_cloud_usd_je_provider: spent,
    messung_gueltig: reason === null && invalidLines.length < rows.length,
    ...(reason ? { grund_ungueltig: reason } : {}),
    runtime: meta.runtime,
  };
  mkdirSync(out, { recursive: false });
  writeFileSync(join(out, "lauf.yaml"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  writeFileSync(join(out, "ergebnisse.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), { flag: "wx" });
  copyFileSync(receipts, join(out, "sessions.jsonl"));
  if (invalid) copyFileSync(invalid, join(out, "invalid.jsonl"));
  for (const name of beside) copyFileSync(join(dirname(receipts), name), join(out, name));
  if (diagnosis) {
    writeFileSync(join(out, "diagnose.jsonl"), diagnosis.map((row) => JSON.stringify(row)).join("\n") + "\n", { flag: "wx" });
    writeFileSync(join(out, "diagnose.md"), `${diagnosisTable(diagnosis)}\n`, { flag: "wx" });
  }
  const names = readdirSync(out).filter((name) => name !== "manifest.sha256").sort();
  writeFileSync(join(out, "manifest.sha256"), names.map((name) => `${sha(readFileSync(join(out, name)))}  ${name}`).join("\n") + "\n", { flag: "wx" });
  return { manifest, files: names, exists: existsSync(out) };
}
