import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { AdapterInfo, HubApi, SessionRecord } from "../../shared/api.ts";
import { HANDOVER_CATEGORIES, type ProviderFailure } from "./handover.ts";
import { Button } from "../../shared/ui/index.ts";

/**
 * EPIC-P21 T21.2: a provider failure (login expired, rate limit, quota) is shown in words, and the work can
 * move to another provider/harness/model with one tap. Nothing switches silently: the target is chosen and the
 * text the next agent starts from is shown, editable, before anything starts.
 */
export function HandoverBar({ failure, session, api, onHandedOver, onRepaired }: { failure: ProviderFailure; session: SessionRecord; api: HubApi; onHandedOver: (created: SessionRecord) => void; onRepaired: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!HANDOVER_CATEGORIES.has(failure.category)) return null;
  const repair = async () => {
    setRepairing(true);
    setError(null);
    try {
      const ack = await api.repairSession(session.id);
      if (!ack.ok) throw new Error(ack.detail ?? t("session.repair_failed"));
      await onRepaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRepairing(false);
    }
  };
  return (
    <div class="handover-bar" role="alert">
      <div >
        <strong>{failure.title}</strong>
        <span class="dim"> — {failure.detail}</span>
      </div>
      {failure.category === "session" && (
        <Button  disabled={repairing} onClick={() => void repair()} variant="primary" class={repairing ? "busy" : undefined}>
          {repairing ? t("session.repaired") : t("session.continue_here")}
        </Button>
      )}
      {!open && (
        <Button onClick={() => setOpen(true)}>
          {t("session.hand_over_to_other")}
        </Button>
      )}
      {open && <HandoverForm session={session} api={api} onCancel={() => setOpen(false)} onHandedOver={onHandedOver} />}
      {error && <div class="error">{error}</div>}
    </div>
  );
}

export function HandoverForm({ session, api, onCancel, onHandedOver }: { session: SessionRecord; api: HubApi; onCancel: () => void; onHandedOver: (created: SessionRecord) => void }) {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [target, setTarget] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [tightening, setTightening] = useState(false);
  // Der Text vor dem Straffen — „Rückgängig“ stellt ihn wieder her.
  const [beforeTighten, setBeforeTighten] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adapters().then((all) => alive && setAdapters(all.filter((a) => a.id !== session.adapter && a.capabilities.features.followUp !== undefined))).catch(() => undefined);
    api.handoverDraft(session.id).then((d) => alive && setPrompt(d.prompt)).catch((e) => alive && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      alive = false;
    };
  }, [api, session.id, session.adapter]);

  const chosen = adapters.find((a) => a.id === target);
  const canPickModel = chosen?.capabilities.features.modelChoice === "start";
  useEffect(() => {
    setModel("");
    setModels([]);
    if (!target || !canPickModel) return;
    let alive = true;
    api.adapterModels(target).then((r) => alive && setModels(r.models ?? [])).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, target, canPickModel]);

  // Optional und nur auf Klick: das Ziel-Modell formuliert den Text neu. Der Text geht dafür an dieses Ziel
  // (ADR-0039: ohnehin das, was es als erste Eingabe bekäme); die Schwärzung von Schlüsseln lief schon im Entwurf.
  const tighten = async () => {
    setTightening(true);
    setError(null);
    try {
      const result = await api.enhancePrompt(target, session.project, prompt);
      setBeforeTighten(prompt);
      setPrompt(result.enhanced.slice(0, 3500));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("session.tighten_failed"));
    } finally {
      setTightening(false);
    }
  };

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      onHandedOver(await api.handover(session.id, { adapter: target, ...(canPickModel && model ? { model } : {}), prompt }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div class="handover-form">
      <label>
        {t("newsession.target")}
        <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)} aria-label={t("newsession.target_provider")}>
          <option value="">{t("newsession.choose_dash")}</option>
          {adapters.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}
            </option>
          ))}
        </select>
      </label>
      {canPickModel && (
        <label>
          {t("common.model")}
          <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)} aria-label={t("newsession.target_model")}>
            <option value="">{t("session.harness_default")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t("session.handover_text_first_input")}
        <textarea rows={8} value={prompt} onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)} aria-label={t("session.handover_text")} maxLength={3500} />
      </label>
      {error && <div class="error">{error}</div>}
      <div class="approval-actions">
        <Button  disabled={busy || tightening || !target || !prompt.trim()} onClick={() => void tighten()} title={target ? t("session.text_goes_to", { "target": target }) : t("session.choose_target_first")} class={tightening ? "busy" : undefined}>
          {tightening ? t("session.formulating") : t("session.tighten_with_model")}
        </Button>
        {beforeTighten !== null && (
          <Button onClick={() => { setPrompt(beforeTighten); setBeforeTighten(null); }}>
            {t("session.undo")}
          </Button>
        )}
        <Button  disabled={busy || !target || !prompt.trim()} onClick={() => void go()} variant="primary" class={busy ? "busy" : undefined}>
          {busy ? t("session.starting") : t("session.hand_over")}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
