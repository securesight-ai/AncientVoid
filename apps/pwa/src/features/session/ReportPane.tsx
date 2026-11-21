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
  const tokens = metricView(record, "tokens", (n) => n.toLocaleString("de-DE"), numbersReal);
  // AC-P2-1: `diff.files` trägt seit den Commit-Abschnitten nur den
  // uncommitteten Rest — „Dateien geändert" zählt die Union mit den
  // Commit-Dateien (dedupliziert pro Pfad).
  const changedFiles = diff
    ? new Set([...(diff.commits ?? []).flatMap((c) => c.files.map((f) => f.path)), ...diff.files.map((f) => f.path)]).size
    : 0;
  const filesChanged = diff ? (diff.error ? diff.error : `${changedFiles}${suffix}`) : "lädt …";

  return (
    <div>
      <span class={`status-chip ${running ? "pending" : "done"}`}>{status === "interrupted" ? "Unterbrochen — Zug abgebrochen" : running ? "● läuft" : "✓ abgeschlossen"}</span>
      {status === "parked" && record.parkReason === "budget" && <BudgetTopUp sessionId={record.id} currentBudgetUsd={record.budgetUsd} />}
      <div class="kv-list">
        <div class="kv-row">
          <span class="k">Dauer</span>
          <span class="v num">
            {formatDuration(durationMs)}
            {suffix}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">Kosten</span>
          <span class={`v num metric-${cost.quality}`} title={cost.hint}>
            {cost.text}
            {cost.quality !== "unknown" ? suffix : ""}
          </span>
        </div>
        <div class="kv-row">
          <span class="k" title="ADR-0084: Summe dessen, was die Modell-Aufrufe bekommen haben — nicht das, was geschrieben wurde">Tokens verarbeitet</span>
          <span class={`v num metric-${tokens.quality}`} title={tokens.hint}>
            {tokens.text}
            {tokens.quality !== "unknown" ? suffix : ""}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">Kontextfenster</span>
          <span class="v num">
            {!context || context.fill === null
              ? "keine Meldung"
              : context.window === null
                ? `${context.fill.toLocaleString("de-DE")} Tokens — Fenstergröße unbekannt (ADR-0032)`
                : `${Math.round((context.fill / context.window) * 100)} % (${context.fill.toLocaleString("de-DE")} / ${context.window.toLocaleString("de-DE")})`}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">Kontingent (Adapter-weit)</span>
          <span class="v num">
            {!usage || !usage.supported
              ? "unbekannt"
              : usage.quota === null
                ? "noch keine Meldung"
                : usage.quota.windows.map(formatWindow).join(" · ")}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">Dateien geändert</span>
          <span class="v num">{filesChanged}</span>
        </div>
        <div class="kv-row">
          <span class="k">Tests</span>
          <span class="v dim">nicht erfasst — kein Adapter meldet ein strukturiertes Test-Signal</span>
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
