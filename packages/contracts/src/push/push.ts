import { z } from "zod";

/**
 * T8.3 / ADR-0026: Web Push as a hint only. The payload is an opaque
 * notification id and a category — never a prompt, a command or text on
 * the lock screen. Push leaves the tailnet (browser push service): off
 * until a person turns it on, endpoints only at known push services.
 */
export const PUSH_CATEGORIES = ["approval", "error", "done"] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Which notification kinds push, and as what. `done` only when asked for. */
export const PUSH_KIND_CATEGORY: Readonly<Record<string, PushCategory>> = {
  "tool.permission_requested": "approval",
  "session.steer_pending_approval": "approval",
  "operation.uncertain": "error",
  "provider.error": "error",
  "session.start_failed": "error",
  "session.recovery_failed": "error",
  "session.recovery_blocked": "error",
  "adapter.down": "error",
  "session.budget_exceeded": "error",
  "session.daily_cap_exceeded": "error",
  "session.turn_failed": "error",
  "session.turn_end": "done",
};

/** Hosts of the browsers' push services — nothing else is ever called. */
export const DEFAULT_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "*.notify.windows.com",
  "*.push.apple.com",
];

export function pushHostAllowed(endpoint: string, hosts: readonly string[] = DEFAULT_PUSH_HOSTS): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return hosts.some((h) => (h.startsWith("*.") ? url.hostname.endsWith(h.slice(1)) : url.hostname === h));
}

export const PushSubscribeInput = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  /** Replaces a rotated subscription of the same device. */
  oldEndpoint: z.string().url().max(2000).optional(),
  /** Quiet hours in the device's local time, minutes after midnight. */
  quiet: z.object({ from: z.number().int().min(0).max(1439), to: z.number().int().min(0).max(1439), tzOffsetMinutes: z.number().int().min(-840).max(840) }).nullable().optional(),
  /** Also push when a turn is done (default: only approvals and errors). */
  done: z.boolean().optional(),
  /** EPIC-P61 / ADR-0101: language for hub-rendered push texts. */
  locale: z.enum(["de", "en"]).optional(),
});
export type PushSubscribeInput = z.infer<typeof PushSubscribeInput>;

export interface PushSubscriptionView {
  id: number;
  device: string | null;
  /** Host only — the endpoint URL is a secret-ish capability. */
  service: string;
  createdAt: string;
  quiet: { from: number; to: number; tzOffsetMinutes: number } | null;
  done: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** The push service said it no longer exists (404/410). */
  gone: boolean;
  mine: boolean;
  /** EPIC-P61 / ADR-0101: language the hub uses when it renders push texts for this subscription. */
  locale: "de" | "en";
}

export interface PushPayload {
  id: number;
  category: PushCategory;
  sessionId: string;
  hostId: string;
  /** EPIC-P61 / ADR-0101: rendered from the server catalog in the subscription's language. */
  title?: string;
  body?: string;
}

/** Is `now` inside the quiet hours (device-local)? */
export function inQuietHours(quiet: { from: number; to: number; tzOffsetMinutes: number } | null, now = new Date()): boolean {
  if (!quiet || quiet.from === quiet.to) return false;
  const local = (((now.getUTCHours() * 60 + now.getUTCMinutes() - quiet.tzOffsetMinutes) % 1440) + 1440) % 1440;
  return quiet.from < quiet.to ? local >= quiet.from && local < quiet.to : local >= quiet.from || local < quiet.to;
}
