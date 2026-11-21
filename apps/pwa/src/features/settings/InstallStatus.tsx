import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { deviceStatusLines, gatherDeviceStatus } from "../../shared/device-status.ts";
import { sendOrientationReport } from "../../shared/device-report.ts";
import { lockOrientation, type OrientationTarget } from "../../shared/orientation-lock.ts";
import { SettingRow } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

/**
 * BUG-0186: der installierte Stand ist auf dem Handy ablesbar. Wer dreht und es dreht
 * sich nichts, sieht hier in vier Zeilen, ob die App installiert läuft, welche
 * Ausrichtung ihr Fenster hat, was ihr Manifest sagt und ob ein Service Worker das
 * Manifest festhält. Der Knopf prüft nach „Worker aktualisiert“ oder nach dem
 * Neuanlegen des Startsymbols erneut.
 */
export function InstallStatus() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [check, setCheck] = useState(0);
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  async function orient(target: OrientationTarget) {
    const res = await lockOrientation(target);
    setLockMsg(res.detail);
    await new Promise((r) => setTimeout(r, 300)); // die Ausrichtungs-Abfrage braucht einen Moment
    try {
      const status = await gatherDeviceStatus();
      setLines(deviceStatusLines(status));
      // BUG-0186: derselbe Stand geht an den Hub — die Ursache steht dort im Protokoll,
      // statt dass sie auf dem Handy abgelesen werden muss. Warten tut darauf niemand.
      void sendOrientationReport(res.how, res.detail, status);
    } catch {
      /* die vorigen Zeilen bleiben stehen */
    }
  }

  useEffect(() => {
    let alive = true;
    const run = () =>
      gatherDeviceStatus()
        .then((status) => {
          if (!alive) return;
          setLines(deviceStatusLines(status));
          // "Stand neu pruefen" ist damit auch der eine Knopf fuer die Ferndiagnose: der
          // Winkelbericht geht mit, ohne dass jemand etwas ablesen oder eintippen muss.
          void sendOrientationReport("nicht-versucht", "Stand neu geprueft", status);
        })
        .catch(() => alive && setLines(["Stand nicht lesbar"]));
    run();
    // Nach einem Worker-Wechsel (BUG-0186: alte Stufe hatte das Manifest einbetoniert)
    // liest sich der Stand von selbst neu — sonst stünde dort eine alte Antwort.
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    sw?.addEventListener?.("controllerchange", run);
    return () => {
      alive = false;
      sw?.removeEventListener?.("controllerchange", run);
    };
  }, [check]);
  return (
    <SettingRow label={t("settings.installed_state")} hint="Anzeigemodus, Ausrichtung, Manifest und die Worker-Stufe dahinter">
      <div class="install-status" data-testid="install-status">
        {lines === null ? (
          <span class="dim">{t("settings.checked")}</span>
        ) : (
          lines.map((line) => (
            <div class="install-status__line dim" key={line}>
              {line}
            </div>
          ))
        )}
        <Button data-testid="install-status-refresh" onClick={() => setCheck((n) => n + 1)}>
          {t("settings.recheck")}
        </Button>
        <span class="settings-row-actions">
          <Button data-testid="install-orient-landscape" onClick={() => void orient("landscape")} class="small">
            {t("settings.force_landscape")}
          </Button>
          <Button data-testid="install-orient-auto" onClick={() => void orient("any")} class="small">
            {t("settings.automatic_again")}
          </Button>
        </span>
        {lockMsg !== null && (
          <div class="install-status__line" data-testid="install-orient-result">
            {lockMsg}
          </div>
        )}
      </div>
    </SettingRow>
  );
}
