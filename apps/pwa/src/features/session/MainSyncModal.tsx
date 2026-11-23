import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { MainSyncApplyDto, MainSyncCheckDto } from "../../shared/api.ts";
import { Button, Modal } from "../../shared/ui/index.ts";

/**
 * ADR-0102: „N hinter main“ als Knopf — ein Klick pullt den neuesten main und
 * mischt ihn in den Session-Branch; anfallende Konflikte löst die Strategie
 * `favor-session` automatisch gunsten der Session (`autoResolved` nennt die
 * Dateien). Der Ablauf steht als Schritte im Modal, Fehler bleiben sichtbar
 * (fail loud), kein stiller Teilerfolg.
 */

/** Der API-Ausschnitt, den das Modal braucht — erfüllt von hostApi/ApiContext. */
export interface MainSyncApi {
  mainSyncCheck: (sessionId: string) => Promise<MainSyncCheckDto>;
  mainSyncApply: (sessionId: string, opts?: { conflictStrategy?: "abort" | "favor-session" }) => Promise<MainSyncApplyDto>;
}

type Phase = "checking" | "merging" | "done";

export function MainSyncModal({ open, onClose, api, sessionId, initial, onDone }: {
  open: boolean;
  onClose: () => void;
  api: MainSyncApi;
  sessionId: string;
  /** Stand, den die Ansicht schon geladen hat (erspart den ersten Blick aufs Netz). */
  initial: MainSyncCheckDto | null;
  /** Nach jedem Abschluss fragt die Ansicht den Stand neu ab (Badge aktualisieren). */
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [check, setCheck] = useState<MainSyncCheckDto | null>(initial);
  const [result, setResult] = useState<MainSyncApplyDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPhase("checking");
    setResult(null);
    setError(null);
    const step = async () => {
      try {
        const current = await api.mainSyncCheck(sessionId);
        if (!alive) return;
        setCheck(current);
        if (current.behind === 0) {
          setPhase("done");
          onDone();
          return;
        }
        setPhase("merging");
        const applied = await api.mainSyncApply(sessionId, { conflictStrategy: "favor-session" });
        if (!alive) return;
        setResult(applied);
        setPhase("done");
        onDone();
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : t("session.merge_failed"));
        setPhase("done");
      }
    };
    void step();
    return () => {
      alive = false;
    };
    // Der Ablauf gehört zum Öffnen des Modals und zum erneuten Versuch —
    // initial/onDone sind Anzeige-Refresh, keine Auslöser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, run]);

  const failed = error !== null || (result !== null && (result.outcome === "conflict" || result.outcome === "failed"));
  return (
    <Modal open={open} onClose={onClose} label={t("session.main_sync_modal_title")} title={t("session.main_sync_modal_title")} testid="mainsync-modal">
      <ol class={`mainsync-steps${failed ? " failed" : ""}`} data-testid="mainsync-steps">
        <Step state={phase === "checking" ? "active" : "ok"} label={t("session.main_sync_step_check")}>
          {check && (check.behind > 0
            ? <span class="dim"> {check.behind} {t("session.behind_main")}</span>
            : <span class="dim"> {t("session.up_to_date", { "branch": check.branch })}</span>)}
        </Step>
        <Step
          state={phase === "merging" ? "active" : phase === "done" && check && check.behind > 0 ? (failed ? "error" : "ok") : "todo"}
          label={t("session.main_sync_step_merge")}
        >
          {check && check.conflicts !== null && check.conflicts.length > 0 && phase !== "done" && (
            <span class="dim"> · {t("session.main_sync_conflicts_hint", { "files": check.conflicts.join(", ") })}</span>
          )}
        </Step>
        <Step state={phase === "done" ? (failed ? "error" : "ok") : "todo"} label={t("session.main_sync_step_done")} />
      </ol>

      {result && <MainSyncResult result={result} />}
      {error && (
        <p class="mainsync-modal-error" role="alert" data-testid="mainsync-modal-error">
          {t("session.merge_failed")} <span class="dim">{error}</span>
        </p>
      )}

      <div class="ui-modal-actions">
        {failed && <Button onClick={() => setRun((n) => n + 1)}>{t("common.retry")}</Button>}
        <Button variant="primary" onClick={onClose}>{t("common.close")}</Button>
      </div>
    </Modal>
  );
}

function Step({ state, label, children }: { state: "todo" | "active" | "ok" | "error"; label: string; children?: ComponentChildren }) {
  return (
    <li class={`mainsync-step ${state}`} data-state={state}>
      <span class="mainsync-step-marker" aria-hidden="true">
        {state === "ok" ? "✓" : state === "error" ? "✕" : state === "active" ? "…" : "○"}
      </span>
      <span class="mainsync-step-label">
        {label}
        {children}
      </span>
    </li>
  );
}

function MainSyncResult({ result }: { result: MainSyncApplyDto }) {
  if (result.outcome === "applied") {
    return (
      <p class="mainsync-modal-result" role="status" data-testid="mainsync-modal-result">
        {t("session.merged_into_main", { "to": result.to ?? "?" })}
        {result.autoResolved && result.autoResolved.length > 0 && (
          <>
            <br />
            {t("session.main_sync_autoresolved", { "files": result.autoResolved.join(", ") })}
          </>
        )}
      </p>
    );
  }
  if (result.outcome === "conflict") {
    return (
      <p class="mainsync-modal-error" role="alert" data-testid="mainsync-modal-result">
        {t("session.conflict_nothing", { "files": (result.files ?? []).join(", ") })}
      </p>
    );
  }
  if (result.outcome === "failed") {
    return (
      <p class="mainsync-modal-error" role="alert" data-testid="mainsync-modal-result">
        {t("session.failed_reason", { "reason": result.reason ?? "?" })} <span class="dim">{result.detail ?? ""}</span>
      </p>
    );
  }
  return (
    <p class="mainsync-modal-result" role="status" data-testid="mainsync-modal-result">
      {t("session.skipped_detail", { "reason": result.reason ?? "?", "detail": result.detail ? `: ${result.detail}` : "" })}
    </p>
  );
}
