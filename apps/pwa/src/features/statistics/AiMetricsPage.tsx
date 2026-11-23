import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { AiMetricsReport } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { Card, EmptyState } from "../../shared/ui/index.ts";
import { MetricSource } from "./MetricSource.tsx";

/**
 * EPIC-P59 (ADR-0078): Metrik-Seite — Auslastung des lokalen KI-Servers.
 * Zeigt nur was der Hub gemessen meldet; jede Zahl trägt Quelle und Alter
 * (ADR-0023). Offline bleiben die letzten Daten plus Zeitstempel stehen,
 * kein Whiteout (K10). Der Poll folgt dem Intervall des Reports.
 * EPIC-P66: Wert-/Altersformat geteilt mit der Statistik-Zentrale
 * (shared/metrics.ts).
 */

const REFRESH_FALLBACK_MS = 10_000;

export function AiMetricsPage() {
  const [report, setReport] = useState<AiMetricsReport | null>(null);
  const [stale, setStale] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      timer = setTimeout(poll, ms);
    };
    const poll = async () => {
      try {
        const res = await hubApi.aimetrics();
        if (!alive) return;
        setReport(res);
        setStale(false);
        schedule(Math.max(2, res.intervalSec) * 1000);
      } catch {
        if (!alive) return;
        setStale(true);
        schedule(REFRESH_FALLBACK_MS);
      }
      if (alive) setTick((t) => t + 1);
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!report) return <EmptyState text={stale ? "keine Daten — der Hub meldet nicht" : "lädt …"} />;
  if (report.sources.length === 0) return <EmptyState text={t("aimetrics.no_sources2")} />;
  return (
    <div class="status-page hosts">
      {stale && <p class="stat-note" role="status">{t("aimetrics.no_fresh")}</p>}
      {report.sources.map((source) => (
        <Card key={source.id} aria-label={`Metrik-Quelle ${source.label}`} class="hosts-hero">
          <MetricSource source={source} stepMs={report.intervalSec * 1000} />
        </Card>
      ))}
    </div>
  );
}
