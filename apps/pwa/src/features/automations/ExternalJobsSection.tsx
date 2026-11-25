import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { ExternalJobInfo, ExternalJobsResponse } from "@ancientvoid/contracts";
import { useApi } from "../../shared/api-context.ts";
import { readAutomationSnapshot, writeAutomationSnapshot } from "./automation-cache.ts";

/** EPIC-P73 (ADR-0094): Anzeige der Auto-Jobs außerhalb des Hub-Schedulers —
 * GitHub-Actions-Workflows und die Issue-Session-Bridge. Nur Ansehen und
 * Verlinken; verplant wird nichts hier (kein AutomationDefinition-Maschinerie). */

const STATUS_LABEL: Record<ExternalJobInfo["status"], string> = {
  queued: "wartet",
  running: "läuft",
  succeeded: "erfolgt",
  failed: "fehlgeschlagen",
  timeout: "Zeitüberschreitung",
  cancelled: "abgebrochen",
  skipped: "übersprungen",
  unknown: "unklar",
};

const SOURCE_LABEL: Record<ExternalJobInfo["source"], string> = {
  "github-actions": "GitHub Actions",
  "issue-bridge": "Issue-Bridge",
};

export function ExternalJobsSection({ offline, cacheKey }: { offline: boolean; cacheKey: string }) {
  const api = useApi();
  const [data, setData] = useState<ExternalJobsResponse | null>(null);
  const [readError, setReadError] = useState("");

  useEffect(() => {
    let alive = true;
    let pending = false;
    const tick = async () => {
      if (pending || !alive) return;
      pending = true;
      try {
        const fresh = await api.externalJobs();
        if (!alive) return;
        setData(fresh);
        setReadError("");
        // Offline-Kopie am bestehenden Automations-Snapshot (K10, Version v2).
        const cached = cacheKey ? readAutomationSnapshot(cacheKey) : null;
        if (cacheKey) writeAutomationSnapshot(cacheKey, { at: cached?.at ?? fresh.atUtc, list: cached?.list ?? [], histories: cached?.histories ?? [], external: fresh });
      } catch (err) {
        if (alive) setReadError(err instanceof Error ? err.message : "Abruf fehlgeschlagen");
      } finally {
        pending = false;
      }
    };
    // Offline: gespeicherten Stand zeigen, nicht gegen einen toten Host pollsen.
    if (offline && cacheKey) {
      const cached = readAutomationSnapshot(cacheKey);
      if (cached?.external) setData(cached.external);
      return () => { alive = false; };
    }
    void tick();
    const timer = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [api, offline, cacheKey]);

  const jobs = data?.jobs ?? [];
  return <section class="automation-external" data-testid="external-jobs-section">
    <div class="swarms-list-head"><h4>{t("automations.external_automations")}</h4>{data && <span class="swarm-row-meta">{t("automations.as_of")} <time dateTime={data.atUtc}>{new Date(data.atUtc).toLocaleString("de-DE")}</time></span>}</div>
    {offline && <p role="status">{t("automations.offline_saved")}</p>}
    {data?.staleError && <div class="files-error" role="alert" data-testid="external-jobs-stale">{data.staleError}</div>}
    {readError && !data && <div class="files-error" role="alert">{readError}</div>}
    {jobs.length === 0
      ? <div class="ui-empty" data-testid="external-jobs-empty">{data ? "Keine externen Automatismen konfiguriert — GitHub-Token (issues-Sektion) bzw. Issue-Bridge fehlt." : "lade…"}</div>
      : <ul class="automation-external-list">{jobs.map((job, i) => <li key={`${job.source}:${job.name}:${i}`}>
        <span class="swarm-pill" data-testid="external-job-status">{STATUS_LABEL[job.status]}</span>
        <span class="swarm-row-title">{job.name}</span>
        <span class="swarm-row-meta">{SOURCE_LABEL[job.source]}{job.detail ? ` · ${job.detail}` : ""}</span>
        {job.url && <a class="swarm-row-meta" href={job.url} target="_blank" rel="noreferrer">{t("automations.open")}</a>}
      </li>)}</ul>}
  </section>;
}
