import { t } from "../../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { HubApi } from "../../../shared/api.ts";
import { useApi } from "../../../shared/api-context.ts";
import { ago } from "../../../shared/status.ts";
import type { WorkspaceStatus } from "@ancientvoid/contracts";
import { Button, Chip, EmptyState } from "../../../shared/ui/index.ts";

/**
 * EPIC-P29 T29.6: Umgebung einer Session — Workspace-Phase, Services mit
 * Logs/Preview, menschlicher Retry nach `failed`/`needs_attention`
 * (ADR-0051 §3), Offline-Zeitstempel (K10). Preview läuft über den
 * authentifizierten Proxy mit kurzlebigem Ticket (ADR-0051 §6).
 */

const PHASE_LABEL: Record<string, string> = {
  preparing: "bereitet vor",
  ready: "bereit",
  failed: "fehlgeschlagen",
  needs_attention: "klärungsbedürftig",
  approval_required: "Freigabe nötig",
};

const SERVICE_LABEL: Record<string, string> = {
  starting: "startet",
  ready: "bereit",
  failed: "fehlgeschlagen",
  stopped: "beendet",
  probing: "wird geprüft",
};

const FAILURE_KIND_LABEL: Record<string, string> = {
  exit: "Exitcode",
  timeout: "Frist überschritten",
  port: t("workspace.port"),
  ownership: "Eigentum",
  include: "Dateiübernahme",
  unknown: "unbekannt",
};

export function WorkspaceRuntimePane({ sessionId, refreshSeq }: { sessionId: string; refreshSeq: number }) {
  const api: HubApi = useApi();
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [noWorkspace, setNoWorkspace] = useState(false);
  const [offline, setOffline] = useState(false);
  const [standAt, setStandAt] = useState<Date | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ serviceId: string; tail: string } | null>(null);
  const [preview, setPreview] = useState<{ serviceId: string; src: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reload = () => {
    void api
      .workspaceStatus(sessionId)
      .then((loaded) => {
        setStatus(loaded);
        setNoWorkspace(false);
        setOffline(false);
        setStandAt(new Date());
      })
      .catch((err: unknown) => {
        if ((err as { status?: unknown })?.status === 404) {
          setNoWorkspace(true);
          setOffline(false);
          setStandAt(new Date());
          return;
        }
        setOffline(true); // K10: alter Stand bleibt sichtbar, markiert
      });
  };

  useEffect(() => {
    let alive = true;
    api
      .workspaceStatus(sessionId)
      .then((loaded) => {
        if (!alive) return;
        setStatus(loaded);
        setNoWorkspace(false);
        setOffline(false);
        setStandAt(new Date());
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if ((err as { status?: unknown })?.status === 404) {
          setNoWorkspace(true);
          setStandAt(new Date());
          return;
        }
        setOffline(true); // ohne bekannten Stand: ehrlicher Offline-Hinweis
        setStandAt(new Date());
      });
    return () => {
      alive = false;
    };
    // refreshSeq = Seq des letzten workspace.*-Events: die Ansicht hängt an
    // dem Ereignisstrom, kein eigener Poll-Timer neben dem 3-s-Session-Poll.
  }, [sessionId, refreshSeq, api]);

  useEffect(() => {
    if (logsFor === null) {
      setLogs(null);
      return;
    }
    let alive = true;
    api
      .workspaceServiceLogs(sessionId, logsFor)
      .then((loaded) => alive && setLogs({ serviceId: loaded.serviceId, tail: loaded.tail }))
      .catch(() => alive && setLogs({ serviceId: logsFor, tail: "(Log nicht erreichbar)" }));
    return () => {
      alive = false;
    };
  }, [sessionId, logsFor, api, refreshSeq]);

  const retry = async () => {
    setBusy("retry");
    setNote(null);
    try {
      const ack = await api.workspaceRetry(sessionId);
      setNote(ack.ok ? "Retry gelaufen — Ursache im Ereignisstrom, neue Phase oben." : `Retry abgelehnt: ${ack.detail ?? "?"}`);
    } catch (err) {
      setNote(`Retry fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const openPreview = async (serviceId: string) => {
    setBusy(`preview:${serviceId}`);
    setNote(null);
    try {
      const ticket = await api.workspacePreviewTicket(sessionId, serviceId);
      // Ticket in die URL statt Bearer (iframe kann keine Header setzen) —
      // kurzlebig, gebunden an genau diesen Service (ADR-0051 §6).
      setPreview({
        serviceId,
        src: `${api.workspaceProxyBase(sessionId, serviceId)}/?ticket=${encodeURIComponent(ticket.ticket)}`,
        expiresAt: ticket.expiresAt,
      });
    } catch (err) {
      setNote(`Preview nicht möglich: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  if (noWorkspace) {
    return (
      <EmptyState text={t("workspace.no_workspace")} />
    );
  }
  if (!status) {
    return (
      <EmptyState class="dim" text={offline ? "Umgebung nicht abrufbar — offline" : "lädt…"} />
    );
  }

  const canRetry = status.phase === "failed" || status.phase === "needs_attention";
  return (
    <div class="workspace-runtime">
      <div class="workspace-head">
        <span class={`pill ws-phase-${status.phase}`}>{PHASE_LABEL[status.phase] ?? status.phase}</span>
        <span class="dim">
          {t("workspace.base")} {status.baseSha.slice(0, 8)} {t("workspace.manifest_frag")} {status.manifestHash.slice(0, 8)}
        </span>
        {/* K10: Standuruhr — offline bleibt der letzte Stand lesbar markiert */}
        <span class={`stand${offline ? " offline" : ""}`}>
          {offline ? `Stand von ${standAt ? standAt.toLocaleTimeString("de-DE") : "unbekannt"} — offline` : `Stand: ${status.updatedAt ? ago(status.updatedAt) : "…"}`}
        </span>
      </div>

      {status.failure && (
        <div class="ws-failure" role="alert">
          <strong>
            {FAILURE_KIND_LABEL[status.failure.kind] ?? status.failure.kind} {t("workspace.in_quote")}{status.failure.step}"
            {typeof status.failure.exitCode === "number" ? ` (Exit ${status.failure.exitCode})` : ""}
          </strong>
          {status.failure.detail && <div class="dim">{status.failure.detail}</div>}
          {status.failure.logBlobRef && <div class="dim">{t("workspace.full_output_blob")} {status.failure.logBlobRef}</div>}
        </div>
      )}

      <ul class="ws-services">
        {status.services.map((service) => (
          <li key={service.id} class={`ws-service ws-state-${service.state}`}>
            <div class="ws-service-row">
              <span class="ws-service-id">{service.id}</span>
              <span class="pill">{SERVICE_LABEL[service.state] ?? service.state}</span>
              {service.port !== null && <span class="dim">{t("workspace.port")} {service.port}</span>}
              <span class="ws-actions">
                <Chip onClick={() => setLogsFor(logsFor === service.id ? null : service.id)} aria-expanded={logsFor === service.id}>
                  {t("workspace.logs")}
                </Chip>
                {service.state === "ready" && (
                  <Chip disabled={busy === `preview:${service.id}`} onClick={() => void openPreview(service.id)}>
                    {preview?.serviceId === service.id ? "Preview aktualisieren" : "Preview öffnen"}
                  </Chip>
                )}
              </span>
            </div>
            {service.failure && (
              <div class="ws-failure small">
                {FAILURE_KIND_LABEL[service.failure.kind] ?? service.failure.kind}: {service.failure.detail ?? ""}
                {service.failure.logBlobRef ? ` · Blob ${service.failure.logBlobRef}` : ""}
              </div>
            )}
            {logsFor === service.id && (
              <pre class="ws-logs">{logs && logs.serviceId === service.id ? logs.tail || "(noch keine Ausgabe)" : "lädt…"}</pre>
            )}
            {preview?.serviceId === service.id && (
              <div class="ws-preview">
                {/* Sandboxed: das Projekt-App-Preview bekommt keinen Zugriff auf
                    Hub-Origin-Ressourcen (kein localStorage, kein Token). */}
                <iframe src={preview.src} title={`Preview ${service.id}`} sandbox="allow-scripts allow-forms" loading="lazy" />
                <div class="dim">{t("workspace.ticket_valid")} {new Date(preview.expiresAt).toLocaleTimeString("de-DE")} {t("workspace.then_reopen")}</div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div class="ws-footer">
        <Chip onClick={reload}>
          {t("workspace.refresh")}
        </Chip>
        {canRetry && (
          <Button disabled={busy === "retry"} onClick={() => void retry()}>
            {busy === "retry" ? "Retry läuft…" : "Setup wiederholen (menschlicher Retry)"}
          </Button>
        )}
        {note && <span class="dim">{note}</span>}
      </div>
    </div>
  );
}
