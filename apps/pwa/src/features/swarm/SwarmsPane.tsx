import { t } from "../../shared/i18n/index.ts";
import { ApiContext, useApi } from "../../shared/api-context.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Swarm } from "@ancientvoid/contracts";
import { getToken, hostApi, type AdapterInfo, type DiscoveredProject } from "../../shared/api.ts";
import { sessionHash } from "../../app/route.ts";
import { StatusDot } from "../../shared/StatusDot.tsx";
import type { DisplayInput } from "../../shared/display-state.ts";
import { ago } from "../../shared/status.ts";
import { readSwarmSnapshot, swarmCacheKey, writeSwarmSnapshot } from "./swarm-cache.ts";
import { Button, Card, ConfirmDialog } from "../../shared/ui/index.ts";
/**
 * EPIC-P40/EPIC-P60 (ADR-0064, ADR-0077), EPIC-P83 (ADR-0123): Agenten-Swarms
 * (ehemals Agenten-Teams) in der P43-Sprache — Karten je Worker-Task (T60.6),
 * Rückfragen als auffällige Karten über dem Raster (T60.5), K10: letzter Stand
 * mit Zeitstempel offline.
 */

/** Swarm-/Task-Status auf den P43-Anzeigezustand heben (Contract bleibt roh in data-status). */
function swarmDisplay(status: string): DisplayInput {
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

function TaskCard({ task, swarmTitle }: { task: Swarm["tasks"][number]; swarmTitle: string }) {
  const current = task.dispatches[task.dispatches.length - 1];
  const disp = swarmDisplay(task.status);
  return (
    <div class={`card swarm-task-card st-${taskTone(task.status)}`} data-testid="swarm-task-card" data-task={task.id}>
      <div class="row">
        <strong class="session-title">{task.title}</strong>
        <StatusDot {...disp} label={false} />
      </div>
      <p class="session-where dim">
        <span class="swarm-chip">{task.id}</span> {task.adapter}{task.model ? ` · ${task.model}` : " · Standardmodell"}
        {current && <> {t("swarm.attempt_frag")} {current.generation} ({label(current.status)})</>}
      </p>
      {task.dependsOn.length > 0 && <p class="session-where dim">{t("swarm.depends_on")} {task.dependsOn.join(" → ")}</p>}
      <p class="session-where dim">{label(task.status)}{task.result ? ` · ${task.result.bytes} Bytes` : ""}</p>
      {task.result && (
        <div class="swarm-result">
          <pre>{task.result.text.slice(0, 400)}{task.result.text.length > 400 ? "…" : ""}</pre>
          {task.result.blobRef && <p class="swarm-blob dim">{t("swarm.result_blob")} {task.result.blobRef}</p>}
        </div>
      )}
      {current && (
        <div class="swarm-task-card-actions">
          <a class="link-btn row-action" href={sessionHash(current.sessionId)} title={current.sessionId}>{t("swarm.session_arrow")}</a>
        </div>
      )}
      <span class="sr-only">{swarmTitle}</span>
    </div>
  );
}

function SwarmDetail({ swarm, onAnswer, onCancel, busy, offline }: { swarm: Swarm; onAnswer: (gateId: string, label: string) => void; onCancel: () => void; busy: boolean; offline: boolean }) {
  const done = swarm.tasks.filter((t) => t.status === "done").length;
  const openGates = swarm.gates.filter((g) => !g.answeredAt);
  const progress = swarm.tasks.length === 0 ? 0 : done / swarm.tasks.length;
  return (
    <div class="swarm-detail" data-testid="swarm-detail">
      <header class="swarm-detail-head">
        <h3>{swarm.title}</h3>
        <span class="swarm-pill-wrap">
          <StatusDot {...swarmDisplay(swarm.status)} label={false} />
          <span class="status-label">{label(swarm.status)}</span>
        </span>
      </header>
      <p class="swarm-goal">{swarm.goal}</p>
      <p class="swarm-meta">
        {t("swarm.project_colon")} <span class="swarm-chip">{swarm.project}</span> {t("swarm.plan_frag")} {swarm.planSource === "coordinator" ? t("swarm.coordinator") : "übergeben"} {t("swarm.adapter_frag")} {swarm.frame.adapters.join(", ")} {t("swarm.parallelism_frag")} {swarm.frame.maxParallel}
        {swarm.frame.models.length > 0 && (<> {t("swarm.models_frag")} {swarm.frame.models.join(", ")}</>)}
        {swarm.coordinatorSessionId && (
          <> · <a href={sessionHash(swarm.coordinatorSessionId)}>{t("swarm.coordinator_session")}</a></>
        )}
      </p>
      <div class="card-plan" data-testid="swarm-progress" role="img" aria-label={`${done} von ${swarm.tasks.length} Aufgaben erledigt`}>
        <div class="card-plan-bar"><div class="card-plan-fill" style={{ transform: `scaleX(${progress})` }} /></div>
        <span class="dim">{done}/{swarm.tasks.length} {t("session.done")}</span>
      </div>

      {openGates.length > 0 && (
        <div class="swarm-gates">
          {openGates.map((gate) => (
            <Card data-testid="swarm-gate" key={gate.id} class="swarm-gate">
              <p>{gate.question}</p>
              <div class="swarm-gate-actions">
                {gate.options.map((opt) => (
                  <Button disabled={busy || offline} key={opt.label} onClick={() => onAnswer(gate.id, opt.label)}>
                    {opt.label}
                  </Button>
                ))}
                <Button disabled={busy || offline} onClick={onCancel} class="swarm-cancel">
                  {t("swarm.stop_swarm")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {swarm.tasks.length > 0 && (
        <div class="swarm-task-cards">
          {/* Stabile Keys je Task-ID: der 3-s-Poll aktualisiert Karten an Ort und Stelle (K2, kein Flackern). */}
          {swarm.tasks.map((task) => <TaskCard key={task.id} task={task} swarmTitle={swarm.title} />)}
        </div>
      )}
      <p class="swarm-meta dim">{done}/{swarm.tasks.length} {t("swarm.tasks_done")} {swarm.deliveries.length} {t("swarm.deliveries")}</p>
    </div>
  );
}

function NewSwarmForm({ adapters, projects, onCreated, offline }: { adapters: AdapterInfo[]; projects: DiscoveredProject[]; onCreated: (swarm: Swarm) => void; offline: boolean }) {
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
      const swarm = await api.swarmStart({
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
      onCreated(swarm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  /** Schrittfolge nach dem „Neue Session"-Muster (T60.5): Ziel → Projekt → Rahmen → Start. */
  return (
    <form class="ui-card form-grid swarm-new" data-testid="swarm-new" onSubmit={(e) => { e.preventDefault(); void start(); }}>
      <h3>{t("swarm.new_swarm")}</h3>
      <label>{t("swarm.title")} <input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
      <label>{t("newsession.target")} <textarea rows={3} value={goal} onInput={(e) => setGoal((e.target as HTMLTextAreaElement).value)} /></label>
      <label>{t("newsession.project")}
        <select value={project} onChange={(e) => setProject((e.currentTarget as HTMLSelectElement).value)}>
          {projects.map((p) => <option value={p.path} key={p.path}>{p.name}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>{t("swarm.worker_adapter")}</legend>
        {adapters.map((a) => (
          <label class="swarm-adapter">
            <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} /> {a.id}
          </label>
        ))}
      </fieldset>
      <div class="swarm-new-row">
        <label>{t("swarm.coordinator")} <input value={coordinatorAdapter} onInput={(e) => setCoordinatorAdapter((e.target as HTMLInputElement).value)} /></label>
        <label>{t("swarm.parallelism")} <input type="number" min={1} max={8} value={maxParallel} onInput={(e) => setMaxParallel(Number((e.target as HTMLInputElement).value))} /></label>
      </div>
      <label>{t("swarm.allowed_models")} <input value={modelsText} placeholder={t("swarm.empty_default")} onInput={(e) => setModelsText((e.target as HTMLInputElement).value)} /></label>
      {error && <div class="files-error" role="alert">{error}</div>}
      <Button type="submit" disabled={busy || offline} variant="primary">{t("swarm.start_swarm")}</Button>
    </form>
  );
}

export function SwarmsPane({ initialHash = location.hash }: { initialHash?: string }) {
  const host = new URLSearchParams(initialHash.split("?")[1] ?? "").get("host");
  const api = useMemo(() => hostApi(host), [host]);
  return <ApiContext.Provider value={api}><SwarmsHostPane key={host ?? "self"} initialHash={initialHash} /></ApiContext.Provider>;
}

function SwarmsHostPane({ initialHash }: { initialHash: string }) {
  const api = useApi();
  const [swarms, setSwarms] = useState<Swarm[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(initialHash.split("?")[1] ?? "").get("swarm"));
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
    void swarmCacheKey(api.swarmsScope, getToken()).then((key) => {
      if (!alive) return;
      // K10: gespeicherter Stand sofort zeigen, dann online auffrischen.
      const cached = readSwarmSnapshot(key);
      if (cached) {
        setSwarms(cached.list);
        setAt(cached.at);
      }
      let pending = false;
      const tick = async () => {
        if (pending || !alive) return;
        pending = true;
        try {
          const list = await api.swarmList();
          if (!alive) return;
          failedPolls.current = 0;
          setHostDown(false);
          setSwarms(list);
          const fetchedAt = new Date().toISOString();
          setAt(fetchedAt);
          setError("");
          writeSwarmSnapshot(key, { at: fetchedAt, list });
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
      clearInterval(timer);
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

  const selected = swarms?.find((t) => t.id === selectedId) ?? null;

  const refresh = async () => {
    try {
      const list = await api.swarmList();
      failedPolls.current = 0;
      setHostDown(false);
      const fetchedAt = new Date().toISOString();
      setAt(fetchedAt);
      setSwarms(list);
      void swarmCacheKey(api.swarmsScope, getToken()).then((key) => writeSwarmSnapshot(key, { at: fetchedAt, list })).catch(() => {});
    } catch {
      // Der nächste Poll-Tick übernimmt es.
    }
  };

  const answer = async (gateId: string, answerLabel: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const swarm = await api.swarmAnswer(selected.id, gateId, answerLabel);
      setSwarms((prev) => (prev ? prev.map((t) => (t.id === swarm.id ? swarm : t)) : prev));
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
  const stopSwarm = async () => {
    setStopAsk(false);
    if (!selected) return;
    setBusy(true);
    try {
      const swarm = await api.swarmCancel(selected.id, "Vom Nutzer gestoppt");
      setSwarms((prev) => (prev ? prev.map((t) => (t.id === swarm.id ? swarm : t)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Abbruch fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="swarms-pane" data-testid="swarms-pane">
      <div class="swarms-list">
        <div class="swarms-list-head">
          <h3>{t("swarm.swarms")}</h3>
          <Button disabled={offline || busy} onClick={() => setShowNew((v) => !v)}>{showNew ? "Abbrechen" : t("swarm.new_swarm")}</Button>
        </div>
        {at && !offline && <p class="dim">{t("swarm.as_of")} {ago(at)}</p>}
        {offline && (
          <p role="status" data-testid="swarms-offline">
            {t("swarm.offline_last")}{at ? <> {t("swarm.from_the")} <time dateTime={at}>{new Date(at).toLocaleString("de-DE")}</time></> : ""}{t("swarm.changes_locked")}
          </p>
        )}
        {error && !offline && <div class="files-error" role="alert">{error}</div>}
        {showNew && (
          <NewSwarmForm
            adapters={adapters}
            projects={projects}
            offline={offline}
            onCreated={(swarm) => {
              setShowNew(false);
              setSelectedId(swarm.id);
              void refresh();
            }}
          />
        )}
        {swarms === null ? (
          <div class="ui-empty">{offline ? "Kein gespeicherter Stand vorhanden." : "lade…"}</div>
        ) : swarms.length === 0 ? (
          <Card data-testid="swarms-empty">
            <h3>{t("swarm.no_swarms")}</h3>
            <p class="dim">{t("swarm.swarm_explain")}</p>
            <Button disabled={offline} onClick={() => setShowNew(true)} variant="primary">{t("swarm.create_swarm")}</Button>
          </Card>
        ) : (
          <ul >
            {/* Stabile Keys je Swarm-ID: Poll-Aktualisierung ohne Flackern (K2). */}
            {swarms.map((swarm) => {
              const done = swarm.tasks.filter((t) => t.status === "done").length;
              return (
                <li key={swarm.id}>
                  <button type="button" class={`card swarm-row ${swarm.id === selectedId ? "active" : ""}`} data-testid="swarm-row" onClick={() => setSelectedId(swarm.id)}>
                    <span class="row">
                      <strong class="session-title">{swarm.title}</strong>
                      <StatusDot {...swarmDisplay(swarm.status)} label={false} />
                    </span>
                    <span class="session-where dim">{swarm.project || "—"} · {done}/{swarm.tasks.length} {t("swarm.done_frag")} {swarm.frame.adapters.join(", ")}</span>
                    <span class="session-ago dim">{ago(swarm.createdAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected && <SwarmDetail swarm={selected} onAnswer={answer} onCancel={cancel} busy={busy} offline={offline} />}
      <ConfirmDialog
        open={stopAsk}
        onClose={() => setStopAsk(false)}
        onConfirm={() => void stopSwarm()}
        title={t("swarm.stop_swarm")}
        body={t("swarm.stop_swarm_q")}
        danger
        confirmLabel={t("swarm.stop_swarm")}
      />
    </div>
  );
}
