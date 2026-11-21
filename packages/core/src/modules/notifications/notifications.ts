import { win32 } from "node:path";
import type { NormalizedEvent, NotificationAction, NotificationLevel, NotificationMessageKey } from "@ancientvoid/contracts";

export interface NotificationDraft {
  level: NotificationLevel;
  /** Deutscher Fallback-Titel — bleibt auch mit messageKey gefüllt (Alt-Clients, Alt-Journal). */
  title: string;
  detail: string | null;
  kind: string;
  /** EPIC-P61 T61.7 / ADR-0101: Katalogschlüssel für determinierte Texte. */
  messageKey?: NotificationMessageKey;
  params?: Record<string, string | number>;
}

export interface NotificationContext {
  adapter: string;
  project: string;
}

/** Anzeigename eines Projektpfads. Ein Windows-Hub meldet `C:\…`; win32.basename trennt an / und \ (BUG-0196). */
export function projectName(project: string): string {
  return win32.basename(project) || project;
}

/** EPIC-P67 T67.6: gespeicherten Aktionsknopf lesen — kaputter JSON-Stand gilt als "keine Aktion", nie als Absturz. */
export function parseNotificationAction(raw: string | null | undefined): NotificationAction | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { label?: unknown; method?: unknown; path?: unknown };
    if (typeof parsed.label === "string" && parsed.label !== "" && parsed.method === "POST" && typeof parsed.path === "string" && parsed.path.startsWith("/api/")) {
      return { label: parsed.label, method: "POST", path: parsed.path };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * ADR-0015: which events deserve the user's attention outside the open
 * session. Everything else stays in the session's own history.
 */
export function notificationFor(event: NormalizedEvent, ctx: NotificationContext): NotificationDraft | null {
  const payload = event.payload as Record<string, unknown>;
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const where = projectName(ctx.project);
  const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
  switch (kind) {
    case "provider.error":
      return { level: "error", title: `${where} · ${event.summary}`, detail: text(payload.detail), kind };
    case "session.start_failed":
      return { level: "error", title: `${where} · ${ctx.adapter}: Start fehlgeschlagen`, detail: text(payload.error), kind, messageKey: "notification.start_failed", params: { project: where, adapter: ctx.adapter } };
    case "session.recovery_failed":
      return { level: "error", title: `${where} · Wiederherstellung fehlgeschlagen`, detail: text(payload.reason), kind, messageKey: "notification.recovery_failed", params: { project: where } };
    case "adapter.down":
      return { level: "error", title: `${where} · ${ctx.adapter} antwortet nicht`, detail: text(payload.detail), kind, messageKey: "notification.adapter_down", params: { project: where, adapter: ctx.adapter } };
    case "session.interrupted":
      return { level: "warning", title: `${where} · Session unterbrochen`, detail: text(payload.reason), kind, messageKey: "notification.session_interrupted", params: { project: where } };
    case "session.turn_end":
      if (payload.reason === "interrupted") return null;
      // Nutzerfund 2026-11-15: ein abgebrochener Lauf ist eine Fehler-Meldung
      // wert — aber nur eine pro Lauf, mit den Worten des Provider-Fehlers,
      // wenn es einen gab (siehe recordNotifications).
      if (payload.reason === "error") {
        return { level: "error", title: `${where} · Zug fehlgeschlagen`, detail: text(payload.detail) ?? "Der Zug endete mit einem Fehler — Details im Verlauf.", kind: "session.turn_failed", messageKey: "notification.turn_failed", params: { project: where } };
      }
      return { level: "success", title: `${where} · Zug fertig`, detail: `${ctx.adapter} wartet auf den nächsten Prompt.`, kind, messageKey: "notification.turn_done", params: { project: where } };
    case "tool.permission_requested":
      return {
        level: "warning",
        title: `${where} · ${payload.question === true ? "Rückfrage" : "Freigabe nötig"}`,
        detail: event.summary,
        kind,
        messageKey: payload.question === true ? "notification.question" : "notification.approval_needed",
        params: { project: where },
      };
    case "session.steer_pending_approval":
      return { level: "warning", title: `${where} · Freigabe nötig`, detail: "Eine Antwort wartet in den Freigaben.", kind, messageKey: "notification.approval_needed", params: { project: where } };
    // EPIC-P19: ein Loop meldet selbst, wann er eine Person braucht oder gestört ist (AC-P19-2, K9).
    case "loop.hold":
      return { level: "warning", title: `${where} · Loop wartet auf dich`, detail: text(payload.reason), kind, messageKey: "notification.loop_hold", params: { project: where } };
    case "loop.broken":
      return { level: "error", title: `${where} · Loop gestört`, detail: text(payload.reason), kind, messageKey: "notification.loop_broken", params: { project: where } };
    case "loop.notify":
      return { level: "warning", title: `${where} · Loop eskaliert (Stufe ${text(payload.level) ?? "?"})`, detail: text(payload.reason), kind, messageKey: "notification.loop_escalated", params: { project: where, level: text(payload.level) ?? "?" } };
    case "session.budget_exceeded":
    case "session.daily_cap_exceeded":
      return { level: "warning", title: `${where} · Budget erreicht, pausiert`, detail: null, kind, messageKey: "notification.budget_paused", params: { project: where } };
    case "session.applied":
      return { level: "success", title: `${where} · ins Projekt übernommen`, detail: `${String(payload.files)} Datei(en) nach ${String(payload.into)} (${String(payload.commit)})`, kind, messageKey: "notification.applied", params: { project: where } };
    case "session.writer_takeover":
      return { level: "info", title: `${where} · Gerät übernommen`, detail: `Schreibt jetzt: ${String(payload.to)}`, kind, messageKey: "notification.writer_takeover", params: { project: where } };
    case "operation.uncertain":
      return {
        level: "warning",
        title: `${where} · Ausführung ungewiss`,
        detail: "Der Hub startete neu, während eine freigegebene Aktion lief. Ob sie ankam, ist unklar — bitte im Verlauf prüfen, sie wird nicht wiederholt.",
        kind,
        messageKey: "notification.operation_uncertain",
        params: { project: where },
      };
    case "operation.rejected_changed":
      return { level: "error", title: `${where} · Aktion nicht ausgeführt`, detail: "Die Argumente weichen von der Freigabe ab.", kind, messageKey: "notification.operation_rejected", params: { project: where } };
    // ADR-0076: gescheiterte Hintergrundarbeit blockiert die Wiederaufnahme —
    // das bleibt hängen und gehört auf den Bildschirm, nicht nur in den Verlauf.
    case "session.recovery_blocked":
      return { level: "error", title: `${where} · Hintergrundarbeit fehlgeschlagen`, detail: text(payload.detail), kind, messageKey: "notification.recovery_blocked", params: { project: where } };
    case "session.recovered":
      // 2026-10-25: only warn when the session was ACTIVELY working — an idle
      // session between turns loses nothing by falling back to observed mode.
      // Repeated false "nur noch lesbar" warnings after every hub restart
      // trained users to ignore the bell (observed 2026-10-24).
      return payload.controllable === false && payload.wasWorking === true
        ? { level: "warning", title: `${where} · nach Neustart nicht steuerbar`, detail: "Die Session lief mitten im Zug und ist jetzt nur noch lesbar.", kind, messageKey: "notification.recovered_uncontrollable", params: { project: where } }
        : null;
  }
  // BUG-0162: Nur System-Events sind Prozesswahrheit — thinking/assistant
  // Inhalte, die den String wörtlich enthalten (Agent debuggt Prozesse),
  // sind keine Absturzmeldung.
  if (event.type !== "system") return null;
  const exited = /process exited with code (\d+)/.exec(event.summary);
  if (exited) {
    return { level: "error", title: `${where} · ${ctx.adapter} abgebrochen (Code ${exited[1]})`, detail: "Der Provider-Prozess endete mit einem Fehler. Details im Verlauf.", kind: "process.exit", messageKey: "notification.process_exit", params: { project: where, adapter: ctx.adapter, code: exited[1]! } };
  }
  return null;
}

/** EPIC-P61 T61.7 / ADR-0101: Params-JSON lesen — kaputter Stand gilt als "keine Params", nie als Absturz. */
export function parseNotificationParams(raw: string | null | undefined): Record<string, string | number> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" || typeof v === "number") out[k] = v;
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}
