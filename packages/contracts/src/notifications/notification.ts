/** ADR-0015: what the hub tells the user about, across sessions. */
export type NotificationLevel = "info" | "success" | "warning" | "error";

/**
 * EPIC-P67 / ADR-0088 T67.6: Aktion einer Benachrichtigung — ein Knopf, der
 * genau diesen Hub-Endpunkt ruft (gleicher Endpunkt wie das Session-Menü).
 * Rein additiv: Bestand ohne `action` rendert wie bisher.
 */
export interface NotificationAction {
  label: string;
  method: "POST";
  /** Hub-API-Pfad inklusive Session-Id, z. B. `/api/sessions/<id>/main-sync`. */
  path: string;
}

/**
 * EPIC-P61 / ADR-0101: messageKey + Params für Texte, die der Hub selbst
 * erzeugt. Titel/Detail bleiben als deutsche Fallback-Texte für Alt-Clients
 * und Alt-Journal; Persistierte Notifications vor P61 haben keinen Schlüssel.
 * Params klein halten (K5): Datenasen < 512 B, sonst bleibt es `detail`.
 */
export type NotificationMessageKey =
  | "notification.start_failed"
  | "notification.recovery_failed"
  | "notification.adapter_down"
  | "notification.session_interrupted"
  | "notification.turn_failed"
  | "notification.turn_done"
  | "notification.question"
  | "notification.approval_needed"
  | "notification.loop_hold"
  | "notification.loop_broken"
  | "notification.loop_escalated"
  | "notification.budget_paused"
  | "notification.applied"
  | "notification.writer_takeover"
  | "notification.operation_uncertain"
  | "notification.operation_rejected"
  | "notification.recovery_blocked"
  | "notification.recovered_uncontrollable"
  | "notification.process_exit";

export interface HubNotification {
  id: number;
  sessionId: string;
  level: NotificationLevel;
  title: string;
  detail: string | null;
  /** The event kind that caused it, e.g. "provider.error". */
  kind: string;
  createdAt: string;
  /** EPIC-P67: optionaler Aktionsknopf — null/undefined = keine Aktion. */
  action?: NotificationAction | null;
  /** EPIC-P61 / ADR-0101: Katalogschlüssel für Hub-eigene Texte (additiv). */
  messageKey?: NotificationMessageKey | string | null;
  /** Interpolation zum messageKey — nur Daten, keine Freitexte > 512 B (K5). */
  params?: Record<string, string | number> | null;
}
