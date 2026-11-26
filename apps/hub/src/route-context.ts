import type { HubSwarm } from "./modules/swarm/index.ts";
import type { TeamPairingService } from "./modules/team/team-pairing-service.ts";
import { resolve, sep } from "node:path";
import type { FastifyRequest } from "fastify";
import type { ClaudeLive, PlannerModelConfig, SettingsStore, AttachmentStore, SessionManager, TokenService, AdapterRegistry, ApprovalService, WebAuthnStore, HealthStore, ProbeRunner, ReviewStore, ProjectTrustStore, BrowserService, DeviceService, AutomationService, AiMetricsSampler, HostMetricsService, InferenceTracker, FleetStore, MainSyncSettingsService, ScanService } from "@ancientvoid/core";
import { KnowledgeService, nativeOpenCommand, scanProjectSkills, ensureBaseSkills, LoopRegistry, type SessionTextIndex } from "@ancientvoid/core";
import type { ForgeService } from "./modules/forge/forge-service.ts";
import type { StatisticsService } from "./modules/statistics/statistics.service.ts";
import type { ExternalJobsService } from "./modules/automations/external-jobs.ts";
import { DEFAULT_HOST_ID } from "@ancientvoid/contracts";
import type { ActionDefinition, HubMetrics, DiscoverySource, SessionRecord } from "@ancientvoid/contracts";
import { TMUX_PREFIX } from "@ancientvoid/workers";
import { extractToken } from "./platform/auth.ts";
import { createWebAuthnRoutes, type WebAuthnConfig } from "./modules/identity/webauthn.ts";
/** What the HTTP modules get from the hub (ADR-0020). */
export interface RouteDeps {
  pwaDir?: string;
  /** T7.10: uploaded files (optional — a hub without them refuses attachment ids). */
  attachments?: AttachmentStore;
  /** ADR-0060: Hub-Einstellungen (Register eigener Modelle). */
  settings?: SettingsStore;
  /** EPIC-P67 T67.3: Main-Sync-Einstellungen (config-Tabelle) — fehlt in Tests vor T7.10 → 501. */
  mainSync?: MainSyncSettingsService;
  sessions: SessionManager;
  tokens: TokenService;
  registry: AdapterRegistry;
  projectRoots?: string[];
  /** T2.4/EPIC-P2: optional, like SessionManager's worktrees/approvals
   * wiring — a hub without an ApprovalService configured just doesn't
   * expose the queue routes (501, not a crash). */
  approvals?: ApprovalService;
  /** T2.5: optional — a hub without WebAuthn configured doesn't expose
   * the passkey routes (501), same pattern as approvals above. */
  webauthn?: { store: WebAuthnStore; config: WebAuthnConfig };
  /** T3.9: optional — omitting it disables POST /api/prompt-optimizer/
   * feedback (501), same pattern as above. */
  dataDir?: string;
  /** Real user request (2026-09-19): surfaces a real `tmux attach`
   * command on a session when the worker runner is genuinely tmux —
   * see HubAppDeps's own doc comment for the full reasoning. */
  workerRunnerKind?: string;
  store?: HealthStore;
  metrics?: HubMetrics;
  startedAt?: number;
  /** ADR-0012: external read-only session sources mixed into GET /api/discovery. */
  discoverySources?: DiscoverySource[];
  /** EPIC-P15 T15.4: which Claude sessions are open at the PC (optional: no CLI, no hint). */
  claudeLive?: ClaudeLive;
  /** Injected in tests. Production uses spawnProbeRunner. */
  probeRunner?: ProbeRunner;
  /** EPIC-P6: this hub's host id in the fleet. */
  hostId?: string;
  /** 2026-10-26: readable name for fleet views (hostname by default). */
  hostLabel?: string;
  /** T9.2: local model for text commands and text edits (ADR-0027). */
  assistantModel?: PlannerModelConfig;
  /** T7.6: actions from hub.config.json (`actions`). */
  actions?: ActionDefinition[];
  /** EPIC-P19: Loops (Dark Factory). Ohne Angabe: der Katalog, noch ohne angebundene Connectors. */
  loops?: LoopRegistry;
  /** EPIC-P36: Review-Notizen zur Diff-Ansicht (Journal+Snapshot, ADR-0055).
   * Ohne Angabe antworten die Review-Routen 501-artig (siehe Approvals-Muster). */
  reviews?: ReviewStore;
  /** EPIC-P46 (ADR-0058 §9): Projekt-Freigaben für Diagnose-Prüfer; ohne Angabe läuft kein Projektcode. */
  trust?: ProjectTrustStore;
  /** EPIC-P39 (ADR-0059): Browser-Arbeitsplatz; ohne Angabe 501. */
  browser?: BrowserService;
  /** EPIC-P42 (ADR-0067): Android-Testgeräte; ohne Angabe 501. */
  devices?: DeviceService;
  /** EPIC-P37 (ADR-0056): Forge-Dienst (GitLab im Session-Kontext) — ohne
   * Angabe antworten die Forge-Routen ehrlich mit "nicht eingerichtet". */
  forge?: ForgeService;
  /** EPIC-P41 (ADR-0064): Automationen — ohne Angabe ehrliche Abschaltung (501). */
  automations?: AutomationService;
  /** EPIC-P73 (ADR-0094): Forge-Token-Dateien aus der Config — die PWA darf
   * Tokens eintragen (Datei schreiben), sie aber nie zurücklesen. */
  forgeTokens?: { githubTokenFile?: string };
  /** EPIC-P74 (ADR-0096): Wissensquellen — ohne Angabe aus `settings` gebaut, ohne beides 501. */
  knowledge?: KnowledgeService;
  /** EPIC-P80 (ADR-0118): Pentest-Scan — ohne Konfiguration erklären die Routen die Lage (K10). */
  scan?: ScanService;
  /** EPIC-P73 (ADR-0094): externe Auto-Jobs (GitHub-Actions, Issue-Bridge) —
   * immer vorhanden; ohne Quellen antwortet der Endpunkt ehrlich leer. */
  externalJobs?: ExternalJobsService;
  swarm?: HubSwarm;
  /** EPIC-P83 (ADR-0118 §7): Kopplungsdienst — nur mit `team.listen` vorhanden. */
  teamPairing?: TeamPairingService;
  /** EPIC-P59 (ADR-0078): Sampler für die Metrik-Seite; ohne Angabe leere Quelle-Liste. */
  aimetrics?: AiMetricsSampler;
  /** EPIC-P79 (ADR-0125): Tracker für die Token-Tempo-Seite. */
  inference?: InferenceTracker;
  /** Suche (Nachschärfe 2026-11-22): Volltextindex über die Sessiontexte.
   * Ohne Angabe antworten die Session-Routen 501 — wie bei approvals, die
   * ein Hub ohne Konfiguration ebenfalls nicht anbietet. */
  search?: { transcript: SessionTextIndex };
  /** EPIC-P56 T56.3: Statistik-Rollup für die Statistik-Seite; ohne Angabe ehrlich 501. */
  statistics?: StatisticsService;
  /** EPIC-P59 Nachtrag: Peer-Liste für Merge in GET /api/aimetrics. */
  fleet?: FleetStore;
  /** Peer-Reports mergen (Default true, wenn aiMetrics gesetzt). */
  aimetricsMergePeers?: boolean;
  /** EPIC-P81 (ADR-0117): Host-Metriken; ohne Angabe leere Host-Liste. */
  hostMetrics?: HostMetricsService;
  hostMetricsMergePeers?: boolean;
}

/**
 * Shared by every module's routes: the hub's dependencies plus the few
 * helpers several modules need (caller label, attach command, skill
 * catalog). Built once in routes.ts.
 */
export function createRouteContext(deps: RouteDeps) {
  const projectRoots = deps.projectRoots ?? [];

  /** The configured root a project lives under, with its base skill
   * catalog in place. BUG-0021: a session started with a skill before
   * anyone listed skills found no catalog and ran a shorter extends chain. */
  async function catalogRootFor(project: string): Promise<string | undefined> {
    const projectPath = resolve(project);
    const root = projectRoots
      .map((entry) => resolve(entry))
      .filter((entry) => projectPath === entry || projectPath.startsWith(entry + sep))
      .sort((a, b) => b.length - a.length)[0];
    if (root) await ensureBaseSkills(root);
    return root;
  }

  async function skillsFor(project: string) {
    const root = await catalogRootFor(project);
    return scanProjectSkills(project, root && root !== resolve(project) ? { baseRoot: root } : undefined);
  }
  const webauthnRoutes = deps.webauthn ? createWebAuthnRoutes(deps.webauthn.store, deps.webauthn.config) : null;
  // T3.8: dedup concurrent ensureIndexed() calls for the same project — a
  // first-time index can take real minutes; without this, rapid repeated
  // searches while indexing would each kick off their own `qmd embed`.
  const indexingInFlight = new Map<string, Promise<void>>();
  // T2.8 (EPIC-P2 §2 audit trail "wer-wann-was"): the caller's own device
  // label, identify()d fresh from its already-authHook-verified bearer
  // token on every call — never trusted from anything client-supplied.
  function callerLabel(req: FastifyRequest): string | null {
    const raw = extractToken(req);
    if (!raw) return null;
    return deps.tokens.identify(raw)?.label ?? null;
  }

  // Real user request (2026-09-19): "same session on the phone and my
  // desktop terminal". Already true today — SessionManager.makeContext()
  // always names the worker after the real session id (session-manager.ts),
  // so the tmux pane name is deterministic and never needs plumbing
  // through SessionHandle/adapters. Only shown for a genuinely live
  // session on a genuinely tmux-backed hub — a stopped session's pane is
  // gone, and a `process`-runner hub has no pane to attach to at all.
  //
  // Since ADR-0013 a session between turns is `idle`, so `working` really
  // means a turn — and its pane — is running.
  async function withAttachCmd<T extends SessionRecord>(
    session: T,
  ): Promise<T & { attachCmd?: string; openCmd?: string; worktree?: { path: string; branch: string } }> {
    // T5.5: open the same provider session in its own terminal UI — only
    // while no turn runs here, so hub and terminal never write at once.
    const idle = session.status !== "working" && session.status !== "starting";
    const openCmd = idle
      ? nativeOpenCommand(session.adapter, session.nativeSessionId, deps.sessions.workdirOf(session.id) ?? session.project)
      : null;
    // Where the session's files really are — its own worktree, not the
    // project checkout the user has open in the editor.
    const workdir = deps.sessions.workdirOf(session.id);
    const worktree =
      session.worktreeSha !== null && workdir && workdir !== session.project
        ? { path: workdir, branch: `ancientvoid/${session.id}` }
        : null;
    // ADR-0017: every session of this hub carries this hub's host id.
    const withOpen = { ...session, hostId, ...(openCmd ? { openCmd } : {}), ...(worktree ? { worktree } : {}) };
    if (deps.workerRunnerKind !== "tmux" || session.status !== "working") return withOpen;
    if (!(await deps.sessions.hasLiveWorker(session.id))) return withOpen;
    return { ...withOpen, attachCmd: `tmux attach -t ${TMUX_PREFIX}${session.id}` };
  }

  const startedAt = deps.startedAt ?? Date.now();
  const hostId = deps.hostId ?? DEFAULT_HOST_ID;
  const loops = deps.loops ?? new LoopRegistry();
  // T74.6: einmalig aufgelöst — die Freigaben-Route und die Knowledge-Routen
  // teilen dieselbe Instanz (Freigabe-Antrag und Ausführung nach Entscheidung).
  const knowledge = deps.knowledge ?? (deps.settings ? new KnowledgeService(deps.settings, { operations: deps.sessions.operations(), ...(deps.approvals ? { approvals: deps.approvals } : {}) }) : null);

  return { deps, loops, projectRoots, hostId, hostLabel: deps.hostLabel, startedAt, catalogRootFor, skillsFor, callerLabel, withAttachCmd, webauthnRoutes, indexingInFlight, knowledge, scan: deps.scan };
}

export type RouteContext = ReturnType<typeof createRouteContext>;
