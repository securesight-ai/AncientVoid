import { SessionInterruption } from "./session-interruption.ts";
import { SessionRecovery } from "./session-recovery.ts";
import { SessionActivities } from "./session-activity.ts";
import type { ActivityReport, SessionActivity } from "@ancientvoid/contracts";
import { existsSync } from "node:fs";
import type { PromptAttachment, ToolPermissionAnswer, ToolPermissionPoll, ToolPermissionRequest, SessionMetricsState, AdapterContext, BlobRef, EmittedEvent, EmittedStreamFrame, WsStreamFrames, HubLogger, HubMetrics, NormalizedEvent, SessionRecord, SessionSnapshot, SessionStatus, SteerInput, Ack, WorkerProcess, WorkerRunner, UsageQuota, ReportingSink, DiscoverySource, DiscoveredSession, HubNotification, NotificationAction, PendingOperation, RunEstimate, TurnMetric, MainSyncSettings } from "@ancientvoid/contracts";
import { blobRefToString, countMetrics, currentProviderFailureFromEvents, metricsState, isLoopAdapter, unsupportedResume, EmittedStreamFrame as StreamFrameSchema } from "@ancientvoid/contracts";
import type { EventStore } from "../../platform/index.ts";
import type { Pforte } from "../inference/index.ts";
import type { AdapterRegistry } from "../harness/index.ts";
import type { HubDatabase } from "../../platform/index.ts";
import type { WorktreeBaseChoice, WorktreeManager } from "../workspace/index.ts";
import { WorkspaceRuntime, ManifestApprovalStore, ServiceSupervisor, CheckoutLeaseStore } from "../workspace/index.ts";
import { OperationStore } from "../approvals/index.ts";
import { ApprovalFlow, type AgentActionKind } from "./approval-flow.ts";
import { BudgetGuard } from "./budget-guard.ts";
import { ToolPermissions, type ToolGate } from "./tool-permissions.ts";
import type { ApprovalService } from "../approvals/index.ts";
import { createConsoleLogger } from "../../platform/index.ts";
import { dedupeDiscovered, filterDiscovered, pageDiscovered } from "../discovery/index.ts";
import { notificationHorizonCutoff, notificationFor, projectName, type NotificationDraft } from "../notifications/index.ts";
import { parseNotificationAction, parseNotificationParams } from "../notifications/index.ts";
import { EVAL_COMPLETE_EVENT, EvalResult, type EvalRunInput } from "@ancientvoid/contracts";
import { deriveTurnMetrics, measureEvaluationPhase, readEvaluation, TurnMetricStore } from "../runs/index.ts";
import { buildHandoverPrompt, HANDOVER_PROMPT_MAX } from "../handover/index.ts";
import { SessionQueue } from "./session-queue.ts";
import { askTitleModel } from "./session-title.ts";
import { createTokenTally, type SessionTokenTotals } from "./token-totals.ts";
import type { PlannerModelConfig } from "../commands/model.ts";
import { WRITER_LEASE_MS, type SteerMeta, type LiveSession, type SessionCreateOptions, originFromPrompt, sessionTitle, TURN_END_SETTLE_MS, activityOf, VALID_TRANSITIONS, DEFAULT_HEARTBEAT_MS, DEFAULT_STEER_WAIT_MS } from "./session-state.ts";
import { defaultOpencodeDataDir } from "../discovery/index.ts";
import { type SessionRow, persistRecord, rowToRecord } from "./session-row.ts";

export interface SessionManagerObservability {
  autoResumeInterrupted?: boolean;
  automaticCompaction?: () => boolean;
  logger?: HubLogger;
  metrics?: HubMetrics;
  /** K7 budget for recoverAll in ms (default 3000); tests lower it. */
  recoveryBudgetMs?: number;
  /** T17.4: hard cap for the hub's wait on one adapter submission in ms
   * (default 30_000, see DEFAULT_STEER_WAIT_MS); tests lower it. There is
   * deliberately no "0 = off" — no unbounded waits in the server. */
  steerWaitMs?: number;
}

/** Account-level usage/quota snapshot (ADR-0004) — keyed by adapter id,
 * NOT session id: rate limits are shared across every session of that
 * adapter-account, unlike SessionRecord.costUsd. Deliberately in-memory
 * only, never K7-persisted — the next active session of that adapter
 * delivers a fresh value on its first turn, and a value from before a hub
 * restart could already be stale anyway. */
export interface AdapterUsageSnapshot {
  quota: UsageQuota;
  observedAt: string;
}

/** Session records, worker context and event projection shared by the lifecycle. */
export abstract class SessionManagerRuntime {
  protected abstract automaticResume(session: LiveSession): Promise<Ack>;
  protected abstract dispatchDigest(session: LiveSession): void;
  protected abstract inferenzEndpoint(session: LiveSession): string | null;
  protected abstract scheduleDrain(sessionId: string): void;
  protected abstract parkFor(session: LiveSession, reason: SessionRecord["parkReason"], actor?: string): Promise<void>;
  protected abstract emitPrompt(session: LiveSession, text: string, actor?: string, attachments?: readonly PromptAttachment[]): Promise<void>;
  protected abstract withAttachments<T extends { text: string; attachments?: PromptAttachment[] | undefined }>(session: LiveSession, input: T): T;
  protected abstract continueStopped(session: LiveSession, input: Extract<SteerInput, { kind: "prompt" }>, actor?: string): Promise<Ack>;
  abstract create(spec: unknown, actor?: string, options?: SessionCreateOptions): Promise<SessionRecord>;
  abstract stop(sessionId: string, actor?: string): Promise<Ack>;
  abstract steer(sessionId: string, input: SteerInput, actor?: string, meta?: SteerMeta): Promise<Ack>;
  abstract resolveWorkspaceSetup(op: PendingOperation, decidedByLabel?: string): Promise<Ack>;
  protected abstract openStopped(sessionId: string): LiveSession | undefined;
  protected abstract failWorkspace(session: LiveSession, manifestHash: string | null, baseSha: string, failure: { step: string; kind: string; exitCode?: number; detail?: string; logBlobRef: string | null }): Promise<void>;
  protected abstract canDrain(session: LiveSession): boolean;
  protected abstract gebeInferenzFrei(session: LiveSession): void;

  protected readonly interruption: SessionInterruption;
  protected readonly autoResumeInterrupted: boolean;
  protected readonly uncertainQueue = new Set<string>();
  protected shuttingDown = false;
  /** ADR-0083: Abonnenten transienter Live-Frames (sessionId -> Set). Kein EventStore. */
  private readonly frameSubscribers = new Map<string, Set<(frames: WsStreamFrames) => void>>();
  protected readonly recovery: SessionRecovery;
  private readonly activityTracker: SessionActivities;
  protected readonly live = new Map<string, LiveSession>();
  private readonly usageByAdapter = new Map<string, AdapterUsageSnapshot>();
  /** ADR-0019: approval-gated prompts and budget top-ups. */
  protected readonly flow: ApprovalFlow;
  /** ADR-0019: shared by the approval flow and tool permissions. */
  protected readonly operationStore: OperationStore;
  /** T7.2: set by the server (enableToolPermissions). */
  private tools: ToolPermissions | undefined;
  /** T2.7: budget and daily cap. */
  private readonly budget: BudgetGuard;
  /** Tail of the per-session steer chain (see steer()). */
  protected readonly steerQueue = new Map<string, Promise<void>>();
  /** T17.4: input ids with a submission still running — its wait may have
   * timed out; until the attempt settles the outcome is unknown, and the
   * same id is never submitted twice. */
  protected readonly inFlightInputs = new Map<string, Set<string>>();
  /** T17.4: hard cap for the hub's wait on one adapter submission. */
  protected readonly steerWaitMs: number;
  private readonly automaticCompaction: () => boolean;

  protected readonly db: HubDatabase;
  protected readonly store: EventStore;
  protected readonly registry: AdapterRegistry;
  protected readonly runner: WorkerRunner;
  protected readonly worktrees: WorktreeManager | undefined;
  /** EPIC-P29 (ADR-0051): Setup/Teardown-Operationen, Hash-Freigaben, Services. */
  protected readonly workspaces: WorkspaceRuntime;
  protected readonly workspaceServices: ServiceSupervisor;
  protected readonly manifestApprovals: ManifestApprovalStore;
  /** ADR-0057: ein AV-Schreiber pro direktem Checkout. */
  protected readonly checkoutLeases: CheckoutLeaseStore;
  protected readonly approvals: ApprovalService | undefined;
  /** EPIC-P29: die Manifest-Freigabe hängt an der immer vorhandenen Queue —
   * unabhängig von `requireStepApprovals` (das steuert nur steer.prompt). */
  protected workspaceApprovals: ApprovalService | undefined;
  protected readonly recoveryBudgetMs: number;
  protected readonly mirrorDataDir: string;
  protected readonly defaultPermissionMode: string | null;
  /** EPIC-P67 Stufe 1: liefert effektive Main-Sync-Einstellungen je Projekt — undefined = altes Verhalten. */
  protected readonly mainSyncSettings: ((projectPath: string) => MainSyncSettings) | undefined;
  protected readonly queue: SessionQueue;
  protected readonly pforte: Pforte | undefined;
  private readonly recordingEvaluations = new Set<string>();
  private readonly turnMetricStore: TurnMetricStore;
  private titleModel: PlannerModelConfig | undefined;
  protected readonly draining = new Set<string>();
  protected readonly reportingSinks: ReportingSink[];
  protected readonly logger: HubLogger;
  protected readonly metrics: HubMetrics | undefined;
  protected readonly heartbeatTimer: NodeJS.Timeout;
  private heartbeatRunning = false;

  constructor(
    db: HubDatabase,
    store: EventStore,
    registry: AdapterRegistry,
    runner: WorkerRunner,
    heartbeatIntervalMs: number = DEFAULT_HEARTBEAT_MS,
    /** T2.1: optional — omitting it (every pre-P2 call site, every test
     * using a non-git temp dir as `project`) keeps the exact pre-P2
     * behavior: sessions run directly in `record.project`, no isolation. */
    worktrees?: WorktreeManager,
    /** T2.4: optional — omitting it keeps steer()'s exact pre-P2 behavior
     * (forwarded to the adapter immediately, no approval gate). Every
     * existing call site predates this and stays unaffected. */
    approvals?: ApprovalService,
    /** T2.7: hub-wide daily cost cap (EPIC-P2 §3) — omitted/null means no
     * cap, the exact pre-T2.7 behavior. */
    dailyCapUsd: number | null = null,
    /** T4.1/ADR-0009: fire-and-forget digest consumers, called once per
     * completed session. Empty array (default) is the exact pre-T4.1
     * behavior — no digests, no new network egress unless explicitly
     * configured (same "default off" principle as the MCP gateway, OD-2). */
    reportingSinks: ReportingSink[] = [],
    observability: SessionManagerObservability = {},
    /** Read-only opencode mirror (ADR-0011 Erweiterung): the data dir whose
     * opencode.db mirror sessions read. Defaults to the same dir the
     * discovery scan uses; tests inject their own fixture dir. */
    mirrorDataDir: string = defaultOpencodeDataDir(),
    /** ADR-0033: the mode new sessions start in, where the adapter offers it. */
    defaultPermissionMode: string | null = null,
    /** EPIC-P67 / ADR-0088 Stufe 1: effektive Main-Sync-Einstellungen für
     * ein Projekt (global + Projekt-Override, vom Aufrufer aufgelöst).
     * Weglassen = exakt das Vor-P67-Verhalten: Basis ist der lokale HEAD. */
    mainSyncSettings?: (projectPath: string) => MainSyncSettings,
    /** BUG-0272 (ADR-0116): Pforte für Einzelslot-Modell-Endpoints. Weht der Hub
     * sie ein, bleiben Züge in der Warteschlange, solange der Endpoint belegt ist —
     * statt dass sich zwei Sitzungen im gemeinsamen KV-Kontext verdrängen. */
    pforte?: Pforte,
  ) {
    this.autoResumeInterrupted = observability.autoResumeInterrupted ?? true;
    this.activityTracker = new SessionActivities({
      session: (id) => this.live.get(id),
      emit: (session, kind, payload) => this.emitSystem(session, kind, payload),
      working: (session) => this.setStatus(session, "working"),
      settle: (session, code) => this.setStatus(session, "idle").then(() => this.emitSystem(session, "session.turn_end", { code })),
      settleFailed: (session) => this.setStatus(session, "error"),
    });
    this.recovery = new SessionRecovery({
      error: (err) => this.logger.error("automatic recovery failed", { err: String(err) }),
      events: (id) => this.store.replay(id),
      declaration: (id) => this.registry.get(id)?.capabilities.resume,
      emit: (session, kind, payload) => this.emitSystem(session, kind, payload),
      resume: (session) => this.automaticResume(session),
      autoResumeInterrupted: () => this.autoResumeInterrupted,
    });
    this.interruption = new SessionInterruption({
      replay: (id) => this.store.replay(id),
      setStatus: (session, status) => this.setStatus(session, status),
      emit: (session, kind, payload) => this.emitSystem(session, kind, payload),
      digest: (session) => this.dispatchDigest(session),
      stop: (session) => session.adapter.stop(session.handle!, this.makeContext(session)),
      autoResume: (session) => {
        // ADR-0076 Nachtrag: die globale Konfiguration ODER die ausdrückliche
        // Limit-Option dieser Session — attempt() grenzt die Gründe erneut ein.
        if (this.autoResumeInterrupted || session.record.autoResumeOnLimit) this.recovery.schedule(session);
        return Promise.resolve({ ok: false });
      },
    });
    this.defaultPermissionMode = defaultPermissionMode;
    this.mainSyncSettings = mainSyncSettings;
    this.queue = new SessionQueue(db);
    this.pforte = pforte;
    // Wird ein Platz frei, dürfen die wartenden Sitzungen dieses Endpoints wieder
    // an die Reihe — sonst bliebe die Warteschlange liegen, bis jemand zufällig
    // eine neue Eingabe schickt.
    this.pforte?.setzeWeckruf((schluessel) => {
      for (const s of this.live.values()) {
        const modell = this.inferenzEndpoint(s);
        if (modell !== null && this.pforte?.schluessel(modell) === schluessel) this.scheduleDrain(s.record.id);
      }
    });
    this.turnMetricStore = new TurnMetricStore(db);
    this.mirrorDataDir = mirrorDataDir;
    this.db = db;
    this.store = store;
    this.registry = registry;
    this.runner = runner;
    this.worktrees = worktrees;
    this.approvals = approvals;
    this.workspaceServices = new ServiceSupervisor(db, store, store.directory());
    this.workspaces = new WorkspaceRuntime(db, store, this.workspaceServices);
    this.manifestApprovals = new ManifestApprovalStore(db);
    this.checkoutLeases = new CheckoutLeaseStore(db);
    this.operationStore = new OperationStore(db);
    this.budget = new BudgetGuard(
      {
        session: (id) => this.live.get(id),
        sessions: () => this.live.values(),
        records: () => this.list(),
        emitSystem: (session, kind, payload) => this.emitSystem(session, kind, payload),
        park: (session, reason, actor) => this.parkFor(session, reason, actor),
        setStatus: (session, status) => this.setStatus(session, status),
        context: (session) => this.makeContext(session),
        persist: (record) => this.persist(record),
      },
      dailyCapUsd,
    );
    this.flow = new ApprovalFlow(
      {
        session: (id) => this.live.get(id),
        emitSystem: (session, kind, payload) => this.emitSystem(session, kind, payload),
        emitPrompt: (session, text, actor, attachments) => this.emitPrompt(session, text, actor, attachments),
        forAdapter: (session, input) => this.withAttachments(session, input),
        continueStopped: (session, input, actor) => this.continueStopped(session, input, actor),
        context: (session) => this.makeContext(session),
        applyBudgetTopUp: (sessionId, usd, actor) => this.applyBudgetTopUp(sessionId, usd, actor),
        createSession: (spec, actor) => this.create(spec, actor),
        stopSession: (sessionId, actor) => this.stop(sessionId, actor),
        parkSession: (sessionId, actor) => this.steer(sessionId, { kind: "park" }, actor),
        resolveWorkspaceSetup: (op, decidedByLabel) => this.resolveWorkspaceSetup(op, decidedByLabel),
      },
      approvals,
      this.operationStore,
    );
    this.reportingSinks = reportingSinks;
    this.logger = observability.logger ?? createConsoleLogger();
    this.metrics = observability.metrics;
    this.recoveryBudgetMs = observability.recoveryBudgetMs ?? 3000;
    this.automaticCompaction = observability.automaticCompaction ?? (() => false);
    this.steerWaitMs = observability.steerWaitMs ?? DEFAULT_STEER_WAIT_MS;
    // T1.9 (AC-P1-5): poll each live adapter's own status() on a timer,
    // not just react to its worker process exiting. A hard-killed process
    // already surfaces via WorkerProcess.onExit (see makeContext below),
    // but "down" per the adapter's own health check (hung, degraded,
    // unreachable) needs an active probe — that's what onExit can't see.
    this.heartbeatTimer = setInterval(() => void this.runHeartbeat(), heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  /** Exposed for tests — same logic the timer runs, without waiting out
   * the real interval. */
  async runHeartbeat(): Promise<void> {
    if (this.shuttingDown || this.heartbeatRunning) return; // don't overlap a slow previous tick
    this.heartbeatRunning = true;
    try {
      for (const session of this.live.values()) {
        if (["stopped", "stopping", "parked"].includes(session.record.status)) continue;
        await this.activityTracker.expire(session);
        if (session.record.status === "interrupted") {
          // ADR-0076 Nachtrag: auch die Limit-Option einer Session hält die
          // Wiederaufnahme-Prüfung am Laufen (Fenster läuft → still warten).
          if (this.autoResumeInterrupted || session.record.autoResumeOnLimit) this.recovery.schedule(session);
          continue;
        }
        if (!session.handle) continue;
        const terminal = ["stopped", "error", "interrupted"].includes(session.record.status) || (session.record.status === "parked" && !session.persistentWorker);
        if (terminal) continue;
        let report;
        try {
          let healthTimer: NodeJS.Timeout | undefined;
          try {
            report = await Promise.race([
              session.adapter.status(session.handle),
              new Promise<{ state: "broken"; detail: string }>(resolve => {
                healthTimer = setTimeout(() => resolve({ state: "broken", detail: "Adapter-Heartbeat antwortet nicht (5 s)." }), 5000);
              }),
            ]);
          } finally { if (healthTimer) clearTimeout(healthTimer); }
        } catch (err) {
          // The health check itself failing is exactly the kind of
          // "unbekannter Ausfall" AGENTS.md rule 6 wants surfaced, not
          // silently retried forever.
          report = { state: "broken" as const, detail: err instanceof Error ? err.message : String(err) };
        }
        if (this.shuttingDown) break;
        if (report.state === "down" || report.state === "broken") {
          if (isLoopAdapter(session.record.adapter) || !VALID_TRANSITIONS[session.record.status].includes("interrupted")) {
            await this.setStatus(session, "error");
          } else await this.interruption.interrupt(session, "adapter_down");
          await this.emitSystem(session, "adapter.down", {
            state: report.state,
            detail: report.detail ?? null,
          });
        }
      }
    } finally {
      this.heartbeatRunning = false;
    }
  }

  /** Subscribe to event batches of a session (server WS push). */
  subscribe(sessionId: string, cb: (events: NormalizedEvent[]) => void): () => void {
    const s = this.openStopped(sessionId);
    if (!s) return () => undefined;
    s.subscribers.add(cb);
    return () => s.subscribers.delete(cb);
  }

  /**
   * ADR-0083: Abo für transiente Live-Frames (echtes Streaming). Bewusst getrennt von
   * `subscribe`: Frames laufen an der Persistierung vorbei — kein EventStore, kein
   * Snapshot, keine Resync-Pflicht. Wer sich später einklinkt (Reconnect, View mitten
   * im Turn), sieht den Beitrag, sobald der dauerhafte Block eintrifft.
   */
  subscribeFrames(sessionId: string, cb: (frames: WsStreamFrames) => void): () => void {
    let set = this.frameSubscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.frameSubscribers.set(sessionId, set);
    }
    const born = set;
    born.add(cb);
    return () => {
      born.delete(cb);
      if (born.size === 0) this.frameSubscribers.delete(sessionId);
    };
  }

  private publishFrame(session: LiveSession, frame: EmittedStreamFrame): void {
    const parsed = StreamFrameSchema.safeParse(frame);
    if (!parsed.success) {
      // Fail loud, ohne die Session abzuschießen: ein kaputter Frame ist Wegwerfware,
      // der Block dahinter bleibt die Wahrheit.
      this.logger.warn("live-frame abgelehnt", { sessionId: session.record.id, reason: parsed.error.issues[0]?.message ?? "Schema" });
      this.metrics?.inc("live_frames_rejected");
      return;
    }
    const set = this.frameSubscribers.get(session.record.id);
    if (!set || set.size === 0) return; // niemand schaut zu: nichts tun, nichts speichern
    const msg: WsStreamFrames = { type: "stream", sessionId: session.record.id, frames: [parsed.data] };
    for (const cb of set) {
      try {
        cb(msg);
      } catch {
        this.metrics?.inc("live_frames_dropped"); // langsamer Verbraucher: Frame ist weg
      }
    }
    this.metrics?.inc("live_frames");
  }

  /** ADR-0004: latest account-level usage/quota snapshot for an adapter,
   * or null when this adapter has never emitted one (never guessed, never
   * a stale 0 — "null" reads as "no observation yet", not "no usage"). */
  getAdapterUsage(adapterId: string): AdapterUsageSnapshot | null {
    return this.usageByAdapter.get(adapterId) ?? null;
  }

  list(): SessionRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
        .all() as unknown as SessionRow[]
    ).map(rowToRecord);
  }

  sessionCounts(): { live: number; total: number; byStatus: Record<string, number> } {
    const records = this.list();
    const byStatus: Record<string, number> = {};
    for (const record of records) {
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    }
    return { live: this.live.size, total: records.length, byStatus };
  }

  /**
   * Hub rows plus external sources, deduped, paged. Unknown resume versions
   * stay in the list with unsupportedResume (K9), they are not dropped.
   *
   * Clip observers (cursor/claude-clip, external IDE chats) stay out —
   * they bury the real sessions (user decision 2026-09-28); a hub-managed
   * clip session is a real session and stays.
   */
  async discover(
    sources: readonly DiscoverySource[] = [],
    cursor = 0,
    limit = 50,
    query: { q?: string; adapter?: string } = {},
  ): Promise<{ items: DiscoveredSession[]; nextCursor: number | null }> {
    const external: DiscoveredSession[] = [];
    for (const source of sources) external.push(...(await source.list()));
    const records = this.list();
    const hubIds = new Set(records.map((record) => record.id));
    const merged = dedupeDiscovered([...records.map((record) => this.toDiscovered(record)), ...external]).filter(
      (item) =>
        !(item.hubSessionId === null && (item.adapter === "cursor-clip" || item.adapter === "claude-clip")) &&
        // ADR-0041: a run inside one of this hub's own worktrees IS that hub session — listing the harness's
        // file as a second, "external" row (older sessions never reported a native id) only doubles it.
        !(item.hubSessionId === null && hubIds.has(/\/data\/worktrees\/([0-9a-f-]{36})(?:\/|$)/.exec(item.project)?.[1] ?? "")),
    );
    // BUG-0035: page 1 is what the user opens — the most recently observed
    // first, never the source's oldest scan order. Items without a
    // timestamp sink; ISO-8601 compares chronologically as a string.
    merged.sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""));
    return pageDiscovered(filterDiscovered(merged, query), cursor, limit);
  }

  async hasLiveWorker(sessionId: string): Promise<boolean> {
    const workers = await this.runner.list();
    // T17.6: marker first; the name stays for runners/workers without one.
    return workers.some((worker) => worker.sessionId === sessionId || worker.name === sessionId);
  }

  get(sessionId: string): SessionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as unknown as SessionRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  openActivities(sessionId: string): SessionActivity[] {
    return [...(this.live.get(sessionId)?.activities.values() ?? [])];
  }

  /** T2.2: the real, live working directory for a session — the worktree
   * path when T2.1 isolation succeeded, else `record.project`. Used by the
   * diff engine so it diffs where the session's changes actually are,
   * not always the raw project path. Undefined only for a session id the
   * manager has never seen (never created, never recovered). */
  workdirOf(sessionId: string): string | undefined {
    const live = this.live.get(sessionId);
    if (live) return live.workdir;
    // Stopped sessions load only when opened (BUG-0018) — their worktree is
    // still the place the session worked in.
    const record = this.get(sessionId);
    if (!record) return undefined;
    const worktree = record.worktreeSha !== null && this.worktrees ? this.worktrees.pathFor(sessionId) : null;
    return worktree && existsSync(worktree) ? worktree : record.project;
  }

  /** T7.6: hub-side work (registered actions) in a live session's timeline.
   * A session without a live process gets none — the run is still listed. */
  async recordHubEvents(sessionId: string, events: EmittedEvent[]): Promise<boolean> {
    const live = this.live.get(sessionId);
    if (!live) return false;
    await this.emitEvents(live, events);
    return true;
  }

  require(sessionId: string): SessionRecord {
    const rec = this.get(sessionId);
    if (!rec) throw new Error(`unknown session ${sessionId}`);
    return rec;
  }

  private readonly notificationListeners: ((n: HubNotification) => unknown)[] = [];
  /** BUG-0226: letzter Retention-Kapp-Lauf über `notifications` (Wall-Clock, nur Drossel). */
  private notificationsPrunedAt = 0;

  /** T8.3: hear about every stored notification (e.g. Web Push). */
  onNotification(listener: (n: HubNotification) => unknown): void {
    this.notificationListeners.push(listener);
  }

  /** ADR-0015: cross-session notifications, persisted so every device and a
   * restarted hub show the same list. Nutzerfund 2026-11-15: Fehler werden
   * zurückgehalten, bis der Lauf wirklich abbricht — und pro Lauf höchstens
   * eine Fehler-Meldung gespeichert, bevorzugt mit den Worten des
   * Provider-Fehlers. Ein Zug, der trotz Provider-Fehlers sauber endet,
   * benachrichtigt gar nicht (der Fehler bleibt im Verlauf sichtbar). */
  private recordNotifications(session: LiveSession, events: readonly NormalizedEvent[]): void {
    const ctx = { adapter: session.record.adapter, project: session.record.project };
    const store = (draft: NotificationDraft, ts: string) => {
      const res = this.db
        .prepare("INSERT INTO notifications (session_id, level, title, detail, kind, created_at, message_key, params) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(session.record.id, draft.level, draft.title, draft.detail, draft.kind, ts, draft.messageKey ?? null, draft.params ? JSON.stringify(draft.params) : null);
      // T8.3: push and other listeners — after it is stored, never blocking.
      const stored: HubNotification = { id: Number(res.lastInsertRowid), sessionId: session.record.id, level: draft.level, title: draft.title, detail: draft.detail, kind: draft.kind, createdAt: ts, ...(draft.messageKey ? { messageKey: draft.messageKey } : {}), ...(draft.params ? { params: draft.params } : {}) };
      for (const listener of this.notificationListeners) {
        void Promise.resolve()
          .then(() => listener(stored))
          .catch((err) => this.logger.warn("notification listener failed", { err: String(err) }));
      }
    };
    /** Eine Abbruch-Ursache wird genau einmal gemeldet — mit den Worten des
     * zurückgehaltenen Provider-Fehlers, falls es ihn gab. */
    const notifyFailure = (generic: NotificationDraft | null, ts: string) => {
      if (session.runFailureNotified) return;
      store(session.pendingErrorDraft ?? generic ?? { level: "error", title: `${projectName(ctx.project)} · ${ctx.adapter} fehlgeschlagen`, detail: null, kind: "session.turn_failed" }, ts);
      session.pendingErrorDraft = null;
      session.runFailureNotified = true;
    };
    for (const event of events) {
      const kind = (event.payload as { kind?: unknown }).kind;
      if (kind === "session.prompt") {
        // Neuer Lauf: Zurückhaltung und Abbruch-Marke gelten pro Lauf.
        session.pendingErrorDraft = null;
        session.runFailureNotified = false;
      }
      switch (kind) {
        case "provider.error": {
          // Nur zurückhalten — die Worte werden gebraucht, wenn der Lauf abbricht.
          session.pendingErrorDraft = notificationFor(event, ctx) ?? null;
          continue;
        }
        case "session.interrupted": {
          // Schon gemeldet? Dann ist die Unterbrechung derselbe Abbruch.
          if (session.runFailureNotified) continue;
          notifyFailure(notificationFor(event, ctx), event.ts);
          continue;
        }
        case "adapter.down": {
          // Die Unterbrechung benennt die Ursache; adapter.down ist Beleg.
          // (Ersetzt die frühere 30-s-Unterdrückung nach provider.error.)
          if (session.record.status === "interrupted" || session.runFailureNotified) continue;
          notifyFailure(notificationFor(event, ctx), event.ts);
          continue;
        }
        case "session.turn_end": {
          const reason = (event.payload as { reason?: unknown }).reason;
          if (reason === "error") notifyFailure(notificationFor(event, ctx), event.ts);
          else if (reason !== "interrupted") {
            // Sauberes Zugende: ein überstandener Provider-Fehler ist keine
            // Meldung mehr wert — „Zug fertig“ schon.
            const draft = notificationFor(event, ctx);
            if (draft) store(draft, event.ts);
            session.pendingErrorDraft = null;
            session.runFailureNotified = false;
          }
          // Nach einem Abbruch bleibt die Marke stehen: Folge-Meldungen
          // desselben Abbruchs (Auto-Resume scheitert, Aufräumen) sind keine
          // eigenen Meldungen. Der nächste Prompt beginnt einen neuen Lauf.
          continue;
        }
        default: {
          const draft = notificationFor(event, ctx);
          if (!draft) continue;
          if (draft.level === "error") notifyFailure(draft, event.ts);
          else store(draft, event.ts);
        }
      }
    }
  }

  /** Newest first. With `afterId`, only newer ones (polling). BUG-0226: nur
   * Zeilen im Horizont (14 Tage) — Uralt-Bestand wird weder beim ersten Poll
   * (`after=0`) ausgeliefert noch aufbewahrt; das Lesen kappt zusätzlich
   * gedrosselt (max. einmal pro Stunde), damit die Tabelle nicht wächst. */
  notifications(afterId = 0, limit = 50): { items: HubNotification[]; lastId: number } {
    const horizon = notificationHorizonCutoff();
    if (Date.now() - this.notificationsPrunedAt > 3600_000) {
      this.notificationsPrunedAt = Date.now();
      this.db.prepare("DELETE FROM notifications WHERE created_at < ?").run(horizon);
    }
    const rows = this.db
      .prepare("SELECT * FROM notifications WHERE id > ? AND created_at >= ? ORDER BY id DESC LIMIT ?")
      .all(afterId, horizon, Math.min(Math.max(limit, 1), 200)) as unknown as {
      id: number;
      session_id: string;
      level: HubNotification["level"];
      title: string;
      detail: string | null;
      kind: string;
      created_at: string;
      action: string | null;
      message_key: string | null;
      params: string | null;
    }[];
    const last = this.db.prepare("SELECT MAX(id) AS id FROM notifications").get() as { id: number | null };
    return {
      items: rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        level: row.level,
        title: row.title,
        detail: row.detail,
        kind: row.kind,
        createdAt: row.created_at,
        // EPIC-P67 T67.6: Aktionsknopf — kaputter JSON-Stand gilt als "keine Aktion", nie als Absturz der Liste
        action: parseNotificationAction(row.action),
        // EPIC-P61 T61.7 / ADR-0101: Katalogschlüssel + Params — kaputter JSON-Stand gilt als "keine Params".
        ...(row.message_key ? { messageKey: row.message_key } : {}),
        ...(() => { const p = parseNotificationParams(row.params); return p ? { params: p } : {}; })(),
      })),
      lastId: last.id ?? 0,
    };
  }

  /**
   * EPIC-P67 T67.6: Benachrichtigung außerhalb eines Session-Events speichern
   * (Main-Sync-Scheduler, später mehr) — gleiche Tabelle, gleiche Listener
   * (Push), optionaler Aktionsknopf. Die Session muss existieren; der
   * Rückgabewert ist die gespeicherte Meldung oder null bei unbekannter Session.
   */
  pushNotification(sessionId: string, draft: NotificationDraft, action?: NotificationAction | null): HubNotification | null {
    if (!this.get(sessionId)) return null;
    const ts = new Date().toISOString();
    const res = this.db
      .prepare("INSERT INTO notifications (session_id, level, title, detail, kind, created_at, action, message_key, params) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(sessionId, draft.level, draft.title, draft.detail, draft.kind, ts, action ? JSON.stringify(action) : null, draft.messageKey ?? null, draft.params ? JSON.stringify(draft.params) : null);
    const stored: HubNotification = { id: Number(res.lastInsertRowid), sessionId, level: draft.level, title: draft.title, detail: draft.detail, kind: draft.kind, createdAt: ts, ...(action ? { action } : {}), ...(draft.messageKey ? { messageKey: draft.messageKey } : {}), ...(draft.params ? { params: draft.params } : {}) };
    for (const listener of this.notificationListeners) {
      void Promise.resolve()
        .then(() => listener(stored))
        .catch((err) => this.logger.warn("notification listener failed", { err: String(err) }));
    }
    return stored;
  }













  /** ADR-0019: see ApprovalFlow. */
  applyApprovedSteer(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    return this.flow.applyApprovedSteer(approvalId, decidedByLabel);
  }

  requestBudgetTopUp(sessionId: string, newBudgetUsd: number, reason?: string, actor?: string): Promise<Ack & { approvalId?: string }> {
    return this.flow.requestBudgetTopUp(sessionId, newBudgetUsd, reason, actor);
  }

  recordApprovalDecision(sessionId: string, approvalId: string, action: string, status: "approved" | "rejected", decidedByLabel: string): Promise<void> {
    return this.flow.recordApprovalDecision(sessionId, approvalId, action, status, decidedByLabel);
  }

  applyApprovedBudgetTopUp(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    return this.flow.applyApprovedBudgetTopUp(approvalId, decidedByLabel);
  }

  operation(id: string): PendingOperation | undefined {
    return this.flow.operation(id);
  }

  /** T74.6 (EPIC-P74): der OperationStore für Freigaben außerhalb von Sessions
   * (z. B. Knowledge-Notizen) — derselbe Store, dieselbe Einmal-Garantie (ADR-0019). */
  operations(): OperationStore {
    return this.operationStore;
  }

  /**
   * T7.2 / ADR-0018 §3: native tool permissions. The server wires the
   * approval service (always, independent of `requireStepApprovals`) and
   * the bridge that lets a provider ask.
   */
  enableToolPermissions(gate: ToolGate): void {
    this.flow.useHumanGate(gate.approvals);
    this.tools = new ToolPermissions(
      {
        session: (id) => this.live.get(id),
        setStatus: (session, status) => this.setStatus(session, status),
        emitEvents: (session, events) => this.emitEvents(session, events),
      },
      this.operationStore,
      gate,
    );
  }

  /**
   * EPIC-P29 / ADR-0051 §2: die Manifest-Freigabe läuft über die echte,
   * immer vorhandene Queue — der Server verdrahtet sie unabhängig von
   * `requireStepApprovals` (gleiche Figur wie enableToolPermissions).
   */
  enableWorkspaceApprovals(approvals: ApprovalService): void {
    this.workspaceApprovals = approvals;
  }

  /** T7.4: see ApprovalFlow.requestAgentAction. */
  requestAgentAction(kind: AgentActionKind, sessionId: string | null, payload: Record<string, unknown>, actor: string): Promise<Ack & { approvalId?: string }> {
    return this.flow.requestAgentAction(kind, sessionId, payload, actor);
  }

  /** T7.4: runs what an approval released (any operation kind). */
  applyApproved(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    return this.flow.applyApproved(approvalId, decidedByLabel);
  }

  /** T7.2: see ToolPermissions. */
  requestToolPermission(sessionId: string, req: ToolPermissionRequest): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
    return this.tools ? this.tools.request(sessionId, req) : Promise.resolve({ ok: false, detail: "tool permissions not enabled" });
  }

  answerToolQuestion(id: string, answers: Record<string, string>): boolean {
    return this.tools?.answerQuestion(id, answers) ?? false;
  }

  pollToolPermission(sessionId: string, id: string): Promise<ToolPermissionPoll | undefined> {
    return this.tools ? this.tools.poll(sessionId, id) : Promise.resolve(undefined);
  }

  /** T2.7: see BudgetGuard. */
  applyBudgetTopUp(sessionId: string, newBudgetUsd: number, actor?: string): Promise<Ack> {
    return this.budget.applyBudgetTopUp(sessionId, newBudgetUsd, actor);
  }







  async tail(sessionId: string, afterSeq: number, limit?: number): Promise<NormalizedEvent[]> {
    return this.store.tail(sessionId, afterSeq, limit);
  }

  private readonly originScan = new Map<string, number>();

  /** Lazily project the original input for sessions recorded before P90. */
  async sessionOrigin(record: SessionRecord): Promise<string | null> {
    if (record.originIntent || record.handoverFrom || record.lastSeq === 0) return record.originIntent ?? null;
    let cursor = this.originScan.get(record.id) ?? 0;
    while (cursor < record.lastSeq) {
      const events = await this.store.tail(record.id, cursor, 200);
      if (events.length === 0) break;
      for (const event of events) {
        if (event.type !== "user") continue;
        const text = typeof event.payload.text === "string" ? event.payload.text : event.blobRef ? event.summary : "";
        const origin = originFromPrompt(text);
        if (!origin) continue;
        this.db.prepare("UPDATE sessions SET origin_intent = ? WHERE id = ? AND origin_intent IS NULL").run(origin, record.id);
        this.originScan.delete(record.id);
        const saved = this.get(record.id)?.originIntent ?? origin;
        const live = this.live.get(record.id);
        if (live) live.record.originIntent ??= saved;
        return saved;
      }
      cursor = events.at(-1)!.seq;
    }
    if (cursor > 0) {
      if (this.originScan.size >= 128) this.originScan.delete(this.originScan.keys().next().value!);
      this.originScan.set(record.id, cursor);
    }
    return null;
  }

  /**
   * ADR-0084: Token-Bilanz der Session — „erzeugt“ und „verarbeitet“ getrennt.
   * Abgeleitet und seitenweise gezählt (kein neuer Zustand, K7): große Sessions
   * landen nie komplett im Speicher.
   */
  async tokenTotals(sessionId: string, pageSize = 1000): Promise<SessionTokenTotals> {
    const tally = createTokenTally();
    let after = 0;
    for (;;) {
      const page = await this.store.tail(sessionId, after, pageSize);
      if (page.length === 0) break;
      tally.add(page);
      after = page[page.length - 1]!.seq;
      if (page.length < pageSize) break;
    }
    return tally.result();
  }

  async readBlob(sessionId: string, hash: string): Promise<Buffer> {
    return this.store.readBlob(sessionId, hash);
  }

  /** EPIC-P40 (ADR-0064 §5): Orchestrierungs-Ergebnisse > 4 KB als Blob (K5) — gleiche Ablage wie ctx.blob. */
  async writeBlobRef(sessionId: string, data: string | Uint8Array): Promise<string> {
    return blobRefToString(await this.store.writeBlob(sessionId, data));
  }

  /**
   * K7 crash recovery: restore every persisted session.
   * Identical status/event-count after `kill -9`, restore < 3 s.
   */
  /**
   * EPIC-P21 T21.2: the proposal for handing a session to another provider — the text the next one
   * starts from, and why (the provider.error of the current turn, if there is one).
   */
  async handoverDraft(sessionId: string): Promise<{ prompt: string; adapter: string; model: string | null; reason: { category: string; title: string; detail: string } | null }> {
    const record = this.live.get(sessionId)?.record ?? this.list().find((r) => r.id === sessionId);
    if (!record) throw new Error("unknown session");
    const events = await this.store.replay(sessionId);
    const reason = currentProviderFailureFromEvents(events);
    return { prompt: buildHandoverPrompt(events, { adapter: record.adapter, model: record.model, ...(reason ? { reason } : {}) }), adapter: record.adapter, model: record.model, reason };
  }

  /** Starts a new session at another adapter/model with the (edited) handover text; both sides record the link. */
  async handover(sessionId: string, input: { adapter: string; model?: string | undefined; prompt: string }, actor?: string): Promise<SessionRecord> {
    const source = this.live.get(sessionId)?.record ?? this.list().find((r) => r.id === sessionId);
    if (!source) throw new Error("unknown session");
    if (input.prompt.length === 0 || input.prompt.length > HANDOVER_PROMPT_MAX) throw new Error(`handover prompt must be 1–${HANDOVER_PROMPT_MAX} characters`);
    const oldTitle = source.focus?.text ?? source.title;
    const firstLine = input.prompt.trimStart().split("\n", 1)[0]!;
    const proposed = firstLine.startsWith("Übergabe: Diese Arbeit lief bisher") ? null : sessionTitle(firstLine);
    const words = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\d]+/gu) ?? []);
    const previous = words(oldTitle ?? "");
    const next = [...words(proposed ?? "")];
    const changed = proposed && next.length > 0 && next.filter((word) => previous.has(word)).length / next.length < 0.5;
    const created = await this.create({ adapter: input.adapter, project: source.project, prompt: input.prompt, ...(input.model ? { model: input.model } : {}) }, actor, {
      naming: {
        originIntent: await this.sessionOrigin(source) ?? originFromPrompt(source.title ?? ""),
        title: oldTitle,
        focus: changed ? { text: proposed, source: "handoff", setAt: new Date().toISOString() } : source.focus ?? null,
        handoverFrom: source.id,
      },
    });
    const from = this.live.get(sessionId);
    const to = this.live.get(created.id);
    if (from) await this.emitEvents(from, [{ type: "system", summary: `Übergeben an ${created.adapter}${created.model ? ` (${created.model})` : ""}`, payload: { kind: "session.handover_out", toSessionId: created.id, adapter: created.adapter, model: created.model } }]);
    if (to) await this.emitEvents(to, [{ type: "system", summary: `Übernommen von ${source.adapter}${source.model ? ` (${source.model})` : ""}`, payload: { kind: "session.handover_in", fromSessionId: sessionId, adapter: source.adapter, model: source.model } }]);
    // 2026-11-12 (Nutzeranforderung an ADR-0039): die Quelle pausiert sauber —
    // sie läuft nicht weiter und kostet nicht doppelt, während die Arbeit im
    // Ziel weiterläuft. parkFor fail-closed: ein freilaufender Adapterprozess
    // bekommt das echte Park-Signal (T2.7/ADR-0008), nicht nur ein neues Label.
    if (from && from.record.status !== "parked" && from.record.status !== "stopped") await this.parkFor(from, "manual", actor);
    return created;
  }

  /** Rebuilds one session's turn measurements from its event stream (idempotent). */
  private async recordTurnMetrics(sessionId: string): Promise<void> {
    const record = this.live.get(sessionId)?.record ?? this.list().find((r) => r.id === sessionId);
    if (!record) return;
    const turns = deriveTurnMetrics(await this.store.replay(sessionId), { sessionId, adapter: record.adapter, model: record.model });
    this.turnMetricStore.replaceSession(sessionId, turns);
  }

  /** K7 recovery path for turn measurements: sessions without rows are rebuilt from JSONL, one at a time. */
  async backfillTurnMetrics(): Promise<number> {
    let rebuilt = 0;
    for (const record of this.list()) {
      if (this.turnMetricStore.hasSession(record.id)) continue;
      await this.recordTurnMetrics(record.id);
      if (this.turnMetricStore.hasSession(record.id)) rebuilt++;
    }
    return rebuilt;
  }

  /** Typical duration of a turn for this session's adapter/model — null for an unknown session. */
  runEstimate(sessionId: string): RunEstimate | null {
    const record = this.live.get(sessionId)?.record ?? this.list().find((r) => r.id === sessionId);
    return record ? this.turnMetricStore.estimate(record.adapter, record.model, sessionId) : null;
  }

  turnMetrics(sessionId: string): TurnMetric[] {
    return this.turnMetricStore.listBySession(sessionId);
  }

  turnMetricsSummary(): ReturnType<TurnMetricStore["summary"]> {
    return this.turnMetricStore.summary();
  }

  evaluation(sessionId: string): Promise<EvalResult | null> {
    return readEvaluation(this.store, sessionId);
  }

  /**
   * P84: alle erfassten Auswertungen. Die Journale bleiben die Quelle (K7); der Speicher-Cache
   * merkt sich nur, dass eine beendete Session keine Auswertung trägt, und fällt mit dem Prozess.
   */
  private readonly evaluationScan = new Map<string, EvalResult | null>();

  async listEvaluations(): Promise<EvalResult[]> {
    const stopped = this.list().filter((record) => record.status === "stopped");
    const todo = stopped.filter((record) => !this.evaluationScan.has(record.id));
    for (let index = 0; index < todo.length; index += 8) {
      await Promise.all(todo.slice(index, index + 8).map(async (record) => {
        this.evaluationScan.set(record.id, await readEvaluation(this.store, record.id));
      }));
    }
    return stopped.flatMap((record) => this.evaluationScan.get(record.id) ?? []);
  }

  async recordEvaluation(sessionId: string, input: EvalRunInput): Promise<EvalResult> {
    if (input.phases.at(-1)?.sessionId !== sessionId) throw new Error("Evaluation must be recorded on the build session");
    if (this.recordingEvaluations.has(sessionId)) throw new Error("Evaluation write in progress; retry");
    this.recordingEvaluations.add(sessionId);
    try {
      const existing = await this.evaluation(sessionId);
      if (existing) {
        if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error("Session already has a different evaluation");
        await this.store.flush(sessionId);
        return existing;
      }
      const phases = await Promise.all(input.phases.map(async (phase) => {
        const record = this.get(phase.sessionId);
        if (!record || record.status !== "stopped") throw new Error("Evaluation phases must be stopped before recording");
        return measureEvaluationPhase(phase, record, await this.store.replay(record.id), input.outcome);
      }));
      if (phases[0] && phases[1] && phases[0].endedAt > phases[1].startedAt) {
        throw new Error("Evaluation plan must finish before the build begins");
      }
      const session = this.live.get(sessionId) ?? this.openStopped(sessionId);
      if (!session || session.record.status !== "stopped") throw new Error("Evaluation build session is unavailable");
      const result = EvalResult.parse({ input, recordedAt: new Date().toISOString(), phases });
      await this.emitSystem(session, EVAL_COMPLETE_EVENT, { result });
      this.evaluationScan.set(sessionId, result);
      await this.store.flush(sessionId);
      return result;
    } finally {
      this.recordingEvaluations.delete(sessionId);
    }
  }

  protected makeContext(session: LiveSession): AdapterContext {
    const signal = session.abort.signal;
    const bindWorker = (proc: WorkerProcess) => {
      let force: NodeJS.Timeout | undefined;
      const abort = () => {
        void proc.kill("SIGTERM").catch(err => this.logger.warn("worker termination failed", { sessionId: session.record.id, err: String(err) }));
        force = setTimeout(() => { void proc.kill("SIGKILL").catch(err => this.logger.error("worker forced termination failed", { sessionId: session.record.id, err: String(err) })); }, 2000);
        force.unref();
      };
      proc.onExit(() => { signal.removeEventListener("abort", abort); if (force) clearTimeout(force); });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    };
    const automaticCompaction = this.automaticCompaction;
    return {
      sessionId: session.record.id,
      get automaticCompaction() { return automaticCompaction(); },
      signal,
      workdir: session.workdir,
      log: (level, msg, extra) => {
        const logger = this.logger.child({
          adapter: session.record.adapter,
          sessionId: session.record.id,
        });
        logger[level](msg, extra);
      },
      emit: (event: EmittedEvent) => {
        if (event.summary === EVAL_COMPLETE_EVENT || event.payload?.kind === EVAL_COMPLETE_EVENT) {
          this.logger.warn("adapter attempted to emit a reserved evaluation event", { sessionId: session.record.id });
          return;
        }
        if (this.shuttingDown) return;
        if (signal.aborted) {
          // BUG-0188: stop() abortet das Signal, bevor der Adapter den
          // onExit-Flush der Worker-Ausgabe liefert. Ein Event mit
          // payload.nativeSessionId ist der generische Resume-Griff
          // (emitEvents bindet ihn) — hermes druckt die session_id genau
          // dann. Er überlebt den Stop (K7: die geleistete Arbeit bleibt
          // über --resume erreichbar). Alles andere nach dem Stop bleibt
          // verworfen, wird aber geloggt — still war der Drop nie wieder.
          const late = event.payload as { nativeSessionId?: unknown } | undefined;
          if (typeof late?.nativeSessionId === "string" && late.nativeSessionId.length > 0) {
            void this.emitEvents(session, [event]).catch((err) => this.handleEmitFailure(session, event, err));
          } else {
            this.logger.warn("adapter event after stop dropped", {
              sessionId: session.record.id,
              type: event.type,
              kind: (event.payload as { kind?: unknown } | undefined)?.kind ?? null,
            });
          }
          return;
        }
        if (event.type === "error" || event.payload?.kind === "provider.error" || event.payload?.kind === "cursor.usage_limit") session.turnFailed = true;
        void this.emitEvents(session, [event]).catch((err) => this.handleEmitFailure(session, event, err));
      },
      /** ADR-0083: transiente Live-Frames — kein EventStore, kein Snapshot, keine
       * Event-Sequenz. Ein Frame, der nirgends hingeht, ist verloren — absichtlich. */
      stream: (frame: EmittedStreamFrame) => {
        if (signal.aborted || this.shuttingDown) return;
        this.publishFrame(session, frame);
      },
      blob: async (data: string | Uint8Array): Promise<BlobRef> => {
        return this.store.writeBlob(session.record.id, data);
      },
      spawnWorker: async (cmd, opts) => {
        if (this.shuttingDown || signal.aborted) throw new Error("Session-Kontext beendet — kein neuer Worker.");
        const proc = await this.runner.spawn({
          name: session.record.id,
          // T17.5/ADR-0037: explicit marker — identity after a restart
          // comes from this, not from the (overridable) name.
          sessionId: session.record.id,
          cwd: session.workdir,
          cmd,
          ...(opts?.env !== undefined ? { env: opts.env } : {}),
          ...(opts?.cols !== undefined ? { cols: opts.cols } : {}),
          ...(opts?.rows !== undefined ? { rows: opts.rows } : {}),
          ...(opts?.stdin !== undefined ? { stdin: opts.stdin } : {}),
        });
        bindWorker(proc);
        if (signal.aborted) throw new Error("Session während Worker-Start beendet.");
        // ADR-0013 Nachtrag: a persistent agent is not a turn — the adapter
        // reports turns through ctx.turn().
        if (opts?.persistent) {
          session.persistentWorker = true;
          // ADR-0050: persistiert, damit die K7-Recovery nach einem Crash
          // weiß, dass adapter.recover() auch ohne offenen Zug sinnvoll ist
          // (Adoption des weiterlaufenden Prozesses).
          session.record.persistentWorker = true;
          this.persist(session.record);
          this.trackPersistentWorker(session, proc, signal);
        } else await this.trackTurn(session, proc);
        return proc;
      },
      adoptWorker: async (opts) => {
        const proc = (await this.runner.adopt?.(session.record.id)) ?? null;
        if (proc) bindWorker(proc);
        session.adopted = proc !== null;
        if (proc && opts?.persistent) {
          session.persistentWorker = true;
          session.record.persistentWorker = true;
          this.persist(session.record);
          this.trackPersistentWorker(session, proc, signal);
        }
        if (proc && !opts?.persistent) await this.trackTurn(session, proc);
        return proc;
      },
      turn: (state) => {
        if (signal.aborted || this.shuttingDown) return;
        if (state === "working") session.turnFailed = false;
        this.queueLifecycle(session, signal, () => this.adapterTurn(session, state));
      },
      get turnActive() { return session.record.status === "working" && session.mainTurnIdle !== true; },
      activity: (activity) => {
        this.queueLifecycle(session, signal, () => this.activityTracker.record(session, activity, "provider"));
      },
      interrupt: (reason, detail) => {
        this.queueLifecycle(session, signal, async () => {
          await this.emitSystem(session, "session.transport_lost", { reason, detail: detail?.slice(0, 500) ?? null });
          await this.interruption.interrupt(session, reason);
        });
      },
      get nativeSessionId() {
        return session.record.nativeSessionId;
      },
      // ADR-0061: the session's recorded model (kept current by configure()).
      get model() {
        return session.record.model;
      },
      ...(this.tools?.bridge ? { permissionBridge: () => this.tools!.bridge!(session.record.id) } : {}),
      ...(this.tools ? { requestToolPermission: (req: ToolPermissionRequest) => signal.aborted ? Promise.resolve({ behavior: "deny" as const, message: "Session beendet." }) : this.awaitToolPermission(session, req, signal) } : {}),
    };
  }

  /**
   * AI-P0-5 / BUG-0003 follow-up: a failed store.append() used to be a bare
   * console.error plus a raw `session.record.status = "error"` mutation —
   * never persisted, never visible in the event stream, and the seq that
   * emitEvents() had already assigned was gone for good either way. That's
   * exactly the silent drop AGENTS.md rule 6 ("Fail loud") exists to rule
   * out. This makes the failure visible on both channels a subscriber or
   * API client can actually observe:
   *   - status: a real setStatus() call (validated transition, persisted
   *     to SQLite, snapshot saved) instead of an in-memory-only mutation.
   *   - stream: a best-effort follow-up "error" event. Most append
   *     failures are one-off (e.g. a transient EventStore race), so a
   *     second attempt usually lands; if it doesn't, that failure is
   *     logged too and swallowed rather than looping.
   */
  private async handleEmitFailure(session: LiveSession, failedEvent: EmittedEvent, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error("event append failed", { sessionId: session.record.id, err: message });

    try {
      await this.setStatus(session, "error");
    } catch (statusErr) {
      // Late emission after shutdown/cleanup (session already "stopped",
      // no transition to "error" allowed) must never crash the daemon.
      this.logger.error("could not persist error status", {
        sessionId: session.record.id,
        err: statusErr instanceof Error ? statusErr.message : String(statusErr),
      });
    }

    try {
      await this.emitEvents(session, [
        {
          type: "error",
          summary: `event append failed: ${message.slice(0, 150)}`,
          payload: { originalType: failedEvent.type, reason: message },
        },
      ]);
    } catch (retryErr) {
      this.logger.error("could not surface append failure as an event", {
        sessionId: session.record.id,
        err: retryErr instanceof Error ? retryErr.message : String(retryErr),
      });
    }
  }

  protected async emitEvents(session: LiveSession, emitted: EmittedEvent[]): Promise<void> {
    const events: NormalizedEvent[] = emitted.map((e) => ({
      seq: ++session.record.lastSeq,
      ts: e.ts ?? new Date().toISOString(),
      sessionId: session.record.id,
      type: e.type,
      summary: e.summary.slice(0, 200),
      payload: e.payload ?? {},
      blobRef: e.blobRef ?? null,
      ...(e.tokensEst !== undefined ? { tokensEst: e.tokensEst } : {}),
      ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}),
      ...(e.tokensSource !== undefined ? { tokensSource: e.tokensSource } : {}),
      ...(e.costSource !== undefined ? { costSource: e.costSource } : {}),
      ...(e.usageQuota !== undefined ? { usageQuota: e.usageQuota } : {}),
    }));
    // ADR-0003: costUsd is per-event, not cumulative — the hub sums it.
    let sawCost = false;
    for (const e of events) {
      if (e.costUsd !== undefined) {
        session.record.costUsd += e.costUsd;
        sawCost = true;
      }
      // ADR-0006: same per-event/summed pattern as costUsd, applied to the
      // tokensEst field that already existed on the event contract but was
      // never aggregated onto the session record.
      if (e.tokensEst !== undefined) session.record.tokensEst += e.tokensEst;
      // T7.7: per-turn evidence — "no number" stays visibly unknown.
      session.record.metrics = metricsState(countMetrics((session.record.metrics as SessionMetricsState).counters, e));
      // T8.1: the card shows what happened last, in words.
      const act = activityOf(e);
      if (act) session.record.lastActivity = act;
      const native = (e.payload as { nativeSessionId?: unknown }).nativeSessionId;
      if (typeof native === "string" && native.length > 0) session.record.nativeSessionId = native;
      // ADR-0004: usageQuota is account-level, NEVER summed and NEVER
      // written onto SessionRecord — only the latest snapshot per adapter
      // id, overwriting regardless of which session observed it (it's the
      // same account state either way).
      if (e.usageQuota !== undefined) {
        this.usageByAdapter.set(session.record.adapter, {
          quota: e.usageQuota,
          observedAt: new Date().toISOString(),
        });
      }
    }
    session.record.updatedAt = new Date().toISOString();
    const enforced = await this.store.append(session.record.id, events);
    this.metrics?.inc("events_appended", enforced.length);
    this.persist(session.record);
    for (const sub of session.subscribers) {
      try {
        sub(enforced);
      } catch {
        // a slow/broken subscriber never blocks the stream
      }
    }
    this.recordNotifications(session, enforced);
    // EPIC-P21 T21.3: a finished turn becomes a measurement (derived from the stream, K7).
    if (enforced.some((e) => e.type === "system" && (e.payload as { kind?: unknown }).kind === "session.turn_end")) {
      void this.recordTurnMetrics(session.record.id).catch((err) => this.logger.warn("turn metrics not recorded", { sessionId: session.record.id, err: err instanceof Error ? err.message : String(err) }));
    }
    this.maybeTitleWithModel(session, enforced);
    // BUG-0048: the provider moved on — "Freigabe nötig" without an open request is stale.
    if (session.record.status === "waiting_approval" && enforced.some((e) => ["assistant", "tool_use", "tool_result", "thinking"].includes(e.type))) {
      void this.healWaitingApproval(session, false).catch((err) => this.logger.warn("waiting_approval heal failed", { sessionId: session.record.id, err: err instanceof Error ? err.message : String(err) }));
    }
    // T2.7: after this event's own subscriber notification, not before —
    // checkBudget/checkDailyCap recurse back into this method for their
    // own park/warning events, which must reach subscribers in their real
    // temporal order (the event that crossed the threshold, then the park
    // that followed), not the other way around. Safe against runaway
    // recursion: a just-parked session is terminal and neither check
    // re-fires for it.
    if (sawCost) {
      await this.budget.check(session);
      await this.budget.checkDailyCap();
    }
  }

  /**
   * BUG-0048: "waiting_approval" is only true while a tool request is open. A hub restart in the
   * middle of one (the bridge's answer never arrived) or a request that timed out meanwhile left
   * it standing — the overview then showed "Braucht dich" with nothing to decide.
   */
  protected async healWaitingApproval(session: LiveSession, afterRestart: boolean): Promise<void> {
    if (session.record.status !== "waiting_approval") return;
    if (this.operationStore.list(["pending"], session.record.id).some((o) => o.kind === "tool.permission")) return;
    // EPIC-P29: Warten auf eine Manifest-Freigabe ist echtes Warten — kein
    // Tool-Rest, der "geheilt" werden dürfte. Abgelehnt/abgelaufen wird
    // laut fehlerhaft; entschieden (approved) gehört der Operation.
    const wsApproval = (this.workspaceApprovals ?? this.approvals)?.list().find((a) => a.sessionId === session.record.id && a.action === "workspace.setup");
    if (wsApproval) {
      if (wsApproval.status === "pending") return;
      if (wsApproval.status === "rejected" || wsApproval.status === "timed_out") {
        await this.failWorkspace(session, session.workspace?.manifestHash ?? null, session.workspace?.baseSha ?? session.record.worktreeSha ?? "", {
          step: "approval",
          kind: "unknown",
          detail: `Manifest-Freigabe ${wsApproval.status === "rejected" ? "abgelehnt" : "abgelaufen"}`,
          logBlobRef: null,
        });
      }
      return;
    }
    // After a restart no turn is known to be running unless the worker was adopted.
    const idle = afterRestart && (session.adopted === false || !session.handle);
    await this.setStatus(session, idle ? "idle" : "working");
  }

  /** EPIC-P15 T15.5: model for short AI titles. Absent: titles come from the prompt only. */
  enableAiTitles(model: PlannerModelConfig | undefined): void {
    this.titleModel = model;
  }

  protected async requestFocusTitle(sessionId: string): Promise<string | null> {
    if (!this.titleModel) throw new Error("Kein Modell für Namensvorschläge konfiguriert");
    const events = await this.store.replay(sessionId);
    const prompt = events.findLast((entry) => entry.type === "user" && typeof entry.payload.text === "string")?.payload.text;
    const answer = events.findLast((entry) => entry.type === "assistant" && typeof entry.payload.text === "string")?.payload.text;
    return typeof prompt === "string" && prompt.trim()
      ? askTitleModel(this.titleModel, prompt, typeof answer === "string" ? answer : "")
      : null;
  }

  /** EPIC-P15 T15.5: once per session, after the first real answer. Fire and forget: a slow or
   * failing model never holds up the stream, and the prompt-based title stays when it fails. */
  private maybeTitleWithModel(session: LiveSession, events: readonly NormalizedEvent[]): void {
    if (!this.titleModel || session.aiTitleTried || session.record.handoverFrom || session.record.focus || session.record.titleSource !== "auto") return;
    const answer = events.find((e) => e.type === "assistant" && typeof (e.payload as { text?: unknown }).text === "string" && (e.payload as { text: string }).text.trim());
    const prompt = session.titlePrompt ?? session.record.title;
    if (!answer || !prompt) return;
    session.aiTitleTried = true;
    const text = (answer.payload as { text: string }).text;
    void (async () => {
      const title = await askTitleModel(this.titleModel!, prompt, text);
      if (!title || session.record.focus || session.record.titleSource !== "auto") return; // none, or renamed meanwhile
      session.record.title = title;
      session.record.titleSource = "ai";
      session.record.updatedAt = new Date().toISOString();
      this.persist(session.record);
      await this.emitSystem(session, "session.titled", { title, source: "ai" });
    })().catch((err) => this.logger.warn("ai title failed", { sessionId: session.record.id, err: err instanceof Error ? err.message : String(err) }));
  }

  /**
   * EPIC-P67 / ADR-0088 Stufe 1: die Basiswahl sichtbar machen. Skip/Fetch-
   * Fehler werden als Event laut benannt (Regel 6, K10) — ein Erfolg auf
   * `origin/<Hauptbranch>` braucht keins: die Basis-SHA steht im Record
   * (`worktreeSha`) und belegt sie. `off` ist Nutzerauswahl, kein Defekt.
   */
  protected async emitMainSyncBaseEvent(session: LiveSession, base: WorktreeBaseChoice): Promise<void> {
    if (base.source === "origin" || base.reason === "off") return;
    // BUG-0260: „Projekt hat kein Haupt-Fern“ ist eine Konfigurationslage, kein
    // Defekt — wie `off` und `not-main-branch` als Skip benannt. Sonst steht in
    // der Sessions-Akte jedes Projekt ohne Fern als Fehler da.
    if (base.reason === "not-main-branch" || base.reason === "no-remote") {
      await this.emitSystem(session, "workspace.main_sync_skipped", { reason: base.reason, ...(base.detail ? { detail: base.detail } : {}) });
      return;
    }
    await this.emitSystem(session, "workspace.main_sync_failed", {
      reason: base.fetchReason,
      ...(base.detail ? { detail: base.detail } : {}),
    });
  }

  protected async emitSystem(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void> {
    await this.emitEvents(session, [
      { type: "system", summary: kind === "session.interrupted" ? `${kind}: ${String(payload.reason)}` : kind, payload: { kind, ...payload } },
    ]);
    await this.store.saveSnapshot(session.record.id, this.snapshotOf(session));
  }

  private snapshotOf(session: LiveSession): SessionSnapshot {
    return {
      sessionId: session.record.id,
      status: session.record.status,
      lastSeq: session.record.lastSeq,
      adapterVersion: session.record.adapterVersion,
      savedAt: new Date().toISOString(),
      controlMode: session.record.controlMode,
      nativeSessionId: session.record.nativeSessionId,
      resumeVersion: session.record.resumeVersion,
      inputRevision: session.record.inputRevision,
      openActivities: [...session.activities.values()],
      originIntent: session.record.originIntent,
      focus: session.record.focus,
      handoverFrom: session.record.handoverFrom,
    };
  }

  /**
   * T5.4 / ADR-0013: every CLI adapter runs one worker process per turn, and
   * every worker is spawned through this context. A new worker makes the
   * session `working`; the last one exiting cleanly makes it `idle` (between
   * turns). A failed exit leaves the status to the adapter/heartbeat path.
   */
  /** ADR-0013 Nachtrag: turns reported by an adapter with a persistent worker. */
  private async adapterTurn(session: LiveSession, state: "working" | "idle"): Promise<void> {
    if (state === "working") {
      session.mainTurnIdle = false;
      await this.emitSystem(session, "session.main_turn_start", {});
      if (session.record.status === "idle" || session.record.status === "error") await this.setStatus(session, "working");
      return;
    }
    // ADR-0076: das Hauptzugende wird zuerst journalisiert — turnActive und
    // promptloses Resume richten sich nach ihm, auch wenn Arbeit offen bleibt.
    if (!session.mainTurnIdle) {
      session.mainTurnIdle = true;
      await this.emitSystem(session, "session.main_turn_end", {});
    }
    await this.dropOrphanedTools(session);
    // ADR-0074 (BUG-0155): Zugende ≠ Arbeitsende — offene Aktivitäten halten
    // die Session ehrlich auf working; statt turn_end steht die Ausnahme im Strom.
    if (session.activities.size > 0) {
      await this.emitSystem(session, "session.activity_pending", { open: [...session.activities.values()].map((a) => a.label) });
      if (this.canDrain(session)) this.scheduleDrain(session.record.id);
      return;
    }
    if (session.record.status !== "working") return;
    if (session.turnFailed) {
      await this.interruption.interrupt(session, "adapter_down");
      return;
    }
    await this.setStatus(session, "idle");
    await this.emitSystem(session, "session.turn_end", { code: 0 });
  }

  /** BUG-0209: Ein Werkzeugaufruf gehört zu einem Zug. Steht er nach dem Hauptzugende
   * noch offen im Register, hat sein terminales Update nie den Hub erreicht (abgebrochener
   * oder verlorener Aufruf) — ohne dieses Schließen blieb die Session für immer `working`.
   * Subagenten (`task:`/`agent:`) und externe Jobs dürfen den Zug überleben und bleiben. */
  protected async dropOrphanedTools(session: LiveSession): Promise<void> {
    for (const [id, work] of [...session.activities]) {
      if (work.source !== "provider" || !id.startsWith("tool:")) continue;
      session.activities.delete(id);
      await this.emitSystem(session, "session.activity_end", { id, code: 0, orphaned: true });
    }
  }

  private queueLifecycle(session: LiveSession, signal: AbortSignal, work: () => Promise<unknown>): void {
    session.lifecycle = (session.lifecycle ?? Promise.resolve()).then(async () => {
      if (!signal.aborted && !this.shuttingDown) await work();
    }).catch(err => this.handleEmitFailure(session, { type: "error", summary: "Session-Lebenszyklus fehlgeschlagen", payload: { kind: "session.lifecycle_failed" } }, err));
  }

  activity(sessionId: string, activity: ActivityReport): Promise<Ack> {
    return this.activityTracker.report(sessionId, activity);
  }

  /** ADR-0074 (BUG-0155): extern registrierte Aktivität (Job, Subagent,
   * Watcher). Explizit — der Hub rät nie aus Assistant-Text oder Prozessen. */
  async registerActivity(sessionId: string, label: string, source = "external"): Promise<{ id: string } | null> {
    const session = this.live.get(sessionId);
    if (!session) return null;
    const id = `job:${crypto.randomUUID()}`;
    const entry = { id, source, label: label.trim() || "Hintergrundarbeit", startedAt: new Date().toISOString() };
    session.activities.set(id, entry);
    if (session.record.status === "idle" || session.record.status === "error") await this.setStatus(session, "working");
    await this.emitSystem(session, "session.activity_begin", { ...entry });
    return { id };
  }

  /** ADR-0074: Ende einer Aktivität. Die letzte beendete Aktivität einer
   * arbeitenden Session ohne Zug-Prozesse schließt den Lauf (idle + turn_end). */
  async endActivity(sessionId: string, id: string, code = 0): Promise<boolean> {
    const session = this.live.get(sessionId);
    const entry = session?.activities.get(id);
    if (!session || !entry || !session.activities.delete(id)) return false;
    await this.emitSystem(session, "session.activity_end", { id, code });
    // Nutzerfund 2026-11-15: Während des Hauptzugs ist ein leeres Provider-
    // Register eine Werkzeug-Lücke, kein Laufende (SessionActivities.closeIfLast).
    if (session.mainTurnIdle === false && entry.source === "provider") return true;
    if (session.activities.size === 0 && (session.activeWorkers ?? 0) === 0 && session.record.status === "working") {
      if (code !== 0) {
        await this.emitSystem(session, "session.turn_end", { code, reason: "error", detail: entry.label });
        await this.setStatus(session, "error");
      } else {
        await this.setStatus(session, "idle");
        await this.emitSystem(session, "session.turn_end", { code });
      }
    }
    return true;
  }

  /** T7.2: an in-process adapter waits for the phone's decision. */
  private async awaitToolPermission(session: LiveSession, req: ToolPermissionRequest, signal: AbortSignal): Promise<ToolPermissionAnswer> {
    const tools = this.tools!;
    const asked = await tools.request(session.record.id, req);
    if (!asked.ok) return { behavior: "deny", message: `Freigabe nicht möglich (${asked.detail}) — nicht ausgeführt.` };
    for (;;) {
      if (signal.aborted) return { behavior: "deny", message: "Session beendet — nicht ausgeführt." };
      const poll = await tools.poll(session.record.id, asked.id);
      if (!poll) return { behavior: "deny", message: "Anfrage nicht mehr bekannt — nicht ausgeführt." };
      if (poll.state === "answered") return poll.answer;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  private async trackTurn(session: LiveSession, proc: WorkerProcess): Promise<void> {
    session.activeWorkers = (session.activeWorkers ?? 0) + 1;
    session.workerExitPending = false;
    if (session.record.status === "idle" || session.record.status === "error") await this.setStatus(session, "working");
    const signal = session.abort.signal;
    const parkGeneration = session.parkGeneration ?? 0;
    proc.onExit((code) => {
      if (signal.aborted) return;
      session.activeWorkers = Math.max(0, (session.activeWorkers ?? 1) - 1);
      if ((session.activeWorkers ?? 0) === 0) session.workerExitPending = true;
      if (parkGeneration !== (session.parkGeneration ?? 0)) return;
      if (code !== 0) {
        this.scheduleInterruption(session, signal);
        return;
      }
      setTimeout(() => {
        if (signal.aborted || this.shuttingDown || (session.activeWorkers ?? 0) > 0 || session.record.status !== "working") return;
        if ([...session.activities.values()].some(work => work.source !== "external")) {
          void this.interruption.interrupt(session, "worker_exit");
          return;
        }
        void this.adapterTurn(session, "idle")
          .catch((err) => this.logger.warn("turn end not recorded", { sessionId: session.record.id, err: String(err) }));
      }, TURN_END_SETTLE_MS).unref();
    });
  }

  private trackPersistentWorker(session: LiveSession, proc: WorkerProcess, signal: AbortSignal): void {
    proc.onExit(() => this.scheduleInterruption(session, signal));
  }

  private scheduleInterruption(session: LiveSession, signal: AbortSignal): void {
    // Give the adapter's exit callback time to journal a provider error.
    setTimeout(() => {
      if (signal.aborted || this.shuttingDown || (session.activeWorkers ?? 0) > 0) return;
      void this.interruption.interrupt(session, "worker_exit").catch((err) => this.logger.error("interruption not recorded", { sessionId: session.record.id, err: String(err) }));
    }, TURN_END_SETTLE_MS).unref();
  }

  protected async setStatus(session: LiveSession, status: SessionStatus): Promise<void> {
    const allowed = VALID_TRANSITIONS[session.record.status] ?? [];
    if (!allowed.includes(status) && session.record.status !== status) {
      throw new Error(
        `illegal session transition ${session.record.status} → ${status} (${session.record.id})`,
      );
    }
    // BUG-0272 (ADR-0116): der Zug hält den Modell-Endpoint. Sobald die Session
    // nicht mehr arbeitet, gibt sie ihn zurück — der Lease der Pforte hält ihren
    // KV-Cache trotzdem warm, damit der nächste Zug derselben Sitzung nicht von
    // vorn vorbehandeln muss.
    if (status !== "working" && status !== "starting") this.gebeInferenzFrei(session);
    session.record.status = status;
    session.record.updatedAt = new Date().toISOString();
    this.persist(session.record);
    await this.store.saveSnapshot(session.record.id, this.snapshotOf(session));
    if (status === "idle") this.scheduleDrain(session.record.id);
  }

  protected persist(record: SessionRecord): void {
    persistRecord(this.db, record);
  }


  private toDiscovered(record: SessionRecord): DiscoveredSession {
    return {
      hubSessionId: record.id,
      project: record.project,
      adapter: record.adapter,
      status: record.status,
      controlMode: unsupportedResume(record.resumeVersion) ? "observed" : record.controlMode,
      harness: record.harness,
      hostId: record.hostId,
      nativeSessionId: record.nativeSessionId,
      resumeVersion: record.resumeVersion,
      observedAt: record.observedAt ?? record.updatedAt,
      unsupportedResume: unsupportedResume(record.resumeVersion),
      fork: record.fork,
      parentSessionId: record.parentSessionId,
      title: record.title,
      preview: record.lastActivity?.text ?? null,
      live: record.status === "working" || record.status === "starting",
    };
  }

  protected hasSeenInput(sessionId: string, inputId: string): boolean {
    const row = this.db
      .prepare("SELECT input_id FROM session_inputs WHERE session_id = ? AND input_id = ?")
      .get(sessionId, inputId) as { input_id: string } | undefined;
    return row !== undefined;
  }

  protected commitSteerMeta(session: LiveSession, meta: SteerMeta | undefined): void {
    session.record.inputRevision += 1;
    if (meta?.clientId) {
      session.record.writerClient = meta.clientId;
      session.record.writerLeaseUntil = new Date(Date.now() + WRITER_LEASE_MS).toISOString();
    }
    this.persist(session.record);
    if (!meta?.inputId) return;
    this.db
      .prepare("INSERT OR IGNORE INTO session_inputs (session_id, input_id, applied_at) VALUES (?, ?, ?)")
      .run(session.record.id, meta.inputId, new Date().toISOString());
  }
}
