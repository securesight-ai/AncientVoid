import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { AutomationHistoryEntry, AutomationInfo, TeamStart } from "@ancientvoid/contracts";
import { useApi } from "../../shared/api-context.ts";
import { sessionHash } from "../../app/route.ts";
import { remoteHost } from "../../shared/api.ts";
import { outcomeLabel, REASON_LABEL, scheduleText, STATE_LABEL } from "./automation-labels.ts";
import { readAutomationSnapshot, writeAutomationSnapshot } from "./automation-cache.ts";
import { Button } from "../../shared/ui/index.ts";

export function AutomationDetail({ info, offline, cacheKey, host }: { info: AutomationInfo; offline: boolean; cacheKey: string; host: string | null }) {
  const api = useApi();
  const [history, setHistory] = useState<AutomationHistoryEntry[] | null>(null);
  /** Abrufzeitpunkt der angezeigten Einträge; gesetzt nur, solange sie aus der Offlinekopie stammen. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const definition = info.definition;
  const [template, setTemplate] = useState<TeamStart | null>(null);
  const [templateError, setTemplateError] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [resolveError, setResolveError] = useState("");
  const resolve = async (claimKey: string) => {
    setResolveError("");
    try {
      await api.automationResolve(definition.id, claimKey, note.trim());
      setResolving(null); setNote("");
      setHistory(await api.automationHistory(definition.id));
    } catch (err) { setResolveError(err instanceof Error ? err.message : "Aufgeben fehlgeschlagen"); }
  };
  useEffect(() => {
    let alive = true; setTemplate(null); setTemplateError("");
    if (definition.target.kind === "team" && !offline) void api.automationTemplate(definition.id).then(value => { if (alive) setTemplate(value); }).catch(err => { if (alive) setTemplateError(String(err)); });
    return () => { alive = false; };
  }, [api, definition.id, definition.generation, offline]);
  useEffect(() => {
    let alive = true;
    const cached = cacheKey ? readAutomationSnapshot(cacheKey)?.histories.find(h => h.id === definition.id) : undefined;
    setHistory(cached?.entries ?? null); setCachedAt(cached?.at ?? null); setError("");
    if (offline) { if (!cached) setError("Für diesen Plan ist kein Offline-Verlauf gespeichert."); return; }
    void api.automationHistory(definition.id).then(entries => {
      if (!alive) return;
      setHistory(entries); setCachedAt(null);
      const snapshot = readAutomationSnapshot(cacheKey);
      if (snapshot) writeAutomationSnapshot(cacheKey, { ...snapshot, histories: [...snapshot.histories.filter(h => h.id !== definition.id), { id: definition.id, at: new Date().toISOString(), entries: entries.slice(0, 100) }] });
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : "Verlauf nicht lesbar"); });
    return () => { alive = false; };
  }, [api, definition.id, definition.generation, info.lastOccurrence?.utc, info.lastOccurrence?.state, info.lastOccurrence?.outcome, offline, cacheKey]);
  const target = definition.target;
  return <div class="team-detail" data-testid="automation-detail">
    <h3>{definition.label}</h3>
    <p class="team-meta">{t("automations.schedule")} {scheduleText(info)} {t("automations.max_parallel_frag")} {definition.grant.maxParallel} {t("automations.catchup_frag")} {definition.grant.missedGraceMs / 60_000} {t("automations.minutes_approval_version")} {definition.generation}</p>
    <p class="team-meta">{t("automations.precheck")} {definition.precheckActionId ?? "keine"} {t("automations.deadline_open")} {definition.precheckDeadlineMs / 1000} s)</p>
    <p class="team-meta">{t("automations.target")} {target.kind === "session" ? `${target.harness}${target.model ? ` · ${target.model}` : ""} · ${target.workdir} · ${target.project}` : target.kind === "script" ? `Skript ${target.actionId} · ${target.project}` : `Team-Vorlage ${target.templateId}`}</p>
    {templateError && <p role="alert">{templateError}</p>}
    {template && <div><p>{t("automations.frozen_frame")} {template.project} {t("automations.worker_frag")} {template.frame.adapters.join(", ")} {t("automations.at_most_frag")} {template.frame.maxParallel} {t("automations.parallel")}</p>{template.plan?.tasks.map(task => <details key={task.id}><summary>{task.title} · {task.adapter}{task.model ? ` · ${task.model}` : ""}</summary><pre>{task.prompt}</pre></details>)}</div>}
    {offline && target.kind === "team" && <p>{t("automations.team_frame_online")}</p>}
    <h4>{t("automations.next_occurrences")}</h4>
    <ul class="automation-occurrences" data-testid="automation-preview">{info.nextOccurrences.map(o => <li key={o.utc}>{o.local} ({o.utc})</li>)}</ul>
    {info.nextOccurrences.length === 0 && <p>{t("automations.no_occurrence")}</p>}
    <h4>{t("session.history")}</h4>
    {error && <div class="files-error" role="alert">{error}</div>}
    {cachedAt && history && <p data-testid="automation-history-asof">{t("automations.saved_history")} <time dateTime={cachedAt}>{new Date(cachedAt).toLocaleString("de-DE")}</time> {t("automations.at_most_100")}{offline ? "" : " — aktueller Abruf fehlgeschlagen"}.</p>}
    {!history && !error && <div class="ui-empty">{t("common.loading_short")}</div>}
    {history?.length === 0 && !error && <div class="ui-empty">{t("automations.no_runs")}</div>}
    {!!history?.length && <ul class="team-tasks" data-testid="automation-history">{history.map(entry => <li key={entry.claimKey} class="team-task">
      <div class="team-task-head"><span class="team-pill">{STATE_LABEL[entry.state] ?? entry.state}</span><span>{entry.occurrenceUtc}</span></div>
      <div class="team-task-meta">
        {entry.reason && <>{t("automations.reason")} {REASON_LABEL[entry.reason] ?? entry.reason} · </>}
        {entry.outcome && <>{t("automations.result")} {outcomeLabel(entry.outcome)} · </>}
        {entry.detail && <p>{entry.detail}</p>}
        {entry.missedThroughUtc && <p>{t("automations.missed_until")} {entry.missedThroughUtc}</p>}
        {entry.sessionId && <a href={sessionHash(entry.sessionId, remoteHost(host))}>{t("automations.session_arrow")}</a>}
        {entry.teamId && <a href={`#/teams?team=${encodeURIComponent(entry.teamId)}${host ? `&host=${encodeURIComponent(host)}` : ""}`}>{t("automations.team_arrow")}</a>}
      </div>
      {/* ADR-0072: ohne Referenz gibt es keinen Abgleich — nur ein Mensch kann den Plan wieder freigeben. */}
      {entry.state === "unknown" && !entry.sessionId && !entry.teamId && (resolving === entry.claimKey
        ? <form  onSubmit={e => { e.preventDefault(); void resolve(entry.claimKey); }}>
          <label>{t("automations.abandon_note")}<input value={note} maxLength={300} required onInput={e => setNote(e.currentTarget.value)} /></label>
          <Button type="submit" disabled={offline || !note.trim()}>{t("automations.close_abandoned")}</Button>
          <Button onClick={() => { setResolving(null); setNote(""); setResolveError(""); }}>{t("common.cancel")}</Button>
          {resolveError && <div class="files-error" role="alert">{resolveError}</div>}
        </form>
        : <Button disabled={offline} onClick={() => { setResolving(entry.claimKey); setNote(""); setResolveError(""); }}>{t("automations.abandon_ab")}</Button>)}
    </li>)}</ul>}
  </div>;
}
