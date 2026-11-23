import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { InferenceModelStatus } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

/**
 * BUG-0258: manuelle Anbindung des Inferenz-Modells (OpenAI-kompatibel, z. B.
 * Halogen auf evo-local). Runtime änderbar über den SettingsStore — URL und
 * Modell openly im Config, der Schlüssel nur als **Dateireferenz** (ADR-0011):
 * nie einen Token ins Formular, nur den Pfad zur Schlüsseldatei.
 */
export function InferenceSettings() {
  const [status, setStatus] = useState<InferenceModelStatus | null>(null);
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKeyFile, setApiKeyFile] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = () => void hubApi.inferenceModelStatus().then((s) => {
    setStatus(s);
    setUrl(s.url ?? "");
    setModel(s.model ?? "");
  }).catch(() => setStatus(null));

  useEffect(reload, []);

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      await hubApi.inferenceModelSet({
        url: url.trim() || null,
        model: model.trim() || null,
        ...(apiKeyFile.trim() ? { apiKeyFile: apiKeyFile.trim() } : {}),
      });
      reload();
      setNote(t("inference.settings.saved"));
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("inference.settings.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title={t("inference.settings.title")} testid="settings-inference">
      <SettingRow label={t("inference.settings.url")} hint={status?.url ?? t("inference.settings.unbound")}>
        <input data-testid="inference-url" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder={t("inference.settings.url_placeholder")} />
      </SettingRow>
      <SettingRow label={t("inference.settings.model")} hint={status?.model ?? "—"}>
        <input data-testid="inference-model" value={model} onInput={(e) => setModel((e.target as HTMLInputElement).value)} placeholder={t("inference.settings.model_placeholder")} />
      </SettingRow>
      <SettingRow label={t("inference.settings.keyfile")}>
        <input data-testid="inference-keyfile" value={apiKeyFile} onInput={(e) => setApiKeyFile((e.target as HTMLInputElement).value)} placeholder={t("inference.settings.keyfile_placeholder")} />
      </SettingRow>
      {status?.probe && (
        <p role="status" data-testid="inference-probe" class={status.probe.ok ? "ok" : "err"}>
          {status.probe.ok ? t("inference.settings.probe_ok", { model: status.model ?? "" }) : t("inference.settings.probe_fail", { detail: status.probe.detail ?? "" })}
        </p>
      )}
      {note && <p role="status">{note}</p>}
      <Button onClick={save} disabled={saving} data-testid="inference-save">{t("inference.settings.save")}</Button>
    </SettingsSection>
  );
}
