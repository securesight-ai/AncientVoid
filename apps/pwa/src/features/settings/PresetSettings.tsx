import { t } from "../../shared/i18n/index.ts";
import { getOpenWindows, openPopout, windowGeometry } from "../windows/windows.ts";
import { useEffect, useState } from "preact/hooks";
import { APPEARANCE_EVENT } from "../../app/appearance.ts";
import { tileFractions, parseWorkspace } from "../workspace/tiles.ts";
import { defaultPreset, getPreset, parsePreset, PRESET_EVENT, setPreset, type DevicePreset } from "./presets.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

const SAVED = "ancientvoid.named-presets.v1";
function savedPresets(): Record<string, DevicePreset> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SAVED) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).slice(0, 20).flatMap(([name, p]) => {
      try { return [[name, parsePreset(JSON.stringify(p))]]; } catch { return []; }
    }));
  } catch { return {}; }
}

/** Gerätelokal; exportiert nur freigegebene Darstellungs- und Geometriefelder. */
export function PresetSettings() {
  const [p, update] = useState(getPreset);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(savedPresets);
  const [json, setJson] = useState("");
  useEffect(() => {
    const sync = () => update(getPreset());
    for (const event of [PRESET_EVENT, APPEARANCE_EVENT, "ancientvoid:theme"]) window.addEventListener(event, sync);
    return () => { for (const event of [PRESET_EVENT, APPEARANCE_EVENT, "ancientvoid:theme"]) window.removeEventListener(event, sync); };
  }, []);
  const attempt = (action: () => void) => { try { action(); setMessage("Gespeichert — nur auf diesem Gerät."); } catch (e) { setMessage(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); } };
  const change = (patch: Partial<DevicePreset>) => attempt(() => setPreset({ ...p, ...patch }));
  const store = (next: Record<string, DevicePreset>) => { localStorage.setItem(SAVED, JSON.stringify(next)); setSaved(next); };
  const capture = (): DevicePreset => {
    const ws = parseWorkspace(localStorage.getItem("ancientvoid.workspace"));
    return { ...p, windows: Object.values(getOpenWindows()).slice(0, 12).map(w => ({ target: w.target, geometry: windowGeometry(w.target) })), layout: { ...p.layout, kind: ws.layout, ...tileFractions(ws) } };
  };
  const restoreLayout = (next: DevicePreset) => {
    // Nur die Anordnung ändern: belegte Kacheln und ihre Verbindungen bleiben erhalten.
    window.dispatchEvent(new CustomEvent("ancientvoid:restore-layout", { detail: next.layout }));
  };
  return <SettingsSection title={t("settings.appearance_layout_presets")}>
    <p class="settings-intro dim">{t("settings.saved_on_device")}</p>
    <SettingRow label={t("settings.density")}><select aria-label={t("settings.density")} value={p.density} onChange={e => change({ density: e.currentTarget.value as DevicePreset["density"] })}><option value="comfortable">{t("settings.comfortable")}</option><option value="compact">{t("settings.compact")}</option></select></SettingRow>
    <SettingRow label={t("settings.chat_width")}><select aria-label={t("settings.chat_width")} value={p.chatWidth} onChange={e => change({ chatWidth: e.currentTarget.value as DevicePreset["chatWidth"] })}><option value="full">{t("settings.full_width")}</option><option value="readable">{t("settings.reading_width")}</option></select></SettingRow>
    <SettingRow label={t("settings.code_size")}><input aria-label={t("settings.code_size")} type="range" min="0.85" max="1.3" step="0.05" value={p.codeScale} onInput={e => change({ codeScale: Number(e.currentTarget.value) })} /><output>{Math.round(p.codeScale * 100)} %</output></SettingRow>
    <SettingRow label={t("settings.corner_radius")}><input aria-label={t("settings.corner_radius")} type="range" min="0" max="20" value={p.radius} onInput={e => change({ radius: Number(e.currentTarget.value) })} /></SettingRow>
    <SettingRow label={t("settings.border_width")}><input aria-label={t("settings.border_width")} type="range" min="1" max="3" value={p.border} onInput={e => change({ border: Number(e.currentTarget.value) })} /></SettingRow>
    <SettingRow label={t("settings.surface_color")} hint="Wird nur bei lesbarem Textkontrast übernommen."><input type="color" aria-label={t("settings.surface_color")} value={p.surface ?? (p.theme === "dark" ? "#121316" : "#ffffff")} onChange={e => change({ surface: e.currentTarget.value })} /><Button onClick={() => change({ surface: null })}>{t("settings.default_surface")}</Button></SettingRow>
    <SettingRow label={t("settings.local_background")} hint="PNG, JPEG oder WebP; maximal 500 KB."><input type="file" aria-label={t("settings.local_background")} accept="image/png,image/jpeg,image/webp" onChange={e => {
      const file = e.currentTarget.files?.[0];
      if (!file) return;
      if (file.size > 500_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setMessage("Nur PNG/JPEG/WebP bis 500 KB erlaubt."); return; }
      const reader = new FileReader();
      reader.onerror = () => setMessage("Bild konnte nicht gelesen werden.");
      reader.onload = () => change({ background: String(reader.result) });
      reader.readAsDataURL(file);
    }} /><Button onClick={() => change({ background: null })}>{t("settings.remove_image")}</Button></SettingRow>
    <div class="preset-actions"><Button onClick={() => attempt(() => setPreset(defaultPreset()))}>{t("settings.reset_appearance")}</Button>
      <Button onClick={() => { const next = { ...defaultPreset(), theme: "light" as const }; attempt(() => setPreset(next)); }}>{t("settings.light")}</Button>
      <Button onClick={() => attempt(() => setPreset(defaultPreset()))}>{t("settings.dark")}</Button>
    </div>
    <label>{t("settings.preset_name")}<input aria-label={t("settings.preset_name")} maxLength={60} value={name} onInput={e => setName(e.currentTarget.value)} /></label>
    <Button disabled={!name.trim() || (Object.keys(saved).length >= 20 && !Object.hasOwn(saved, name.trim()))} onClick={() => attempt(() => store({ ...saved, [name.trim()]: parsePreset(JSON.stringify(capture())) }))}>{t("settings.save_appearance")}</Button>
    {Object.entries(saved).map(([title, preset]) => <div class="preset-actions" key={title}><span>{title}</span><Button aria-label={`Preset anwenden: ${title}`} onClick={() => attempt(() => { setPreset(preset); restoreLayout(preset); })}>{t("settings.apply")}</Button><Button aria-label={`Preset löschen: ${title}`} onClick={() => attempt(() => store(Object.fromEntries(Object.entries(saved).filter(([k]) => k !== title))))}>{t("common.delete")}</Button></div>)}
    <p class="dim">{t("settings.phone_preset")}</p>
    <Button onClick={() => change({ layout: { ...p.layout, window: { left: 0, top: 0, width: 390, height: 844 } } })}>{t("settings.browser_preset_phone")}</Button>
    {(p.windows ?? []).map((w, i) => <Button key={i} onClick={() => { void openPopout(w.target, undefined, w.geometry).then(result => setMessage(result === "blocked" ? "Fenster blockiert — bitte Pop-ups für diese Seite erlauben." : "Fenster wiederhergestellt.")); }}>{t("common.windows")} {i + 1} {t("settings.restore_open")}{w.target.kind})</Button>)}
    <label>{t("settings.preset_json")}<textarea aria-label={t("settings.preset_json")} rows={5} value={json} onInput={e => setJson(e.currentTarget.value)} /></label>
    <div class="preset-actions"><Button onClick={() => attempt(() => setJson(JSON.stringify(parsePreset(JSON.stringify(capture())), null, 2)))}>{t("settings.export_preset")}</Button>
    <Button disabled={!json.trim()} onClick={() => attempt(() => { const next = parsePreset(json); setPreset(next); restoreLayout(next); })}>{t("settings.import_preset")}</Button></div>
    {message && <p role="status" aria-label={t("settings.preset_status")}>{message}</p>}
  </SettingsSection>;
}
