import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { KnowledgeAuthKind, KnowledgeSourceView, KnowledgeStatus } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { vaultKnowledgeHash } from "../../app/route.ts";
import { ago } from "../../shared/status.ts";
import { Button } from "../../shared/ui/index.ts";
import { SettingsSection } from "../settings/parts.tsx";

/**
 * EPIC-P74 T74.6a (ADR-0096): Wissensquellen anbinden — z. B. die
 * Librarian-Fassade auf dem HiveMind-Server, aber jeder MCP-Knowledge-Server
 * nach EPIC-P74 §3.3.1 geht. Das Geheimnis ist write-only; der Status jeder
 * Quelle steht sichtbar daneben (Fail loud). Treffer und Dokumente sind
 * fremder Text: hier nur angezeigt, nie als Anweisung weitergegeben (PRD §8.5).
 */

const STATE_LABEL: Record<KnowledgeStatus["state"], string> = {
  unknown: "nie geprüft",
  ok: "erreichbar",
  unreachable: "nicht erreichbar",
  unauthorized: "Zugang abgelehnt",
  protocol: "Protokollfehler",
  "tool-error": "Fehler der Quelle",
};

export function statusText(s: KnowledgeStatus): { text: string; ok: boolean | null } {
  if (s.state === "unknown") return { text: STATE_LABEL.unknown, ok: null };
  const parts = [STATE_LABEL[s.state], s.detail, s.failures > 1 ? `${s.failures}× in Folge` : null, s.at ? ago(s.at) : null].filter(Boolean);
  return { text: parts.join(" · "), ok: s.state === "ok" };
}

export function KnowledgeSettings() {
  const [sources, setSources] = useState<KnowledgeSourceView[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState<KnowledgeSourceView | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [authKind, setAuthKind] = useState<KnowledgeAuthKind>("bearer");
  const [header, setHeader] = useState("");
  const [secret, setSecret] = useState("");
  const [dropSecret, setDropSecret] = useState(false);


  const reload = () =>
    hubApi
      .knowledgeSources()
      .then((r) => setSources(r.sources))
      .catch(() => setSources(null));

  useEffect(() => {
    void reload();
  }, []);

  /** Jeder Fehlschlag zeigt die Meldung — der neue Status der Quelle kommt mit dem Neuladen. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "fehlgeschlagen" });
    } finally {
      setBusy(false);
      void reload();
    }
  };

  const resetForm = () => (setEdit(null), setLabel(""), setUrl(""), setAuthKind("bearer"), setHeader(""), setSecret(""), setDropSecret(false));

  const startEdit = (s: KnowledgeSourceView) => {
    setEdit(s);
    setLabel(s.label);
    setUrl(s.url);
    setAuthKind(s.auth.kind);
    setHeader(s.auth.header ?? "");
    setSecret("");
    setDropSecret(false);
  };

  const save = () =>
    run(async () => {
      const body = {
        label: label.trim(),
        url: url.trim(),
        auth: authKind === "header" ? { kind: authKind, header: header.trim() } : { kind: authKind },
        ...(dropSecret ? { secret: null } : secret.trim() ? { secret: secret.trim() } : {}),
        ...(edit ? { tools: edit.tools } : {}),
      };
      if (edit) await hubApi.updateKnowledgeSource(edit.id, body);
      else await hubApi.addKnowledgeSource(body);
      setMessage({ ok: true, text: edit ? "Quelle geändert." : "Quelle angelegt — jetzt „Prüfen“." });
      resetForm();
    });

  const probe = (s: KnowledgeSourceView) =>
    run(async () => {
      const r = await hubApi.probeKnowledgeSource(s.id);
      setMessage({ ok: true, text: `${s.label}: ${r.overview.summary}` });
    });



  return (
    <SettingsSection title={t("knowledge.knowledge_sources")} testid="knowledge-settings">
      <div class="dim settings-intro">{t("knowledge.mcp_attach")}</div>

      <div class="connection-group" role="group" aria-label={t("knowledge.attached_sources")}>
        {(sources ?? []).map((s) => {
          const st = statusText(s.status);
          return (
            <div key={s.id} class="connection-entry" data-testid="knowledge-source">
              <div class="connection-entry-head">
                <span class="connection-name">{s.label}</span>
                <span class={`connection-status knowledge-status ${st.ok === null ? "dim" : st.ok ? "ok" : "err"}`} data-testid="knowledge-status">
                  {st.text}
                </span>
              </div>
              <div class="mono dim connection-url">{s.url}</div>
              <div class="dim connection-models">
                {t("knowledge.auth")} {s.auth.kind === "header" ? `Header ${s.auth.header}` : s.auth.kind === "bearer" ? "Bearer" : "keine"}
                {s.hasSecret ? " · Geheimnis hinterlegt ✓" : ""}
              </div>
              <div class="row connection-actions">
                <Button disabled={busy} onClick={() => void probe(s)}>
                  {t("knowledge.check")}
                </Button>
                <Button disabled={busy} onClick={() => startEdit(s)}>
                  {t("knowledge.edit")}
                </Button>
                <Button disabled={busy} aria-label={`${s.label} löschen`} variant="danger" onClick={() => void run(async () => (await hubApi.removeKnowledgeSource(s.id), setMessage({ ok: true, text: "Quelle gelöscht." })))}>
                  {t("common.delete")}
                </Button>
              </div>
            </div>
          );
        })}
        {sources !== null && sources.length === 0 && <div class="dim">{t("knowledge.no_source")}</div>}

        <label>
          {t("composer.name")}
          <input value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder={t("knowledge.librarian")} data-testid="knowledge-label" />
        </label>
        <label>
          {t("knowledge.mcp_address")}
          <input value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder={t("knowledge.mcp_placeholder")} inputMode="url" autocapitalize="off" spellcheck={false} data-testid="knowledge-url" />
        </label>
        <label>
          {t("knowledge.signin")}
          <select value={authKind} onChange={(e) => setAuthKind((e.target as HTMLSelectElement).value as KnowledgeAuthKind)} data-testid="knowledge-auth">
            <option value="bearer">{t("knowledge.bearer_token")}</option>
            <option value="header">{t("knowledge.own_header")}</option>
            <option value="none">{t("knowledge.none")}</option>
          </select>
        </label>
        {authKind === "header" && (
          <label>
            {t("knowledge.header_name")}
            <input value={header} onInput={(e) => setHeader((e.target as HTMLInputElement).value)} placeholder={t("knowledge.x_api_key")} autocapitalize="off" spellcheck={false} />
          </label>
        )}
        {authKind !== "none" && (
          <label>
            {t("knowledge.token")} {edit ? "(leer lassen = unverändert)" : ""}
            <input type="password" value={secret} onInput={(e) => setSecret((e.target as HTMLInputElement).value)} placeholder={edit?.hasSecret ? "neues Token eingeben, um es zu ersetzen" : ""} autocomplete="off" data-testid="knowledge-secret" />
          </label>
        )}
        {edit?.hasSecret && authKind !== "none" && (
          <label class="row" style="gap: 8px">
            <input type="checkbox" checked={dropSecret} onChange={(e) => setDropSecret((e.target as HTMLInputElement).checked)} />
            {t("knowledge.remove_token")}
          </label>
        )}
        <div class="row" style="gap: 8px">
          <Button disabled={busy || !label.trim() || !url.trim() || (authKind === "header" && !header.trim())} onClick={() => void save()} variant="primary" data-testid="knowledge-save">
            {edit ? "Ändern" : "Quelle anbinden"}
          </Button>
          {edit && <Button onClick={resetForm}>{t("common.cancel")}</Button>}
        </div>
        <div class="dim settings-intro">{t("knowledge.token_stays")}</div>
      </div>

      {(sources ?? []).length > 0 && (
        <div class="row" style="gap: 8px">
          <Button onClick={() => (location.hash = vaultKnowledgeHash())} variant="primary">
            {t("knowledge.use_in_notes")}
          </Button>
        </div>
      )}

      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"}>{message.text}</div>}
    </SettingsSection>
  );
}
