import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { hubApi, type EndpointEntry, type EndpointKind, type VoidWardenConnection } from "../../shared/api.ts";
import { ago } from "../../shared/status.ts";
import { SettingsSection } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";
import { copyIntoShelf } from "../../shared/clipboard-copy.ts";

/**
 * Verbindungs-Registry (Optionen): VoidWarden-Instanzen und Modell-/Tool-
 * Endpoints. VoidWarden bekommt pro Eintrag ein eigenes read-only-Token,
 * einmalig sichtbar — der Status ist die letzte Meldung dieses Tokens am Hub.
 * Endpoint-Schlüssel sind write-only: der Hub speichert nur den Hash und sagt
 * nur, ob einer gesetzt ist. Der Prüf-Knopf fragt Erreichbarkeit ohne Schlüssel
 * ab (jede HTTP-Antwort zählt, auch 401/403).
 */

const KIND_LABEL: Record<EndpointKind, string> = { llm: t("settings.llm"), image: t("settings.image_recognition"), video: t("settings.video_recognition"), other: t("notifications.section_rest") };

function vwStatus(c: VoidWardenConnection): { text: string; ok: boolean } {
  if (!c.lastSeenAt) return { text: "noch nie gemeldet", ok: false };
  return { text: `gemeldet ${ago(c.lastSeenAt)}`, ok: true };
}

function endpointStatus(e: EndpointEntry): { text: string; ok: boolean | null } {
  if (!e.probe) return { text: "nie geprüft", ok: null };
  if (e.probe.ok) return { text: `erreichbar (HTTP ${e.probe.httpStatus}) · ${ago(e.probe.at)}`, ok: true };
  return { text: `nicht erreichbar${e.probe.detail ? ` · ${e.probe.detail}` : ""}`, ok: false };
}

export function ConnectionsSettings() {
  const [voidwarden, setVoidwarden] = useState<VoidWardenConnection[] | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointEntry[] | null>(null);
  /** EPIC-P73 (ADR-0094): GitHub-Token-Status (write-only) + Eingabe. */
  const [forgeGithub, setForgeGithub] = useState<{ tokenFile: string | null; present: boolean } | null>(null);
  const [ghToken, setGhToken] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Einmalig sichtbares Token nach Anlegen/Erneuern — nach dem Verlassen weg. */
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);

  // VoidWarden-Formular
  const [vwEdit, setVwEdit] = useState<VoidWardenConnection | null>(null);
  const [vwName, setVwName] = useState("");
  const [vwEndpoint, setVwEndpoint] = useState("");
  const [vwRotate, setVwRotate] = useState(false);

  // Endpoint-Formular
  const [epEdit, setEpEdit] = useState<EndpointEntry | null>(null);
  const [epName, setEpName] = useState("");
  const [epKind, setEpKind] = useState<EndpointKind>("llm");
  const [epUrl, setEpUrl] = useState("");
  const [epKey, setEpKey] = useState("");
  const [epDropKey, setEpDropKey] = useState(false);
  const [epModels, setEpModels] = useState("");

  const reload = () =>
    hubApi
      .connections()
      .then((c) => {
        setVoidwarden(c.voidwarden);
        setEndpoints(c.endpoints);
        setForgeGithub(c.forge?.github ?? null);
      })
      .catch(() => {
        setVoidwarden(null);
        setEndpoints(null);
      });

  useEffect(() => {
    void reload();
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const copyToken = (token: string) => {
    // ADR-0090: ein Token ist kein Ablage-Stoff — die Zwischenablage ja, die Ablage nein.
    void copyIntoShelf(token, "text", { secret: true }).then((ok) =>
      setMessage(ok ? { ok: true, text: "Token kopiert." } : { ok: false, text: "Kopieren nicht erlaubt — bitte von Hand markieren." }),
    );
  };

  const saveVoidWarden = () =>
    run(async () => {
      const body = { name: vwName.trim(), ...(vwEndpoint.trim() ? { endpoint: vwEndpoint.trim() } : {}), ...(vwEdit && vwRotate ? { rotate: true } : {}) };
      const res = vwEdit ? await hubApi.updateVoidWarden(vwEdit.id, body) : await hubApi.addVoidWarden(body);
      if (res.token) setIssued({ name: res.connection.name, token: res.token });
      setMessage({ ok: true, text: vwEdit ? "Verbindung gespeichert." : "Verbindung angelegt." });
      setVwEdit(null);
      setVwName("");
      setVwEndpoint("");
      setVwRotate(false);
      await reload();
    });

  const editVoidWarden = (c: VoidWardenConnection) => {
    setIssued(null);
    setVwEdit(c);
    setVwName(c.name);
    setVwEndpoint(c.endpoint ?? "");
    setVwRotate(false);
  };

  const saveEndpoint = () =>
    run(async () => {
      const models = epModels.split(",").map((m) => m.trim()).filter((m) => m.length > 0);
      const key: { apiKey?: string | null } = epDropKey ? { apiKey: null } : epKey.trim() ? { apiKey: epKey.trim() } : {};
      const body = { name: epName.trim(), kind: epKind, baseUrl: epUrl.trim(), models, ...key };
      await (epEdit ? hubApi.updateEndpoint(epEdit.id, body) : hubApi.addEndpoint(body));
      setMessage({ ok: true, text: epEdit ? "Endpoint gespeichert." : "Endpoint angelegt." });
      setEpEdit(null);
      setEpName("");
      setEpKind("llm");
      setEpUrl("");
      setEpKey("");
      setEpDropKey(false);
      setEpModels("");
      await reload();
    });

  const editEndpoint = (e: EndpointEntry) => {
    setIssued(null);
    setEpEdit(e);
    setEpName(e.name);
    setEpKind(e.kind);
    setEpUrl(e.baseUrl);
    setEpKey("");
    setEpDropKey(false);
    setEpModels(e.models.join(", "));
  };

  const probe = (e: EndpointEntry) =>
    run(async () => {
      const res = await hubApi.probeEndpoint(e.id);
      setEndpoints((prev) => (prev ? prev.map((x) => (x.id === e.id ? res.endpoint : x)) : prev));
      setMessage(res.endpoint.probe?.ok ? { ok: true, text: `„${e.name}“ antwortet (HTTP ${res.endpoint.probe.httpStatus}).` } : { ok: false, text: `„${e.name}“ nicht erreichbar.` });
    });

  const saveGitHubToken = () =>
    run(async () => {
      const res = await hubApi.connectionSetGitHubToken(ghToken);
      setGhToken("");
      setMessage({ ok: true, text: `GitHub-Token gespeichert (${res.tokenFile}) — die Issue-Bridge übernimmt ihn mit dem nächsten Poll.` });
      await reload();
    });

  return (
    <SettingsSection title={t("settings.connections")} testid="connections-settings">
      <div class="dim settings-intro">{t("settings.voidwarden_note")}</div>

      <div class="connection-group" role="group" aria-label={t("settings.voidwarden")}>
        <strong class="connection-group-title">{t("settings.voidwarden")}</strong>
        {(voidwarden ?? []).map((c) => {
          const st = vwStatus(c);
          return (
            <div key={c.id} class="connection-entry">
              <div class="connection-entry-head">
                <span class="connection-name">{c.name}</span>
                <span class={st.ok ? "connection-status ok" : "connection-status dim"}>{st.text}</span>
              </div>
              {c.endpoint && <div class="mono dim connection-url">{c.endpoint}</div>}
              <div class="row connection-actions">
                <Button disabled={busy} onClick={() => editVoidWarden(c)}>
                  {t("settings.edit")}
                </Button>
                <Button disabled={busy} aria-label={`${c.name} löschen`} onClick={() => void run(async () => (await hubApi.removeVoidWarden(c.id), setMessage({ ok: true, text: "Verbindung gelöscht, Token zurückgezogen." }), reload()))} variant="danger">
                  {t("common.delete")}
                </Button>
              </div>
            </div>
          );
        })}
        {voidwarden !== null && voidwarden.length === 0 && <div class="dim">{t("settings.no_instance")}</div>}

        <label>
          {t("composer.name")}
          <input value={vwName} onInput={(e) => setVwName((e.target as HTMLInputElement).value)} placeholder={t("settings.nyx_board")} />
        </label>
        <label>
          {t("settings.endpoint_optional")}
          <input value={vwEndpoint} onInput={(e) => setVwEndpoint((e.target as HTMLInputElement).value)} placeholder={t("settings.pixel_url")} inputMode="url" autocapitalize="off" spellcheck={false} />
        </label>
        {vwEdit && (
          <label class="row" style="gap: 8px">
            <input type="checkbox" checked={vwRotate} onChange={(e) => setVwRotate((e.target as HTMLInputElement).checked)} />
            {t("settings.replace_token")}
          </label>
        )}
        <div class="row" style="gap: 8px">
          <Button disabled={busy || !vwName.trim()} onClick={() => void saveVoidWarden()} variant="primary">
            {vwEdit ? "Ändern" : "Verbindung anlegen"}
          </Button>
          {vwEdit && (
            <Button onClick={() => (setVwEdit(null), setVwName(""), setVwEndpoint(""), setVwRotate(false))}>
              {t("common.cancel")}
            </Button>
          )}
        </div>

        {issued && (
          <div class="connection-token">
            <div class="connection-token-title">{t("settings.token_for")}{issued.name}{t("settings.once_shown")}</div>
            <div class="mono connection-token-value">{issued.token}</div>
            <div class="dim">{t("settings.copy_to_voidwarden")}</div>
            <Button onClick={() => copyToken(issued.token)}>
              {t("session.copy")}
            </Button>
          </div>
        )}
      </div>

      <div class="connection-group" role="group" aria-label={t("settings.model_tool_endpoints")}>
        <strong class="connection-group-title">{t("settings.model_tool")}</strong>
        {(endpoints ?? []).map((e) => {
          const st = endpointStatus(e);
          return (
            <div key={e.id} class="connection-entry">
              <div class="connection-entry-head">
                <span class="connection-name">
                  {e.name} <span class="dim">· {KIND_LABEL[e.kind]}</span>
                </span>
                <span class={st.ok === null ? "connection-status dim" : st.ok ? "connection-status ok" : "connection-status err"}>{st.text}</span>
              </div>
              <div class="mono dim connection-url">{e.baseUrl}</div>
              <div class="dim connection-models">
                {e.models.length > 0 ? e.models.join(", ") : "keine Modelle aktiviert"}
                {e.hasKey ? " · Schlüssel hinterlegt ✓" : ""}
              </div>
              <div class="row connection-actions">
                <Button disabled={busy} onClick={() => void probe(e)}>
                  {t("settings.check")}
                </Button>
                <Button disabled={busy} onClick={() => editEndpoint(e)}>
                  {t("settings.edit")}
                </Button>
                <Button disabled={busy} aria-label={`${e.name} löschen`} onClick={() => void run(async () => (await hubApi.removeEndpoint(e.id), setMessage({ ok: true, text: "Endpoint gelöscht." }), reload()))} variant="danger">
                  {t("common.delete")}
                </Button>
              </div>
            </div>
          );
        })}
        {endpoints !== null && endpoints.length === 0 && <div class="dim">{t("settings.no_endpoint")}</div>}

        <label>
          {t("composer.name")}
          <input value={epName} onInput={(e) => setEpName((e.target as HTMLInputElement).value)} placeholder={t("settings.gpubox")} />
        </label>
        <label>
          {t("settings.type")}
          <select value={epKind} onChange={(e) => setEpKind((e.target as HTMLSelectElement).value as EndpointKind)}>
            <option value="llm">{t("settings.llm")}</option>
            <option value="image">{t("settings.image_recognition")}</option>
            <option value="video">{t("settings.video_recognition")}</option>
            <option value="other">{t("notifications.section_rest")}</option>
          </select>
        </label>
        <label>
          {t("settings.endpoint_url2")}
          <input value={epUrl} onInput={(e) => setEpUrl((e.target as HTMLInputElement).value)} placeholder={t("settings.endpoint_url")} inputMode="url" autocapitalize="off" spellcheck={false} />
        </label>
        <label>
          {t("settings.api_key")} {epEdit ? "(leer lassen = unverändert)" : "(optional)"}
          <input type="password" value={epKey} onInput={(e) => setEpKey((e.target as HTMLInputElement).value)} placeholder={epEdit?.hasKey ? "neuen Key eingeben, um ihn zu ersetzen" : "sk-…"} autocomplete="off" />
        </label>
        {epEdit?.hasKey && (
          <label class="row" style="gap: 8px">
            <input type="checkbox" checked={epDropKey} onChange={(e) => setEpDropKey((e.target as HTMLInputElement).checked)} />
            {t("settings.remove_key")}
          </label>
        )}
        <label>
          {t("settings.enabled_models")}
          <input value={epModels} onInput={(e) => setEpModels((e.target as HTMLInputElement).value)} placeholder={t("settings.halogen_models")} autocapitalize="off" autocorrect="off" spellcheck={false} />
        </label>
        <div class="row" style="gap: 8px">
          <Button disabled={busy || !epName.trim() || !epUrl.trim()} onClick={() => void saveEndpoint()} variant="primary">
            {epEdit ? "Ändern" : "Endpoint anlegen"}
          </Button>
          {epEdit && (
            <Button onClick={() => (setEpEdit(null), setEpName(""), setEpKind("llm"), setEpUrl(""), setEpKey(""), setEpDropKey(false), setEpModels(""))}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
        <div class="dim settings-intro">{t("settings.key_hash")}</div>
      </div>

      <div class="connection-group" role="group" aria-label={t("settings.forge_github_token")}>
        <strong class="connection-group-title">{t("settings.forge_github")}</strong>
        <div class="connection-entry">
          <div class="connection-entry-head">
            <span class="connection-name">{t("settings.issue_bridge")}</span>
            <span class={forgeGithub?.present ? "connection-status ok" : "connection-status dim"} data-testid="forge-github-status">
              {forgeGithub === null ? "nicht konfiguriert" : forgeGithub.present ? "Token hinterlegt ✓" : "kein Token"}
            </span>
          </div>
          {forgeGithub?.tokenFile && <div class="mono dim connection-url">{forgeGithub.tokenFile}</div>}
          {forgeGithub === null && <div class="dim">{t("settings.tokenfile_missing")}</div>}
        </div>
        {forgeGithub !== null && (
          <>
            <label>
              {t("settings.token_github")}
              <input type="password" value={ghToken} onInput={(e) => setGhToken((e.target as HTMLInputElement).value)} placeholder={t("settings.github_pat")} autocapitalize="off" spellcheck={false} autocomplete="off" data-testid="forge-github-token-input" />
            </label>
            <div class="row" style="gap: 8px">
              <Button disabled={busy || ghToken.trim().length < 10} onClick={() => void saveGitHubToken()} variant="primary" data-testid="forge-github-save">
                {t("settings.save_token")}
              </Button>
            </div>
            <div class="dim settings-intro">{t("settings.write_only")}</div>
          </>
        )}
      </div>

      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"}>{message.text}</div>}
    </SettingsSection>
  );
}
