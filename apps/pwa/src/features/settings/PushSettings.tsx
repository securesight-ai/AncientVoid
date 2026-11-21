import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { hubApi, type PushState } from "../../shared/api.ts";
import { SettingRow, SettingsSection, Switch } from "./parts.tsx";
import { pushSupport, readPrefs, subscribeThisDevice, unsubscribeThisDevice, writePrefs } from "../../shared/push.ts";
import { Button } from "../../shared/ui/index.ts";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const minutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "");

/**
 * T8.3 (ADR-0026): push notifications — off until you turn them on; the
 * inbox (bell) stays the complete list. Delivery status per device visible.
 */
export function PushSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [prefs, setPrefs] = useState(readPrefs);
  const support = pushSupport();

  const load = () =>
    hubApi
      .push()
      .then(setState)
      .catch((err) => setError(err instanceof Error ? err.message : "Push-Status nicht ladbar"));
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError("");
    setInfo("");
    try {
      await fn();
      if (ok) setInfo(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fehlgeschlagen");
    }
    await load();
  };

  const mine = state?.subscriptions.filter((s) => s.mine && !s.gone) ?? [];
  const save = (p: typeof prefs) => {
    setPrefs(p);
    writePrefs(p);
  };

  return (
    <SettingsSection title={t("notifications.title")} testid="push-settings">
      <p class="dim settings-intro">
        {t("settings.push_note")}
      </p>
      {error && <div class="reply-error">{error}</div>}
      {info && <div class="dim">{info}</div>}
      {state && (
        <SettingRow label={t("settings.push_on_hub")} hint="aus, bis du es einschaltest">
          <Switch label={t("settings.allow_push")} checked={state.enabled} onChange={(next) => void run(() => hubApi.setPushEnabled(next))} />
        </SettingRow>
      )}
      {state?.enabled && (
        <>
          {support === "unsupported" && <div class="push-status warn">{t("settings.no_push_browser")}</div>}
          {support === "denied" && <div class="push-status err">{t("settings.notifications_blocked")}</div>}
          {support === "ok" && (
            <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: flex-start">
              {mine.length === 0 ? (
                <Button onClick={() => void run(() => subscribeThisDevice(state.publicKey!), "Dieses Gerät bekommt jetzt Push.")} variant="primary">
                  {t("settings.turn_on_device")}
                </Button>
              ) : (
                <>
                  <Button onClick={() => void run(async () => {
                    const r = await hubApi.pushTest();
                    if (r.sent === 0) throw new Error(r.errors[0] ?? "Nicht zugestellt.");
                  }, "Test gesendet — kommt er an?")}>
                    {t("settings.send_test")}
                  </Button>
                  <Button onClick={() => void run(unsubscribeThisDevice, "Push auf diesem Gerät aus.")}>
                    {t("settings.off_on_device")}
                  </Button>
                </>
              )}
            </div>
          )}
          <SettingRow label={t("settings.also_completed_turn")} hint="sonst nur Freigaben und Fehler">
            <Switch label={t("settings.also_when_done")} checked={prefs.done} onChange={(next) => save({ ...prefs, done: next })} />
          </SettingRow>
          <SettingRow label={t("settings.quiet_time")}>
            <span class="quiet-control">
              <Switch label={t("settings.quiet_time")} checked={prefs.quiet !== null} onChange={(next) => save({ ...prefs, quiet: next ? { from: 22 * 60, to: 7 * 60 } : null })} />
              {prefs.quiet && (
              <>
                <input type="time" aria-label={t("settings.quiet_from")} value={hhmm(prefs.quiet.from)} onInput={(e) => save({ ...prefs, quiet: { ...prefs.quiet!, from: minutes((e.target as HTMLInputElement).value) } })} />
                {t("settings.until")}
                <input type="time" aria-label={t("settings.quiet_until")} value={hhmm(prefs.quiet.to)} onInput={(e) => save({ ...prefs, quiet: { ...prefs.quiet!, to: minutes((e.target as HTMLInputElement).value) } })} />
              </>
              )}
            </span>
          </SettingRow>
          {mine.length > 0 && support === "ok" && (
            <Button onClick={() => void run(() => subscribeThisDevice(state.publicKey!), "Einstellungen übernommen.")}>
              {t("settings.apply_for_device")}
            </Button>
          )}
          {state.subscriptions.length > 0 && (
            <div class="push-devices">
              {state.subscriptions.map((s) => (
                <div key={s.id} class={`push-device ${s.gone ? "gone" : s.lastError ? "failed" : ""}`}>
                  <strong>{s.device ?? "Gerät"}</strong>
                  {s.mine ? " (dieses)" : ""} · {s.service}
                  <div class="dim">
                    {s.gone
                      ? s.lastError
                      : s.lastError
                        ? `Zustellung fehlgeschlagen ${when(s.lastErrorAt)}: ${s.lastError}`
                        : s.lastOkAt
                          ? `zuletzt zugestellt ${when(s.lastOkAt)}`
                          : "noch nichts gesendet"}
                    {s.quiet ? ` · Ruhe ${hhmm(s.quiet.from)}–${hhmm(s.quiet.to)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SettingsSection>
  );
}
