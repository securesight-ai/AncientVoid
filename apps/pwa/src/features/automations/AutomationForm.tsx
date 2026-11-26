import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import type { AutomationInfo, AutomationSchedule, AutomationTarget, Swarm } from "@ancientvoid/contracts";
import type { ActionDefinition } from "../../shared/api.ts";
import { useApi } from "../../shared/api-context.ts";
import { sha256Hex } from "./automation-labels.ts";
import { Button } from "../../shared/ui/index.ts";

const TZ_SUGGESTIONS = ["Europe/Berlin", "Europe/London", "UTC", "America/New_York"];

export function AutomationForm({ adapters, projects, swarms, editing, disabled, onSaved, onCancel }: {
  adapters: string[];
  projects: string[];
  swarms: Swarm[];
  editing: AutomationInfo | null;
  disabled: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const existing = editing?.definition ?? null;
  const target = existing?.target;
  const [targetKind, setTargetKind] = useState<"session" | "swarm" | "script">(target?.kind ?? "session");
  const [templateId, setTemplateId] = useState(target?.kind === "swarm" ? target.templateId : "");
  const [actionId, setActionId] = useState(target?.kind === "script" ? target.actionId : "");
  const [actions, setActions] = useState<ActionDefinition[] | null>(null);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsError, setActionsError] = useState("");
  const actionsSeq = useRef(0);
  const [label, setLabel] = useState(existing?.label ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(existing?.schedule.kind === "preset" ? existing.schedule.weekdays ?? [1] : [1]);
  const [harness, setHarness] = useState(target?.kind === "session" ? target.harness : "");
  const [model, setModel] = useState(target?.kind === "session" && target.model ? target.model : "");
  const [project, setProject] = useState(target?.kind === "session" || target?.kind === "script" ? target.project : "");
  const [workdir, setWorkdir] = useState<"worktree" | "direct">(target?.kind === "session" ? target.workdir : "worktree");
  const [scheduleKind, setScheduleKind] = useState<"preset" | "cron">(existing?.schedule.kind === "cron" ? "cron" : "preset");
  const [preset, setPreset] = useState<"hourly" | "daily" | "weekly" | "weekday">(existing?.schedule.kind === "preset" ? existing.schedule.preset : "daily");
  const [localTime, setLocalTime] = useState(existing?.schedule.kind === "preset" && existing.schedule.localTime ? existing.schedule.localTime : "09:00");
  const [cron, setCron] = useState(existing?.schedule.kind === "cron" ? existing.schedule.cron : "* * * * *");
  const [timezone, setTimezone] = useState(existing?.schedule.timezone ?? "Europe/Berlin");
  const [precheckActionId, setPrecheckActionId] = useState(existing?.precheckActionId ?? "");
  const [maxParallel, setMaxParallel] = useState(existing?.grant.maxParallel ?? 1);
  const [missedGraceMinutes, setMissedGraceMinutes] = useState(Math.round((existing?.grant.missedGraceMs ?? 0) / 60_000));
  const [promptText, setPromptText] = useState("");
  const [hostId, setHostId] = useState(existing?.hostId ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hostId) return;
    let alive = true;
    // Der Scheduler feuert nur auf dem Eigentümer-Host — deshalb den echten hostId ablesen, nicht raten.
    void api.fleetHello().then((h) => alive && setHostId(h.hostId)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [hostId]);

  useEffect(() => {
    // ADR-0080: Skript-Ziele wählen eine registrierte Aktion des Projekts — lazily, sobald ein Projekt steht.
    if (targetKind !== "script") return;
    const path = project.trim();
    if (!path) { setActions(null); setActionsError(""); return; }
    const current = ++actionsSeq.current;
    let alive = true;
    setActionsLoading(true); setActionsError("");
    api.automationActions(path)
      .then((res) => { if (alive && current === actionsSeq.current) setActions(res.actions); })
      .catch((err: unknown) => { if (alive && current === actionsSeq.current) { setActions(null); setActionsError(err instanceof Error ? err.message : "Aktionen nicht lesbar"); } })
      .finally(() => { if (alive && current === actionsSeq.current) setActionsLoading(false); });
    return () => { alive = false; };
  }, [targetKind, project]);

  const submit = async () => {
    setError("");
    if (disabled || !navigator.onLine) { setError("Offline — Speichern ist gesperrt."); return; }
    if (!label.trim() || (targetKind === "session" && (!harness || !project.trim() || ((!existing || target?.kind !== "session") && !promptText.trim())))
      || (targetKind === "swarm" && !templateId) || (targetKind === "script" && (!project.trim() || !actionId))) {
      setError("Label und vollständiges Ziel sind Pflicht. Neue Sessions brauchen einen Prompt; Skripte brauchen Projekt und Aktion.");
      return;
    }
    if (!hostId) {
      setError("Host-ID des Hubs konnte nicht abgelesen werden — erneut versuchen.");
      return;
    }
    setBusy(true);
    try {
      const promptBlobSha256 = promptText.trim() ? await sha256Hex(promptText) : target?.kind === "session" ? target.promptBlobSha256 : "";
      const schedule: AutomationSchedule = scheduleKind === "cron"
        ? { kind: "cron", cron: cron.trim(), timezone }
        : { kind: "preset", preset, ...(preset === "hourly" ? {} : { localTime }), ...(preset === "weekly" ? { weekdays } : {}), timezone };
      const definition = {
        id: existing?.id ?? crypto.randomUUID(),
        label: label.trim(),
        generation: existing?.generation ?? 1,
        enabled: false, // Neuanfang/Zurücksetzung: die Aktivierung ist die separate Freigabe.
        hostId,
        schedule,
        target: (targetKind === "swarm" ? { kind: "swarm", templateId }
          : targetKind === "script" ? { kind: "script", project: project.trim(), actionId }
          : { kind: "session", harness, ...(model.trim() ? { model: model.trim() } : {}), workdir, project: project.trim(), promptBlobSha256 }) satisfies AutomationTarget,
        ...(precheckActionId.trim() ? { precheckActionId: precheckActionId.trim() } : {}),
        precheckDeadlineMs: 60_000,
        grant: { maxParallel, missedGraceMs: missedGraceMinutes * 60_000 },
        createdAtUtc: existing?.createdAtUtc ?? new Date().toISOString(),
      };
      if (existing) {
        await api.automationUpdate(existing.id, definition, targetKind === "session" && promptText.trim() ? promptText : undefined);
      } else {
        await api.automationCreate(definition, targetKind === "session" ? promptText : undefined);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form key={existing?.id ?? "new"} class="automation-form" data-testid="automation-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h4>{existing ? `„${existing.label}" bearbeiten` : "Neue Automation"}</h4>
      {error && <div class="files-error" role="alert">{error}</div>}
      <label>{t("automations.label")}
        <input value={label} onInput={(e) => setLabel(e.currentTarget.value)} maxlength={80} placeholder={t("automations.morning_briefing")} required />
      </label>
      <label>{t("automations.automation_type")}<select value={targetKind} onChange={e => setTargetKind(e.currentTarget.value as "session" | "swarm" | "script")}><option value="session">{t("automations.cron_session_trigger")}</option><option value="swarm">{t("automations.service_agent_swarm")}</option><option value="script">{t("automations.script_start")}</option></select></label>
      {targetKind === "swarm" ? <label>{t("automations.swarm_template")}<select value={templateId} onChange={e => setTemplateId(e.currentTarget.value)} required><option value="">{t("automations.choose_existing_swarm")}</option>{swarms.filter(swarm => swarm.tasks.length > 0).map(swarm => <option key={swarm.id} value={swarm.id}>{swarm.title}</option>)}</select></label> : targetKind === "script" ? <>
      <label>{t("newsession.project")}
        <input list="automation-projects" value={project} onInput={(e) => setProject(e.currentTarget.value)} placeholder={t("automations.path_to_repo")} required />
      </label>
      <label>{t("automations.action")}
        <select value={actionId} onChange={e => setActionId(e.currentTarget.value)} required disabled={!project.trim() || actionsLoading}>
          <option value="">{actionsLoading ? "lade Aktionen…" : project.trim() ? "Registrierte Aktion wählen" : "zuerst Projekt angeben"}</option>
          {(actions ?? []).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>
      {actionsError && <div class="files-error" role="alert">{actionsError}</div>}
      {!actionsError && !actionsLoading && actions?.length === 0 && project.trim() && <p class="swarm-meta">{t("automations.no_registered_actions")}</p>}
      <p class="swarm-meta">{t("automations.script_start_desc")}</p>
      </> : <>
      <div class="form-grid">
        <label>{t("status.harness")}
          <input list="automation-adapters" value={harness} onInput={(e) => setHarness(e.currentTarget.value)} placeholder={t("automations.dummy")} required />
        </label>
        <datalist id="automation-adapters">{adapters.map((a) => <option key={a} value={a} />)}</datalist>
        <label>{t("automations.model_optional")}
          <input value={model} onInput={(e) => setModel(e.currentTarget.value)} />
        </label>
      </div>
      <label>{t("newsession.project")}
        <input list="automation-projects" value={project} onInput={(e) => setProject(e.currentTarget.value)} placeholder={t("automations.path_to_repo")} required />
      </label>
      <div class="form-grid">
        <label>{t("newsession.workplace")}
          <select value={workdir} onChange={(e) => setWorkdir(e.currentTarget.value as "worktree" | "direct")}>
            <option value="worktree">{t("automations.worktree_default")}</option>
            <option value="direct">{t("automations.direct_checkout")}</option>
          </select>
        </label>

      </div>
      </>}
      <datalist id="automation-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
        <label>{t("automations.time_zone")}
          <input list="automation-timezones" value={timezone} onInput={(e) => setTimezone(e.currentTarget.value)} />
        </label>
        <datalist id="automation-timezones">{TZ_SUGGESTIONS.map((tz) => <option key={tz} value={tz} />)}</datalist>
      <fieldset>
        <legend>{t("automations.schedule")}</legend>
        <div class="form-grid">
          <label>{t("automations.type")}
            <select value={scheduleKind} onChange={(e) => setScheduleKind(e.currentTarget.value as "preset" | "cron")}>
              <option value="preset">{t("automations.preset")}</option>
              <option value="cron">{t("automations.cron_5_fields")}</option>
            </select>
          </label>
          {scheduleKind === "preset" ? (
            <>
              <label>{t("automations.preset")}
                <select value={preset} onChange={(e) => setPreset(e.currentTarget.value as "hourly" | "daily" | "weekly" | "weekday")}>
                  <option value="hourly">{t("automations.hourly")}</option>
                  <option value="daily">{t("automations.daily")}</option>
                  <option value="weekly">{t("automations.weekly")}</option>
                  <option value="weekday">{t("automations.weekdays_short")}</option>
                </select>
              </label>
              {preset !== "hourly" && (
                <label>{t("automations.time_local")}
                  <input type="time" value={localTime} onInput={(e) => setLocalTime(e.currentTarget.value)} />
                </label>
              )}
            </>
          ) : (
            <label>{t("automations.cron_fields")}
              <input value={cron} onInput={(e) => setCron(e.currentTarget.value)} placeholder="*/15 9-17 * * 1-5" />
            </label>
          )}
        </div>
      </fieldset>
      {scheduleKind === "preset" && preset === "weekly" && <fieldset><legend>{t("automations.weekdays")}</legend>{["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"].map((day, index) => <label key={day}><input type="checkbox" checked={weekdays.includes(index)} onChange={() => setWeekdays(days => days.includes(index) ? days.filter(d => d !== index) : [...days, index].sort())} />{day}</label>)}</fieldset>}
      <div class="form-grid">
        <label>{t("automations.precheck_action")}
          <input value={precheckActionId} onInput={(e) => setPrecheckActionId(e.currentTarget.value)} placeholder={t("automations.git_status")} />
        </label>
        <label>{t("automations.max_parallel")}
          <input type="number" min={1} max={4} value={maxParallel} onInput={(e) => setMaxParallel(Number(e.currentTarget.value) || 1)} />
        </label>
        <label>{t("automations.catchup_window")}
          <input type="number" min={0} max={1440} value={missedGraceMinutes} onInput={(e) => setMissedGraceMinutes(Number(e.currentTarget.value) || 0)} />
        </label>
      </div>
      {targetKind === "session" && <label>{t("automations.prompt_keep")}
        <textarea rows={4} value={promptText} onInput={(e) => setPromptText(e.currentTarget.value)} placeholder={t("automations.what_run_should")} required={!existing} />
      </label>}
      <p class="swarm-meta">{t("automations.new_disabled")}</p>
      <div class="automation-form-actions">
        <Button type="submit" disabled={busy || disabled}>{existing ? "Speichern" : "Anlegen"}</Button>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
