import { hubApi } from "./api.ts";
import { resolveLanguage } from "./i18n/index.ts";

/** T8.3: what this browser can do with Web Push. */
export function pushSupport(): "ok" | "unsupported" | "denied" {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission === "denied" ? "denied" : "ok";
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const PREFS = "ancientvoid.pushPrefs";

export interface PushPrefs {
  quiet: { from: number; to: number } | null;
  done: boolean;
}

export function readPrefs(): PushPrefs {
  try {
    return { quiet: null, done: false, ...(JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<PushPrefs>) };
  } catch {
    return { quiet: null, done: false };
  }
}

export function writePrefs(p: PushPrefs): void {
  localStorage.setItem(PREFS, JSON.stringify(p));
}

/** Subscribe (or re-register) this device with its current preferences. */
export async function subscribeThisDevice(publicKey: string, oldEndpoint?: string): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Benachrichtigungen sind für diese Seite nicht erlaubt.");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const prefs = readPrefs();
  await hubApi.pushSubscribe({
    endpoint: json.endpoint,
    keys: json.keys,
    ...(oldEndpoint && oldEndpoint !== json.endpoint ? { oldEndpoint } : {}),
    quiet: prefs.quiet ? { ...prefs.quiet, tzOffsetMinutes: new Date().getTimezoneOffset() } : null,
    done: prefs.done,
    // EPIC-P61 / ADR-0101: der Hub rendert Push-Texte in der Sprache dieses Geräts.
    locale: resolveLanguage(),
  });
}

export async function unsubscribeThisDevice(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await hubApi.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

/** App start: a rotated or re-created subscription is registered again. */
export async function resyncPush(): Promise<void> {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const state = await hubApi.push().catch(() => null);
  if (state?.publicKey) await subscribeThisDevice(state.publicKey).catch(() => undefined);
}
