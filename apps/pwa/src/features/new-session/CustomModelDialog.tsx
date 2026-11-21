import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { CustomModel, PiProviderBody } from "../../shared/api.ts";
import { Sheet, Button } from "../../shared/ui/index.ts";

type Api = {
  customModels: () => Promise<{ items: CustomModel[] }>;
  addCustomModel: (body: { id: string; label?: string; adapters: string[] }) => Promise<unknown>;
  removeCustomModel: (id: string) => Promise<unknown>;
  addPiProvider: (adapterId: string, body: PiProviderBody) => Promise<{ created: boolean }>;
};

/**
 * ADR-0060: eigene Modelle und Endpunkte, direkt am Modell-Dropdown. „Modell“ trägt eine Id ins
 * Hub-Register ein (der Harness bekommt sie unverändert als --model); „Endpunkt“ (nur pi) schreibt
 * einen Provider in pi's models.json — der Schlüssel steht als $UMGEBUNGSVARIABLE, nie im Klartext
 * im Hub.
 */
export function CustomModelDialog({ adapter, canEndpoint, api, onClose, onChanged }: { adapter: string; canEndpoint: boolean; api: Api; onClose: () => void; onChanged: (pick?: string) => void }) {
  const [tab, setTab] = useState<"model" | "endpoint">("model");
  const [items, setItems] = useState<CustomModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Modell
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  // Endpunkt
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKind, setApiKind] = useState<PiProviderBody["api"]>("openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [context, setContext] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const [replace, setReplace] = useState(false);

  const reload = () => api.customModels().then((r) => setItems(r.items)).catch(() => undefined);
  useEffect(() => void reload(), []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const saveModel = () =>
    run(async () => {
      await api.addCustomModel({ id: id.trim(), ...(label.trim() ? { label: label.trim() } : {}), adapters: everywhere ? [] : [adapter] });
      onChanged(id.trim());
      setId("");
      setLabel("");
      await reload();
      setNote(t("newsession.model_saved"));
    });

  const saveEndpoint = () =>
    run(async () => {
      const ctx = Number(context);
      const res = await api.addPiProvider(adapter, {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        api: apiKind,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        models: [{ id: modelId.trim(), ...(Number.isFinite(ctx) && ctx > 0 ? { contextWindow: ctx } : {}), ...(reasoning ? { reasoning: true } : {}) }],
        ...(replace ? { replace: true } : {}),
      });
      onChanged(`${name.trim()}/${modelId.trim()}`);
      await reload();
      setNote(res.created ? t("newsession.endpoint_added") : t("newsession.endpoint_replaced"));
    });

  const field = "display: grid; gap: 4px; font-size: calc(13px * var(--font-scale, 1))";
  const exists = /schon/.test(error ?? "");

  return (
    <Sheet open onClose={onClose} label={t("newsession.own_model_endpoint")} variant="modal" testid="modal" class="custom-model-dialog">
        <h3>{t("newsession.own_model_endpoint")}</h3>
        {canEndpoint && (
          <div class="row" role="tablist">
            <Button role="tab" aria-selected={tab === "model"} onClick={() => setTab("model")} variant="primary" class={tab === "model" ? undefined : undefined}>
              {t("common.model")}
            </Button>
            <Button role="tab" aria-selected={tab === "endpoint"} onClick={() => setTab("endpoint")} variant="primary" class={tab === "endpoint" ? undefined : undefined}>
              {t("newsession.endpoint_pi")}
            </Button>
          </div>
        )}
        {tab === "model" || !canEndpoint ? (
          <>
            <label style={field}>
              {t("newsession.model_id")}
              <input value={id} onInput={(e) => setId((e.target as HTMLInputElement).value)} placeholder={t("new-session.anthropic_model")} autocapitalize="off" autocorrect="off" spellcheck={false} />
            </label>
            <label style={field}>
              {t("newsession.display_name_optional")}
              <input value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder={t("new-session.opus")} />
            </label>
            <label class="row" style="gap: 8px; font-size: calc(13px * var(--font-scale, 1))">
              <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere((e.target as HTMLInputElement).checked)} />
              {t("newsession.offer_in_all_harnesses")} {adapter})
            </label>
            <div class="dim" style="font-size: calc(12px * var(--font-scale, 1))">
              {t("newsession.hub_passes_id")}
            </div>
            <div class="modal-actions">
              <Button disabled={busy || !id.trim()} onClick={() => void saveModel()} variant="primary">
                {busy ? t("common.loading_dots") : t("common.save")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <label style={field}>
              {t("newsession.provider_name")}
              <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder={t("new-session.gpubox")} autocapitalize="off" spellcheck={false} />
            </label>
            <label style={field}>
              {t("newsession.base_url")}
              <input value={baseUrl} onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)} placeholder={t("new-session.endpoint_url")} inputMode="url" autocapitalize="off" spellcheck={false} />
            </label>
            <label style={field}>
              {t("newsession.interface")}
              <select value={apiKind} onChange={(e) => setApiKind((e.target as HTMLSelectElement).value as PiProviderBody["api"])}>
                <option value="openai-completions">{t("newsession.openai_compatible")}</option>
                <option value="anthropic-messages">{t("newsession.anthropic_compatible")}</option>
                <option value="google-generative-ai">{t("newsession.google_compatible")}</option>
              </select>
            </label>
            <label style={field}>
              {t("newsession.api_key_env")}
              <input value={apiKey} onInput={(e) => setApiKey((e.target as HTMLInputElement).value)} placeholder={t("new-session.gpubox_key")} autocapitalize="off" spellcheck={false} />
            </label>
            <label style={field}>
              {t("newsession.model_id_at_endpoint")}
              <input value={modelId} onInput={(e) => setModelId((e.target as HTMLInputElement).value)} placeholder={t("new-session.halogen_model")} autocapitalize="off" spellcheck={false} />
            </label>
            <label style={field}>
              {t("newsession.context_window_tokens")}
              <input value={context} onInput={(e) => setContext((e.target as HTMLInputElement).value)} inputMode="numeric" placeholder="131072" />
            </label>
            <label class="row" style="gap: 8px; font-size: calc(13px * var(--font-scale, 1))">
              <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning((e.target as HTMLInputElement).checked)} />
              {t("newsession.model_thinks")}
            </label>
            {exists && (
              <label class="row" style="gap: 8px; font-size: calc(13px * var(--font-scale, 1))">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace((e.target as HTMLInputElement).checked)} />
                {t("newsession.replace_existing_provider")}
              </label>
            )}
            <div class="dim" style="font-size: calc(12px * var(--font-scale, 1))">
              {t("newsession.writes_pi_models_json")}
            </div>
            <div class="modal-actions">
              <Button disabled={busy || !name.trim() || !baseUrl.trim() || !modelId.trim()} onClick={() => void saveEndpoint()} variant="primary">
                {busy ? t("common.loading_dots") : t("newsession.add_entry")}
              </Button>
            </div>
          </>
        )}
        {error && <div class="composer-notice err">{error}</div>}
        {note && <div class="composer-notice">{note}</div>}
        {items.length > 0 && (
          <div class="custom-model-list">
            <strong style="font-size: calc(13px * var(--font-scale, 1))">{t("newsession.own_models")}</strong>
            {items.map((m) => (
              <div key={m.id} class="row" style="justify-content: space-between; gap: 8px">
                <span class="mono" style="overflow-wrap: anywhere; font-size: calc(12px * var(--font-scale, 1))">
                  {m.label ? `${m.label} · ` : ""}
                  {m.id}
                  <span class="dim"> {m.adapters.length === 0 ? t("newsession.all_paren") : `(${m.adapters.join(", ")})`}</span>
                </span>
                <Button aria-label={t("newsession.remove_entry", { "id": m.id })} disabled={busy} onClick={() => void run(async () => (await api.removeCustomModel(m.id), onChanged(), reload()))}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
        )}
        <div class="modal-actions">
          <Button onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
    </Sheet>
  );
}
