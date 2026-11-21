import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { hubApi, type SessionRecord } from "../../shared/api.ts";
import { armFirstRun, dismissFirstSignal, FIRST_APPROVAL_EVENT, firstSignalPending } from "../../shared/first-run.ts";
import { Button, Card } from "../../shared/ui/index.ts";

/**
 * EPIC-P57 T57.9 (AC-P57-7): der Leerzustand eines frischen Hubs ist die Onboarding-Fläche — eine kurze Anweisung,
 * eine Probe-Session mit dem Testadapter (kein Provider nötig) und der Verweis aufs Tutorial. Keine Tour, kein Overlay.
 * Der Fortschritt ist Gerätezustand (first-run.ts), nie Hub-Wahrheit.
 */
export function StartGuide({ probeAvailable, onOpen }: { probeAvailable: boolean; onOpen: (session: SessionRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Erst wer den Einstieg gesehen hat, bekommt später das Erfolgssignal.
  useEffect(armFirstRun, []);

  const startProbe = async () => {
    setBusy(true);
    setError("");
    try {
      const { projects } = await hubApi.projects();
      const project = projects[0]?.path;
      if (!project) {
        setError(t("startguide.no_project"));
        return;
      }
      onOpen(await hubApi.createSession({ adapter: "dummy", project }));
    } catch (err) {
      setError(err instanceof Error ? t("startguide.probe_failed_detail", { "message": err.message }) : t("startguide.probe_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-label={t("common.first_steps")}>
      <h2 style="margin: 0">{t("common.no_sessions_yet")}</h2>
      <p style="margin: 0">
        {probeAvailable
          ? t("startguide.step_probe")
          : t("startguide.step_create")}
      </p>
      {probeAvailable && (
        <Button  aria-busy={busy} disabled={busy} onClick={() => void startProbe()} variant="primary" class={busy ? "busy" : undefined}>
          {t("common.probe_session")}
        </Button>
      )}
      {error && (
        <div class="reply-error" role="alert">
          {error}
        </div>
      )}
      <p class="dim" style="margin: 0">
        {t("common.full_guide")} <code>{t("startguide.guide_file")}</code> {t("common.in_repo")}
      </p>
    </Card>
  );
}

/** Einmaliges, schließbares Erfolgssignal nach der ersten entschiedenen Freigabe dieses Geräts. */
export function FirstSuccessSignal() {
  const [shown, setShown] = useState(firstSignalPending);
  useEffect(() => {
    const on = () => setShown(firstSignalPending());
    document.addEventListener(FIRST_APPROVAL_EVENT, on);
    return () => document.removeEventListener(FIRST_APPROVAL_EVENT, on);
  }, []);
  if (!shown) return null;
  return (
    <Card role="status">
      <span>{t("common.decided")}</span>{" "}
      <button
        type="button"
        class="link-btn"
        onClick={() => {
          dismissFirstSignal();
          setShown(false);
        }}
      >
        {t("common.close")}
      </button>
    </Card>
  );
}
