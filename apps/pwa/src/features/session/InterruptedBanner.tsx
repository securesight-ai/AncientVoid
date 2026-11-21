import { t } from "../../shared/i18n/index.ts";
import { fmtDateTime, fmtTime, fmtNumber } from "../../shared/i18n/format.ts";
import type { SessionInterruptionReason } from "@ancientvoid/contracts";
import { useState } from "preact/hooks";
import type { NormalizedEvent } from "../../shared/ws.ts";
import { Button } from "../../shared/ui/index.ts";

const REASONS: Record<SessionInterruptionReason, string> = {
  worker_exit: t("session.agent_exit_unexpected"),
  hub_restart: t("session.hub_restarted"),
  adapter_down: t("session.adapter_lost"),
  provider_limit: t("session.provider_limit"),
};

/** ADR-0076 Nachtrag: Starb der Zug am Kontingent/Rate-Limit (oder meldete
 * der Provider ein gesperrtes Fenster)? Nur dann bietet das Banner die
 * automatische Fortsetzung an. */
function limitFailure(events: NormalizedEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const kind = e.payload.kind;
    if (kind === "session.prompt" || kind === "session.handover_out") return false;
    if (e.type === "assistant") return false;
    if (kind === "provider.error") return e.payload.category === "quota" || e.payload.category === "rate_limit" || blockedWindow(events) !== undefined;
    if (kind === "cursor.usage_limit") return true;
  }
  return false;
}

/** Früheste noch laufende Freigabezeit der ausgelasteten Fenster (ADR-0004). */
function blockedWindow(events: NormalizedEvent[]): string | undefined {
  const quota = [...events].reverse().find(e => e.usageQuota !== undefined)?.usageQuota;
  let earliest: string | undefined;
  for (const w of quota?.windows ?? []) {
    if (w.utilization < 1) continue;
    const at = Date.parse(w.resetsAt);
    if (!Number.isFinite(at) || at <= Date.now()) continue;
    if (earliest === undefined || at < Date.parse(earliest)) earliest = w.resetsAt;
  }
  return earliest;
}

export function InterruptedBanner({ events, since, nativeResume, onResume, onArchive, failed = false, onStop, onHandover, autoResumeOnLimit = false, onAutoResumeLimit }: {
  events: NormalizedEvent[];
  since: string;
  /** true = Adapter deklariert hub-Resume; false = Weitermachen nutzt Prompt-Fallback. */
  nativeResume: boolean;
  onResume: () => Promise<void>;
  onArchive: () => Promise<void>;
  failed?: boolean;
  onStop?: () => Promise<void>;
  onHandover?: () => void;
  /** ADR-0076 Nachtrag: Option dieser Session — nach dem Limit-Fenster automatisch fortsetzen. */
  autoResumeOnLimit?: boolean;
  onAutoResumeLimit?: (on: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const event = [...events].reverse().find(e => e.payload.kind === "session.interrupted");
  const boundary = [...events].reverse().find(e => e.payload.kind === "session.prompt")?.seq ?? 0;
  const blocked = [...events].reverse().find(e => e.seq > boundary && (e.payload.kind === "session.recovery_blocked" || e.payload.kind === "session.recovery_failed" || e.payload.kind === "session.start_failed" || e.payload.kind === "provider.error" || e.type === "error"));
  const reason = String(event?.payload.reason ?? t("session.interruption_detected"));
  const at = typeof event?.payload.since === "string" ? event.payload.since : since;
  const isLimit = event?.payload.limit === true || (failed && limitFailure(events));
  const resumesAt = typeof event?.payload.resumesAt === "string" ? event.payload.resumesAt : blockedWindow(events);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <section class="interrupted-banner" role="status" aria-label={failed ? t("session.needs_decision") : t("session.interrupted")}>
    <strong>{failed ? t("session.needs_an_decision") : t("session.interrupted")}</strong>
    {blocked && <p>{String(blocked.payload.detail ?? blocked.payload.reason ?? blocked.payload.error ?? blocked.summary)}</p>}
    <p>{Object.hasOwn(REASONS, reason) ? REASONS[reason as SessionInterruptionReason] : reason} · <time dateTime={at}>{fmtDateTime(at)}</time></p>
    {event?.payload.lastTurnId && <p>{t("session.last_turn")} {String(event.payload.lastTurnId)}</p>}
    {!failed && !nativeResume && <p>{t("session.no_native_resume")}</p>}
    {isLimit && autoResumeOnLimit && <p class="dim" role="status">{t("session.auto_resumes_when_free")}{resumesAt ? <> {t("session.at_earliest_from")} <time dateTime={resumesAt}>{fmtTime(resumesAt)}</time></> : ""}.</p>}
    <div class="row">
      {!failed && <Button disabled={busy} onClick={() => void act(onResume)}>{t("session.continue")}</Button>}
      {isLimit && onAutoResumeLimit && !autoResumeOnLimit && <Button disabled={busy} onClick={() => void act(() => onAutoResumeLimit(true))}>{t("session.auto_continue_after_limit")}</Button>}
      {isLimit && onAutoResumeLimit && autoResumeOnLimit && <Button disabled={busy} onClick={() => void act(() => onAutoResumeLimit(false))}>{t("session.automation_off")}</Button>}
      {onStop && <Button disabled={busy} onClick={() => void act(onStop)}>{t("common.cancel")}</Button>}
      {onHandover && <Button disabled={busy} onClick={onHandover}>{t("session.hand_over_to_other")}</Button>}
      <Button disabled={busy} onClick={() => void act(onArchive)}>{t("common.archive_btn")}</Button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
