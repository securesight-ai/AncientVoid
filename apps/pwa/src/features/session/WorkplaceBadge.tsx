import { t } from "../../shared/i18n/index.ts";
import type { SessionRecord } from "../../shared/api.ts";

/** EPIC-P38 (ADR-0057): Arbeitsort der Session — beim Namen genannt, nie als Sicherheitsgrenze beworben. */
export function WorkplaceBadge({ session }: { session: Pick<SessionRecord, "workspaceMode" | "worktreeSha"> }) {
  const mode = session.workspaceMode ?? (session.worktreeSha ? "worktree" : "unknown");
  if (mode === "worktree") return <span class="workplace-badge" data-mode="worktree" title={t("session.own_git_worktree")}>{t("common.worktree")}</span>;
  if (mode === "direct") return <span class="workplace-badge warn" data-mode="direct" title={t("session.works_in_project_folder")}>{t("newsession.project_direct")}</span>;
  return <span class="workplace-badge warn" data-mode="unknown" title={t("session.workplace_unproven")}>{t("session.workplace_unsettled")}</span>;
}
