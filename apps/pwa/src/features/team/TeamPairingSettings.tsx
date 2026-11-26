import { useEffect, useState } from "preact/hooks";
import { hubApi, type TeamPairingStatus, type TeamPeerPin } from "../../shared/api.ts";
import { SettingRow, SettingsSection } from "../settings/parts.tsx";
import { Button } from "../../shared/ui/index.ts";
import { t } from "../../shared/i18n/index.ts";

/**
 * EPIC-P83 T83.3 (V6, ADR-0118 §7): Team-Kopplung in den Einstellungen —
 * Einladung erzeugen / beitreten, Codes vorlesen und tippen. Passkey folgt;
 * bis dahin reicht die Bestätigung per Knopf (wie hubctl team confirm).
 */
export function TeamPairingSettings() {
  const [status, setStatus] = useState<TeamPairingStatus | null>(null);
  const [pins, setPins] = useState<TeamPeerPin[]>([]);
  const [inviteIn, setInviteIn] = useState("");
  const [codeIn, setCodeIn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [available, setAvailable] = useState(true);

  const reload = async () => {
    try {
      const [s, p] = await Promise.all([hubApi.teamPairingStatus(), hubApi.teamPins()]);
      setStatus(s);
      setPins(p);
      setAvailable(s.configured !== false);
    } catch {
      setStatus(null);
      setAvailable(false);
    }
  };

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 2_000);
    return () => clearInterval(id);
  }, []);

  const invite = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const opened = await hubApi.teamInvite("Team");
      setMessage({ ok: true, text: t("team.invite_created") });
      setStatus(await hubApi.teamPairingStatus());
      void opened;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("team.invite_failed") });
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await hubApi.teamJoin(inviteIn.trim(), "Mein Hub");
      setMessage({ ok: true, text: t("team.joined") });
      setInviteIn("");
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("team.join_failed") });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Einladende Seite hat inviteText; Beitretende nicht.
      if (status?.inviteText) await hubApi.teamConfirmCodeB(codeIn.trim());
      else await hubApi.teamConfirmCodeA(codeIn.trim());
      setCodeIn("");
      setMessage({ ok: true, text: t("team.code_ok") });
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("team.code_failed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title={t("team.pairing_title")}>
      {!available && <p class="dim" data-testid="team-pairing-off">{t("team.listen_off")}</p>}
      {available && (
        <>
          <SettingRow label={t("team.state")} hint={status?.teamId || undefined}>
            <span class="mono" data-testid="team-pairing-state">{status?.state ?? "…"}</span>
          </SettingRow>
          {status?.codeA && (
            <SettingRow label={t("team.read_aloud")} hint={t("team.read_aloud_hint")}>
              <code class="mono" data-testid="team-pairing-code">{status.codeA}</code>
            </SettingRow>
          )}
          {status?.inviteText && (
            <SettingRow label={t("team.invite_text")} hint={t("team.invite_hint")}>
              <textarea class="mono" readOnly rows={3} value={status.inviteText} data-testid="team-invite-text" />
            </SettingRow>
          )}
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <Button disabled={busy || status?.state === "waiting" || status?.state === "joined"} onClick={() => void invite()} variant="primary" data-testid="team-invite-btn">
              {t("team.create_invite")}
            </Button>
          </div>
          <SettingRow label={t("team.join_invite")}>
            <input value={inviteIn} onInput={(e) => setInviteIn(e.currentTarget.value)} placeholder="avteam1.…" data-testid="team-join-input" />
            <Button disabled={busy || !inviteIn.trim()} onClick={() => void join()} data-testid="team-join-btn">{t("team.join")}</Button>
          </SettingRow>
          <SettingRow label={t("team.type_code")} hint={t("team.type_code_hint")}>
            <input value={codeIn} onInput={(e) => setCodeIn(e.currentTarget.value)} inputMode="numeric" maxLength={8} placeholder="12345678" data-testid="team-code-input" />
            <Button disabled={busy || !/^\d{8}$/.test(codeIn.trim())} onClick={() => void confirm()} data-testid="team-confirm-btn">{t("team.confirm")}</Button>
          </SettingRow>
          {pins.length > 0 && (
            <div class="fleet-peers" data-testid="team-pins">
              {pins.map((p) => (
                <div key={p.instanceId} class="setting-row">
                  <span class="setting-label">
                    <strong class="mono">{p.instanceId.slice(0, 12)}…</strong>{" "}
                    <span class="dim">{p.state}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"} data-testid="team-pairing-msg">{message.text}</div>}
    </SettingsSection>
  );
}
