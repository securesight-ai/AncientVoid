import type { AiMetricsField, AiMetricsSourceReport } from "@ancientvoid/contracts";
import { t } from "../../shared/i18n/index.ts";
import { formatMetricAge, formatMetricValue } from "../../shared/metrics.ts";
import { Sparkline, StatTile } from "../../shared/ui/charts/index.tsx";
import { thin, type SeriesPoint } from "../../shared/ui/charts/geometry.ts";

/**
 * EPIC-P81 T81.11: eine Metrik-Quelle als Kacheln mit Mini-Kurve, darunter die
 * vollständige Tabelle — geteilt von Metriken- und Statistik-Reiter. Kacheln zeigen
 * nur Gemeldetes; was fehlt, steht ehrlich in der Tabelle (ADR-0023).
 */
function series(field: AiMetricsField): SeriesPoint[] {
  return field.history.flatMap((s) => (s.value === null ? [] : [[Date.parse(s.ts), s.value] as const]));
}

export function MetricSource({ source, stepMs }: { source: AiMetricsSourceReport; stepMs: number }) {
  const reported = source.fields.filter((f) => f.value !== null);
  return (
    <div class="metric-source">
      <p class="stat-metrics-head">
        <strong>{source.label}</strong>
        {source.url && <code>{source.url}</code>}
      </p>
      {!source.status.ok && <p role="status" class="hosts-failed"><span aria-hidden="true">⚠</span> {t("aimetrics.probe_failed")} {source.status.error}</p>}
      {reported.length > 0 && (
        <div class="stat-tiles">
          {reported.map((f) => {
            const { points, stride } = thin(series(f), 120);
            return (
              <StatTile key={f.key} label={f.label} value={formatMetricValue(f.value, f.unit)}>
                <Sparkline points={points} stepMs={stepMs * stride} />
              </StatTile>
            );
          })}
        </div>
      )}
      <details class="hosts-table">
        <summary>{t("aimetrics.allFields", { n: source.fields.length })}</summary>
        <div class="stat-scroll">
          <table>
            <thead>
              <tr><th>{t("aimetrics.field")}</th><th>{t("aimetrics.value")}</th><th>p50 / p95</th><th>{t("composer.source")}</th><th>{t("aimetrics.age")}</th></tr>
            </thead>
            <tbody>
              {source.fields.map((field) => (
                <tr key={field.key}>
                  <td>{field.label}</td>
                  <td>{formatMetricValue(field.value, field.unit)}</td>
                  <td>{field.window ? `${formatMetricValue(field.window.p50, field.unit)} / ${formatMetricValue(field.window.p95, field.unit)} (${field.window.samples})` : "—"}</td>
                  <td>{field.source}</td>
                  <td>{formatMetricAge(field.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
