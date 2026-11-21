import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { hubApi, type FleetPeer } from "../../shared/api.ts";
import { InviteQr, QrScanner } from "./InviteQr.tsx";
import { pairLink, parsePairLink } from "./pair-link.ts";
import { SettingRow, SettingsSection } from "../settings/parts.tsx";
import { Button } from "../../shared/ui/index.ts";

/**
 * T6.2 / ADR-0017: pair this hub with others. On the other hub, create a
 * code; here, enter its address and the code. Tokens stay on the hubs.
 */
export function FleetSettings() {
  const [self, setSelf] = useState<string | null>(null);
  const [peers, setPeers] = useState<FleetPeer[] | null>(null);
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const reload = () =>
    hubApi
      .fleetPeers()
      .then(setPeers)
      .catch(() => setPeers([]));

  useEffect(() => {
    hubApi
      .fleetHello()
      .then((h) => setSelf(h.hostId))
      .catch(() => setSelf(null));
    void reload();
  }, []);

  const createInvite = async () => {
    try {
      setInvite(await hubApi.fleetInvite());
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Code fehlgeschlagen" });
    }
  };

  const addPeer = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const peer = await hubApi.fleetAddPeer(url.trim(), code.trim());
      setMessage({ ok: true, text: `Verbunden mit ${peer.hostId}.` });
      setUrl("");
      setCode("");
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Verbinden fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const onScan = (text: string) => {
    setScanning(false);
    const link = parsePairLink(text);
    if (!link) {
      setMessage({ ok: false, text: "Das ist kein AncientVoid-Einladungscode." });
      return;
    }
    setUrl(link.url);
    setCode(link.code);
    setMessage({ ok: true, text: `Einladung von ${link.url} gelesen — jetzt verbinden.` });
  };

  const removePeer = async (hostId: string) => {
    try {
      await hubApi.fleetRemovePeer(hostId);
      setConfirmRemove(null);
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Entfernen fehlgeschlagen" });
    }
  };

  return (
    <SettingsSection title={t("shell.fleet")} >
      <SettingRow label={t("fleet.this_hub")} hint="Name in der Flotte">
        <span class="mono dim" data-testid="fleet-self">{self ?? "…"}</span>
      </SettingRow>

      {peers && peers.length > 0 && (
        <div class="fleet-peers">
          {peers.map((p) => (
            <div key={p.hostId} class="setting-row" data-testid="fleet-peer">
              <span class="setting-label">
                <strong>{p.hostId}</strong> <span class="mono dim">{p.url}</span>
              </span>
              {confirmRemove === p.hostId ? (
                <span class="row setting-control" style="gap: 6px">
                  <Button onClick={() => void removePeer(p.hostId)} variant="danger">
                    {t("fleet.really_remove")}
                  </Button>
                  <Button onClick={() => setConfirmRemove(null)}>
                    {t("common.cancel")}
                  </Button>
                </span>
              ) : (
                <span class="setting-control">
                  <Button onClick={() => setConfirmRemove(p.hostId)}>
                    {t("fleet.remove")}
                  </Button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Button onClick={() => { setMessage(null); setScanning((v) => !v); }}>
        {scanning ? "Kamera schließen" : "QR-Code scannen"}
      </Button>
      {scanning && <QrScanner onResult={onScan} onClose={() => setScanning(false)} />}
      <label>
        {t("fleet.add_host")}
        <input value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder={t("fleet.tailnet_placeholder")} autocapitalize="off" autocorrect="off" spellcheck={false} />
      </label>
      <label>
        {t("fleet.code_from_other")}
        <input value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} placeholder={t("fleet.code_placeholder")} autocapitalize="characters" autocorrect="off" spellcheck={false} />
      </label>
      <Button disabled={busy || !url.trim() || !code.trim()} onClick={() => void addPeer()} variant="primary" class={busy ? "busy" : undefined}>
        {busy ? "lädt…" : "Host verbinden"}
      </Button>
      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"}>{message.text}</div>}

      <SettingRow label={t("fleet.connect_from_other")}>
        <Button onClick={() => void createInvite()}>
          {t("fleet.generate_code")}
        </Button>
      </SettingRow>
      {invite && (
        <div class="fleet-invite">
          <InviteQr text={pairLink(location.origin, invite.code)} />
          <code class="mono">{invite.code}</code>
          <span class="dim">
            {t("fleet.onetime_until")} {new Date(invite.expiresAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span class="dim fleet-invite-origin">
            {t("fleet.address_qr")} <span class="mono">{location.origin}</span>
            {/^https?:\/\/(localhost|127\.|\[::1\])/.test(location.origin) && " — nur auf diesem Rechner erreichbar; für den QR-Code den Hub über seine Tailnet-Adresse öffnen."}
          </span>
        </div>
      )}
    </SettingsSection>
  );
}
