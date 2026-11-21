import { t } from "../../shared/i18n/index.ts";
import { WorkplaceChoice, type WorkplaceMode } from "./WorkplaceChoice.tsx";
import { CustomModelDialog } from "./CustomModelDialog.tsx";
import { takeHandOver } from "../../shared/media.ts";
import { takeShareInbox } from "../../app/share-inbox.ts";
import { sourcesBlock, sourcesOf, consumeSources, type SourceRef } from "../../shared/sources.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LoopPicker } from "../loops/LoopPicker.tsx";
import type { LoopInfo, LoopSpec } from "@ancientvoid/contracts";
import { emptyOnboard, isOnboarding, loopBlocker, type OnboardDraft } from "../loops/loop-form.ts";
import { hubApi, hostApi, type AdapterInfo, type DiscoveredProject, type FleetHost, type HubApi, type ModelOption, type SessionRecord } from "../../shared/api.ts";
import type { AttachmentRecord } from "../../shared/api.ts";
import { ApiContext } from "../../shared/api-context.ts";
import { Composer } from "../composer/Composer.tsx";
import { SkillPicker, loadSelectedWorkflow, rememberedSkill, type SelectedSkill } from "../composer/SkillOverlay.tsx";
import { Button, Card } from "../../shared/ui/index.ts";

const LAST_KEY = "ancientvoid.newSession.last";
const PROMPT_KEY = "ancientvoid.newSession.prompt";

function readLast(): { host?: string | null; adapter?: string; project?: string; loop?: LoopSpec | null } {
  try {
    return (JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") ?? {}) as { host?: string | null; adapter?: string; project?: string; loop?: LoopSpec | null };
  } catch {
    return {};
  }
}

/** EPIC-P43 T43.6: die Schnellsuche springt mit einem Projekt in „Neue Session“ — über dieselbe Merkung. */
export function preselectProject(path: string): void {
  localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), project: path }));
}

/** BUG-0096: Die Merkung ist die stärkste Quelle für den Start-Adapter —
 * die Adapterliste kann beim Mount noch leer sein (async Abruf), und der
 * alte Fallback („dummy“/erster Eintrag) blieb dann für immer stehen, weil
 * der Nachlade-Effekt einen gültig erscheinenden Wert nie korrigierte. */
export function initialAdapter(last: { adapter?: string } | undefined, adapters: readonly { id: string }[]): string {
  return last?.adapter ?? adapters[0]?.id ?? "dummy";
}

/** BUG-0188: Anlegen und Nachladen laufen über denselben (host-gebundenen)
 * API-Stub — ein neues Projekt landet auf dem gewählten Host, nicht
 * versehentlich auf dem heimischen, und Liste wie Pfad kommen von dort. */
export async function createProjectOnHost(
  api: Pick<HubApi, "createProject" | "projects">,
  name: string,
): Promise<{ projects: DiscoveredProject[]; project: string } | null> {
  const res = await api.createProject(name);
  if (!res.created && !res.project) return null;
  const list = await api.projects();
  return { projects: list.projects, project: res.project.path };
}

export function CreateSession({
  adapters: localAdapters,
  hosts,
  onCreated,
}: {
  adapters: AdapterInfo[];
  hosts: FleetHost[];
  onCreated: (s: SessionRecord) => void;
}) {
  // EPIC-P6: a session starts on exactly the chosen host.
  const selfHost = hosts.find((h) => h.self)?.hostId ?? null;
  // T8.4: start where you last started — host, harness, project — and
  // keep an unsent start prompt on this device.
  const last = useMemo(readLast, []);
  const [host, setHost] = useState<string | null>(last.host && hosts.some((h) => h.hostId === last.host) ? last.host : selfHost);
  const remote = host !== null && host !== selfHost;
  const api = useMemo(() => (remote ? hostApi(host) : hubApi), [host, remote]);
  const [remoteAdapters, setRemoteAdapters] = useState<AdapterInfo[]>([]);
  const adapters = remote ? remoteAdapters : localAdapters;
  useEffect(() => {
    if (!remote) return;
    api.adapters().then(setRemoteAdapters).catch(() => setRemoteAdapters([]));
  }, [api, remote]);
  const [adapter, setAdapterState] = useState(initialAdapter(last, adapters));
  // BUG-0105: die Wahl gilt ab dem Klick, nicht erst ab dem Start — ein Remount
  // darf sie nicht auf den zuletzt gestarteten Adapter zurückwerfen.
  const setAdapter = useCallback((id: string) => {
    setAdapterState(id);
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), adapter: id }));
    } catch {
      /* Speicher gesperrt/voll: Wahl bleibt Komponentenzustand (Merkung beim Submit). */
    }
  }, []);
  useEffect(() => {
    if (adapters.length > 0 && !adapters.some((a) => a.id === adapter)) setAdapter(adapters[0]!.id);
  }, [adapters]);
  const [project, setProject] = useState("");
  const [loop, setLoop] = useState<LoopSpec | null>(null);
  const [loopInfo, setLoopInfo] = useState<LoopInfo | null>(null);
  const [loopConfirmed, setLoopConfirmed] = useState(false);
  const [onboard, setOnboard] = useState<OnboardDraft>(emptyOnboard);
  const [loopReload, setLoopReload] = useState(0);
  const [onboardNote, setOnboardNote] = useState("");
  const loopBlock = loopBlocker(loopInfo, loop, loopConfirmed, onboard);
  // EPIC-P10.5: a video result handed over from the media page.
  const [attachments, setAttachments] = useState<AttachmentRecord[]>(() => takeHandOver("new"));
  const [prompt, setPromptState] = useState(() => localStorage.getItem(PROMPT_KEY) ?? "");
  const setPrompt = (p: string) => {
    setPromptState(p);
    if (p) localStorage.setItem(PROMPT_KEY, p);
    else localStorage.removeItem(PROMPT_KEY);
  };
  // AI-P9-2: ein Share aus einer anderen App füllt den Auftrag einmalig
  // vor — ungesendeter eigener Text bleibt, Geteiltes wird angehängt.
  useEffect(() => {
    const shared = takeShareInbox();
    if (!shared) return;
    setPromptState((p) => {
      const next = p ? `${p}\n\n${shared}` : shared;
      localStorage.setItem(PROMPT_KEY, next);
      return next;
    });
  }, []);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<DiscoveredProject[] | null>(null);
  // BUG-0173: ob Projekt-Wurzeln konfiguriert sind, ist eine eigene Tatsache —
  // die Anzahl der gefundenen Repos darf nicht als Stellvertreter herhalten.
  const [rootsInfo, setRootsInfo] = useState<{ configured: boolean; roots: string[] } | null>(null);
  // BUG-0009/0169: grindige Wurzeln und gekürzte Listen dürfen nicht verschwinden.
  const [projectWarnings, setProjectWarnings] = useState<string[]>([]);
  // T-PJ1: inline project creation (git init in first projectRoot)
  const [newProject, setNewProject] = useState("");
  const [creating, setCreating] = useState(false);
  const createNewProject = async () => {
    const name = newProject.trim();
    if (!name || creating) return;
    setCreating(true);
    setError("");
    try {
      // BUG-0188: über den host-gebundenen API-Stub (`api`), nicht hubApi —
      // sonst git-init't der heimische Hub und der Pfad stammt vom falschen Host.
      const made = await createProjectOnHost(api, name);
      if (made) {
        setNewProject("");
        setProjects(made.projects);
        setProject(made.project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };
  const [skill, setSkill] = useState<SelectedSkill | null>(null);
  // EPIC-P38: Arbeitsort — Standard eigener Worktree; „direkt“ nur bewusst gewählt.
  const [workplace, setWorkplace] = useState<WorkplaceMode>("worktree");
  const [confirmDirty, setConfirmDirty] = useState(false);
  const [workplaceBlocked, setWorkplaceBlocked] = useState(false);
  // ADR-0081: parallels Schreiben im Nicht-Git-Ordner ist eine eigene, bewusste Entscheidung.
  const [confirmShared, setConfirmShared] = useState(false);
  useEffect(() => { setConfirmDirty(false); setConfirmShared(false); }, [project, workplace]);
  // ADR-0018: a model picker only where the harness takes one at start,
  // filled from its catalog when it has one, else free text.
  const features = adapters.find((a) => a.id === adapter)?.capabilities.features;
  const modelChoice = features?.modelChoice === "start";
  const [model, setModel] = useState("");
  // ADR-0033: leer = Standard des Hubs (Auto, wo der Harness es kennt).
  const modes = features?.permissionModes ?? [];
  const [mode, setMode] = useState("");
  useEffect(() => setMode(""), [adapter]);
  const [catalog, setCatalog] = useState<ModelOption[] | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  // ADR-0060: eigene Modelle/Endpunkte; `catalogTick` lädt den Katalog nach dem Anlegen neu.
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [catalogTick, setCatalogTick] = useState(0);
  const pendingPick = useRef<string | null>(null);
  useEffect(() => {
    setModel("");
    setCatalog(null);
    setDefaultModel(null);
    setCustomIds([]);
    if (!modelChoice) return;
    let alive = true;
    api
      .adapterModels(adapter)
      .then((res) => {
        if (!alive) return;
        setCatalog(res.models);
        setDefaultModel(res.defaultModel);
        setCustomIds(res.customIds ?? []);
        // The registration's default is what "Standard des Harness" runs —
        // preselect it so the dropdown shows the actual model from the start.
        if (pendingPick.current) setModel(pendingPick.current);
        else if (typeof res.defaultModel === "string" && res.defaultModel) setModel(res.defaultModel);
        pendingPick.current = null;
      })
      .catch(() => alive && setCatalog(null));
    return () => {
      alive = false;
    };
  }, [adapter, modelChoice, api, catalogTick]);

  useEffect(() => {
    let alive = true;
    setProjects(null);
    setProject("");
    api
      .projects()
      .then((res) => {
        if (!alive) return;
        setProjects(res.projects);
        setRootsInfo({ configured: res.rootsConfigured ?? res.projects.length > 0, roots: res.roots ?? [] });
        setProjectWarnings(res.warnings ?? []);
        // Preselect the first discovered project so "Starten" works
        // without any typing when a picker is shown. BUG-0173: der gemerkte
        // Pfad gilt auch dann, wenn gar kein Git-Repo gefunden wurde — sonst
        // tippen Nutzer, die ohne Git arbeiten, jeden Tag alles neu.
        setProject((p) => p || last.project || res.projects[0]?.path || "");
      })
      .catch(() => {
        // T1.5-5: an unreachable /api/projects must not make the form
        // unusable — fall back to the free-text path exactly as if no
        // projectRoots were configured (BUG-0006 lesson: onboarding paths
        // must never become a dead end).
        if (alive) setProjects([]);
        if (alive) setRootsInfo(null);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  // T1.5-10: the last skill/agent chosen FOR THIS PROJECT is always the
  // default (user's own requirement — "so dass man nicht immer auswählen
  // muss aber kann") — reloaded whenever the selected project changes.
  // BUG-0078: only for adapters that support its kind, otherwise the hub
  // would refuse the whole start (the picker stays hidden there).
  useEffect(() => {
    setSkill(rememberedSkill(project, features));
  }, [project, features]);

  const withWorkflow = (text: string): string => {
    if (skill || !project) return text;
    const name = loadSelectedWorkflow(project);
    if (!name) return text;
    const line = `Workflow: ${name}\n\n`;
    return text.startsWith(line) ? text : `${line}${text}`;
  };

  // EPIC-P43.5 T43.5-1: Quellenchips der Neuanlage wandern beim Start in den
  // Prompt/Auftrag — dieselbe Blockform wie die Composer-Vorschau, danach verbraucht.
  const withSources = (text: string, sources: SourceRef[]): string => {
    if (sources.length === 0) return text;
    return `${text}${text.trim() ? "\n\n" : ""}${sourcesBlock(sources)}`;
  };

  // BUG-0105: nur claude/maki sind Factory-Treiber — eine ersetzte Wahl wird
  // gesagt (fail loud), nie still getauscht.
  const [replacedDriver, setReplacedDriver] = useState<string | null>(null);
  useEffect(() => {
    setReplacedDriver(null);
  }, [loop?.id]);
  useEffect(() => {
    if (loop?.id === "securesight-factory" && !["claude", "maki"].includes(adapter)) {
      setReplacedDriver(adapter);
      setAdapter("claude");
    }
  }, [loop?.id, adapter, setAdapter]);

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      // T1.5-3: no budgetUsd input — the user works exclusively with
      // coding subscriptions, where a $ figure per session doesn't answer
      // anything real (see the Kontingent display instead). The contract
      // field itself is untouched (createSession still accepts it) for P2
      // to build on for API-key-billed adapters.
      let startLoop = loop;
      // Neues Repo: erst die Linie einrichten (factoryctl), dann die Session auf ihr starten.
      const ob = loopInfo?.capabilities?.onboarding;
      if (loop && ob && isOnboarding(loopInfo, loop)) {
        setOnboardNote(t("newsession.line_creating"));
        const made = await api.onboardLoop(loop.id, { options: onboard.values, secret: onboard.secret });
        setOnboardNote("");
        if (!made.ok) throw new Error(made.detail);
        startLoop = { ...loop, options: { ...loop.options, [ob.optionKey]: made.options[ob.optionKey] ?? "" } };
        setLoop(startLoop);
        setOnboard(emptyOnboard);
        setLoopReload((n) => n + 1);
        // AC-P26-1 / Premortem 2: „bereit“ nur, wenn die Factory es meldet — sonst die Checkliste zeigen und nicht starten.
        if (made.ready === false) {
          setOnboardNote(t("newsession.setup_incomplete", { "detail": made.detail ?? t("newsession.check_factory_list") }));
          return;
        }
        if (made.detail) setOnboardNote(t("session.setup_of", { "detail": made.detail }));
      }
      // EPIC-P26 T26.5 (ADR-0043): securesight „bestehend“ startet den
      // Factory-Lauf — Treiber (/factory mit dem Auftrag als Prompt) plus
      // verknüpfter Beobachter. Die Treiberwahl bleibt erhalten (ADR-0048).
      const factoryRun = startLoop?.id === "securesight-factory" && !isOnboarding(loopInfo, startLoop);
      const selectedSources = sourcesOf("new");
      const rec = factoryRun
        ? (await api.factoryStart({ project, adapter, ...(modelChoice && model.trim() ? { model: model.trim() } : {}), ...(prompt ? { goal: withSources(prompt, selectedSources) } : {}) })).driver
        : await api.createSession({
            ...(startLoop ? { loop: startLoop } : { adapter }),
            project,
            ...(prompt ? { prompt: withSources(withWorkflow(prompt), selectedSources) } : {}),
            ...(modelChoice && model.trim() ? { model: model.trim() } : {}),
            ...(skill || mode ? { args: { ...(skill ? { [skill.kind]: skill.name } : {}), ...(mode ? { permissionMode: mode } : {}) } } : {}),
            ...(attachments.length > 0 ? { attachmentIds: attachments.map((a) => a.id) } : {}),
            // Loops arbeiten immer im Projekt des Loop-Systems — dort gibt es keine Arbeitsort-Wahl.
            ...(startLoop ? {} : { workspaceMode: workplace, ...(workplace === "direct" && confirmDirty ? { confirmDirty: true } : {}), ...(workplace === "direct" && confirmShared ? { confirmSharedFolder: true } : {}) }),
          });
      localStorage.removeItem(PROMPT_KEY);
      localStorage.setItem(LAST_KEY, JSON.stringify({ host, adapter, project, loop: startLoop }));
      consumeSources("new", selectedSources);
      onCreated(rec);
    } catch (err) {
      setOnboardNote("");
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <ApiContext.Provider value={api}>
    {/* BUG-0244: zwei Spalten ab ausreichender Kachelbreite (Container-Query), weniger Scrollen am PC/Tablet. */}
    <Card class="form-grid new-session-form">
      <div class="new-session-col">
      {/* BUG-0188: Der Host führt das Formular an — Pfad, wählbares Repo,
          Adapter und Skills hängen alle von ihm ab; erst danach folgen
          Projekt und Pfad. */}
      {hosts.length > 1 && (
        <label>
          {t("common.host")}
          <select value={host ?? ""} onChange={(e) => setHost((e.target as HTMLSelectElement).value)}>
            {hosts.map((h) => (
              <option key={h.hostId} value={h.hostId} disabled={h.state !== "reachable"}>
                {h.hostId}
                {h.self ? t("newsession.this_suffix") : h.state !== "reachable" ? ` (${h.state})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t("newsession.project")}
        {projects === null ? (
          <input disabled placeholder="lade…" />
        ) : projects.length > 0 ? (
          <select
            value={projects.some((p) => p.path === project) ? project : ""}
            onChange={(e) => setProject((e.target as HTMLSelectElement).value)}
          >
            {projects.every((p) => p.path !== project) && <option value="">{t("newsession.own_path_below")}</option>}
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
                {p.branch ? ` (${p.branch})` : ""}
              </option>
            ))}
          </select>
        ) : rootsInfo?.configured ? (
          <span class="dim" style="font-size: calc(11px * var(--font-scale, 1))">
            {t("newsession.no_git_repo_in_roots")}{rootsInfo.roots.join(", ")}{t("newsession.type_path_note")}
          </span>
        ) : (
          <span class="dim" style="font-size: calc(11px * var(--font-scale, 1))">
            {t("newsession.no_project_roots")}
          </span>
        )}
      </label>
      {projectWarnings.length > 0 && (
        <ul class="dim form-warnings">
          {projectWarnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {projects !== null && (rootsInfo?.configured ?? projects.length > 0) && (
        <div class="form-inline-row">
          <input
            class="form-inline-grow"
            value={newProject}
            onInput={(e) => setNewProject((e.target as HTMLInputElement).value)}
            placeholder={t("newsession.new_project_name")}
          />
          <button type="button" disabled={!newProject.trim() || creating} onClick={createNewProject}>
            {creating ? "…" : t("newsession.add_create")}
          </button>
        </div>
      )}
      <label>
        {t("newsession.path")}
        <input
          value={project}
          onInput={(e) => setProject((e.target as HTMLInputElement).value)}
          placeholder="/home/user/repo"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
        />
      </label>
      </div>
      <div class="new-session-col">
      <LoopPicker api={api} value={loop} confirmed={loopConfirmed} onConfirmed={setLoopConfirmed} onChange={(next, info) => { setLoop(next); setLoopInfo(info); setOnboard(emptyOnboard); }} onboard={onboard} onOnboard={setOnboard} reload={loopReload} initial={last.loop ?? null} project={project} />
      {(!loop || loop.id === "securesight-factory") && (
        <>
      <label>
        {loop ? t("newsession.factory_driver") : t("newsession.adapter")}
        <select value={adapter} onChange={(e) => { setReplacedDriver(null); setAdapter((e.target as HTMLSelectElement).value); }}>
          {adapters.filter((a) => !loop || ["claude", "maki"].includes(a.id)).map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}
              {a.capabilities.features && !a.capabilities.features.followUp ? t("newsession.observe_only_suffix") : ""}
            </option>
          ))}
        </select>
      </label>
      {loop?.id === "securesight-factory" && replacedDriver && (
        <div class="tool-gate warn" role="status">
          {t("newsession.factory_driver_only")}{replacedDriver}{t("newsession.was_replaced")}
        </div>
      )}
      {features?.toolGate === "bypass" && (
        <div class="tool-gate warn">{adapter}{t("newsession.tools_run_unasked")}</div>
      )}
      {!loop && modes.length > 0 && (
        <label>
          {t("common.mode")}
          <select aria-label={t("common.mode")} value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value)}>
            <option value="">{t("common.hub_default")}</option>
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      {modelChoice && (
        <label>
          {loop ? t("newsession.driver_model") : t("common.model")}
          {catalog && catalog.length > 0 ? (
            <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}>
              <option value="">{t("session.harness_default")}</option>
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? m.id}
                  {m.id === defaultModel ? t("newsession.default_suffix") : ""}
                  {customIds.includes(m.id) ? t("newsession.own_suffix") : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onInput={(e) => setModel((e.target as HTMLInputElement).value)}
              placeholder={t("session.harness_default")}
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
            />
          )}
        </label>
      )}
      {modelChoice && (
        <Button onClick={() => setCustomOpen(true)} style="justify-self: start">
          {t("newsession.add_own_model_endpoint")}
        </Button>
      )}
      {customOpen && (
        <CustomModelDialog
          adapter={adapter}
          canEndpoint={adapter === "pi"}
          api={api}
          onClose={() => setCustomOpen(false)}
          onChanged={(pick) => {
            if (pick) pendingPick.current = pick;
            setCatalogTick((t) => t + 1);
          }}
        />
      )}
        </>
      )}
      </div>
      <div class="new-session-span">
      <label>
        {t("newsession.prompt_optional")}
        <Composer
          value={prompt}
          onChange={setPrompt}
          fieldId="new_prompt"
          placeholder={t("newsession.example_prompt")}
          adapter={adapter}
          project={project}
          adapterEnhance={adapters.find((a) => a.id === adapter)?.enhance}
          commands={adapters.find((a) => a.id === adapter)?.capabilities.commands}
          commandScope="start"
          onUseRecommendation={(item) => setSkill(item)}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          sourceTarget="new"
          onSubmit={busy || !project || loopBlock ? undefined : () => void submit()}
        />
      </label>
      {!loop && project && (
        <WorkplaceChoice api={api} project={project} mode={workplace} onMode={setWorkplace} confirmDirty={confirmDirty} onConfirmDirty={setConfirmDirty} confirmShared={confirmShared} onConfirmShared={setConfirmShared} onBlockedChange={setWorkplaceBlocked} />
      )}
      {error && <div role="alert" style="color: var(--err)">{error}</div>}
      {!loop && <SkillPicker project={project} supported={Boolean(features?.skills || features?.agents)} selection={skill} onChange={setSkill} />}
      {loopBlock && loop && <div class="loop-block warn" role="alert">{loopBlock}</div>}
      {onboardNote && <div class="dim" role="status">{onboardNote}</div>}
      <Button  aria-busy={busy} onClick={submit} disabled={busy || !project || !!loopBlock || (!loop && workplaceBlocked)} variant="primary" class={busy ? "busy" : undefined}>
        {busy ? "lädt…" : t("newsession.start")}
      </Button>
      </div>
    </Card>
    </ApiContext.Provider>
  );
}
