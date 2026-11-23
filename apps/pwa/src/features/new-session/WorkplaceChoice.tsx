import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { WorkspacePreview } from "../../shared/api.ts";

export type WorkplaceMode = "worktree" | "direct";

interface Api {
  workspacePreview: (project: string) => Promise<WorkspacePreview>;
}

/**
 * EPIC-P38 T38.4 (ADR-0057): Arbeitsort beim Start — zwei beschriftete Karten,
 * Standard „Eigener Worktree“. Die Harness-Sandbox/der Modus ist davon
 * getrennt (eigenes Feld darunter) und wird hier ausdrücklich nicht versprochen.
 */
export function WorkplaceChoice({
  api,
  project,
  mode,
  onMode,
  confirmDirty,
  onConfirmDirty,
  confirmShared,
  onConfirmShared,
  onBlockedChange,
}: {
  api: Api;
  project: string;
  mode: WorkplaceMode;
  onMode: (mode: WorkplaceMode) => void;
  confirmDirty: boolean;
  onConfirmDirty: (value: boolean) => void;
  /** ADR-0081: ausdrücklich bestätigtes parallels Schreiben in einem Nicht-Git-Ordner. */
  confirmShared: boolean;
  onConfirmShared: (value: boolean) => void;
  /** Start ist blockiert (Checkout belegt, Dirty unbestätigt, Vorschau fehlt) — Grund steht in der Karte. */
  onBlockedChange: (blocked: boolean) => void;
}) {
  const [preview, setPreview] = useState<WorkspacePreview | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    setPreview(null);
    setFailure("");
    if (!project) return;
    let alive = true;
    api
      .workspacePreview(project)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        // Kein Git: der ehrliche Weg ist „Projekt direkt“ — vorbelegen statt scheitern lassen.
        if (!p.worktreePossible) onMode("direct");
      })
      .catch((err) => alive && setFailure(err instanceof Error ? err.message : t("newsession.preview_unavailable")));
    return () => {
      alive = false;
    };
  }, [project, api]);

  const direct = mode === "direct";
  const dirty = preview?.dirty ?? [];
  // ADR-0081: „belegt“ heißt nicht mehr nur Allein-Schreiber — in Ordnern ohne Git
  // sind Mit-Nutzer erlaubt, aber nur nach Bestätigung. Git bleibt gesperrt.
  const isGitCheckout = preview ? preview.isGit : true;
  const holders = direct ? preview?.holders ?? (preview?.heldBy ? [preview.heldBy] : []) : [];
  const held = direct && preview?.heldBy ? preview.heldBy : null;
  const sharedAllowed = holders.length > 0 && !isGitCheckout && confirmShared;
  const dirtyBlock = direct && dirty.length > 0 && !confirmDirty;
  const blocked = direct && ((holders.length > 0 && !sharedAllowed) || dirtyBlock);
  useEffect(() => onBlockedChange(blocked), [blocked]);

  return (
    <fieldset class="workplace-choice" data-preview={preview ? "done" : failure ? "failed" : "pending"}>
      <legend>{t("newsession.workplace")}</legend>
      <div class="workplace-cards" role="radiogroup" aria-label={t("newsession.workplace")}>
        <label class={mode === "worktree" ? "workplace-card active" : "workplace-card"}>
          <input
            type="radio"
            name="workplace"
            value="worktree"
            aria-label={t("newsession.workplace_worktree")}
            checked={mode === "worktree"}
            disabled={preview !== null && !preview.worktreePossible}
            onChange={() => onMode("worktree")}
          />
          <strong>{t("newsession.own_worktree")}</strong>
          <span class="dim">{t("session.changes_in_git_copy")}</span>
          {preview !== null && !preview.worktreePossible && <span class="dim">{t("newsession.not_possible_no_git")}</span>}
        </label>
        <label class={mode === "direct" ? "workplace-card active" : "workplace-card"}>
          <input type="radio" name="workplace" value="direct" aria-label={t("newsession.workplace_direct")} checked={mode === "direct"} onChange={() => onMode("direct")} />
          <strong>{t("newsession.project_direct")}</strong>
          <span class="dim">{t("newsession.agent_works_in_project")}</span>
        </label>
      </div>
      <p class="dim workplace-note">
        {t("newsession.worktree_separates_files_only")}
      </p>
      {failure && <div class="workplace-warn" role="status">{failure}</div>}
      {direct && preview && (
        <div class="workplace-detail" data-testid="workplace-detail">
          <div class="mono">{preview.checkoutId}</div>
          {preview.branch && <div class="dim">{t("common.branch")} {preview.branch}</div>}
          <div class="dim">{t("session.other_program_changes")}</div>
          {held && isGitCheckout && <div class="workplace-warn" role="alert">{t("newsession.other_session_writes")}{held.slice(0, 8)}{t("newsession.stop_or_choose")}</div>}
          {holders.length > 0 && !isGitCheckout && (
            <div class="workplace-warn" role="alert">
              <div>
                {t("newsession.in_this_folder")} {holders.length === 1
                  ? t("session.writers_singular", { "list": holders.map((h) => h.slice(0, 8)).join(", ") })
                  : t("session.writers_plural", { "n": holders.length, "list": holders.map((h) => h.slice(0, 8)).join(", ") })}
                {t("newsession.no_git_no_separation")}
              </div>
              <label class="workplace-confirm">
                <input type="checkbox" checked={confirmShared} onChange={(e) => onConfirmShared((e.target as HTMLInputElement).checked)} />
                {t("newsession.multiple_sessions_accept")}
              </label>
            </div>
          )}
          {dirty.length > 0 && (
            <div class="workplace-warn" role="alert">
              <div>{t("newsession.unsaved_changes_in_project")}{dirty.length}{preview.dirtyTruncated ? "+" : ""}):</div>
              <ul class="mono">
                {dirty.slice(0, 8).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <label class="workplace-confirm">
                <input type="checkbox" checked={confirmDirty} onChange={(e) => onConfirmDirty((e.target as HTMLInputElement).checked)} />
                {t("newsession.start_anyway_untouched")}
              </label>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
