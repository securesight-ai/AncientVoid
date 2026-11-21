import { generateVAPIDKeys, sendNotification } from "web-push";
import { DEFAULT_PUSH_HOSTS, PUSH_KIND_CATEGORY, inQuietHours, pushHostAllowed, type HubNotification, type PushCategory, type PushPayload, type PushSubscribeInput, type PushSubscriptionView } from "@ancientvoid/contracts";
import { renderServerMessage } from "../notifications/index.ts";
import type { HubDatabase } from "../../platform/index.ts";

interface Row {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string | null;
  created_at: string;
  quiet: string | null;
  done: number;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  gone: number;
  last_notification_id: number;
  locale: string | null;
}

/** What actually sends — web-push in production, a fake in tests. */
export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, vapid: { subject: string; publicKey: string; privateKey: string }) => Promise<{ statusCode: number }>;

export const webPushSender: PushSender = async (sub, payload, vapid) => {
  const res = await sendNotification(sub, payload, { vapidDetails: vapid, TTL: 3600, urgency: "high", timeout: 10_000 });
  return { statusCode: res.statusCode };
};

export interface PushOptions {
  sender?: PushSender;
  hosts?: readonly string[];
  subject?: string;
  hostId?: string;
  now?: () => Date;
  /** Waits before re-sending after a transient failure (timeout, 429, 5xx); tests pass zeros. */
  retryDelaysMs?: readonly number[];
}

type Delivery = "ok" | "transient" | "failed";

type Settings = { get(key: string): string | null; set(key: string, value: string | null): void };

/**
 * T8.3 / ADR-0026: push as a hint. Off until a person turns it on (it
 * leaves the tailnet); endpoints only at known push services (no SSRF);
 * one push per notification and device; quiet hours; a push service that
 * says "gone" marks the subscription gone, visibly.
 */
export class PushService {
  private readonly db: HubDatabase;
  private readonly settings: Settings;
  private readonly opts: PushOptions;

  constructor(db: HubDatabase, settings: Settings, opts: PushOptions = {}) {
    this.db = db;
    this.settings = settings;
    this.opts = opts;
  }

  enabled(): boolean {
    return this.settings.get("push.enabled") === "1";
  }

  /** Turning it on creates the VAPID key pair once. */
  setEnabled(on: boolean): void {
    if (on && !this.settings.get("push.vapidPublic")) {
      const keys = generateVAPIDKeys();
      this.settings.set("push.vapidPublic", keys.publicKey);
      this.settings.set("push.vapidPrivate", keys.privateKey);
    }
    this.settings.set("push.enabled", on ? "1" : null);
  }

  publicKey(): string | null {
    return this.enabled() ? this.settings.get("push.vapidPublic") : null;
  }

  subscribe(input: PushSubscribeInput, device: string | null): { ok: true } | { ok: false; detail: string } {
    if (!this.enabled()) return { ok: false, detail: "Push ist auf diesem Hub aus." };
    if (!pushHostAllowed(input.endpoint, this.opts.hosts ?? DEFAULT_PUSH_HOSTS)) return { ok: false, detail: "Unbekannter Push-Dienst — nur die der Browser-Hersteller." };
    if (input.oldEndpoint) this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(input.oldEndpoint);
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, device, created_at, quiet, done, gone, last_notification_id, locale)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, (SELECT COALESCE(MAX(id), 0) FROM notifications), ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, quiet = excluded.quiet, done = excluded.done, gone = 0, locale = excluded.locale`,
      )
      .run(input.endpoint, input.keys.p256dh, input.keys.auth, device, this.now().toISOString(), input.quiet ? JSON.stringify(input.quiet) : null, input.done ? 1 : 0, input.locale ?? "de");
    return { ok: true };
  }

  unsubscribe(endpoint: string): boolean {
    return Number(this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint).changes) > 0;
  }

  list(device: string | null): PushSubscriptionView[] {
    const rows = this.db.prepare("SELECT * FROM push_subscriptions ORDER BY id").all() as unknown as Row[];
    return rows.map((r) => ({
      id: r.id,
      device: r.device,
      service: new URL(r.endpoint).hostname,
      createdAt: r.created_at,
      quiet: r.quiet ? (JSON.parse(r.quiet) as PushSubscriptionView["quiet"]) : null,
      done: r.done === 1,
      lastOkAt: r.last_ok_at,
      lastError: r.last_error,
      lastErrorAt: r.last_error_at,
      gone: r.gone === 1,
      mine: device !== null && r.device === device,
      locale: r.locale === "en" ? "en" : "de",
    }));
  }

  /** Called for every new hub notification. Never throws. */
  async notify(n: HubNotification): Promise<number> {
    const category = PUSH_KIND_CATEGORY[n.kind];
    if (!category || !this.enabled()) return 0;
    const rows = this.db.prepare("SELECT * FROM push_subscriptions WHERE gone = 0 AND last_notification_id < ?").all(n.id) as unknown as Row[];
    let sent = 0;
    for (const r of rows) {
      if (category === "done" && r.done !== 1) continue;
      if (inQuietHours(r.quiet ? JSON.parse(r.quiet) : null, this.now())) continue;
      // EPIC-P61 / ADR-0101: der Hub rendert die Push-Texte selbst — pro Abo in dessen Sprache.
      const body = JSON.stringify(this.payloadFor(n, r, category!));
      let result = await this.deliver(r, body, n.id);
      // A flaky mobile push service must not swallow an approval request: retry transient failures.
      for (const wait of this.opts.retryDelaysMs ?? [2_000, 10_000, 30_000]) {
        if (result !== "transient") break;
        await new Promise((resolve) => setTimeout(resolve, wait));
        result = await this.deliver(r, body, null);
      }
      if (result === "ok") sent++;
    }
    return sent;
  }

  /** A test push to one device's own subscriptions. */
  async test(device: string | null): Promise<{ sent: number; errors: string[] }> {
    const rows = (this.db.prepare("SELECT * FROM push_subscriptions WHERE gone = 0").all() as unknown as Row[]).filter((r) => r.device === device);
    let sent = 0;
    const errors: string[] = [];
    for (const r of rows) {
      if ((await this.deliver(r, JSON.stringify({ ...this.payloadFor({ id: 0, sessionId: "" }, r, "done", "push.category.test.title", "push.category.test.body"), test: true }), null)) === "ok") sent++;
      else errors.push(this.list(device).find((v) => v.id === r.id)?.lastError ?? "Fehler");
    }
    return { sent, errors };
  }

  /**
   * EPIC-P61 / ADR-0101: Payload mit hub-seitig gerendertem Titel — pro Abo in
   * dessen Sprache. Gerendert wird nur, was Katalogschlüssel ist; Prosadaten
   * (detail/summary) bleiben aus der Lockscreen-Payload draußen (ADR-0026).
   */
  private payloadFor(n: { id: number; sessionId: string; messageKey?: string | null; params?: Record<string, string | number> | null }, r: Row | null, category: PushCategory, titleKey?: string, bodyKey?: string): PushPayload {
    const locale: "de" | "en" = r?.locale === "en" ? "en" : "de";
    const payload: PushPayload = { id: n.id, category, sessionId: n.sessionId, hostId: this.opts.hostId ?? "local" };
    const title = renderServerMessage(titleKey ?? n.messageKey ?? `push.category.${category}.title`, locale, n.params ?? {});
    const body = renderServerMessage(bodyKey ?? `push.category.${category}.body`, locale, {});
    if (title) payload.title = title;
    if (body) payload.body = body;
    return payload;
  }

  private async deliver(r: Row, payload: string, notificationId: number | null): Promise<Delivery> {
    const vapid = { subject: this.opts.subject ?? "mailto:ancientvoid@localhost", publicKey: this.settings.get("push.vapidPublic") ?? "", privateKey: this.settings.get("push.vapidPrivate") ?? "" };
    const now = this.now().toISOString();
    // Claimed before sending: a second notify() for the same id sends nothing.
    if (notificationId !== null) this.db.prepare("UPDATE push_subscriptions SET last_notification_id = MAX(last_notification_id, ?) WHERE id = ?").run(notificationId, r.id);
    try {
      const res = await (this.opts.sender ?? webPushSender)({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, vapid);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        this.db.prepare("UPDATE push_subscriptions SET last_ok_at = ?, last_error = NULL WHERE id = ?").run(now, r.id);
        return "ok";
      }
      this.fail(r.id, res.statusCode, `Push-Dienst antwortete ${res.statusCode}`, now);
      return transient(res.statusCode) ? "transient" : "failed";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      this.fail(r.id, status, status ? `Push-Dienst antwortete ${status}` : err instanceof Error ? err.message.slice(0, 160) : "Senden fehlgeschlagen", now);
      return status === undefined || transient(status) ? "transient" : "failed";
    }
  }

  private fail(id: number, status: number | undefined, message: string, at: string): void {
    const gone = status === 404 || status === 410;
    this.db.prepare("UPDATE push_subscriptions SET last_error = ?, last_error_at = ?, gone = ? WHERE id = ?").run(gone ? `${message} — Abo erloschen, auf dem Gerät neu einschalten` : message, at, gone ? 1 : 0, id);
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }
}

/** Worth another try: rate limit and server-side trouble, not "gone" or "rejected". */
function transient(status: number): boolean {
  return status === 429 || status >= 500;
}
