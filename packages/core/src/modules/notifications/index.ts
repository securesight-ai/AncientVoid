/** Public API of this module (ADR-0020). Other modules import only from here. */
export { notificationFor, projectName, parseNotificationAction, parseNotificationParams, notificationHorizonCutoff, NOTIFICATION_HORIZON_DAYS, type NotificationDraft } from "./notifications.ts";
export { renderServerMessage, serverCatalog, type ServerMessageKey } from "./i18n/index.ts";
