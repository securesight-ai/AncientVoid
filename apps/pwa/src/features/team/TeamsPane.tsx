import { t } from "../../shared/i18n/index.ts";
import { ApiContext, useApi } from "../../shared/api-context.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Team } from "@ancientvoid/contracts";
import { getToken, hostApi, type AdapterInfo, type DiscoveredProject } from "../../shared/api.ts";
import { sessionHash } from "../../app/route.ts";
import { StatusDot } from "../../shared/StatusDot.tsx";
import type { DisplayInput } from "../../shared/display-state.ts";
import { ago } from "../../shared/status.ts";
import { readTeamSnapshot, teamCacheKey, writeTeamSnapshot } from "./team-cache.ts";
import { Button, Card, ConfirmDialog } from "../../shared/ui/index.ts";
/**
 * EPIC-P40/EPIC-P60 (ADR-0064, ADR-0077): Agenten-Teams in der P43-Sprache —
 * Karten je Worker-Task (T60.6), Rückfragen als auffällige Karten über dem
 * Raster (T60.5), K10: letzter Stand mit Zeitstempel offline.
 */

/** Team-/Task-Status auf den P43-Anzeigezustand heben (Contract bleibt roh in data-status). */
function teamDisplay(status: string): DisplayInput {
  switch (status) {
    case "planning":
    case "running":
    case "ready":
      return { status: "working" };
    case "awaiting_gate":
      return { status: "waiting_approval", question: true };
    case "done":
      return { status: "idle", unseen: true };
    case "failed":
    case "unknown":
      return { status: "error" };
    case "cancelled":
      return { status: "stopped" };
    // pending: ruhig warten
    default:
      return { status: "parked" };
  }
}

const STATUS_LABEL: Record<string, string> = {
  planning: "plant",
  running: "läuft",
  awaiting_gate: "Rückfrage offen",
  done: "fertig",
  failed: "fehlgeschlagen",
  cancelled: "abgebrochen",
  pending: "wartet",
  ready: "bereit",
  active: "aktiv",
  stale: "veraltet",
};

function label(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** Tonalitätskante der Task-Karte (P43: Farbe nie alleiniges Signal). */
function taskTone(status: string): "working" | "ok" | "err" | "waiting" | "quiet" {
  switch (status) {
    case "running":
    case "ready":
      return "working";
    case "done":
      return "ok";
    case "failed":
    case "unknown":
      return "err";
    case "awaiting_gate":
      return "waiting";
    default:
      return "quiet";
  }
}

function TaskCard({ task, teamTitle }: { task: Team["tasks"][number]; teamTitle: string }) {
  const current = task.dispatches[task.dispatches.length - 1];
  const disp = teamDisplay(task.status);
  return (
    <div class={`card team-task-card st-${taskTone(task.status)}`} data-testid="team-task-card" data-task={task.id}>
      <div class="row">
        <strong class="session-title">{task.title}</strong>
        <StatusDot {...disp} label={false} />
      </div>
      <p class="session-where dim">
        <span class="team-chip">{task.id}</span> {task.adapter}{task.model ? ` · ${task.model}` : " · Standardmodell"}
        {current && <> {t("team.attempt_frag")} {current.generation} ({label(current.status)})</>}
      </p>
      {task.dependsOn.length > 0 && <p class="session-where dim">{t("team.depends_on")} {task.dependsOn.join(" → ")}</p>}
      <p class="session-where dim">{label(task.status)}{task.result ? ` · ${task.result.bytes} Bytes` : ""}</p>
      {task.result && (
        <div class="team-result">
          <pre>{task.result.text.slice(0, 400)}{task.result.text.length > 400 ? "…" : ""}</pre>
          {task.result.blobRef && <p class="team-blob dim">{t("team.result_blob")} {task.result.blobRef}</p>}
        </div>
      )}
      {current && (
        <div class="team-task-card-actions">
          <a class="link-btn row-action" href={sessionHash(current.sessionId)} title={current.sessionId}>{t("team.session_arrow")}</a>
        </div>
      )}
      <span class="sr-only">{teamTitle}</span>
    </div>
  );
}

function TeamDetail({ team, onAnswer, onCancel, busy, offline }: { team: Team; onAnswer: (gateId: string, label: string) => void; onCancel: () => void; busy: boolean; offline: boolean }) {
  const done = team.tasks.filter((t) => t.status === "done").length;
  const openGates = team.gates.filter((g) => !g.answeredAt);
  const progress = team.tasks.length === 0 ? 0 : done / team.tasks.length;
  return (
    <div class="team-detail" data-testid="team-detail">
      <header class="team-detail-head">
        <h3>{team.title}</h3>
        <span class="team-pill-wrap">
          <StatusDot {...teamDisplay(team.status)} label={false} />
          <span class="status-label">{label(team.status)}</span>
        </span>
      </header>
      <p class="team-goal">{team.goal}</p>
      <p class="team-meta">
        {t("team.project_colon")} <span class="team-chip">{team.project}</span> {t("team.plan_frag")} {team.planSource === "coordinator" ? t("team.coordinator") : "übergeben"} {t("team.adapter_frag")} {team.frame.adapters.join(", ")} {t("team.parallelism_frag")} {team.frame.maxParallel}
        {team.frame.models.length > 0 && (<> {t("team.models_frag")} {team.frame.models.join(", ")}</>)}
        {team.coordinatorSessionId && (
          <> · <a href={sessionHash(team.coordinatorSessionId)}>{t("team.coordinator_session")}</a></>
        )}
      </p>
      <div class="card-plan" data-testid="team-progress" role="img" aria-label={`${done} von ${team.tasks.length} Aufgaben erledigt`}>
        <div class="card-plan-bar"><div class="card-plan-fill" style={{ transform: `scaleX(${progress})` }} /></div>
        <span class="dim">{done}/{team.tasks.length} {t("session.done")}</span>
      </div>

      {openGates.length > 0 && (
        <div class="team-gates">
          {openGates.map((gate) => (
            <Card data-testid="team-gate" key={gate.id} class="team-gate">
              <p>{gate.question}</p>
              <div class="team-gate-actions">
                {gate.options.map((opt) => (
                  <Button disabled={busy || offline} key={opt.label} onClick={() => onAnswer(gate.id, opt.label)}>
                    {opt.label}
                  </Button>
                ))}
                <Button disabled={busy || offline} onClick={onCancel} class="team-cancel">
                  {t("team.stop_team")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {team.tasks.length > 0 && (
        <div class="team-task-cards">
          {/* Stabile Keys je Task-ID: der 3-s-Poll aktualisiert Karten an Ort und Stelle (K2, kein Flackern). */}
          {team.tasks.map((task) => <TaskCard key={task.id} task={task} teamTitle={team.title} />)}
        </div>
      )}
      <p class="team-meta dim">{done}/{team.tasks.length} {t("team.tasks_done")} {team.deliveries.length} {t("team.deliveries")}</p>
    </div>
  );
}

function NewTeamForm({ adapters, projects, onCreated, offline }: { adapters: AdapterInfo[]; projects: DiscoveredProject[]; onCreated: (team: Team) => void; offline: boolean }) {
  const api = useApi();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [project, setProject] = useState(projects[0]?.name ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [coordinatorAdapter, setCoordinatorAdapter] = useState("hermes");
  const [maxParallel, setMaxParallel] = useState(2);
  /** ADR-0077 (T60.8): Modell-Allowlist — Komma-getrennt; leer = nur Adapter-Standardmodelle. */
  const [modelsText, setModelsText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const start = async () => {
    setError("");
    if (!title.trim() || !goal.trim() || selected.length === 0) {
      setError("Titel, Ziel und mindestens ein Adapter sind nötig.");
      return;
    }
    const models = modelsText.split(",").map((m) => m.trim()).filter((m) => m.length > 0);
    setBusy(true);
    try {
      const team = await api.teamStart({
        title: title.trim(),
        goal: goal.trim(),
        project,
        frame: {
          adapters: selected,
          coordinatorAdapter: coordinatorAdapter.trim() || null,
          models,
          maxTasks: 8,
          maxDispatchesPerTask: 2,
          maxParallel,
        },
        plan: null,
      });
      onCreated(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  /** Schrittfolge nach dem „Neue Session"-Muster (T60.5): Ziel → Projekt → Rahmen → Start. */
  return (
    <form class="ui-card form-grid team-new" data-testid="team-new" onSubmit={(e) => { e.preventDefault(); void start(); }}>
      <h3>{t("team.new_team")}</h3>
      <label>{t("team.title")} <input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
      <label>{t("newsession.target")} <textarea rows={3} value={goal} onInput={(e) => setGoal((e.target as HTMLTextAreaElement).value)} /></label>
      <label>{t("newsession.project")}
        <select value={project} onChange={(e) => setProject((e.currentTarget as HTMLSelectElement).value)}>
          {projects.map((p) => <option value={p.path} key={p.path}>{p.name}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>{t("team.worker_adapter")}</legend>
        {adapters.map((a) => (
          <label class="team-adapter">
            <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} /> {a.id}
          </label>
        ))}
      </fieldset>
      <div class="team-new-row">
        <label>{t("team.coordinator")} <input value={coordinatorAdapter} onInput={(e) => setCoordinatorAdapter((e.target as HTMLInputElement).value)} /></label>
        <label>{t("team.parallelism")} <input type="number" min={1} max={8} value={maxParallel} onInput={(e) => setMaxParallel(Number((e.target as HTMLInputElement).value))} /></label>
      </div>
      <label>{t("team.allowed_models")} <input value={modelsText} placeholder={t("team.empty_default")} onInput={(e) => setModelsText((e.target as HTMLInputElement).value)} /></label>
      {error && <div class="files-error" role="alert">{error}</div>}
      <Button type="submit" disabled={busy || offline} variant="primary">{t("team.start_team")}</Button>
    </form>
  );
}

export function TeamsPane({ initialHash = location.hash }: { initialHash?: string }) {
  const host = new URLSearchParams(initialHash.split("?")[1] ?? "").get("host");
  const api = useMemo(() => hostApi(host), [host]);
  return <ApiContext.Provider value={api}><TeamsHostPane key={host ?? "self"} initialHash={initialHash} /></ApiContext.Provider>;
}

function TeamsHostPane({ initialHash }: { initialHash: string }) {
  const api = useApi();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(initialHash.split("?")[1] ?? "").get("team"));
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** K10: letzter erfolgreicher Stand + Offline-Erkennung (Navigator + zwei fehlgeschlagene Polls). */
  const [at, setAt] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const failedPolls = useRef(0);
  const [hostDown, setHostDown] = useState(false);
  const offline = !online || hostDown;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void teamCacheKey(api.teamsScope, getToken()).then((key) => {
      if (!alive) return;
      // K10: gespeicherter Stand sofort zeigen, dann online auffrischen.
      const cached = readTeamSnapshot(key);
      if (cached) {
        setTeams(cached.list);
        setAt(cached.at);
      }
      let pending = false;
      const tick = async () => {
        if (pending || !alive) return;
        pending = true;
        try {
          const list = await api.teamList();
          if (!alive) return;
          failedPolls.current = 0;
          setHostDown(false);
          setTeams(list);
          const fetchedAt = new Date().toISOString();
          setAt(fetchedAt);
          setError("");
          writeTeamSnapshot(key, { at: fetchedAt, list });
        } catch (err) {
          if (!alive) return;
          // BUG-0045-Muster: erst der zweite Fehlversuch in Folge gilt als Ausfall.
          failedPolls.current++;
          if (failedPolls.current >= 2) setHostDown(true);
          setError(err instanceof Error ? err.message : "Abruf fehlgeschlagen");
        } finally {
          pending = false;
        }
      };
      void tick();
      timer = setInterval(tick, 3000);
    }).catch((err) => {
      if (alive) setError(String(err));
    });
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void api.adapters().then((a) => alive && setAdapters(a)).catch(() => {});
    void api.projects().then((p) => alive && setProjects(p.projects)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const selected = teams?.find((t) => t.id === selectedId) ?? null;

  const refresh = async () => {
    try {
      const list = await api.teamList();
      failedPolls.current = 0;
      setHostDown(false);
      const fetchedAt = new Date().toISOString();
      setAt(fetchedAt);
      setTeams(list);
      void teamCacheKey(api.teamsScope, getToken()).then((key) => writeTeamSnapshot(key, { at: fetchedAt, list })).catch(() => {});
    } catch {
      // Der nächste Poll-Tick übernimmt es.
    }
  };

  const answer = async (gateId: string, answerLabel: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const team = await api.teamAnswer(selected.id, gateId, answerLabel);
      setTeams((prev) => (prev ? prev.map((t) => (t.id === team.id ? team : t)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Antwort fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const [stopAsk, setStopAsk] = useState(false);
  const cancel = () => {
    if (!selected) return;
    setStopAsk(true);
  };
  const stopTeam = async () => {
    setStopAsk(false);
    if (!selected) return;
    setBusy(true);
    try {
      const team = await api.teamCancel(selected.id, "Vom Nutzer gestoppt");
      setTeams((prev) => (prev ? prev.map((t) => (t.id === team.id ? team : t)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Abbruch fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="teams-pane" data-testid="teams-pane">
      <div class="teams-list">
        <div class="teams-list-head">
          <h3>{t("team.teams")}</h3>
          <Button disabled={offline || busy} onClick={() => setShowNew((v) => !v)}>{showNew ? "Abbrechen" : t("team.new_team")}</Button>
        </div>
        {at && !offline && <p class="dim">{t("team.as_of")} {ago(at)}</p>}
        {offline && (
          <p role="status" data-testid="teams-offline">
            {t("team.offline_last")}{at ? <> {t("team.from_the")} <time dateTime={at}>{new Date(at).toLocaleString("de-DE")}</time></> : ""}{t("team.changes_locked")}
          </p>
        )}
        {error && !offline && <div class="files-error" role="alert">{error}</div>}
        {showNew && (
          <NewTeamForm
            adapters={adapters}
            projects={projects}
            offline={offline}
            onCreated={(team) => {
              setShowNew(false);
              setSelectedId(team.id);
              void refresh();
            }}
          />
        )}
        {teams === null ? (
          <div class="ui-empty">{offline ? "Kein gespeicherter Stand vorhanden." : "lade…"}</div>
        ) : teams.length === 0 ? (
          <Card data-testid="teams-empty">
            <h3>{t("team.no_teams")}</h3>
            <p class="dim">{t("team.team_explain")}</p>
            <Button disabled={offline} onClick={() => setShowNew(true)} variant="primary">{t("team.create_team")}</Button>
          </Card>
        ) : (
          <ul >
            {/* Stabile Keys je Team-ID: Poll-Aktualisierung ohne Flackern (K2). */}
            {teams.map((team) => {
              const done = team.tasks.filter((t) => t.status === "done").length;
              return (
                <li key={team.id}>
                  <button type="button" class={`card team-row ${team.id === selectedId ? "active" : ""}`} data-testid="team-row" onClick={() => setSelectedId(team.id)}>
                    <span class="row">
                      <strong class="session-title">{team.title}</strong>
                      <StatusDot {...teamDisplay(team.status)} label={false} />
                    </span>
                    <span class="session-where dim">{team.project || "—"} · {done}/{team.tasks.length} {t("team.done_frag")} {team.frame.adapters.join(", ")}</span>
                    <span class="session-ago dim">{ago(team.createdAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected && <TeamDetail team={selected} onAnswer={answer} onCancel={cancel} busy={busy} offline={offline} />}
      <ConfirmDialog
        open={stopAsk}
        onClose={() => setStopAsk(false)}
        onConfirm={() => void stopTeam()}
        title={t("team.stop_team")}
        body={t("team.stop_team_q")}
        danger
        confirmLabel={t("team.stop_team")}
      />
    </div>
  );
}
