import { fmtTime } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { remoteHost } from "../../shared/api.ts";
import { StatusDot } from "../../shared/StatusDot.tsx";
import { displayLabel } from "../../shared/display-state.ts";
import type { TileRef } from "../workspace/tiles.ts";
import { useHubStatus } from "./hub-status.ts";
import { useOpenWindows } from "../windows/windows.ts";
import { clockText, countSessions, fleetSummary } from "./status-summary.ts";
import { projectName } from "../../shared/project-name.ts";

/**
 * EPIC-P23 T23.2 (desktop only): the one bar for what holds for the whole hub — connection, fleet,
 * sessions by state, open approvals — plus the focused tile's session. It reads what `App` polls.
 */
export function StatusBar({ focused, onOpenApprovals }: { focused: TileRef | null; onOpenApprovals: () => void }) {
  const hub = useHubStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const counts = countSessions(hub.sessions);
  // EPIC-P43 T43.7 (ADR-0068): wie viele eigene Fenster gerade leben.
  const windows = Object.keys(useOpenWindows()).length;
  const fleet = fleetSummary(hub.hosts);
  const session = focused ? hub.sessions.find((s) => s.id === focused.sessionId && remoteHost(s.hostId) === (focused.hostId ?? null)) : undefined;
  // Voller Fokus-Text für den Tooltip — die Leiste selbst behält die Ellipsis aus Platzgründen.
  const focusName = session?.title ?? (session ? projectName(session.project) : undefined);
  const focusText = session
    ? `${focusName ?? ""} · ${session.adapter}${session.model ? ` · ${session.model}` : ""} · ${displayLabel({ status: session.status, question: hub.questionSessions.includes(session.id) })}`
    : "";
  return (
    <div class="status-bar" role="status" aria-live="off" aria-label={t("shell.status_bar")}>
      <span class={`status-item ${hub.connected ? "" : "bad"}`} title={hub.connected ? t("shell.hub_connected") : hub.error}>
        <span class={`conn-dot ${hub.connected ? "live" : "closed"}`} />
        {hub.connected ? t("common.connected") : t("shell.no_connection", { "time": clockText(hub.lastOkAt) })}
      </span>
      <span class={`status-item ${fleet.problem ? "bad" : ""}`} title={t("shell.fleet")}>
        {fleet.text}
      </span>
      <span class="status-item" title={t("shell.sessions_by_state")}>
        {counts.working} {t("common.running_dot")} {counts.waiting} {t("common.waiting_dot")} {counts.error} {t("common.errors_dot")} {counts.idle} {t("common.ready")}
      </span>
      {hub.pendingApprovals > 0 && (
        <button class="status-item status-link" type="button" onClick={onOpenApprovals} aria-live="polite">
          {hub.pendingApprovals} {t("common.approval")}{hub.pendingApprovals === 1 ? "" : "n"} {t("common.open_count")}
        </button>
      )}
      {windows > 0 && (
        <span class="status-item status-windows" title={t("shell.own_windows")}>
          ⧉ {windows} {t("common.windows")}
        </span>
      )}
      <span class="status-spacer" />
      {session && (
        <span class="status-item status-focus" title={focusText} data-tip={focusText}>
          {focusName} · {session.adapter}
          {session.model ? ` · ${session.model}` : ""} · <StatusDot status={session.status} question={hub.questionSessions.includes(session.id)} />
        </span>
      )}
      <span class="status-item dim">{fmtTime(now)}</span>
    </div>
  );
}
