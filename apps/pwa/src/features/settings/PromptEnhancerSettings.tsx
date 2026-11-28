import { useEffect, useState } from "preact/hooks";
import type { PromptEnhancerPreferences, PromptEnhancerSettings as Preferences } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { t } from "../../shared/i18n/index.ts";
import { Button, Field, Select, Switch } from "../../shared/ui/index.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";

export function PromptEnhancerSettings() {
  const [data, setData] = useState<PromptEnhancerPreferences | null>(null);
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<"saved" | "loadError" | "saveError" | null>(null);
  useEffect(() => {
    let current = true;
    hubApi.promptEnhancerSettings().then((result) => {
      if (!current) return;
      setData(result);
      setSaved(result.settings);
      setModel(result.settings.engine.kind === "adapter" ? result.settings.engine.model ?? "" : "");
    }).catch(() => { if (current) setNotice("loadError"); });
    return () => { current = false; };
  }, []);

  const engine = data?.settings.engine;
  const selection = engine?.kind === "adapter" ? engine.id : "";
  const modelChoice = data?.engines.some(({ id, modelChoice }) => id === selection && modelChoice) ?? false;
  useEffect(() => {
    let current = true;
    setModels([]);
    if (modelChoice) {
      hubApi.adapterModels(selection).then(({ models }) => {
        if (current) setModels((models ?? []).map((entry) => ({ value: entry.id, label: entry.label ?? entry.id })));
      }).catch(() => { /* The model ID can also be entered directly. */ });
    }
    return () => { current = false; };
  }, [selection, modelChoice]);
  const options = data?.engines.map(({ id }) => ({ value: id, label: id })) ?? [];
  if (selection && !options.some(({ value }) => value === selection)) {
    options.unshift({ value: selection, label: t("settings.enhancer.unavailable", { id: selection }) });
  }
  const source = data?.settings.knowledgeSource;
  const sources = data?.knowledgeSources.map(({ id, label }) => ({ value: id, label })) ?? [];
  if (source && !sources.some(({ value }) => value === source)) {
    sources.unshift({ value: source, label: t("settings.enhancer.unavailable", { id: source }) });
  }
  const values: Preferences | null = data && {
    engine: selection ? { kind: "adapter", id: selection, ...(model.trim() && { model: model.trim() }) } : { kind: "auto" },
    scan: data.settings.scan,
    ...(data.settings.knowledgeSource !== undefined && { knowledgeSource: data.settings.knowledgeSource }),
  };
  const refresh = async () => {
    if (!values) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await hubApi.savePromptEnhancerSettings(values);
      setData(result);
      setSaved(result.settings);
      setNotice("saved");
    } catch {
      setNotice("saveError");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title={t("settings.enhancer.title")} testid="settings-enhancer">
      {data && (
        <>
          <Select label={t("settings.enhancer.engine")} value={selection} disabled={saving}
            options={[{ value: "", label: t("settings.enhancer.auto") }, ...options]}
            onChange={(id) => {
              if (id === selection) return;
              setNotice(null);
              setModel("");
              setData({ ...data, settings: { ...data.settings, engine: id ? { kind: "adapter", id } : { kind: "auto" } } });
            }} />
          {modelChoice && (
            <>
              {models.length > 0 && (
                <Select label={t("settings.enhancer.models")} value={models.some(({ value }) => value === model) ? model : ""}
                  options={[{ value: "", label: t("settings.enhancer.modelDefault") }, ...models]} disabled={saving}
                  onChange={(value) => { setModel(value); setNotice(null); }} />
              )}
              <Field label={t("settings.enhancer.model")} value={model} disabled={saving} maxLength={200}
                onInput={(value) => { setModel(value); setNotice(null); }} />
            </>
          )}
          <SettingRow label={t("settings.enhancer.scan")} hint={t("settings.enhancer.scanHint")}>
            <Switch label={t("settings.enhancer.scan")} checked={data.settings.scan} disabled={saving} onChange={(scan) => {
              setNotice(null);
              setData({ ...data, settings: { ...data.settings, scan } });
            }} />
          </SettingRow>
          {sources.length > 0 && (
            <Select label={t("settings.enhancer.knowledge")} hint={t("settings.enhancer.knowledgeHint")}
              value={source ?? ""} disabled={saving}
              options={[
                { value: "", label: t("settings.enhancer.knowledgeOff") },
                ...sources,
              ]}
              onChange={(id) => {
                setNotice(null);
                setData({ ...data, settings: { ...data.settings, knowledgeSource: id || null } });
              }} />
          )}
          <Button disabled={saving || JSON.stringify(values) === JSON.stringify(saved)} onClick={() => void refresh()}>
            {t("settings.enhancer.save")}
          </Button>
        </>
      )}
      {notice && <p role={notice === "saved" ? "status" : "alert"}>{t(`settings.enhancer.${notice}`)}</p>}
    </SettingsSection>
  );
}
