import { fmtNumber } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";
import { remoteHost, type SessionRecord, type AdapterUsage, type SessionDiffResult } from "../../shared/api.ts";
import { formatUsd, formatWindow } from "../overview/Dashboard.tsx";
import { BudgetTopUp } from "./BudgetTopUp.tsx";
import { metricView } from "../../shared/metrics.ts";
import { onHost, WorktreeCard, ContinueCard, AttachCmdRow } from "./HostCommands.tsx";

export function ReportPane({
  record,
  createdAt,
  status,
  numbersReal,
  diff,
  usage,
  context,
  applyInHead = false,
}: {
  record: SessionRecord;
  createdAt: string;
  status: string;
  numbersReal: boolean;
  diff: SessionDiffResult | null;
  usage: AdapterUsage | null;
  /** ADR-0032: { fill, window } in tokens — null when nothing was reported. */
  context: { fill: number | null; window: number | null } | null;
  /** EPIC-P43 T43.5: in „Änderungen“ trägt der Kopf die Hauptaktion. */
  applyInHead?: boolean;
}) {
  const running = status !== "stopped" && status !== "error" && status !== "interrupted";
  const durationMs = new Date(record.updatedAt).getTime() - new Date(createdAt).getTime();
  const suffix = running ? " (bisher)" : "";
  const cost = metricView(record, "cost", formatUsd, numbersReal);
  const tokens = metricView(record, "tokens", (n) => fmtNumber(n), numbersReal);
  // AC-P2-1: `diff.files` trägt seit den Commit-Abschnitten nur den
  // uncommitteten Rest — „Dateien geändert" zählt die Union mit den
  // Commit-Dateien (dedupliziert pro Pfad).
  const changedFiles = diff
    ? new Set([...(diff.commits ?? []).flatMap((c) => c.files.map((f) => f.path)), ...diff.files.map((f) => f.path)]).size
    : 0;
  const filesChanged = diff ? (diff.error ? diff.error : `${changedFiles}${suffix}`) : t("common.loading");

  return (
    <div>
      <span class={`status-chip ${running ? "pending" : "done"}`}>{status === "interrupted" ? t("session.interrupted_abort") : running ? t("session.status_running_bullet") : t("session.status_done_check")}</span>
      {status === "parked" && record.parkReason === "budget" && <BudgetTopUp sessionId={record.id} currentBudgetUsd={record.budgetUsd} />}
      <div class="kv-list">
        <div class="kv-row">
          <span class="k">{t("common.duration")}</span>
          <span class="v num">
            {formatDuration(durationMs)}
            {suffix}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">{t("status.costs")}</span>
          <span class={`v num metric-${cost.quality}`} title={cost.hint}>
            {cost.text}
            {cost.quality !== "unknown" ? suffix : ""}
          </span>
        </div>
        <div class="kv-row">
          <span class="k" title={t("session.adr0084_sum")}>{t("session.tokens_processed")}</span>
          <span class={`v num metric-${tokens.quality}`} title={tokens.hint}>
            {tokens.text}
            {tokens.quality !== "unknown" ? suffix : ""}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">{t("session.context_window")}</span>
          <span class="v num">
            {!context || context.fill === null
              ? t("session.no_report")
              : context.window === null
                ? t("session.tokens_unknown_window", { fill: fmtNumber(context.fill) })
                : t("session.context_pct", { pct: Math.round((context.fill / context.window) * 100), fill: fmtNumber(context.fill), window: fmtNumber(context.window) })}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">{t("session.quota_adapter_wide")}</span>
          <span class="v num">
            {!usage || !usage.supported
              ? t("status.unknown")
              : usage.quota === null
                ? t("session.no_report_yet")
                : usage.quota.windows.map(formatWindow).join(" · ")}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">{t("session.files_changed")}</span>
          <span class="v num">{filesChanged}</span>
        </div>
        <div class="kv-row">
          <span class="k">{t("common.tests")}</span>
          <span class="v dim">{t("session.no_test_signal")}</span>
        </div>
      </div>
      {record.attachCmd && <AttachCmdRow cmd={onHost(record.attachCmd, remoteHost(record.hostId))} />}
      {record.worktree && (
        <WorktreeCard sessionId={record.id} status={status} worktree={record.worktree} project={record.project} host={remoteHost(record.hostId)} apply={!applyInHead} />
      )}
      <ContinueCard
        sessionId={record.id}
        hostId={remoteHost(record.hostId)}
        openCmd={record.openCmd ? onHost(record.openCmd, remoteHost(record.hostId)) : undefined}
        host={remoteHost(record.hostId)}
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}
