import { describe, expect, it } from "vitest";
import { inQuietHours, pushHostAllowed, type HubNotification } from "@ancientvoid/contracts";
import { HubDatabase, PushService, SettingsStore, type PushSender } from "../../../src/index.ts";
import { webPushSender } from "../../../src/modules/push/index.ts";

const sub = (endpoint = "https://fcm.googleapis.com/fcm/send/abc") => ({ endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } });
const note = (id: number, kind: string): HubNotification => ({ id, sessionId: "s1", level: "warning", title: "Freigabe nötig", detail: "rm -rf dist", kind, createdAt: "x" });

function setup(opts: { status?: number; now?: Date; statuses?: number[] } = {}) {
  const db = new HubDatabase(":memory:");
  const sent: { endpoint: string; payload: string }[] = [];
  const sender: PushSender = async (s, payload) => {
    sent.push({ endpoint: s.endpoint, payload });
    return { statusCode: opts.statuses?.shift() ?? opts.status ?? 201 };
  };
  const push = new PushService(db, new SettingsStore(db), { sender, retryDelaysMs: [0, 0], hostId: "workstation", ...(opts.now ? { now: () => opts.now! } : {}) });
  return { db, push, sent };
}

describe("Web Push (T8.3, ADR-0026)", () => {
  it("production sender reaches web-push VAPID validation without network access", async () => {
    await expect(webPushSender(sub(), "{}", { subject: "invalid-subject", publicKey: "", privateKey: "" })).rejects.toThrow("Vapid subject is not a valid URL");
  });

  it("off by default — nothing leaves the hub; turning it on makes a VAPID key", async () => {
    const { push, sent } = setup();
    expect(push.enabled()).toBe(false);
    expect(push.subscribe(sub(), "pixel")).toMatchObject({ ok: false });
    expect(await push.notify(note(1, "tool.permission_requested"))).toBe(0);
    push.setEnabled(true);
    expect(push.publicKey()).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(sent).toHaveLength(0);
  });

  it("only known push services — no requests to internal addresses", () => {
    const { push } = setup();
    push.setEnabled(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x"]) expect(push.subscribe(sub(bad), "pixel"), bad).toMatchObject({ ok: false });
    expect(pushHostAllowed("https://db5p.notify.windows.com/w/?token=1")).toBe(true);
    expect(push.subscribe(sub(), "pixel")).toEqual({ ok: true });
  });

  it("one push per notification and device, payload ohne Prosadaten; turn ends only when asked", async () => {
    const { push, sent } = setup();
    push.setEnabled(true);
    push.subscribe(sub(), "pixel");
    expect(await push.notify(note(1, "tool.permission_requested"))).toBe(1);
    expect(await push.notify(note(1, "tool.permission_requested"))).toBe(0);
    expect(JSON.parse(sent[0]!.payload)).toEqual({ id: 1, category: "approval", sessionId: "s1", hostId: "workstation", title: "AncientVoid — Freigabe nötig", body: "Eine Session wartet auf deine Entscheidung." });
    expect(sent[0]!.payload).not.toContain("rm -rf");
    expect(await push.notify(note(2, "session.turn_end"))).toBe(0);
    expect(await push.notify(note(3, "session.applied"))).toBe(0);
    push.subscribe({ ...sub(), done: true }, "pixel");
    expect(await push.notify(note(4, "session.turn_end"))).toBe(1);
    // ADR-0015 Nachtrag: ein abgebrochener Zug ist ein Fehler — kein „done“.
    expect(await push.notify(note(6, "session.turn_failed"))).toBe(1);
    expect(push.list("pixel")[0]).toMatchObject({ service: "fcm.googleapis.com", mine: true, lastError: null });
    expect(push.list("pixel")[0]!.lastOkAt).not.toBeNull();
  });

  it("transient push-service failures are retried; a rejection is not", async () => {
    const flaky = setup({ statuses: [503, 429, 201] });
    flaky.push.setEnabled(true);
    flaky.push.subscribe(sub(), "pixel");
    expect(await flaky.push.notify(note(1, "tool.permission_requested"))).toBe(1);
    expect(flaky.sent).toHaveLength(3);
    expect(flaky.push.list("pixel")[0]!.lastError).toBeNull();

    const rejected = setup({ status: 403 });
    rejected.push.setEnabled(true);
    rejected.push.subscribe(sub(), "pixel");
    expect(await rejected.push.notify(note(1, "tool.permission_requested"))).toBe(0);
    expect(rejected.sent).toHaveLength(1);
  });

  it("quiet hours hold pushes; the inbox keeps them", async () => {
    const at = new Date("2026-09-24T21:30:00Z"); // 23:30 in CEST
    const { push, sent } = setup({ now: at });
    push.setEnabled(true);
    push.subscribe({ ...sub(), quiet: { from: 22 * 60, to: 7 * 60, tzOffsetMinutes: -120 } }, "pixel");
    expect(await push.notify(note(5, "provider.error"))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(inQuietHours({ from: 22 * 60, to: 7 * 60, tzOffsetMinutes: -120 }, new Date("2026-09-24T08:00:00Z"))).toBe(false);
    expect(inQuietHours({ from: 13 * 60, to: 14 * 60, tzOffsetMinutes: 0 }, new Date("2026-09-24T13:30:00Z"))).toBe(true);
  });

  it("a gone subscription (410) is marked, visible, and not used again", async () => {
    const { push, sent } = setup({ status: 410 });
    push.setEnabled(true);
    push.subscribe(sub(), "pixel");
    expect(await push.notify(note(6, "provider.error"))).toBe(0);
    expect(push.list(null)[0]).toMatchObject({ gone: true, lastError: expect.stringContaining("Abo erloschen") });
    await push.notify(note(7, "provider.error"));
    expect(sent).toHaveLength(1);
  });

  it("a rotated subscription replaces the old one", () => {
    const { push } = setup();
    push.setEnabled(true);
    push.subscribe(sub("https://fcm.googleapis.com/fcm/send/old"), "pixel");
    push.subscribe({ ...sub("https://fcm.googleapis.com/fcm/send/new"), oldEndpoint: "https://fcm.googleapis.com/fcm/send/old" }, "pixel");
    expect(push.list("pixel")).toHaveLength(1);
  });
});

// EPIC-P61 T61.7 / ADR-0101: Der Hub rendert Push-Texte selbst — nach der
// Sprache des Abos. Deutsche Abos behalten die bisherigen Worte unverändert.
describe("EPIC-P61 T61.7: Push-Texte nach Sprache des Abos", () => {
  const subL = (locale?: "de" | "en") => ({ endpoint: "https://fcm.googleapis.com/fcm/send/xyz", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" }, ...(locale ? { locale } : {}) });
  const noteKeyed = (id: number): HubNotification => ({ id, sessionId: "s1", level: "error", title: "galaxy · acp: Start fehlgeschlagen", detail: "boom", kind: "session.start_failed", messageKey: "notification.start_failed", params: { project: "galaxy", adapter: "acp" }, createdAt: "x" });

  it("Abo mit locale en: Titel und Body englisch; Abo ohne locale bleibt deutsch", async () => {
    const { push, sent } = setup();
    push.setEnabled(true);
    expect(push.subscribe(subL("en"), "pixel")).toMatchObject({ ok: true });
    expect(push.subscribe({ ...subL(), endpoint: "https://fcm.googleapis.com/fcm/send/xyz2" }, "pixel2")).toMatchObject({ ok: true });
    expect(await push.notify(noteKeyed(1))).toBe(2);
    const en = sent.find((s) => s.endpoint.endsWith("xyz"))!;
    const de = sent.find((s) => !s.endpoint.endsWith("xyz"))!;
    expect(JSON.parse(en.payload)).toMatchObject({ title: "galaxy · acp: start failed", body: "Something went wrong in a session." });
    expect(JSON.parse(de.payload)).toMatchObject({ title: "galaxy · acp: Start fehlgeschlagen", body: "In einer Session ist etwas schiefgegangen." });
    expect(en.payload).not.toContain("boom"); // ADR-0026: Prosadaten bleiben aus der Lockscreen-Payload
  });

  it("die Abo-Sprache steht im View und überlebt einen Neustart des Dienstes (K7)", () => {
    const { db, push } = setup();
    push.setEnabled(true);
    push.subscribe({ ...subL("en"), endpoint: "https://fcm.googleapis.com/fcm/send/abc" }, "pixel");
    expect(push.list("pixel")[0]).toMatchObject({ locale: "en" });
    const again = new PushService(db, new SettingsStore(db), { sender: async () => ({ statusCode: 201 }) });
    expect(again.list("pixel")[0]).toMatchObject({ locale: "en" });
  });
});
