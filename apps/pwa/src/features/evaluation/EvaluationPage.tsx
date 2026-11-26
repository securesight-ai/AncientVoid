import { useEffect, useState } from "preact/hooks";
import { evaluationTable } from "@ancientvoid/contracts";
import type { EvalSeriesList, EvalSeriesSummary } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { Card, EmptyState, Select } from "../../shared/ui/index.ts";
import { t } from "../../shared/i18n/index.ts";

/**
 * EPIC-P84 (ADR-0126, Messlatte K8-Klasse „kein Lauf geht still verloren“): Rohwerte der
 * Evaluationsserien. Die Tabelle kommt aus `evaluationTable` der Contracts — derselben
 * Funktion, aus der `messlauf:eval pilot-report` den Markdown-Report schreibt. Fehlende
 * Quellen stehen als Fehler da (fail loud), nie als leere Tabelle.
 */
export function EvaluationPage() {
  const [list, setList] = useState<EvalSeriesList | null>(null);
  const [series, setSeries] = useState("");
  const [summary, setSummary] = useState<EvalSeriesSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    hubApi.evaluationSeries().then((value) => {
      setList(value);
      setSeries((current) => current || value.series.at(-1)?.series || "");
    }).catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!series) return;
    setSummary(null);
    hubApi.evaluationSummary(series).then(setSummary).catch(() => setFailed(true));
  }, [series]);

  if (failed) return <EmptyState text={t("evaluation.error")} />;
  if (list === null) return null;
  if (list.series.length === 0) return <EmptyState text={t("evaluation.empty")} />;
  const table = summary ? evaluationTable(summary) : null;
  return (
    <Card aria-label={t("evaluation.title")}>
      <p>{t("evaluation.hint")}</p>
      <Select label={t("evaluation.series")} value={series} options={list.series.map((entry) => ({ value: entry.series, label: `${entry.series} · ${t("evaluation.runs", { n: entry.runs })}` }))} onChange={setSeries} />
      {summary && !summary.consistent && <p role="alert">{t("evaluation.inconsistent")}</p>}
      {table && (
        <div class="eval-table-wrap" style={{ overflowX: "auto" }}>
          <table class="eval-table" data-testid="evaluation-table">
            <thead><tr>{table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{table.rows.map((row) => <tr key={`${row[0]}/${row[1]}`}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
