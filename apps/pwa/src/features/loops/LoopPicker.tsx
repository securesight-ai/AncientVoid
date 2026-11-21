import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import type { LoopInfo, LoopSpec } from "@ancientvoid/contracts";
import type { hubApi } from "../../shared/api.ts";
import { defaultLoopSpec, isOnboarding, onboardProjectDefaults, onboardSelectDefaults, type OnboardDraft } from "./loop-form.ts";

/**
 * EPIC-P19: Auswahl „Loop / Dark Factory“ im Start-Formular. Die Liste und alle Felder kommen vom Hub
 * (Fähigkeiten des Connectors, nie festverdrahtet). Ein Loop ohne Connector bleibt sichtbar und gesperrt,
 * mit dem Grund daneben — kein stilles Verschwinden. Betriebsarten mit Außenwirkung brauchen ein Häkchen.
 */
export function LoopPicker({
  api,
  value,
  confirmed,
  onChange,
  onConfirmed,
  onboard,
  onOnboard,
  reload = 0,
  initial = null,
  project = "",
}: {
  api: Pick<typeof hubApi, "loops">;
  value: LoopSpec | null;
  confirmed: boolean;
  onChange: (next: LoopSpec | null, info: LoopInfo | null) => void;
  onConfirmed: (yes: boolean) => void;
  onboard: OnboardDraft;
  onOnboard: (next: OnboardDraft) => void;
  /** Wird hochgezählt, wenn sich die Linien geändert haben (nach dem Anbinden). */
  reload?: number;
  /** T8.4-Familie: zuletzt gestartete Loop-Auswahl — wird einmalig nach dem
   * Laden der Liste wiederhergestellt; eine eigene Wahl des Nutzers gewinnt. */
  initial?: LoopSpec | null;
  /** ADR-0045: aktueller Projektpfad des Start-Dialogs — füllt Onboarding-Felder
   * mit `prefill: "project"` vor, solange der Nutzer dort selbst nichts tippt. */
  project?: string;
}) {
  const [loops, setLoops] = useState<LoopInfo[] | null>(null);
  // Hat der Nutzer selbst gewählt (auch „kein Loop“), schlägt die Erinnerung nicht mehr zu.
  const touched = useRef(false);
  useEffect(() => {
    let live = true;
    api
      .loops()
      // Ältere Hubs kennen die Route nicht: dann gibt es die Zeile schlicht nicht.
      .then((l) => live && setLoops(l))
      .catch(() => live && setLoops([]));
    return () => {
      live = false;
    };
  }, [api, reload]);
  useEffect(() => {
    if (!loops || touched.current || !initial) return;
    const found = loops.find((l) => l.id === initial.id);
    if (!found || !found.available) return;
    touched.current = true;
    onChange(initial, found);
    // onChange kommt aus dem Eltern-Formular und wechselt pro Render — nur beim ersten Laden restored.
  }, [loops]);
  if (!loops || loops.length === 0) return null;

  const chosen = value ? loops.find((l) => l.id === value.id) : undefined;
  const caps = chosen?.capabilities ?? null;
  // Öffnet die Auswahl das Anbindungs-Formular, gehören die angezeigten
  // Select-Vorgaben auch in den Zustand (sonst blockiert „… fehlt“ trotz
  // gefülltem Dropdown — der Startknopf wirkt dann einfach tot).
  const onboardCaps = caps?.onboarding ?? null;
  const onboardOpen = !!(onboardCaps && value && isOnboarding(chosen ?? null, value));
  const prefilled = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!onboardCaps || !onboardOpen) return;
    const withProject = onboardProjectDefaults(onboardCaps, onboard.values, project, prefilled.current);
    prefilled.current = withProject.filled;
    const values = onboardSelectDefaults(onboardCaps, withProject.values);
    if (values !== onboard.values) onOnboard({ ...onboard, values });
  }, [onboardCaps, onboardOpen, onboard, project]);
  const set = (patch: Partial<LoopSpec>) => value && chosen && onChange({ ...value, ...patch }, chosen);
  const setOption = (key: string, v: string) => set({ options: { ...value?.options, [key]: v } });
  const risky = !!(value?.mode && caps?.riskyModes.includes(value.mode));
  const blocked = loops.filter((l) => !l.available);

  return (
    <div class="loop-picker">
      <label>
        {t("loops.loop")}
        <select
          aria-label={t("loops.loop")}
          value={value?.id ?? ""}
          onChange={(e) => {
            const next = loops.find((l) => l.id === (e.target as HTMLSelectElement).value);
            touched.current = true;
            onConfirmed(false);
            onChange(next ? defaultLoopSpec(next) : null, next ?? null);
          }}
        >
          <option value="">{t("loops.no_loop")}</option>
          {loops.map((l) => (
            <option key={l.id} value={l.id} disabled={!l.available}>
              {l.label}
              {l.available ? "" : " (nicht verbunden)"}
            </option>
          ))}
        </select>
      </label>
      {caps && value && (
        <>
          <div class="dim">{value.id === "securesight-factory" ? "Ein Lauf besteht aus Treiber (Chat) und Beobachter (Fortschritt). Adapter und Modell unten wählen den Treiber; die Factory-Worker nutzen das Routing im Projekt." : "Adapter, Modell und Modus bestimmt der Loop selbst."}</div>
          {caps.modes.length > 0 && (
            <label>
              {t("loops.mode")}
              <select
                aria-label={t("loops.mode")}
                value={value.mode ?? ""}
                onChange={(e) => {
                  onConfirmed(false);
                  set({ mode: (e.target as HTMLSelectElement).value });
                }}
              >
                {caps.modes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {caps.riskyModes.includes(m) ? " (ändert Fremdsysteme)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {caps.orchestrators.length > 0 && (
            <label>
              {t("loops.orchestrator")}
              <select aria-label={t("loops.orchestrator")} value={value.orchestrator ?? ""} onChange={(e) => set({ orchestrator: (e.target as HTMLSelectElement).value })}>
                {caps.orchestrators.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )}
          {caps.options.map((o) => (
            <label key={o.key}>
              {o.label}
              {o.required ? " *" : ""}
              {o.kind === "select" ? (
                <select aria-label={o.label} value={value.options?.[o.key] ?? ""} onChange={(e) => setOption(o.key, (e.target as HTMLSelectElement).value)}>
                  {o.choices?.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : o.kind === "toggle" ? (
                <input type="checkbox" aria-label={o.label} checked={value.options?.[o.key] === "true"} onChange={(e) => setOption(o.key, (e.target as HTMLInputElement).checked ? "true" : "false")} />
              ) : (
                <input type="text" aria-label={o.label} placeholder={o.placeholder ?? ""} value={value.options?.[o.key] ?? ""} onInput={(e) => setOption(o.key, (e.target as HTMLInputElement).value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
              )}
            </label>
          ))}
          {caps.onboarding && isOnboarding(chosen ?? null, value) && (
            <fieldset class="loop-onboard">
              <legend>{caps.onboarding.label}</legend>
              {caps.onboarding.fields.map((f) => (
                <label key={f.key}>
                  {f.label}
                  {f.required ? " *" : ""}
                  {f.kind === "select" ? (
                    <select aria-label={f.label} value={onboard.values[f.key] ?? f.choices?.[0]?.value ?? ""} onChange={(e) => onOnboard({ ...onboard, values: { ...onboard.values, [f.key]: (e.target as HTMLSelectElement).value } })}>
                      {f.choices?.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input type="text" aria-label={f.label} placeholder={f.placeholder ?? ""} value={onboard.values[f.key] ?? ""} onInput={(e) => onOnboard({ ...onboard, values: { ...onboard.values, [f.key]: (e.target as HTMLInputElement).value } })} autocapitalize="off" autocorrect="off" spellcheck={false} />
                  )}
                </label>
              ))}
              {caps.onboarding.secret && (
                <>
                  <label>
                    {caps.onboarding.secret.label} *
                    <input type="password" aria-label={caps.onboarding.secret.label} autocomplete="off" value={onboard.secret} onInput={(e) => onOnboard({ ...onboard, secret: (e.target as HTMLInputElement).value })} />
                  </label>
                  {caps.onboarding.secret.hint && <div class="dim">{caps.onboarding.secret.hint}</div>}
                </>
              )}
              {caps.onboarding.notes?.map((n) => <div class="dim">{n}</div>)}
              <div class="dim">{t("loops.setup_on_start")} {caps.onboarding.secret ? "Das Token wird nicht gespeichert." : ""}</div>
            </fieldset>
          )}
          {risky && (
            <label >
              <input type="checkbox" aria-label={t("loops.confirm_external")} checked={confirmed} onChange={(e) => onConfirmed((e.target as HTMLInputElement).checked)} />
              {t("loops.in_quote")}{value.mode}{t("loops.quote_changes")}
            </label>
          )}
        </>
      )}
      {blocked.length > 0 && (
        <ul class="loop-reasons dim">
          {blocked.map((l) => (
            <li key={l.id}>
              {l.label}: {l.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
