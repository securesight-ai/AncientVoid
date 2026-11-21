import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { DiagnosticsResult, FileMeta, ProjectTrust } from "@ancientvoid/contracts";
import type { HubApi } from "../../shared/api.ts";
import { basket } from "./feedback-basket.ts";
import { Button, Chip } from "../../shared/ui/index.ts";

const STATE_LABEL: Record<DiagnosticsResult["state"], string> = {
  ok: "Keine Fehler gefunden",
  errors: "Fehler gefunden",
  not_configured: "Kein Prüfer eingerichtet — keine Aussage über Fehlerfreiheit",
  untrusted: "Projekt nicht freigegeben — es wurde nichts ausgeführt",
  failed: "Prüfer fehlgeschlagen",
  timeout: "Prüfer hat das Zeitlimit überschritten",
  too_large: "Datei zu groß für den Prüfer",
};

/**
 * EPIC-P46 T46.7 (ADR-0058 §9): Diagnosen nur auf ausdrücklichen Klick. Zustände sind ehrlich benannt; ein
 * Ergebnis gilt nur für die Revision, für die es erzeugt wurde.
 */
export function DiagnosticsPanel({ api, target, meta, result, onResult, onJump, onFeedbackAdded }: { api: HubApi; target: string; meta: FileMeta; result: DiagnosticsResult | null; onResult: (r: DiagnosticsResult | null) => void; onJump: (line: number, column: number) => void; onFeedbackAdded?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trust, setTrust] = useState<ProjectTrust | null>(null);
  useEffect(() => {
    api.diagnosticsTrust(target).then(setTrust).catch(() => setTrust(null));
  }, [target]);

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      onResult(await api.diagnosticsRun(target, meta.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prüfung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };
  const setTrusted = async (trusted: boolean) => {
    try {
      setTrust(await api.diagnosticsSetTrust(target, trusted));
      onResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Freigabe fehlgeschlagen");
    }
  };

  const stale = result !== null && result.revision !== meta.revision;
  return (
    <div class="diag-panel" data-testid="diag-panel">
      <div class="diag-head">
        <Button onClick={run} disabled={busy} data-testid="diag-run">{busy ? "prüft …" : "Prüfen"}</Button>
        {trust && (
          <label class="dim" title={t("files.tsc_project")}>
            <input type="checkbox" checked={trust.trusted} onChange={(e) => void setTrusted((e.target as HTMLInputElement).checked)} data-testid="diag-trust" /> {t("files.approve_project")}
          </label>
        )}
      </div>
      {error && <div class="files-error" role="alert">{error}</div>}
      {result && (
        <div data-testid="diag-result" data-state={result.state}>
          <div role="status">
            <strong>{STATE_LABEL[result.state]}</strong>
            {result.provider && <span class="dim"> · {result.provider}{result.scope === "syntax" ? " (nur Syntax)" : result.scope === "types" ? " (Typen)" : ""}</span>}
          </div>
          {result.detail && <div class="dim">{result.detail}</div>}
          {stale && <div class="files-stale" role="alert">{t("files.file_changed_check")}</div>}
          {result.otherFiles > 0 && <div class="dim">{result.otherFiles} {t("files.more_messages")}</div>}
          {result.truncated && <div class="dim">{t("files.list_truncated")}</div>}
          <ul class="diag-list">
            {result.diagnostics.map((d, k) => (
              <li key={k} class={`diag-${d.severity}`}>
                <button type="button" class="diag-jump" disabled={stale} onClick={() => onJump(d.line, d.column)}>
                  {d.line}:{d.column}
                </button>
                <span> {d.severity === "error" ? "Fehler" : d.severity === "warning" ? "Warnung" : "Hinweis"}{d.code ? ` ${d.code}` : ""}: {d.message.split("\n")[0]}</span>
                <Chip
                  disabled={stale}
                  onClick={() => {
                    basket.add({ path: meta.path, revision: meta.revision, startLine: d.line, endLine: d.endLine ?? d.line, note: "", diagnostic: { code: d.code, message: d.message, source: d.source } });
                    onFeedbackAdded?.();
                  }}
                >
                  {t("files.to_feedback")}
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
