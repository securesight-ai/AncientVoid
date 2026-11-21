import { t } from "../../shared/i18n/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { AutomationInfo, Team } from "@ancientvoid/contracts";
import { getToken, hostApi, remoteHost, type AdapterInfo, type DiscoveredProject } from "../../shared/api.ts";
import { sessionHash } from "../../app/route.ts";
import { ApiContext, useApi } from "../../shared/api-context.ts";
import { useHubStatus } from "../shell/hub-status.ts";
import { AutomationForm } from "./AutomationForm.tsx";
import { AutomationDetail } from "./AutomationDetail.tsx";
import { automationCacheKey, readAutomationSnapshot, writeAutomationSnapshot } from "./automation-cache.ts";
import { ExternalJobsSection } from "./ExternalJobsSection.tsx";
import { outcomeLabel, REASON_LABEL, scheduleText, STATE_LABEL } from "./automation-labels.ts";
import { Button } from "../../shared/ui/index.ts";

export function AutomationsPane() {
  const [host, setHost] = useState<string | null>(null);
  const { hosts } = useHubStatus();
  const api = useMemo(() => hostApi(host), [host]);
  return <div>
    <label>{t("automations.execution_host")}<select value={host ?? ""} onChange={e => setHost(e.currentTarget.value || null)}>
      <option value="">{t("automations.this_host")}</option>{hosts.filter(h => !h.self).map(h => <option key={h.hostId} value={h.hostId}>{h.label ?? h.hostId} · {h.state}</option>)}
    </select></label>
    <ApiContext.Provider value={api}><AutomationsHostPane key={host ?? "self"} host={host} /></ApiContext.Provider>
  </div>;
}

function AutomationsHostPane({ host }: { host: string | null }) {
  const api = useApi();
  const [automations, setAutomations] = useState<AutomationInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<AutomationInfo | null>(null);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [at, setAt] = useState("");
  const [cacheKey, setCacheKey] = useState("");
  const [networkAvailable, setNetworkAvailable] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setNetworkAvailable(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void automationCacheKey(api.automationsScope, getToken()).then(key => {
      if (!alive) return;
      setCacheKey(key);
      const cached = readAutomationSnapshot(key);
      if (cached) { setAutomations(cached.list); setAt(cached.at); }
      let pending = false;
      const tick = async () => {
        if (pending || !alive) return;
        pending = true;
        try {
          const list = await api.automations();
          if (!alive) return;
          const fetchedAt = new Date().toISOString();
          setAutomations(list); setAt(fetchedAt); setOnline(true); setReadError("");
          writeAutomationSnapshot(key, { at: fetchedAt, list, histories: readAutomationSnapshot(key)?.histories ?? [] });
        } catch (err) {
          if (alive) { setOnline(false); setReadError(err instanceof Error ? err.message : "Abruf fehlgeschlagen"); }
        } finally { pending = false; }
      };
      void tick(); timer = setInterval(tick, 3000);
    }).catch(err => { if (alive) setReadError(String(err)); });
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [api]);

  useEffect(() => {
    let alive = true;
    void Promise.all([api.adapters(), api.projects(), api.teamList()]).then(([a, p, r]) => {
      if (alive) { setAdapters(a); setProjects(p.projects); setTeams(r); }
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : "Ziele nicht lesbar"); });
    return () => { alive = false; };
  }, [api]);

  const offline = !online || !networkAvailable;
  const refresh = async () => { const list = await api.automations(); setAutomations(list); };
  const selected = automations?.find(a => a.definition.id === selectedId) ?? null;
  const perform = async (info: AutomationInfo, action: "run" | "enable") => {
    if (offline || !navigator.onLine) return;
    setBusy(true); setError("");
    try {
      if (action === "enable") await api.automationSetEnabled(info.definition.id, !info.definition.enabled, info.definition.generation);
      else {
        const claim = await api.automationRunNow(info.definition.id, info.definition.generation);
        setSelectedId(info.definition.id);
        if (claim.state === "skipped" || claim.state === "unknown") setError(`${STATE_LABEL[claim.state]}: ${claim.reason ? REASON_LABEL[claim.reason] : claim.detail ?? "Start unklar"}`);
      }
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Operation fehlgeschlagen"); }
    finally { setBusy(false); }
  };

  return <div class="teams-pane" data-testid="automations-pane">
    <div class="teams-list">
      <div class="teams-list-head"><h3>{t("common.automations")}</h3><Button disabled={offline || busy} onClick={() => { setShowNew(value => !value); setEditing(null); }}>{showNew ? "Abbrechen" : "Neue Automation"}</Button></div>
      {at && <p>{t("app.data_from")} <time data-testid="automations-asof" dateTime={at}>{new Date(at).toLocaleString("de-DE")}</time></p>}
      {offline && <p role="status" data-testid="automations-offline">{t("automations.offline_locked")}</p>}
      {readError && <div class="files-error" role="alert">{readError}</div>}
      {error && <div class="files-error" role="alert" data-testid="automations-error">{error}</div>}
      {(showNew || editing) && <AutomationForm key={editing?.definition.id ?? "new"} adapters={adapters.map(a => a.id)} projects={projects.map(p => p.path)} teams={teams} editing={editing} disabled={offline}
        onSaved={() => { setShowNew(false); setEditing(null); void refresh().catch(err => setError(String(err))); }} onCancel={() => { setShowNew(false); setEditing(null); }} />}
      {/* Nutzerfinding: spontaner Lauf ohne Plan — normale Session, kein Automations-Claim (ADR-0080). */}
      <TempSessionCard adapters={adapters} projects={projects} disabled={offline} />
      <ExternalJobsSection offline={offline} cacheKey={cacheKey} />
      {automations === null ? <div class="ui-empty">{offline && readError ? "Keine gespeicherte Projektion vorhanden." : "lade…"}</div>
        : automations.length === 0 ? <div class="ui-empty">{t("automations.none_yet")}</div>
        : <ul>{automations.map(info => <li key={info.definition.id}><div class={`team-row ${info.definition.id === selectedId ? "active" : ""}`}>
          <button type="button" class="automation-row-main" onClick={() => setSelectedId(info.definition.id)}>
            <span class="team-row-title">{info.definition.label}</span><span class="team-pill" data-testid="automation-kind">{info.definition.target.kind === "session" ? "Cron-Job" : info.definition.target.kind === "team" ? "Service" : "Skript"}</span><span class="team-pill" data-testid="automation-state">{info.definition.enabled ? "aktiv" : "aus"}</span>
            <span class="team-row-meta">{scheduleText(info)} {t("automations.host_frag")} {info.definition.hostId}</span>
            <span class="team-row-meta">{t("automations.next_occurrence")} {info.nextOccurrences[0]?.local ?? "—"}</span>
            {info.lastOccurrence && <span class="team-row-meta">{t("automations.last ")} {STATE_LABEL[info.lastOccurrence.state]} {info.lastOccurrence.reason ? REASON_LABEL[info.lastOccurrence.reason] : ""} {info.lastOccurrence.outcome ? outcomeLabel(info.lastOccurrence.outcome) : ""}</span>}
          </button>
          <div class="automation-row-actions">
            <Button disabled={busy || offline} onClick={() => void perform(info, "run")}>{t("automations.start_now")}</Button>
            <Button disabled={busy || offline} onClick={() => void perform(info, "enable")}>{info.definition.enabled ? "Deaktivieren" : "Aktivieren"}</Button>
            <Button disabled={busy || offline} onClick={() => { setEditing(info); setShowNew(false); }}>{t("automations.edit")}</Button>
          </div>
        </div></li>)}</ul>}
    </div>
    {selected && <AutomationDetail info={selected} offline={offline} cacheKey={cacheKey} host={host} />}
  </div>;
}

function TempSessionCard({ adapters, projects, disabled }: { adapters: AdapterInfo[]; projects: DiscoveredProject[]; disabled: boolean }) {
  const api = useApi();
  const [harness, setHarness] = useState("");
  const [project, setProject] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Die Adapterliste kommt async — der erste Eintrag setzt den Startwert, kein geratener Fallback (BUG-0096-Muster).
    if (!harness && adapters.length > 0) setHarness(adapters[0]!.id);
  }, [adapters, harness]);
  const start = async () => {
    setError("");
    if (disabled || !navigator.onLine) { setError("Offline — Session-Start ist gesperrt."); return; }
    if (!harness || !project.trim() || !prompt.trim()) { setError("Harness, Projekt und Prompt sind Pflicht."); return; }
    setBusy(true);
    try {
      const record = await api.createSession({ adapter: harness, project: project.trim(), prompt });
      location.hash = sessionHash(record.id, remoteHost(record.hostId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session-Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };
  return <form class="automation-form automation-tempsession" data-testid="automation-tempsession" onSubmit={(e) => { e.preventDefault(); void start(); }}>
    <h4>{t("automations.start_temp_session")}</h4>
    {error && <div class="files-error" role="alert">{error}</div>}
    <div class="form-grid">
      <label>{t("status.harness")}
        <input list="tempsession-adapters" value={harness} onInput={(e) => setHarness(e.currentTarget.value)} placeholder={t("automations.dummy")} required />
      </label>
      <datalist id="tempsession-adapters">{adapters.map((a) => <option key={a.id} value={a.id} />)}</datalist>
    </div>
    <label>{t("newsession.project")}
      <input list="tempsession-projects" value={project} onInput={(e) => setProject(e.currentTarget.value)} placeholder={t("automations.path_to_repo")} required />
    </label>
    <datalist id="tempsession-projects">{projects.map((p) => <option key={p.path} value={p.path} />)}</datalist>
    <label>{t("automations.prompt")}
      <textarea rows={3} value={prompt} onInput={(e) => setPrompt(e.currentTarget.value)} placeholder={t("automations.what_session_should")} required />
    </label>
    <div class="automation-form-actions">
      <Button type="submit" disabled={busy || disabled}>{t("automations.start_session")}</Button>
    </div>
  </form>;
}
