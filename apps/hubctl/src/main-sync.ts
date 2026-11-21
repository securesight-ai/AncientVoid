import type { MainSyncApplyResult, MainSyncCheckResult } from "@ancientvoid/contracts";
import { api } from "./api.ts";
import { t } from "./i18n/index.ts";

/**
 * EPIC-P67 T67.9: `hubctl main-sync` — Messung/Probelauf und Einmischen für
 * Skripte (Menschen-Token; die Policy lässt Agenten bewusst nicht schreiben).
 * `--project` wendet auf alle Worktree-Sessions eines Projekts an — der
 * Scheduler macht denselben Rundumschlag mit einem Fetch je Projekt.
 */

interface SessionRow {
  id: string;
  project: string;
  status: string;
}

/** Rein, für Tests: die Messung als Zeilen. */
export function formatMainSyncCheck(check: MainSyncCheckResult, sessionId: string): string[] {
  const lines = [
    `${sessionId} · origin/${check.branch}: ${check.behind === 0 ? t("ms_aktuell") : t("ms_hinten_vorn", { behind: check.behind, ahead: check.ahead })}${check.clean ? "" : t("ms_dirty")}`,
  ];
  if (check.conflicts && check.conflicts.length > 0) lines.push(t("ms_konflikt_probelauf", { files: check.conflicts.join(", ") }));
  else lines.push(t("ms_probelauf_sauber"));
  lines.push(t("ms_zuletzt", { x: check.lastSyncedAt ? new Date(check.lastSyncedAt).toLocaleString() : t("ms_nie") }));
  return lines;
}

/** Rein, für Tests: das Apply-Ergebnis als Zeilen. */
export function formatMainSyncApply(result: MainSyncApplyResult): string {
  switch (result.outcome) {
    case "applied":
      return t("ms_applied", { mixed: t("ms_mixed"), from: result.from, to: result.to, n: result.files.length, files: result.files.length === 1 ? t("ms_files_one") : t("ms_files_many") });
    case "conflict":
      return t("ms_conflict", { files: result.files.join(", ") });
    case "skipped":
      return t("ms_skipped", { reason: result.reason, detail: result.detail ? `: ${result.detail}` : "" });
    case "failed":
      return t("ms_failed", { reason: result.reason, detail: result.detail ? `: ${result.detail}` : "" });
  }
}

function usage(): never {
  console.log(t("usage_main_sync"));
  process.exit(1);
}

export async function runMainSync(args: string[]): Promise<void> {
  const apply = args.includes("--apply");
  const check = args.includes("--check");
  if (apply && check) usage();

  if (args[0] === "--settings") {
    const settings = await api<{ global: { value: Record<string, unknown>; fallback: string }; projects: { value: Record<string, Record<string, unknown>>; fallback: string } }>("/api/settings/main-sync");
    console.log(t("ms_global_line", { x: settings.global.fallback === "none" ? t("ms_saved") : t("ms_defaults_entry", { x: settings.global.fallback }) }));
    for (const [key, value] of Object.entries(settings.global.value)) console.log(`  ${key}: ${JSON.stringify(value)}`);
    const paths = Object.keys(settings.projects.value);
    if (paths.length === 0) console.log(t("ms_proj_overrides_none"));
    for (const path of paths) console.log(`${t("ms_proj_word")} ${path}: ${JSON.stringify(settings.projects.value[path])}`);
    return;
  }

  let sessionIds: { id: string; label: string }[];
  if (args[0] === "--project") {
    const project = args[1];
    if (!project) usage();
    const sessions = await api<SessionRow[]>("/api/sessions");
    sessionIds = sessions.filter((s) => s.project === project).map((s) => ({ id: s.id, label: s.id }));
    if (sessionIds.length === 0) {
      console.log(t("ms_no_sessions_for", { project }));
      return;
    }
  } else {
    const id = args.find((a) => !a.startsWith("--"));
    if (!id) usage();
    sessionIds = [{ id, label: id }];
  }

  let anyFailure = false;
  for (const { id } of sessionIds) {
    if (apply) {
      const result = await api<MainSyncApplyResult>(`/api/sessions/${id}/main-sync`, { method: "POST", body: "{}" });
      console.log(`${id}: ${formatMainSyncApply(result)}`);
      if (result.outcome === "failed") anyFailure = true;
    } else {
      try {
        const checkResult = await api<MainSyncCheckResult>(`/api/sessions/${id}/main-sync`);
        for (const line of formatMainSyncCheck(checkResult, id)) console.log(line);
      } catch (err) {
        anyFailure = true;
        console.log(t("ms_messung_gescheitert", { id, err: err instanceof Error ? err.message : String(err) }));
      }
    }
  }
  if (anyFailure) process.exitCode = 1;
}
