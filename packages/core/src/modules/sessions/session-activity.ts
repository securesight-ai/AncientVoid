import { ActivityReport, EXTERNAL_ACTIVITY_TTL_MS, type Ack } from "@ancientvoid/contracts";
import type { LiveSession } from "./session-state.ts";

interface Host {
  session(id: string): LiveSession | undefined;
  emit(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void>;
  working(session: LiveSession): Promise<void>;
  settle(session: LiveSession, code: number): Promise<void>;
  settleFailed(session: LiveSession): Promise<void>;
}

/**
 * ADR-0076 (BUG-0155 T2/T3): Adapter-Berichte und registrierte externe Jobs
 * treiben dasselbe Register (ADR-0074: `LiveSession.activities`, Events
 * `session.activity_begin/end`) — der Hub rät nie aus Assistant-Text oder
 * Prozessen. Externe Arbeit muss sich melden; schweigt sie länger als die
 * Frist, wird sie als unklar sichtbar und blockiert die Wiederaufnahme.
 */
export class SessionActivities {
  private readonly host: Host;
  constructor(host: Host) { this.host = host; }

  async record(session: LiveSession, raw: unknown, source: "provider" | "external"): Promise<void> {
    const activity = ActivityReport.parse(raw);
    const id = source === "external" ? `job:${activity.id}` : activity.id;
    if (activity.state === "running") {
      // BUG-0220: Ein Running-Report für eine bereits geführte Aktivität ist
      // Herzschlag (hubctl alle 20 s; ein verklemmter Provider kann es in
      // Burst-Geschwindigkeit sein) — den Herzschlag auffrischen, damit die TTL
      // weiterläuft, aber kein zweites activity_begin in den EventStore
      // streuen. Erst nach activity_end darf dieselbe ID erneut beginnen.
      const known = session.activities.get(id);
      if (known) {
        known.lastSeenAt = new Date().toISOString();
        return;
      }
      const entry = { id, source, label: activity.label?.trim() || activity.id, startedAt: new Date().toISOString() };
      session.activities.set(id, entry);
      await this.host.emit(session, "session.activity_begin", { ...entry });
      if (session.record.status === "idle" || session.record.status === "error") await this.host.working(session);
      return;
    }
    const code = activity.state === "failed" ? 1 : 0;
    if (!session.activities.delete(id)) return; // unbekannte/alte end-Ids streuen nicht (ADR-0074)
    await this.host.emit(session, "session.activity_end", { id, code });
    if (activity.state === "failed" && source === "external") {
      await this.host.emit(session, "session.recovery_blocked", { detail: `Hintergrundarbeit „${activity.label ?? activity.id}“ ist fehlgeschlagen. Zustand prüfen, abbrechen oder übergeben.` });
    }
    await this.closeIfLast(session, code, activity.label ?? activity.id);
  }

  async report(sessionId: string, activity: ActivityReport): Promise<Ack> {
    const session = this.host.session(sessionId);
    const allowed = session && (["working", "idle", "waiting_approval"].includes(session.record.status) || activity.state !== "running");
    if (!session || !allowed) return { ok: false, detail: "Session nimmt keine Hintergrundarbeit an." };
    const run = (session.lifecycle ?? Promise.resolve()).then(() => this.record(session, activity, "external"));
    // Der Aufrufer sieht den Fehler; die Kette darf daran nicht den nächsten Zugwechsel verlieren.
    session.lifecycle = run.catch(() => undefined);
    await run;
    return { ok: true };
  }

  /** Herzschlag-Frist (ADR-0076): externe Arbeit ohne Lebenszeichen gilt als unklar. */
  async expire(session: LiveSession): Promise<void> {
    for (const entry of [...session.activities.values()]) {
      if (entry.source === "external" && Date.now() - Date.parse(entry.lastSeenAt ?? entry.startedAt) > EXTERNAL_ACTIVITY_TTL_MS) {
        await this.record(session, { id: entry.id.replace(/^job:/, ""), kind: "job", state: "failed", label: entry.label }, "external");
      }
    }
  }

  private async closeIfLast(session: LiveSession, code: number, label?: string): Promise<void> {
    // BUG-0161: Ein Aktivitätsende ist kein Zugende. Läuft die Hauptarbeit
    // noch (mainTurnIdle === false, ADR-0076), bleibt die Session working —
    // ihr Zugende kommt über adapterTurn/Worker-Exit, nicht über Tools.
    if (session.mainTurnIdle === false) return;
    if (session.activities.size > 0 || (session.activeWorkers ?? 0) > 0 || session.record.status !== "working") return;
    // Eine fehlgeschlagene/ungewiss beendete Hintergrundarbeit ist kein
    // sauberer Laufabschluss (BUG-0155): ehrlich `error`, nie success-idle.
    // Nutzerfund 2026-11-15: Das Label der Arbeit gehört in die Meldung.
    if (code !== 0) {
      await this.host.emit(session, "session.turn_end", { code, reason: "error", detail: label ?? undefined });
      await this.host.settleFailed(session);
      return;
    }
    await this.host.settle(session, code);
  }
}
