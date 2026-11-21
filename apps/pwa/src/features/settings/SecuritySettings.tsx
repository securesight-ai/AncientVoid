import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { hubApi, getToken } from "../../shared/api.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

/** Gruppe „Sicherheit & Verbindung“: Passkey, Geräte-Token, Adresse, Projekte. */
export function SecuritySettings({ onSwitchToken }: { onSwitchToken: () => void }) {
  const [projectCount, setProjectCount] = useState<number | null>(null);
  // T2.5: null = unknown/loading, undefined = webauthn not configured on
  // this hub (501) — kept distinct from "false" (configured, not
  // registered yet) so the row can say the right thing in each case.
  const [passkey, setPasskey] = useState<boolean | null | undefined>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");

  useEffect(() => {
    let alive = true;
    hubApi
      .projects()
      .then((res) => {
        if (alive) setProjectCount(res.projects.length);
      })
      .catch(() => {
        if (alive) setProjectCount(null);
      });
    hubApi
      .webauthnStatus()
      .then((res) => alive && setPasskey(res.registered))
      .catch(() => alive && setPasskey(undefined));
    return () => {
      alive = false;
    };
  }, []);

  const registerPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyError("");
    try {
      const options = (await hubApi.webauthnRegisterOptions()) as PublicKeyCredentialCreationOptionsJSON;
      const attestation = await startRegistration({ optionsJSON: options });
      const result = await hubApi.webauthnRegisterVerify(attestation);
      setPasskey(result.ok);
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : "Passkey-Registrierung fehlgeschlagen");
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <SettingsSection title={t("settings.security_connection")}>
      <SettingRow label={t("settings.passkey")} hint="für destruktive Freigaben (T2.5)">
        {passkey === undefined ? (
          <span class="dim">{t("settings.not_configured")}</span>
        ) : passkey === true ? (
          <span class="dim">{t("settings.registered")}</span>
        ) : (
          <Button  aria-busy={passkeyBusy} onClick={registerPasskey} disabled={passkeyBusy} class={passkeyBusy ? "busy" : undefined}>
            {passkeyBusy ? "lädt…" : "Passkey registrieren"}
          </Button>
        )}
      </SettingRow>
      {passkeyError && <div class="reply-error">{passkeyError}</div>}
      <SettingRow label={t("settings.device_token")}>
        <span class="dim">{getToken() ? "•••• aktiv" : "kein Token"}</span>
        <Button onClick={onSwitchToken}>
          {t("settings.change_device_token")}
        </Button>
      </SettingRow>
      <SettingRow label={t("settings.reachable_via")}>
        <span class="mono dim">{location.host}</span>
      </SettingRow>
      <SettingRow label={t("settings.project_roots")}>
        <span class="dim">{projectCount === null ? "n/a" : `${projectCount} Projekte gefunden`}</span>
      </SettingRow>
    </SettingsSection>
  );
}
