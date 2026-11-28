import { fmtTime } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";
import { Sheet, Button, Chip, ConfirmDialog, EmptyState, Card } from "../../shared/ui/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { registerField } from "../../shared/command-context.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import type { ApprovalRequest, DiscoveredProject, FleetHost, SessionRecord } from "../../shared/api.ts";
import { hostApi, hubApi, remoteHost } from "../../shared/api.ts";
import { graphHash, sessionHash, FOUND_HASH_ALIAS } from "../../app/route.ts";
import { HandoverForm } from "../session/Handover.tsx";
import { targetKey } from "../windows/protocol.ts";
import { TabIcon } from "../../shared/TabIcon.tsx";
import { useOpenWindows } from "../windows/windows.ts";
import { isLastSession, type LastSession } from "../shell/last-session.ts";
import { compareByActivity, sessionsForOverview } from "./session-list.ts";
import { compareQueue, decidableOnCard, pendingFor, quietOpen, SECTION_ORDER, SECTION_TITLE, sectionOf, type Section } from "./queue.ts";
import { CardDecision } from "../approvals/Approvals.tsx";
import { loadTail } from "../session/tail-cache.ts";
import { runProgress } from "../session/run-progress.ts";
import { metricView, totalCostText } from "../../shared/metrics.ts";
import { ago } from "../../shared/status.ts";
import { StatusDot } from "../../shared/StatusDot.tsx";
import { StartGuide, FirstSuccessSignal } from "./StartGuide.tsx";
import { emptyText, showStartGuide } from "./start-guide.ts";
import { initSeen, isUnseen, seenKey } from "../../shared/seen.ts";
import { DiscoveryPane } from "../discovery/Discovery.tsx";
import { projectName } from "../../shared/project-name.ts";
import { filterWithHits, hitKey, hitsBySession, topHit, type ContentHit } from "./content-hits.ts";

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Known window ids get a German label; anything else (future adapters —
 * zai, swarm, local-llm) shows its raw id rather than guessing a label. */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d",
};

export function formatWindow(w: { id: string; utilization: number; resetsAt: string }): string {
  const label = WINDOW_LABELS[w.id] ?? w.id;
  const pct = Math.round(w.utilization * 100);
  const reset = fmtTime(w.resetsAt);
  return `${label} ${pct}% · reset ${reset}`;
}

export interface DashboardProps {
  sessions: SessionRecord[];
  /** EPIC-P6: the fleet's hosts; more than one groups the overview by host. */
  hosts?: FleetHost[];
  onOpen: (session: SessionRecord, opts?: { newTile?: boolean; seq?: number }) => void;
  /** T2.6: pending approval-queue count (0 on a hub without approvals
   * configured — not distinguished from "genuinely zero pending" here,
   * since either way there's nothing for the banner to show). */
  pendingApprovals?: number;
  /** EPIC-P43 T43.3: die offenen Anfragen dieses Hubs — Zustand „Frage“ und Entscheidung auf der Karte. */
  approvals?: ApprovalRequest[];
  onOpenApprovals?: () => void;
  /** EPIC-P23 T23.1: the session worked in last on this device — marked and brought into view. */
  lastSession?: LastSession | null;
  /** EPIC-P57 T57.9: der Testadapter „dummy“ ist registriert — der Einstieg bietet dann die Probe-Session an. */
  probeAvailable?: boolean;
  /** EPIC-P86 T86.7: Session-Id → Nummer der Kachel (1–4), in der sie rechts offen ist (PC-Spalte; Schlüssel wie tileRefOf). */
  tileNos?: Map<string, number>;
}

/**
 * T1.5 Monitor-Dashboard.
 *
 * Grouped by PROJECT, not "Rechner" (machine): EPIC-P1 §2 describes
 * "Rechner-Kacheln → Projekte → Sessions", which assumes a PWA aggregating
 * several hubs on different machines. That doesn't exist — one PWA talks
 * to exactly one hub (one server process, hence one machine) via
 * relative /api/* paths (see api.ts); there's no multi-hub registry or
 * config anywhere in the codebase to group by. Project is the real,
 * present grouping key today. Revisit this component if/when multi-hub
 * aggregation becomes its own task — don't build that scaffolding on
 * spec now (architecture-best-practices: no seam without a second
 * caller).
 *
 * Traffic-light: reuses the existing `.pill.<status>` color coding
 * (ok/warn/err/dim, see app/styles/) rather than adding a second,
 * redundant status-color indicator next to it.
 */
const HOST_STATE_LABEL: Record<FleetHost["state"], string> = {
  reachable: t("common.connected"),
  stale: "veraltet",
  offline: "offline",
  incompatible: "inkompatibel",
  unauthorized: "Zugriff entzogen",
};

const RECENT_LIMIT = 15;
const QUIET_KEY = "ancientvoid.overview.quietOpen";

/** Gruppe einer Session auf diesem Gerät (der Lesezeiger entscheidet über „fertig“). */
function section(s: SessionRecord): Section {
  return sectionOf(s, isUnseen(seenKey(s.hostId ?? "", s.id), s.lastSeq));
}

/**
 * Planfortschritt einer arbeitenden Session — nur aus dem, was dieses Gerät vom Verlauf wirklich hat
 * (Tail-Cache der Session-Ansicht) und nur, wenn der Stand aktuell ist. Sonst keine Zahl (ADR-0023:
 * lieber nichts als geraten).
 */
function planOf(session: SessionRecord): { done: number; total: number } | null {
  const tail = loadTail(remoteHost(session.hostId) ?? "local", session.id);
  if (!tail || (tail.events.at(-1)?.seq ?? 0) < session.lastSeq) return null;
  const progress = runProgress(tail.events, session.status);
  return progress && progress.source === "todos" && progress.total > 0 ? { done: progress.done, total: progress.total } : null;
}

function matches(s: SessionRecord, q: string): boolean {
  if (!q) return true;
  const hay = `${s.title ?? ""} ${s.project} ${s.hostId ?? ""} ${s.adapter} ${s.model ?? ""} ${s.lastActivity?.text ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function sessionKey(s: SessionRecord): string {
  return seenKey(s.hostId ?? "", s.id);
}

/** EPIC-P47: Ansicht der Übersicht — Sessions (Karten), Projekte, Hosts oder Discovery (T47.5). */
type OverviewView = "sessions" | "projects" | "hosts" | "discovery";
const VIEW_KEY = "ancientvoid.overviewView";
// Kein vierter Tab „Gefunden“ (Nutzerentscheid 2026-11-21): genau ein Einstieg — der Chip rechts
// vom Archiv-Button der Session-Ansicht. Der Deeplink #/gefunden bleibt (FOUND_HASH_ALIAS unten).
const VIEWS = ["sessions", "projects", "hosts"] as const;
const VIEW_TITLE: Record<(typeof VIEWS)[number], string> = { sessions: t("common.sessions_cap"), projects: t("common.projects"), hosts: t("common.hosts") };

export function Dashboard({ sessions, hosts = [], onOpen, pendingApprovals = 0, approvals = [], onOpenApprovals, lastSession = null, probeAvailable = false, tileNos }: DashboardProps) {
  const windowKeys = new Set(Object.values(useOpenWindows()).map((e) => targetKey(e.target)));
  // Once per visit (not per 3 s poll): bring the remembered session into view.
  const hasSessions = sessions.length > 0;
  useEffect(() => {
    document.querySelector(".session-card[aria-current]")?.scrollIntoView?.({ block: "nearest" });
  }, [lastSession?.sessionId, hasSessions]);
  const [showArchived, setShowArchived] = useState(false);
  const [override, setOverride] = useState<Record<string, Partial<SessionRecord>>>({});
  const [actionError, setActionError] = useState("");
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const deleteInFlight = useRef(false);
  const [query, setQuery] = useState("");
  // Der Sitzungsfilter ist für viele der eine Weg zu einer Sitzung — und gesucht
  // wird nach ihrem **Inhalt**, nicht nach ihrem Titel. Darum läuft parallel eine
  // Sitzungstext-Suche; ihre Fundstellen hängen an der Kachel und sind das
  // Sprungziel, wenn die Kachel geöffnet wird.
  const [contentHits, setContentHits] = useState<Map<string, ContentHit>>(new Map());
  const [contentTotal, setContentTotal] = useState<number | null>(null);
  const contentSeq = useRef(0);
  const [allRecent, setAllRecent] = useState(false);
  // T9.4: "Zeig wartende Sessions" narrows the overview; the chip undoes it.
  const [statusFilter, setStatusFilter] = useState(() => sessionStorage.getItem("ancientvoid.overviewFilter") ?? "all");
  useEffect(() => {
    const on = (e: Event) => setStatusFilter(String((e as CustomEvent<string>).detail ?? "all"));
    window.addEventListener("ancientvoid:overview-filter", on);
    return () => window.removeEventListener("ancientvoid:overview-filter", on);
  }, []);
  // EPIC-P47: Ansicht gerätelokal merken — gleiche Mechanik wie der Statusfilter.
  const [view, setView] = useState<OverviewView>(() => {
    const v = sessionStorage.getItem(VIEW_KEY);
    return v === "projects" || v === "hosts" || v === "discovery" ? v : "sessions";
  });
  const setOverviewView = (v: OverviewView) => {
    sessionStorage.setItem(VIEW_KEY, v);
    setView(v);
  };
  // EPIC-P47 §3.4 (T47.5): `#/gefunden` bleibt als Deeplink und Befehlsfeld-Ziel erhalten und
  // springt auf den Discovery-State — ein eigener Menüpunkt existiert nicht mehr.
  useEffect(() => {
    const apply = () => {
      if (location.hash === FOUND_HASH_ALIAS) setView("discovery");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  // Host-Karten der Hosts-Ansicht filtern hierauf; der Chip löst den Filter wieder.
  const [hostFilter, setHostFilter] = useState<string | null>(null);
  const [projects, setProjects] = useState<DiscoveredProject[] | null>(null);
  const [projectsWarning, setProjectsWarning] = useState("");
  useEffect(() => {
    if (view !== "projects") return;
    let alive = true;
    hubApi
      .projects()
      .then((r) => {
        if (!alive) return;
        setProjects(r.projects);
        setProjectsWarning(r.warnings.join(" · "));
      })
      .catch((err: unknown) => {
        if (alive) setProjectsWarning(err instanceof Error ? err.message : t("common.projects_unreachable"));
      });
    return () => {
      alive = false;
    };
  }, [view]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      contentSeq.current += 1;
      setContentHits(new Map());
      setContentTotal(null);
      return;
    }
    const seq = ++contentSeq.current;
    const timer = setTimeout(() => {
      hubApi
        .searchAll({ q, scope: "sessions", limit: 60 })
        .then((r) => {
          if (seq !== contentSeq.current) return;
          setContentHits(hitsBySession(r.sessions));
          setContentTotal(r.sessionTotal);
        })
        .catch(() => {
          if (seq !== contentSeq.current) return;
          setContentHits(new Map());
          setContentTotal(null);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => registerField("session_filter", { get: () => queryRef.current, set: setQuery }), []);
  // T8.6: first run on this device — what exists now counts as read. App mounts
  // this only after the first loaded list, so an empty hub records an empty
  // cursor; otherwise the first sessions to arrive would count as read (BUG-0147).
  useEffect(() => {
    initSeen(sessions.map((s) => ({ key: seenKey(s.hostId ?? "", s.id), lastSeq: s.lastSeq })));
  }, []);

  // Local changes win until the next poll reports the same value.
  useEffect(() => {
    setOverride((prev) => {
      const next: Record<string, Partial<SessionRecord>> = {};
      for (const [id, patch] of Object.entries(prev)) {
        const server = sessions.find((s) => s.id === id);
        if (server && Object.entries(patch).some(([k, v]) => server[k as keyof SessionRecord] !== v)) next[id] = patch;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [sessions]);
  const withOverride = useMemo(
    () => sessions.filter((s) => !deleted.has(sessionKey(s))).map((s) => (override[s.id] ? { ...s, ...override[s.id] } : s)),
    [sessions, override, deleted],
  );
  const visible = useMemo(() => {
    const base = sessionsForOverview(withOverride, showArchived)
      .filter((s) => (hostFilter ? (s.hostId ?? "local") === hostFilter : true))
      // „wartende“ (Sprachbefehl T9.4) heißt blockiert: Freigabe, Frage, Fehler — ein fertiger Zug wartet nicht.
      .filter((s) => showArchived || (statusFilter === "waiting" ? sectionOf(s) === "braucht" /* i18n-ignore: Daten-Key */ : statusFilter === "active" ? section(s) === "aktiv" /* i18n-ignore: Daten-Key */ || section(s) === "braucht" /* i18n-ignore: Daten-Key */ : true));
    // Titel-Treffer **und** Inhalts-Treffer: eine Sitzung, in der etwas gebaut
    // wurde, ist gefunden, auch wenn ihr Titel nichts davon weiß.
    return filterWithHits(base, (x) => matches(x, query.trim()), contentHits);
  }, [withOverride, showArchived, query, statusFilter, hostFilter, contentHits]);
  const sorted = useMemo(() => [...visible].sort(compareByActivity), [visible]);
  const selectedVisible = sorted.filter((s) => selected.has(sessionKey(s)));
  // Entschiedene Anfragen verschwinden sofort; der nächste Abruf bestätigt es.
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const open = useMemo(() => approvals.filter((a) => !decided.has(a.id)), [approvals, decided]);
  const sections = useMemo(() => {
    const out: Record<Section, SessionRecord[]> = { braucht: [], aktiv: [], pins: [], zuletzt: [] };
    for (const s of sorted) out[showArchived ? "zuletzt" /* i18n-ignore: Daten-Key */ : section(s)].push(s);
    out.braucht.sort(compareQueue((s) => (remoteHost(s.hostId) ? null : (pendingFor(open, s.id)?.timeoutAt ?? null))));
    return out;
  }, [sorted, showArchived, open]);
  // „Ruhig“ auf/zu ist Gerätezustand (K7): null = der Start entscheidet (zu, solange oben etwas steht).
  const [quietChoice, setQuietChoice] = useState<boolean | null>(() => {
    const v = localStorage.getItem(QUIET_KEY);
    return v === null ? null : v === "1";
  });
  const counts = { braucht: sections.braucht.length, aktiv: sections.aktiv.length, pins: sections.pins.length, zuletzt: sections.zuletzt.length };
  const quietShown = quietOpen(quietChoice, counts, showArchived || query.trim() !== "" || hostFilter !== null || statusFilter === "recent");
  // Wandern: eine Karte, die die Gruppe gewechselt hat, kommt an ihrem neuen Ort an. Die Karte
  // entsteht in der neuen Gruppe neu; die Klasse bleibt, damit ein Neuzeichnen (Abruf alle 3 s) die
  // laufende Bewegung nicht abschneidet.
  const lastSection = useRef(new Map<string, Section>());
  const moved = useRef(new Set<string>());
  for (const key of SECTION_ORDER)
    for (const s of sections[key]) {
      const id = `${s.hostId ?? ""}:${s.id}`;
      const before = lastSection.current.get(id);
      if (before !== undefined && before !== key) moved.current.add(id);
      lastSection.current.set(id, key);
    }

  // ADR-0023: a sum with unknown parts is no number — shown only when any
  // session of today reported a cost at all.
  const today = useMemo(() => sessions.filter((s) => s.createdAt.slice(0, 10) === todayKey()), [sessions]);
  const todayCost = today.some((s) => s.metrics && s.metrics.cost !== "unknown") ? totalCostText(today, formatUsd) : null;
  const archivedCount = withOverride.filter((s) => s.archived === true).length;

  const change = async (session: SessionRecord, patch: Partial<SessionRecord>, call: () => Promise<unknown>) => {
    setOverride((prev) => ({ ...prev, [session.id]: { ...prev[session.id], ...patch } }));
    try {
      await call();
      setActionError("");
    } catch (err) {
      setOverride((prev) => ({ ...prev, [session.id]: {} }));
      setActionError(err instanceof Error ? err.message : t("common.change_failed"));
    }
  };
  const archive = (s: SessionRecord) => change(s, { archived: !s.archived }, () => hostApi(s.hostId).setArchived(s.id, !s.archived));
  const pin = (s: SessionRecord) => change(s, { pinned: !s.pinned }, () => hostApi(s.hostId).setSessionMeta(s.id, { pinned: !s.pinned }));
  // Löschen fragt im Base-Modal nach (kein Browser-confirm): die Auswahl
  // bleibt bis zur Antwort liegen, Abbrechen lässt alles wie es war.
  const [deleteAsk, setDeleteAsk] = useState<SessionRecord[] | null>(null);
  const remove = (targets: SessionRecord[]) => {
    if (deleteInFlight.current || targets.length === 0) return;
    setDeleteAsk(targets);
  };
  const removeConfirmed = async () => {
    const targets = deleteAsk ?? [];
    setDeleteAsk(null);
    if (deleteInFlight.current || targets.length === 0) return;
    deleteInFlight.current = true;
    setDeleting(true);
    setActionError("");
    const failures: string[] = [];
    try {
      for (const s of targets) {
        const key = sessionKey(s);
        try {
          await hostApi(s.hostId).deleteSession(s.id);
          setDeleted((prev) => new Set(prev).add(key));
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : t("common.delete_failed");
          failures.push(t("common.confirm_name_message", { "name": s.title ?? projectName(s.project), "message": message }));
        }
      }
      if (failures.length) setActionError(t("common.delete_fail", { "failed": failures.length, "total": targets.length, "failures": failures.join(" · ") }));
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  };

  return (
    <div class="dashboard">
      {actionError && <div class="reply-error" role="alert">{actionError}</div>}
      {/* EPIC-P47 T47.1: ein Umschalter statt der rein informativen Host-Chips. */}
      <div class="overview-switch" role="tablist" aria-label={t("common.overview_view")}>
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} class={`chip${view === v ? " active" : ""}`} data-testid="overview-switch-btn" onClick={() => setOverviewView(v)}>
            {VIEW_TITLE[v]}
          </button>
        ))}
      </div>
      {view === "projects" && <ProjectsView projects={projects} warning={projectsWarning} sessions={withOverride} />}
      {view === "discovery" && <DiscoveryPane onOpen={onOpen} />}
      {view === "hosts" && (
        <HostsView
          hosts={hosts}
          sessions={withOverride}
          onPick={(id) => {
            setHostFilter(id);
            setOverviewView("sessions");
          }}
        />
      )}
      {view === "sessions" && (
        <>
          <FirstSuccessSignal />
          <div class="dashboard-summary dim">
            {todayCost && <span>{t("common.today")} {todayCost}</span>}
            <button class={`chip ${showArchived ? "active" : ""}`} type="button" onClick={() => {
              setSelected(new Set());
              setShowArchived((on) => !on);
            }}>
              {showArchived ? t("common.actives") : `Archiv${archivedCount > 0 ? ` (${archivedCount})` : ""}`}
            </button>
            <Chip onClick={() => setOverviewView("discovery")}>
              {t("common.found")}
            </Chip>
          </div>
          {!showArchived && statusFilter !== "all" && statusFilter !== "recent" && (
            <Chip
              onClick={() => {
                sessionStorage.removeItem("ancientvoid.overviewFilter");
                setStatusFilter("all");
              }}
              active
              class="status-filter"
              data-testid="status-filter"
            >
              {statusFilter === "waiting" ? t("common.only_waiting") : t("common.only_active")} ✕
            </Chip>
          )}
          {hostFilter && (
            <Chip onClick={() => setHostFilter(null)} active class="status-filter" data-testid="status-filter">
              {t("common.host_colon")} {hostLabel(hosts, hostFilter)} ✕
            </Chip>
          )}
          {(sessions.length > 4 || query !== "") && (
            <>
            <input
              class="dashboard-search"
              type="search"
              placeholder={t("common.filter_sessions_placeholder")}
              aria-label={t("common.filter_sessions")}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const top = topHit(sorted, contentHits);
                if (top) location.hash = sessionHash(top.session.id, remoteHost(top.session.hostId), top.hit.seq);
              }}
            />
            {query.trim().length >= 2 && (
              <div class="dim dash-content-note">
                {contentTotal === null
                  ? t("search.content_loading")
                  : contentTotal === 0
                    ? t("search.content_none")
                    : `${t(contentTotal === 1 ? "search.content_hits_one" : "search.content_hits", { n: contentTotal })} ${t(contentHits.size === 1 ? "search.content_in_one" : "search.content_in", { n: contentHits.size })} ${t("search.content_tail")}`}
              </div>
            )}
            </>
          )}
          {showArchived && sorted.length > 0 && (
            <div class="archive-actions">
              <Button size="sm" disabled={deleting} onClick={() => setSelected(
                selectedVisible.length === sorted.length ? new Set() : new Set(sorted.map(sessionKey)),
              )}>
                {selectedVisible.length === sorted.length ? t("common.clear_selection") : t("common.select_all_visible")}
              </Button>
              <Button size="sm" variant="danger" disabled={deleting || selectedVisible.length === 0} onClick={() => void remove(selectedVisible)}>
                {deleting ? t("common.deleting") : selectedVisible.length === 1 ? t("common.delete_one") : t("common.delete_n", { "n": selectedVisible.length })}
              </Button>
            </div>
          )}
          {sorted.length === 0 ? (
            showStartGuide({ total: withOverride.length, visible: sorted.length, query, hostFiltered: hostFilter !== null, showArchived, statusFilter }) ? (
              <StartGuide probeAvailable={probeAvailable} onOpen={onOpen} />
            ) : (
              <div class="ui-empty">{emptyText({ query, hostFiltered: Boolean(hostFilter), showArchived })}</div>
            )
          ) : (
            SECTION_ORDER.filter((key) => sections[key].length > 0).map((key) => {
                const folded = key === "zuletzt" /* i18n-ignore: Daten-Key */ && !showArchived && !quietShown;
                const list = folded ? [] : key === "zuletzt" /* i18n-ignore: Daten-Key */ && !showArchived && !allRecent && !query ? sections[key].slice(0, RECENT_LIMIT) : sections[key];
                const title = showArchived ? t("common.archive") : SECTION_TITLE[key];
                return (
                  <section key={key} class={`session-section section-${key}`} aria-label={title}>
                    <h2 class="section-title">
                      {key === "zuletzt" /* i18n-ignore: Daten-Key */ && !showArchived ? (
                        <button
                          class="section-fold"
                          type="button"
                          aria-expanded={!folded}
                          onClick={() => {
                            localStorage.setItem(QUIET_KEY, folded ? "1" : "0");
                            setQuietChoice(folded);
                          }}
                        >
                          <span class="section-fold-mark" aria-hidden="true" />
                          {title} <span class="dim num">{sections[key].length}</span>
                        </button>
                      ) : (
                        <>
                          {title} <span class="dim num">{sections[key].length}</span>
                        </>
                      )}
                      {key === "braucht" /* i18n-ignore: Daten-Key */ && pendingApprovals > 0 && onOpenApprovals && (
                        <button class="link-btn approval-link" type="button" onClick={onOpenApprovals}>
                          {pendingApprovals} {pendingApprovals === 1 ? t("common.approval") : t("common.approvals")} {t("common.show_all")}
                        </button>
                      )}
                    </h2>
                    {list.map((s) => (
                      <SessionRow
                        key={`${s.hostId ?? ""}:${s.id}`}
                        session={s}
                        hit={contentHits.get(hitKey(s.id))}
                        hosts={hosts ?? []}
                        onOpen={onOpen}
                        isLast={isLastSession(lastSession, s.id, remoteHost(s.hostId))}
                        approval={remoteHost(s.hostId) ? null : pendingFor(open, s.id)}
                        onDecided={(id) => setDecided((prev) => new Set(prev).add(id))}
                        moved={moved.current.has(`${s.hostId ?? ""}:${s.id}`)}
                        inWindow={windowKeys.has(targetKey({ kind: "session", sessionId: s.id, ...(remoteHost(s.hostId) ? { hostId: remoteHost(s.hostId)! } : {}) }))}
                        tileNo={tileNos?.get(`${remoteHost(s.hostId) ?? ""}:${s.id}`)}
                        onArchive={archive}
                        onPin={pin}
                        onDelete={(record) => void remove([record])}
                        {...(showArchived ? {
                          selection: {
                            checked: selected.has(sessionKey(s)),
                            disabled: deleting,
                            toggle: (checked: boolean) => setSelected((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(sessionKey(s));
                              else next.delete(sessionKey(s));
                              return next;
                            }),
                          },
                        } : {})}
                      />
                    ))}
                    {list.length < sections[key].length && (
                      <Button onClick={() => setAllRecent(true)} class="more-sessions">
                        {t("common.all")} {sections[key].length} {t("common.show")}
                      </Button>
                    )}
                  </section>
                );
            })
          )}
          {/* Ohne Karte in „Du bist dran“ (Freigabe ohne sichtbare Session) bleibt der Weg zur Liste. */}
          {pendingApprovals > 0 && onOpenApprovals && sections.braucht.length === 0 && (
            <button class="approval-banner" type="button" onClick={onOpenApprovals}>
              {pendingApprovals} {pendingApprovals === 1 ? t("common.approval_waits") : t("common.approvals_wait")} {t("common.waiting_for_you")}
            </button>
          )}
        </>
      )}
      <ConfirmDialog
        open={deleteAsk !== null}
        onClose={() => setDeleteAsk(null)}
        onConfirm={() => void removeConfirmed()}
        title={t("common.delete")}
        body={t("common.delete_forever", { "label": deleteAsk === null ? "" : deleteAsk.length === 1 ? t("common.one_session") : t("common.n_sessions", { "n": deleteAsk.length }) })}
        danger
        confirmLabel={t("common.delete")}
        busy={deleting}
      />
    </div>
  );
}

/** EPIC-P47 T47.2: Karte je entdecktem Projekt; Klick pins den Root im Dateibaum. */
function ProjectsView({ projects, warning, sessions }: { projects: DiscoveredProject[] | null; warning: string; sessions: SessionRecord[] }) {
  if (warning) {
    return (
      <div class="reply-error" role="alert">
        {warning}
      </div>
    );
  }
  if (projects === null) return <EmptyState text="Projekte laden…" />;
  if (projects.length === 0) return <EmptyState text={t("common.no_projects")} />;
  return (
    <section class="session-section" aria-label={t("common.projects")}>
      <h2 class="section-title">
        {t("common.projects")} <span class="dim">{projects.length}</span>
      </h2>
      {projects.map((p) => {
        const n = sessions.filter((s) => s.archived !== true && s.project === p.path).length;
        return (
          <Card key={p.path} class="project-card">
            <button
              class="session-open"
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("ancientvoid:files-open-root", { detail: { kind: "project", path: p.path, label: p.name } }))}
            >
              <div class="row">
                <strong class="session-title">{p.name}</strong>
                {n > 0 && <span class="pill ok">{n} {t("common.session_cap")}{n === 1 ? "" : "s"}</span>}
              </div>
              <div class="session-where dim">
                {p.path}
                {p.branch ? ` · ${p.branch}` : ""}
              </div>
              <div class="session-activity">
                <span class="session-activity-text dim">{t("common.open_file_tree")}</span>
              </div>
            </button>
          </Card>
        );
      })}
    </section>
  );
}

/** EPIC-P47 T47.3: Karte je Fleet-Host; Klick filtert die Session-Ansicht auf den Host. */
function HostsView({ hosts, sessions, onPick }: { hosts: FleetHost[]; sessions: SessionRecord[]; onPick: (hostId: string) => void }) {
  const list: FleetHost[] =
    hosts.length > 0 ? hosts : [{ hostId: "local", label: t("common.this_machine"), self: true, url: null, state: "reachable", lastSyncAt: null, detail: null, sessions: 0 }];
  return (
    <section class="session-section" aria-label={t("common.hosts")}>
      <h2 class="section-title">
        {t("common.hosts")} <span class="dim">{list.length}</span>
      </h2>
      {list.map((h) => {
        const n = sessions.filter((s) => s.archived !== true && (s.hostId ?? "local") === h.hostId).length;
        return (
          <Card key={h.hostId} class="host-card">
            <button class="session-open" type="button" onClick={() => onPick(h.hostId)}>
              <div class="row">
                <strong class="session-title">{h.label ?? h.hostId}</strong>
                <span class={`pill ${h.state === "reachable" ? "ok" : h.state === "stale" || h.state === "unauthorized" ? "warn" : "err"}`}>{HOST_STATE_LABEL[h.state]}</span>
              </div>
              <div class="session-where dim">
                {h.detail ?? (h.self ? t("common.this_machine") : h.url ?? "")}
                {h.state !== "reachable" && h.lastSyncAt ? t("common.stand_time", { time: fmtTime(h.lastSyncAt) }) : ""}
              </div>
              <div class="session-activity">
                <span class="session-activity-text dim">{n > 0 ? `${n} Session${n === 1 ? "" : "s"} zeigen` : t("common.no_sessions")}</span>
              </div>
            </button>
          </Card>
        );
      })}
    </section>
  );
}

function SessionRow({
  session,
  hosts,
  onOpen,
  isLast,
  inWindow,
  tileNo,
  approval,
  onDecided,
  moved,
  onArchive,
  onPin,
  onDelete,
  hit,
  selection,
}: {
  /** EPIC-P34 T34.10: die Session läuft in einem eigenen Fenster. */
  inWindow: boolean;
  /** EPIC-P86 T86.7: Nummer der Kachel, in der diese Session rechts offen ist (undefined = keine). */
  tileNo: number | undefined;
  /** EPIC-P43 T43.3: die offene Anfrage dieser Session (nur eigener Hub). */
  approval: ApprovalRequest | null;
  onDecided: (approvalId: string) => void;
  /** Die Karte hat gerade die Gruppe gewechselt (Bewegung „Wandern“). */
  moved: boolean;
  session: SessionRecord;
  hosts: FleetHost[];
  onOpen: (s: SessionRecord, opts?: { newTile?: boolean; seq?: number; seqAt?: number }) => void;
  hit?: ContentHit;
  isLast: boolean;
  onArchive: (s: SessionRecord) => void;
  onPin: (s: SessionRecord) => void;
  onDelete: (s: SessionRecord) => void;
  selection?: { checked: boolean; disabled: boolean; toggle: (checked: boolean) => void };
}) {
  const waiting = session.status === "waiting_approval";
  const glow = session.status === "working" ? "st-working" : waiting ? "st-waiting" : "";
  const unseen = isUnseen(seenKey(session.hostId ?? "", session.id), session.lastSeq);
  const project = projectName(session.project);
  const question = (approval?.tool?.questions?.length ?? 0) > 0;
  const plan = useMemo(() => (session.status === "working" ? planOf(session) : null), [session.id, session.status, session.lastSeq]);
  // Kleinkram-Regel 3: Zeilenaktionen erscheinen beim Überfahren, bei Fokus oder langem Drücken
  // (Touch: Kontextmenü-Geste) und stehen zusätzlich im Menü „⋯“ der Karte.
  const [actionsOpen, setActionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen && !actionsOpen) return;
    // EPIC-P51 T51.5: Esc über die Shortcut-Registry; Tipp daneben bleibt ein lokaler Listener.
    const off = registerShortcut("overview.menu-close", (e) => {
      e.preventDefault();
      setMenuOpen(false);
      setActionsOpen(false);
    });
    const onDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setActionsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => {
      off();
      window.removeEventListener("pointerdown", onDown);
    };
  }, [menuOpen, actionsOpen]);
  const focus = session.focus?.text ?? session.title;
  const name = focus ?? project;
  const [handoverOpen, setHandoverOpen] = useState(false);
  const actions: { label: string; run: () => void; danger?: boolean; pressed?: boolean }[] = [
    { label: t("common.repo_graph"), run: () => (location.hash = graphHash(session.id, remoteHost(session.hostId))) },
    { label: session.pinned ? t("common.detach") : t("common.pin"), run: () => void onPin(session), pressed: session.pinned === true },
    // 2026-11-12 (Nutzerwunsch, ADR-0039): Übergabe aus der Karte heraus — der
    // Hub parkt die Quelle beim Übergeben (kein doppeltes Weiterlaufen).
    ...(!session.archived ? [{ label: t("common.handover_progress"), run: () => setHandoverOpen(true) }] : []),
    { label: session.archived ? t("common.unarchive") : t("common.archive_btn"), run: () => void onArchive(session) },
    ...(session.archived ? [{ label: t("common.delete"), run: () => onDelete(session), danger: true }] : []),
  ];
  return (
    <div
      ref={cardRef}
      class={`card session-card ${glow}${unseen ? " unseen" : ""}${isLast ? " last-active" : ""}${moved ? " mv-wander" : ""}${actionsOpen ? " actions-open" : ""}`}
      aria-current={isLast ? "true" : undefined}
      tabIndex={-1}
      onKeyDown={(e) => {
        // EPIC-P51 T51.6: Roving — ↑/↓ bewegen den Fokus zwischen Karten
        // (Karte selbst fokussierbar; innere Buttons bleiben Tab erreichbar).
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        const cards = [...document.querySelectorAll<HTMLElement>(".session-card")];
        const idx = cards.findIndex((c) => c === cardRef.current || c.contains(document.activeElement));
        if (idx === -1) return;
        const next = cards[idx + (e.key === "ArrowDown" ? 1 : -1)];
        if (!next) return;
        e.preventDefault();
        next.focus();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setActionsOpen(true);
      }}
    >
      <button
        class="session-open"
        type="button"
        onClick={(ev) => onOpen(session, { newTile: ev.ctrlKey || ev.metaKey, ...(hit ? { seq: hit.seq, seqAt: Date.now() } : {}) })}
      >
        <div class="row">
          <strong class={`session-title${focus ? "" : " dim"}`} title={session.originIntent ?? undefined}>{focus ?? (session.adapter === "loop:securesight-factory" ? t("common.factory_observer", { "project": project }) : t("common.no_order", { "project": project }))}</strong>
          {session.handoverFrom && <span class="session-handover-mark" aria-label={t("session.handover_badge")} title={t("session.handover_badge")}>↪</span>}
          <StatusDot status={session.status} question={question} unseen={unseen} />
        </div>
        {session.originIntent && session.originIntent !== focus && (
          <div class="dim session-origin" title={session.originIntent}>{t("session.origin_intent", { text: session.originIntent })}</div>
        )}
        {inWindow && (
          <div >
            <span class="badge-window" title={t("common.bring_front")}>{t("common.own_window")}</span>
          </div>
        )}
        <div class="session-where dim">
          {/* 2026-10-26: host and model are always visible — readable host
           * label (fallback short id), model or the honest "Standardmodell"
           * (no guessed provider). */}
          {session.hostId ? `${hostLabel(hosts ?? [], session.hostId)} · ` : ""}
          <span data-testid="session-project">{project}</span> · {session.adapter} · {session.model ?? t("common.default_model")}
          {session.costUsd > 0 ? ` · ${metricView(session, "cost", formatUsd, true).text}` : ""}
        </div>
        {hit ? (
          <div class="session-hit">
            <span class="session-hit-chip">{t(hit.count === 1 ? "search.content_chip_one" : "search.content_chip", { n: hit.count })}</span>
          </div>
        ) : null}
        <div class="session-activity">
          {tileNo !== undefined && <span class="card-tile-no" title={t("common.tile_no", { n: tileNo })} data-testid="card-tile-no">{tileNo}</span>}
          <span class="session-activity-text">{session.lastActivity?.text ?? t("common.nothing_yet")}</span>
          <span class="dim session-ago">
            {unseen && <span class="badge new-badge">{t("common.new")}</span>} {ago(session.lastActivity?.at ?? session.updatedAt)}
          </span>
        </div>
        {plan && (
          <div class="card-plan" role="meter" aria-valuemin={0} aria-valuemax={plan.total} aria-valuenow={plan.done} aria-label={t("common.plan_progress")}>
            <span class="card-plan-bar">
              <span class="card-plan-fill" style={{ transform: `scaleX(${plan.total > 0 ? plan.done / plan.total : 0})` }} />
            </span>
            <span class="num dim">
              {t("common.plan")} {plan.done}/{plan.total}
            </span>
          </div>
        )}
      </button>
      {selection && (
        <label class="archive-selection">
          <input type="checkbox" checked={selection.checked} disabled={selection.disabled} onChange={(e) => selection.toggle(e.currentTarget.checked)} />
          <span aria-hidden="true">{t("common.select")}</span>
          <span class="sr-only">{name} {t("common.select_lower")}</span>
        </label>
      )}
      {approval && decidableOnCard(approval) && <CardDecision req={approval} onDecided={() => onDecided(approval.id)} />}
      <div class="session-card-actions">
        {/* EPIC-P48: Repo-Graph dieser Session direkt aus der Übersichtskarte (unten links). */}
        <button
          class="link-btn graph-open row-action"
          type="button"
          aria-label={t("common.open_repo_graph", { "name": name })}
          title={t("common.repo_graph")}
          onClick={() => (location.hash = graphHash(session.id, remoteHost(session.hostId)))}
        >
          <TabIcon name="graph" />
        </button>
        <button class="link-btn row-action" type="button" aria-pressed={session.pinned === true} onClick={() => void onPin(session)}>
          {session.pinned ? t("common.detach") : t("common.pin")}
        </button>
        <button class="link-btn row-action" type="button" onClick={() => void onArchive(session)}>
          {session.archived ? t("common.unarchive") : t("common.archive_btn")}
        </button>
        {session.archived && (
          <button class="link-btn danger row-action" type="button" onClick={() => onDelete(session)}>
            {t("common.delete")}
          </button>
        )}
        <span class="row-menu-wrap">
          <button class="link-btn row-menu-btn" type="button" aria-label={t("common.actions_for", { "name": name })} title={t("common.actions")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((on) => !on)}>
            <TabIcon name={"mehr"} />
          </button>
          {menuOpen && (
            <div class="row-menu" role="menu" aria-label={t("common.actions_for", { "name": name })}>
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  role="menuitem"
                  class={a.danger ? "danger" : ""}
                  onClick={() => {
                    setMenuOpen(false);
                    a.run();
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </span>
      </div>
      {handoverOpen && (
        <Sheet open onClose={() => setHandoverOpen(false)} label={t("common.handover")}>
            <div class="row" style="justify-content: space-between; align-items: center">
              <strong>{t("common.handover")}</strong>
              <Button aria-label={t("common.close")} onClick={() => setHandoverOpen(false)}>
                ✕
              </Button>
            </div>
            {/* Die Quelle parkt der Hub beim Übergeben (SessionManager.handover) —
             * hier wird nur das Ziel gewählt und der Übergabetext gesichtet. */}
            <HandoverForm
              session={session}
              api={hostApi(session.hostId)}
              onCancel={() => setHandoverOpen(false)}
              onHandedOver={(created) => {
                setHandoverOpen(false);
                onOpen(created);
              }}
            />
        </Sheet>
      )}
    </div>
  );
}

/** 2026-10-26: readable host label — the fleet's own label (hostname /
 * tailnet name), falling back to the host id. Never empty, never guessed.
 * 2026-11-21: the id is NOT shortened — host ids are readable slugs
 * ("kaisgamingdesk"), and "kaisgami" was not recognizable as a machine. */
function hostLabel(hosts: readonly FleetHost[], hostId: string): string {
  const host = hosts.find((h) => h.hostId === hostId);
  if (host?.label) return host.label;
  if (hostId === "local") return t("common.this_machine");
  return hostId;
}
