import { join, win32 } from "node:path";
import { SessionInterruption } from "./session-interruption.ts";
import { SessionRecovery } from "./session-recovery.ts";
import { SessionActivities } from "./session-activity.ts";
import type { ActivityReport, SessionActivity } from "@ancientvoid/contracts";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import type { PromptAttachment, ToolPermissionAnswer, ToolPermissionPoll, ToolPermissionRequest, Adapter, SessionMetricsState, AdapterContext, BlobRef, EmittedEvent, EmittedStreamFrame, WsStreamFrames, HubLogger, HubMetrics, NormalizedEvent, SessionRecord, SessionSnapshot, SessionSpec, SessionStatus, SteerInput, Ack, WorkerProcess, WorkerRunner, UsageQuota, ReportingSink, DiscoverySource, DiscoveredSession, HubNotification, NotificationAction, PendingOperation, RunEstimate, TurnMetric, WorkspaceManifest, WorkspaceServiceStatus, WorkspaceSetupApproval, WorkspaceStatus, MainSyncSettings, MainSyncApplyResult, MainSyncCheckResult } from "@ancientvoid/contracts";
import { actorKind, blobRefToString, classifyProviderError, countMetrics, currentProviderFailureFromEvents, emptyMetricCounters, metricsState, promptWithAttachments, providerErrorEvent, DEFAULT_HOST_ID, MAIN_SYNC_DEFAULTS, RESUME_SCHEMA_VERSION, SessionSpec as SessionSpecSchema, isLoopAdapter, unsupportedResume, EmittedStreamFrame as StreamFrameSchema } from "@ancientvoid/contracts";
import type { EventStore } from "../../platform/index.ts";
import type { AdapterRegistry } from "../harness/index.ts";
import type { HubDatabase } from "../../platform/index.ts";
import type { WorktreeBaseChoice, WorktreeManager } from "../workspace/index.ts";
import { MainSyncEngine, resolveMainBranch, fetchMainBranch, classifyFetchError } from "../workspace/index.ts";
import type { MainSyncCandidate } from "../workspace/index.ts";
import { WorkspaceRuntime, ManifestApprovalStore, ServiceSupervisor, CheckoutLeaseStore, canonicalCheckout, checkoutState, foldWorkspaceState, gateManifest, resolveManifest } from "../workspace/index.ts";
import { refuseSpec, refuseSteer } from "../harness/index.ts";
import { OperationStore } from "../approvals/index.ts";
import { ApprovalFlow, type AgentActionKind } from "./approval-flow.ts";
import { BudgetGuard } from "./budget-guard.ts";
import { ToolPermissions, type ToolGate } from "./tool-permissions.ts";
import type { ApprovalService } from "../approvals/index.ts";
import { buildSessionSummary } from "../reporting/index.ts";
import { createConsoleLogger } from "../../platform/index.ts";
import { dedupeDiscovered, filterDiscovered, pageDiscovered } from "../discovery/index.ts";
import { resolveSkillChain, withSkillChain } from "../skills/index.ts";
import { notificationFor, projectName, type NotificationDraft } from "../notifications/index.ts";
import { parseNotificationAction, parseNotificationParams } from "../notifications/index.ts";
import { deriveTurnMetrics, TurnMetricStore } from "../runs/index.ts";
import { buildHandoverPrompt, HANDOVER_PROMPT_MAX } from "../handover/index.ts";
import { SessionQueue, type QueuedPrompt } from "./session-queue.ts";
import { askTitleModel } from "./session-title.ts";
import { createTokenTally, type SessionTokenTotals } from "./token-totals.ts";
import type { PlannerModelConfig } from "../commands/model.ts";
import { WRITER_LEASE_MS, type SteerMeta, type LiveSession, TURN_END_SETTLE_MS, sessionTitle, activityOf, readSkillName, skillNameFromEvents, nativeIdFromEvents, nativeIdFromWorkerLog, VALID_TRANSITIONS, DEFAULT_HEARTBEAT_MS, DEFAULT_STEER_WAIT_MS, foldActivities, limitFailureInEvents, limitWindow } from "./session-state.ts";
import { defaultOpencodeDataDir, readOpenCodeMirrorDelta } from "../discovery/index.ts";
import { type SessionRow, persistRecord, rowToRecord } from "./session-row.ts";

export interface SessionManagerObservability {
  autoResumeInterrupted?: boolean;
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

/** BUG-0050: how many sessions are recovered at the same time. */
const RECOVERY_CONCURRENCY = 6;

/** T17.4: the one honest answer once a submission wait ran out — the
 * attempt may still land late; whether it did is for the session's own
 * tail to answer, never a second submission of the same input id
 * (Herdr lesson: a timeout does not prove that no input was sent). */
const STEER_TIMEOUT_DETAIL = "steer timeout — unclear whether the input arrived; read the session before retrying";

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Session lifecycle manager.
 *
 * - Sessions are first-class objects persisted in SQLite + JSONL.
 * - Every state change is emitted as a system event (auditable).
 * - K7 crash recovery: replay JSONL + snapshot + optional adapter.recover().
 * - Adapters only ever see AdapterContext — never hub internals.
 */
/** 2026-10-26: a registration's `config.model` (the same field
 * /api/adapters/:id/models reports as defaultModel). */
function defaultModelOf(registered: { config?: Readonly<Record<string, unknown>> }): string | null {
  const model = registered.config?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}

export class SessionManager {
  private readonly interruption: SessionInterruption;
  private readonly autoResumeInterrupted: boolean;
  private readonly uncertainQueue = new Set<string>();
  private shuttingDown = false;
  /** ADR-0083: Abonnenten transienter Live-Frames (sessionId -> Set). Kein EventStore. */
  private readonly frameSubscribers = new Map<string, Set<(frames: WsStreamFrames) => void>>();
  private readonly recovery: SessionRecovery;
  private readonly activityTracker: SessionActivities;
  private readonly live = new Map<string, LiveSession>();
  private readonly usageByAdapter = new Map<string, AdapterUsageSnapshot>();
  /** ADR-0019: approval-gated prompts and budget top-ups. */
  private readonly flow: ApprovalFlow;
  /** ADR-0019: shared by the approval flow and tool permissions. */
  private readonly operationStore: OperationStore;
  /** T7.2: set by the server (enableToolPermissions). */
  private tools: ToolPermissions | undefined;
  /** T2.7: budget and daily cap. */
  private readonly budget: BudgetGuard;
  /** Tail of the per-session steer chain (see steer()). */
  private readonly steerQueue = new Map<string, Promise<void>>();
  /** T17.4: input ids with a submission still running — its wait may have
   * timed out; until the attempt settles the outcome is unknown, and the
   * same id is never submitted twice. */
  private readonly inFlightInputs = new Map<string, Set<string>>();
  /** T17.4: hard cap for the hub's wait on one adapter submission. */
  private readonly steerWaitMs: number;

  private readonly db: HubDatabase;
  private readonly store: EventStore;
  private readonly registry: AdapterRegistry;
  private readonly runner: WorkerRunner;
  private readonly worktrees: WorktreeManager | undefined;
  /** EPIC-P29 (ADR-0051): Setup/Teardown-Operationen, Hash-Freigaben, Services. */
  private readonly workspaces: WorkspaceRuntime;
  private readonly workspaceServices: ServiceSupervisor;
  private readonly manifestApprovals: ManifestApprovalStore;
  /** ADR-0057: ein AV-Schreiber pro direktem Checkout. */
  private readonly checkoutLeases: CheckoutLeaseStore;
  private readonly approvals: ApprovalService | undefined;
  /** EPIC-P29: die Manifest-Freigabe hängt an der immer vorhandenen Queue —
   * unabhängig von `requireStepApprovals` (das steuert nur steer.prompt). */
  private workspaceApprovals: ApprovalService | undefined;
  private readonly recoveryBudgetMs: number;
  private readonly mirrorDataDir: string;
  private readonly defaultPermissionMode: string | null;
  /** EPIC-P67 Stufe 1: liefert effektive Main-Sync-Einstellungen je Projekt — undefined = altes Verhalten. */
  private readonly mainSyncSettings: ((projectPath: string) => MainSyncSettings) | undefined;
  private readonly queue: SessionQueue;
  private readonly turnMetricStore: TurnMetricStore;
  private titleModel: PlannerModelConfig | undefined;
  private readonly draining = new Set<string>();
  private readonly reportingSinks: ReportingSink[];
  private readonly logger: HubLogger;
  private readonly metrics: HubMetrics | undefined;
  private readonly heartbeatTimer: NodeJS.Timeout;
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

  /** Hide or restore a session in the overview. Does not stop the worker. */
  /** T8.6: rename or pin — the overview's own metadata, no event. */
  setMeta(sessionId: string, meta: { title?: string | null; pinned?: boolean }): SessionRecord {
    const live = this.live.get(sessionId);
    const record = live?.record ?? this.require(sessionId);
    if (meta.title !== undefined) {
      record.title = meta.title?.trim() ? meta.title.trim().slice(0, 80) : null;
      // A person's own title is never replaced; clearing it hands the job back.
      record.titleSource = record.title ? "manual" : "auto";
    }
    if (meta.pinned !== undefined) record.pinned = meta.pinned;
    this.persist(record);
    return record;
  }

  setArchived(sessionId: string, archived: boolean): SessionRecord {
    const live = this.live.get(sessionId);
    const record = live?.record ?? this.require(sessionId);
    record.archived = archived;
    record.updatedAt = new Date().toISOString();
    this.persist(record);
    return record;
  }

  /** ADR-0076 Nachtrag (Limit-Wiederaufnahme): ausdrückliche Nutzer-Option —
   * diese Session nach einem Kontingent-/Rate-Limit-Fenster automatisch
   * fortsetzen. Nur Menschen/Fleet (kein Agent hält sich so selbst am
   * Laufen, ADR-0076: „Kein HTTP-Agent kann … automatisches Resume
   * erzwingen"). Einschalten an einer fehlgeschlagenen Session überführt
   * den Limit-Fehler in die sichtbare Wiederaufnahme-Wartestellung. */
  async setAutoResumeOnLimit(sessionId: string, on: boolean, actor?: string): Promise<SessionRecord> {
    if (actorKind(actor) !== "human" && actorKind(actor) !== "fleet") throw new Error("Nur Menschen dürfen die Limit-Wiederaufnahme schalten.");
    const session = this.live.get(sessionId);
    const record = session?.record ?? this.require(sessionId);
    record.autoResumeOnLimit = on;
    record.updatedAt = new Date().toISOString();
    this.persist(record);
    if (!on || !session || record.status !== "error") return record;
    const events = await this.store.replay(sessionId);
    if (!limitFailureInEvents(events)) return record;
    await this.setStatus(session, "interrupted");
    const blockedUntil = limitWindow(events).blockedUntil;
    await this.emitSystem(session, "session.interrupted", {
      kind: "session.interrupted", reason: "provider_limit", since: new Date().toISOString(),
      lastTurnId: null, autoResumeEligible: true, limit: true, ...(blockedUntil !== undefined ? { resumesAt: blockedUntil } : {}),
    });
    this.recovery.schedule(session);
    return this.live.get(sessionId)?.record ?? record;
  }

  /**
   * EPIC-P14: archive a session and free its worktree when that loses nothing.
   * The flag is persisted first and never depends on the cleanup. The worktree
   * stays (and the session says why) while a turn runs, while a long-lived
   * worker has it as cwd, or when it holds work (BUG-0027: `hasWork`).
   */
  archive(sessionId: string, archived: boolean, actor?: string): Promise<SessionRecord> {
    return this.chainWork(sessionId, () => this.archiveNow(sessionId, archived, actor));
  }

  private async archiveNow(sessionId: string, archived: boolean, actor?: string): Promise<SessionRecord> {
    await this.interruption.settled(sessionId);
    let servicesAlreadyStopped = false;
    if (archived && this.get(sessionId)?.status === "interrupted") {
      this.openStopped(sessionId);
      await this.stop(sessionId, actor);
      servicesAlreadyStopped = true;
    }
    const record = this.setArchived(sessionId, archived);
    if (archived) {
      this.checkoutLeases.release(sessionId); // ADR-0057: das direkte Projekt selbst bleibt unangetastet
      // EPIC-P29 T29.5/T29.7 (ADR-0051 §3): eigene Services beenden — auch
      // adoptierte einer BEENDETEN Session ohne Live-Sitzung (Hard-Kill nach
      // Zugende; ohne diesen Zweig überlebte der Dienst die Archivierung —
      // E2E workspace-runtime deckt den Fall). Dann genehmigter Teardown
      // (idempotent — genau einmal), DANACH die P14-Prüfungen. Teardown-
      // Fehler ⇒ Worktree bleibt mit Grund.
      const live = this.live.get(sessionId);
      const servicesRunning = this.workspaceServices.list(sessionId).some((row) => row.state === "starting" || row.state === "ready" || row.state === "probing");
      if (live && !servicesAlreadyStopped) {
        await this.workspaceServices
          .stopAll(sessionId, (kind, payload) => this.emitSystem(live, kind, payload))
          .catch((err) => this.logger.warn("service stop on archive failed", { sessionId, err: err instanceof Error ? err.message : String(err) }));
      } else if (!live && servicesRunning) {
        // ohne Live-Sitzung: trotzdem beenden — ohne Events, der Zustand
        // steht in den Service-Zeilen (die K7-Projektion liest die DB-Zeilen).
        await this.workspaceServices.stopAll(sessionId, async () => undefined).catch((err) =>
          this.logger.warn("service stop on archive failed", { sessionId, err: err instanceof Error ? err.message : String(err) }),
        );
      }
      const teardown = await this.teardownWorkspaceOnce(sessionId, actor);
      if (teardown === "failed") return record;
      await this.tidyWorktree(sessionId);
      const folded = live?.workspace ?? (live ? foldWorkspaceState(await this.store.replay(sessionId)) : null);
      if (live && folded && this.worktrees && !existsSync(this.worktrees.pathFor(sessionId))) {
        await this.emitSystem(live, "workspace.archived", { manifestHash: folded.manifestHash ?? null });
      }
    }
    return record;
  }

  /**
   * EPIC-P29 T29.5: genehmigte Teardown-Schritte — genau einmal pro Session
   * (Journal-Gedächtnis), nur solange der Worktree existiert. `failed` heißt:
   * workspace.cleanup_failed ist emittiert, der Worktree muss bleiben.
   * `none` = kein Workspace/kein Worktree (Migrationsregel).
   */
  private async teardownWorkspaceOnce(sessionId: string, actor?: string): Promise<"none" | "ok" | "failed"> {
    const live = this.live.get(sessionId) ?? this.openStopped(sessionId);
    const record = live?.record ?? this.get(sessionId);
    if (!live || !record || !this.worktrees || record.worktreeSha === null) return "none";
    if (!existsSync(this.worktrees.pathFor(sessionId))) return "none"; // schon entsorgt — nichts zu tun
    if (live.workspace === undefined) {
      const folded = foldWorkspaceState(await this.store.replay(sessionId));
      if (!folded) return "none";
      live.workspace = { phase: folded.phase, manifestHash: folded.manifestHash ?? "", baseSha: record.worktreeSha, pendingApprovalId: null };
    }
    const prior = this.workspaces.listJournal(sessionId).filter((row) => row.kind === "teardown").at(-1);
    if (prior) return prior.state === "failed" ? "failed" : "ok"; // genau einmal, Ergebnis bleibt
    const resolved = await resolveManifest(record.project, record.worktreeSha);
    if (resolved.status !== "ok" || !(resolved.manifest.teardown ?? []).length) return "ok"; // nichts deklariert
    const result = await this.workspaces.runTeardown({
      sessionId,
      project: record.project,
      manifest: resolved.manifest,
      manifestHash: live.workspace.manifestHash || resolved.manifestHash,
      worktreePath: this.worktrees.pathFor(sessionId),
      actor: actor ?? null,
      emit: (kind, payload) => this.emitSystem(live, kind, payload),
    });
    return result.ok ? "ok" : "failed";
  }

  private async tidyWorktree(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    const record = live?.record ?? this.get(sessionId);
    if (!record || !this.worktrees || record.worktreeSha === null) return;
    if (!existsSync(this.worktrees.pathFor(sessionId))) return;
    const base = { path: this.worktrees.pathFor(sessionId), branch: this.worktrees.branchFor(sessionId) };
    const note = async (kind: string, payload: Record<string, unknown>) => {
      if (live) await this.emitSystem(live, kind, payload);
      else this.logger.info(kind, { sessionId, ...payload });
    };
    const betweenTurns = record.status === "idle" || record.status === "stopped" || record.status === "error" || record.status === "parked";
    if (!betweenTurns) return void (await note("session.worktree_kept", { ...base, reason: "running" }));
    if (live?.persistentWorker) return void (await note("session.worktree_kept", { ...base, reason: "worker" }));
    try {
      if (await this.worktrees.hasWork(sessionId, record.worktreeSha, record.project)) {
        await note("session.worktree_kept", { ...base, reason: "work" });
      } else {
        await this.worktrees.remove(sessionId, record.project);
      }
    } catch (err) {
      await note("session.worktree_cleanup_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * T2.8 (EPIC-P2 §2 "Audit-Trail: jede Handy-Aktion als Event im
   * Session-JSONL (wer-wann-was)"): `actor` is the calling device's own
   * token label (identify()d by the route, never the raw token) —
   * threaded through into the relevant system events below so a
   * session's own tail answers "wer" without cross-referencing the
   * approvals table or server logs. `undefined` (every pre-T2.8 call
   * site, every test) renders as `actor: null` — "no caller identity
   * available", not "system" or a guess.
   */
  async create(spec: unknown, actor?: string, options: { workInProject?: boolean } = {}): Promise<SessionRecord> {
    const requested = SessionSpecSchema.parse(spec);
    if (requested.mirrorNativeSessionId) return this.createMirror(requested, actor);
    const registered = this.registry.require(requested.adapter);
    // ADR-0033: an explicit mode wins; otherwise the hub default, but only where the adapter has that mode.
    const asked = (requested.args as { permissionMode?: unknown } | undefined)?.permissionMode;
    const permissionMode =
      typeof asked === "string" && asked
        ? asked
        : this.defaultPermissionMode && registered.capabilities.features.permissionModes.includes(this.defaultPermissionMode)
          ? this.defaultPermissionMode
          : null;
    const parsed = permissionMode ? { ...requested, args: { ...requested.args, permissionMode } } : requested;
    const refused = refuseSpec(registered.capabilities.features, parsed.adapter, parsed);
    if (refused) throw new Error(refused);
    const adoptsInPlace = parsed.adoptNativeSessionId !== undefined && parsed.adoptFork !== true;
    // ADR-0057: Arbeitsort-Wahl vor Spawn prüfen — nicht unterstützte Kombinationen scheitern hier, nicht mitten im Start.
    const id = randomUUID();
    const place = await this.resolveWorkplace(id, parsed, { workInProject: options.workInProject === true, adoptsInPlace });
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id,
      adapter: parsed.adapter,
      project: parsed.project,
      worktreeSha: null,
      workspaceMode: place.mode,
      workspaceBaseline: place.baseline,
      // 2026-10-26: a session without an explicit model still shows WHICH
      // model runs — the registration's configured default (e.g. pi → the
      // gpubox qwen) fills the record; without any default it stays null and
      // the UI honestly says "Standardmodell" instead of guessing.
      model: parsed.model ?? defaultModelOf(registered) ?? null,
      permissionMode,
      status: "starting",
      createdAt: now,
      budgetUsd: parsed.budgetUsd ?? null,
      adapterVersion: registered.adapter.version,
      lastSeq: 0,
      costUsd: 0,
      updatedAt: now,
      tokensEst: 0,
      metrics: metricsState(emptyMetricCounters()),
      lastActivity: null,
      pinned: false,
      autoResumeOnLimit: false,
      parkReason: null,
      controlMode: "managed",
      harness: "cli",
      hostId: DEFAULT_HOST_ID,
      // Adoption (ADR-0011): a hub-adopted external run keeps its native id —
      // the first prompt resumes it instead of starting a fresh run.
      nativeSessionId: parsed.adoptNativeSessionId ?? null,
      resumeVersion: RESUME_SCHEMA_VERSION,
      logOffset: null,
      parentSessionId: null,
      observedAt: null,
      fork: parsed.adoptNativeSessionId !== undefined && parsed.adoptFork === true,
      inputRevision: 0,
      writerClient: null,
      writerLeaseUntil: null,
      archived: false,
      title: parsed.prompt ? sessionTitle(parsed.prompt) : (parsed.title ?? null),
      titleSource: "auto",
      persistentWorker: false,
    };
    await this.store.initSession(record.id);
    this.persist(record);

    const session: LiveSession = {
      record,
      adapter: registered.adapter,
      handle: null,
      activities: new Map(),
      abort: new AbortController(),
      subscribers: new Set(),
      workdir: record.project,
      worktreeIsolated: false,
      budgetWarned: false,
      ...(parsed.prompt ? { titlePrompt: parsed.prompt } : {}),
    };
    this.live.set(record.id, session);

    // T2.1: attempt real worktree isolation before anything else touches
    // the filesystem. A non-git `project` (dummy-adapter tests, or a
    // genuinely non-git project directory) is a real, honest fallback —
    // not an error — surfaced as its own system event rather than silently
    // running unisolated (AGENTS.md Regel 6).
    // EPIC-P19: ein Loop arbeitet im Projekt des Loop-Systems selbst, eine Hub-Kopie davon wäre die falsche Stelle.
    // ADR-0041: die Übernahme der Originalsession (ohne Kopie) läuft dort weiter, wo sie entstand — omp bricht
    // `session/load` aus einem anderen Verzeichnis ab, und die Session gehört ohnehin diesem Projekt.
    let worktreeCreated: { path: string; baseSha: string; base: WorktreeBaseChoice } | null = null;
    if (this.worktrees && place.mode === "worktree" && !isLoopAdapter(record.adapter)) {
      try {
        const created = await this.worktrees.create(record.id, record.project, {
          mainSync: this.mainSyncSettings?.(record.project),
        });
        if (created) {
          worktreeCreated = created;
          session.workdir = created.path;
          session.worktreeIsolated = true;
          record.worktreeSha = created.baseSha;
          this.persist(record);
          await this.emitMainSyncBaseEvent(session, created.base);
        }
      } catch (err) {
        await this.emitSystem(session, "session.worktree_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!session.worktreeIsolated) {
      // ADR-0057: der tatsächliche Arbeitsort steht im Record — auch beim sichtbaren Fallback (kein Git / Worktree-Fehler).
      record.workspaceMode = "direct";
      this.persist(record);
      await this.emitSystem(session, "session.no_worktree_isolation", {
        reason: place.explicitDirect ? "Projekt direkt gewählt" : options.workInProject ? "factory driver works in its own project" : isLoopAdapter(record.adapter) ? "loop works in its own project" : adoptsInPlace ? "adopted session continues in its own project" : this.worktrees ? "project is not a git repo" : "worktree isolation not configured",
      });
    }

    const skillName = readSkillName(parsed.args);
    let startSpec = parsed;
    if (parsed.adoptNativeSessionId) {
      // Adoption: the first start resumes the adopted native session; the
      // adapter's own args schema (opencode/claude: resumeSessionId) picks
      // it up and turns the prompt into a continuation. BUG-0039: the hub
      // never had this history — importHistory tells the adapter to emit
      // the load replay instead of discarding it (BUG-0036 is recovery's
      // silence, not adoption's).
      startSpec = { ...startSpec, args: { ...startSpec.args, resumeSessionId: parsed.adoptNativeSessionId, importHistory: true, ...(parsed.adoptFork ? { forkSession: true } : {}) } };
    }
    if (skillName) {
      session.skillName = skillName;
      const chain = await resolveSkillChain(parsed.project, skillName);
      if (chain) {
        // ADR-0100: nativeSkills-Adapter expandieren die Kette selbst — der
        // Hub liefert sie in diesem Lauf nie selbst nach.
        const hubInjects = registered.capabilities.nativeSkills !== true;
        startSpec = {
          ...parsed,
          ...(parsed.prompt !== undefined && hubInjects ? { prompt: withSkillChain(parsed.prompt, chain.block) } : {}),
          args: { ...parsed.args, skillChain: chain.names },
        };
        if (parsed.prompt !== undefined && hubInjects) session.skillChainInjected = true;
        await this.emitEvents(session, [
          {
            type: "system",
            summary: `Skills ${chain.names.join(" → ")}`,
            payload: { kind: "session.skill_chain", names: chain.names },
          },
        ]);
      }
    }
    await this.emitSystem(session, "session.created", {
      adapter: record.adapter,
      adapterVersion: record.adapterVersion,
      project: record.project,
      workdir: session.workdir,
      workspaceMode: record.workspaceMode,
      model: record.model,
      budgetUsd: record.budgetUsd,
      // T1.5-10/AC-P1.5-12: whatever skill/agent was requested must stay
      // traceable in the tail — nobody should have to guess afterwards
      // what a session was actually started with. skillChain is names
      // only; the skill bodies ride in the prompt, not this event.
      args: startSpec.args ?? null,
      actor: actor ?? null,
    });
    if (parsed.prompt || parsed.attachments?.length) await this.emitPrompt(session, parsed.prompt ?? "", actor, parsed.attachments);
    if (startSpec.attachments?.length) {
      const converted = this.withAttachments(session, { text: startSpec.prompt ?? "", attachments: startSpec.attachments });
      startSpec = { ...startSpec, prompt: converted.text, ...(converted.attachments ? { attachments: converted.attachments } : { attachments: undefined }) };
    }
    // EPIC-P29 T29.3 (ADR-0051 §3): bei einem Manifest an der Basis-SHA
    // läuft Freigabe + Include + Setup VOR dem Agenten — der Agent startet
    // nie in einem unvorbereiteten Workspace (AC-P29-3). Ohne Manifest
    // bleibt exakt der alte T2.1-Pfad (Migrationsregel, ADR-0051 §7).
    if (worktreeCreated) {
      const ready = await this.gateWorkspace(session, worktreeCreated.baseSha, startSpec, actor);
      if (!ready) return { ...record }; // wartet auf Freigabe oder ist fehlerhaft
    }
    await this.launchAdapter(session, startSpec);
    return { ...record };
  }

  /**
   * ADR-0057 §3: Arbeitsort einer neuen Session festlegen und absichern, bevor
   * irgendetwas gestartet wird. Direkt gewählt (explizit) heißt: kanonischer
   * Checkout, Schreib-Lease, Dirty-Bestätigung, Baseline. Alles andere
   * (Standard, Loop, Factory, Übernahme) behält sein bisheriges Verhalten.
   */
  private async resolveWorkplace(
    sessionId: string,
    spec: SessionSpec,
    ctx: { workInProject: boolean; adoptsInPlace: boolean },
  ): Promise<{ mode: "worktree" | "direct"; baseline: SessionRecord["workspaceBaseline"]; explicitDirect: boolean }> {
    const inPlace = ctx.workInProject || ctx.adoptsInPlace || isLoopAdapter(spec.adapter);
    if (spec.workspaceMode === "worktree" && inPlace) {
      throw new Error("Arbeitsort „Eigener Worktree“ ist für diesen Start nicht möglich: er arbeitet immer im Projekt selbst.");
    }
    if (spec.workspaceMode !== "direct") {
      if (spec.workspaceMode === "worktree") {
        const { isGit } = await canonicalCheckout(spec.project).catch(() => ({ isGit: false }));
        if (!isGit || !this.worktrees) throw new Error("Arbeitsort „Eigener Worktree“ braucht ein Git-Projekt — wähle „Projekt direkt“.");
      }
      return { mode: inPlace ? "direct" : "worktree", baseline: null, explicitDirect: false };
    }
    let checkout: Awaited<ReturnType<typeof canonicalCheckout>>;
    try {
      checkout = await canonicalCheckout(spec.project);
    } catch {
      throw new Error("Projektordner nicht lesbar — „Projekt direkt“ nicht möglich.");
    }
    const state = await checkoutState(checkout.checkoutId);
    if (state.dirty.length > 0 && spec.confirmDirty !== true) {
      const shown = state.dirty.slice(0, 5).join(", ");
      throw new Error(`Das Projekt hat ungesicherte Änderungen (${shown}${state.dirty.length > 5 ? ", …" : ""}). Direkt starten nur nach ausdrücklicher Bestätigung.`);
    }
    const lease = this.checkoutLeases.acquire(checkout.checkoutId, sessionId, (owner) => this.holdsCheckout(owner));
    if (!lease.ok) {
      // ADR-0081: in einem Ordner ohne Git gibt es keine Branch-/Dirty-Metadaten,
      // die ein Allein-Schreiber schützen könnte. Paralleles Schreiben ist dort
      // erlaubt — aber nur nach ausdrücklicher Bestätigung und sichtbar als
      // Mit-Nutzerschaft (checkout_tenants), nie still.
      if (checkout.isGit) {
        throw new Error(`In diesem Projekt schreibt bereits eine andere AncientVoid-Session (${lease.ownerSessionId.slice(0, 8)}). Erst beenden oder einen eigenen Worktree wählen.`);
      }
      if (spec.confirmSharedFolder !== true) {
        throw new Error(`In diesem Ordner schreibt bereits eine andere AncientVoid-Session (${lease.ownerSessionId.slice(0, 8)}). Paralleles Schreiben braucht die ausdrückliche Bestätigung „Mehrere Sessions in diesem Ordner“.`);
      }
      this.checkoutLeases.addTenant(checkout.checkoutId, sessionId);
    }
    return {
      mode: "direct",
      explicitDirect: true,
      baseline: { checkoutId: checkout.checkoutId, head: state.head, branch: state.branch, dirty: state.dirty, dirtyTruncated: state.dirtyTruncated },
    };
  }

  /** ADR-0057: darf diese Session ihren direkten Checkout noch beschreiben? (Recovery vor Freigabe) */
  private holdsCheckout(sessionId: string): boolean {
    const record = this.get(sessionId);
    return record !== undefined && !record.archived && record.status !== "stopped" && record.status !== "error" && record.status !== "interrupted";
  }

  /**
   * ADR-0057: eine direkte Session erwirbt ihre Lease neu, wenn sie weiterläuft
   * (Resume/„Weiter“). Konflikt → sichtbarer Fehler, kein stiller Fork oder Wechsel.
   */
  private claimDirectCheckout(session: LiveSession): string | null {
    const baseline = session.record.workspaceBaseline;
    if (session.record.workspaceMode !== "direct" || !baseline) return null;
    // ADR-0081: Mit-Nutzer eines Nicht-Git-Ordners holen sich keine exklusive Lease,
    // sondern ihre Mit-Nutzerschaft zurück (Tabelle überlebt Restart, K7).
    if (this.checkoutLeases.isTenant(baseline.checkoutId, session.record.id)) {
      this.checkoutLeases.addTenant(baseline.checkoutId, session.record.id);
      return null;
    }
    const lease = this.checkoutLeases.acquire(baseline.checkoutId, session.record.id, (owner) => owner !== session.record.id && this.holdsCheckout(owner));
    if (lease.ok) return null;
    return this.holdsCheckout(lease.ownerSessionId)
      ? `In diesem Projekt schreibt bereits eine andere AncientVoid-Session (${lease.ownerSessionId.slice(0, 8)}).`
      : null;
  }

  /** ADR-0057 / „Neue Session“: was würde „Projekt direkt“ hier bedeuten? Read-only, startet nichts. */
  async workplacePreview(project: string): Promise<{
    checkoutId: string;
    isGit: boolean;
    worktreePossible: boolean;
    branch: string | null;
    head: string | null;
    dirty: string[];
    dirtyTruncated: boolean;
    heldBy: string | null;
    /** ADR-0081: alle Sessions, die hier schon schreiben (Primär-Lease + Mit-Nutzer). */
    holders: string[];
  }> {
    // BUG-0171: der Zielordner darf erst beim Start entstehen. Die Vorschau ist
    // read-only und startet nichts — also sagt sie ehrlich, was passieren würde,
    // statt einen ENOENT als „Projekt nicht lesbar" durchzureichen.
    if (!existsSync(project)) {
      throw new Error(`Ordner existiert noch nicht: ${project} — er wird beim Start angelegt, sofern sein Elternordner existiert.`);
    }
    const checkout = await canonicalCheckout(project);
    const state = await checkoutState(checkout.checkoutId);
    const lease = this.checkoutLeases.get(checkout.checkoutId);
    return {
      checkoutId: checkout.checkoutId,
      isGit: checkout.isGit,
      worktreePossible: checkout.isGit && this.worktrees !== undefined,
      branch: state.branch,
      head: state.head,
      dirty: state.dirty,
      dirtyTruncated: state.dirtyTruncated,
      heldBy: lease && this.holdsCheckout(lease.sessionId) ? lease.sessionId : null,
      holders: this.checkoutLeases.holders(checkout.checkoutId, undefined, (id) => this.holdsCheckout(id)),
    };
  }

  /** ADR-0057: aktueller Checkout gegen die Start-Baseline (Drift von HEAD/Branch, neu hinzugekommene Änderungen). */
  async workplaceStatus(sessionId: string): Promise<{
    mode: SessionRecord["workspaceMode"];
    baseline: SessionRecord["workspaceBaseline"];
    path: string;
    drift: { headMoved: boolean; branchChanged: boolean; head: string | null; branch: string | null } | null;
    leaseGeneration: number | null;
  } | undefined> {
    const record = this.get(sessionId);
    if (!record) return undefined;
    const base = record.workspaceBaseline;
    const lease = base ? this.checkoutLeases.get(base.checkoutId) : null;
    let drift = null;
    if (base) {
      const now = await checkoutState(base.checkoutId);
      drift = { headMoved: now.head !== base.head, branchChanged: now.branch !== base.branch, head: now.head, branch: now.branch };
    }
    return {
      mode: record.workspaceMode,
      baseline: base,
      path: this.workdirOf(sessionId) ?? record.project,
      drift,
      leaseGeneration: lease && lease.sessionId === sessionId ? lease.generation : null,
    };
  }

  /** EPIC-P29: der Adapter-Start, aus create() extrahiert — auch die
   * Freigabe-Fortsetzung (resolveWorkspaceSetup) startet hier. */
  private async launchAdapter(session: LiveSession, startSpec: SessionSpec): Promise<void> {
    try {
      session.handle = await session.adapter.start(startSpec, this.makeContext(session));
      // BUG-0039/ADR-0098: a start without a turn opens idle — "working"
      // would lie (the PWA shows the loading state for a working session
      // with no events) and nothing could ever settle it back down.
      const startIdle = !startSpec.prompt?.trim() && !startSpec.attachments?.length &&
        (startSpec.adoptNativeSessionId !== undefined || this.registry.get(session.record.adapter)?.capabilities.promptlessStartIdle === true);
      await this.setStatus(session, startIdle ? "idle" : "working");
      await this.emitSystem(session, "session.started", {
        pid: session.handle.pid ?? null,
        capabilities: this.registry.get(session.record.adapter)?.capabilities,
      });
      this.metrics?.inc("sessions_started");
      this.logger.info("session started", {
        sessionId: session.record.id,
        adapter: session.record.adapter,
      });
    } catch (err) {
      await this.setStatus(session, "error");
      await this.emitSystem(session, "session.start_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * EPIC-P29 T29.3: Manifest auflösen, Freigabe prüfen, Setup ausführen.
   * `false` heißt: die Session wartet auf einen Menschen oder ist im
   * Fehlerzustand — der Agent startet nicht. `startSpec` wird nur für den
   * Freigabe-Fall persistiert (Operation), damit die Entscheidung nach
   * einem Hub-Crash den Originalstart sauber fortsetzen kann (ADR-0019).
   */
  private async gateWorkspace(
    session: LiveSession,
    baseSha: string,
    startSpec: SessionSpec,
    actor?: string,
  ): Promise<boolean> {
    const resolved = await resolveManifest(session.record.project, baseSha);
    if (resolved.status === "none") return true; // Migrationsregel: kein Manifest, kein Workspace
    if (resolved.status === "invalid") {
      await this.failWorkspace(session, resolved.manifestHash, baseSha, { step: "manifest", kind: "unknown", detail: resolved.reason, logBlobRef: null });
      return false;
    }
    const gate = gateManifest(resolved, session.record.project, baseSha, this.manifestApprovals);
    if (gate.ok) return await this.runWorkspaceSetup(session, gate.manifest, gate.manifestHash, baseSha, actor ?? null, "setup");
    if (gate.kind !== "approval_required") {
      // bei gültigem Resolver-Ergebnis unerreichbar — trotzdem laut, nie still
      await this.failWorkspace(session, resolved.manifestHash, baseSha, { step: "manifest", kind: "unknown", detail: gate.reason, logBlobRef: null });
      return false;
    }
    const approvalQueue = this.workspaceApprovals ?? this.approvals;
    if (!approvalQueue) {
      await this.failWorkspace(session, resolved.manifestHash, baseSha, { step: "approval", kind: "unknown", detail: "Workspace-Manifest braucht eine menschliche Freigabe — es ist keine Freigabe-Warteschlange konfiguriert.", logBlobRef: null });
      return false;
    }
    const { manifest } = gate.approval;
    const summary = `Workspace-Manifest ${gate.approval.manifestHash.slice(0, 12)}… für ${win32.basename(session.record.project)}: ${manifest.setup?.length ?? 0} Setup-Schritte, ${manifest.include?.length ?? 0} Dateien, ${manifest.services?.length ?? 0} Services`;
    const request = approvalQueue.create(session.record.id, "write", "workspace.setup", summary, false, 24 * 60 * 60 * 1000);
    this.operationStore.create(request.id, session.record.id, "workspace.setup", { approval: gate.approval, startSpec }, session.record.inputRevision, actor ?? null);
    session.workspace = { phase: "approval_required", manifestHash: gate.approval.manifestHash, baseSha, pendingApprovalId: request.id };
    await this.setStatus(session, "waiting_approval");
    await this.emitSystem(session, "workspace.approval_required", {
      approvalId: request.id,
      manifestHash: gate.approval.manifestHash,
      project: session.record.project,
      baseSha,
    });
    return false;
  }

  /** Include-Kopie + Setup-Schritte + Services; `false` = Fehler (Event + error-Status). */
  private async runWorkspaceSetup(
    session: LiveSession,
    manifest: WorkspaceManifest,
    manifestHash: string,
    baseSha: string,
    actor: string | null,
    kind: "setup" | "retry",
  ): Promise<boolean> {
    session.workspace = { phase: "preparing", manifestHash, baseSha, pendingApprovalId: null };
    const result = await this.workspaces.runSetup(
      {
        sessionId: session.record.id,
        project: session.record.project,
        manifest,
        manifestHash,
        worktreePath: session.workdir,
        actor,
        emit: (eventKind, payload) => this.emitSystem(session, eventKind, payload),
      },
      kind,
    );
    if (result.ok) {
      session.workspace.phase = "ready";
      return true;
    }
    session.workspace.phase = "failed";
    await this.setStatus(session, "error"); // workspace.failed hat die Runtime bereits emittiert
    return false;
  }

  /** Fail-loud-Hilfe: Phase failed, Status error, ein Event mit Ursache. */
  private async failWorkspace(
    session: LiveSession,
    manifestHash: string | null,
    baseSha: string,
    failure: { step: string; kind: string; exitCode?: number; detail?: string; logBlobRef: string | null },
  ): Promise<void> {
    session.workspace = { phase: "failed", manifestHash: manifestHash ?? "", baseSha, pendingApprovalId: null };
    await this.setStatus(session, "error");
    await this.emitSystem(session, "workspace.failed", { failure, operationId: null, manifestHash });
  }

  /**
   * EPIC-P29: was eine freigegebene workspace.setup-Operation freisetzt —
   * aufgerufen aus ApprovalFlow.applyApproved (Mensch hat entschieden,
   * ADR-0019: läuft höchstens einmal). Zeichnet die Zustimmung auf, setzt
   * das Setup fort und startet den Agenten mit dem Original-StartSpec.
   */
  async resolveWorkspaceSetup(op: PendingOperation, decidedByLabel?: string): Promise<Ack> {
    const session = this.live.get(op.sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    const { approval, startSpec } = op.payload as { approval: WorkspaceSetupApproval; startSpec: SessionSpec };
    this.manifestApprovals.approve({
      project: approval.project,
      manifestHash: approval.manifestHash,
      baseSha: approval.baseSha,
      approvedBy: decidedByLabel ?? "mensch",
    });
    const ok = await this.runWorkspaceSetup(session, approval.manifest, approval.manifestHash, approval.baseSha, decidedByLabel ?? null, "setup");
    if (!ok) return { ok: false, detail: "Workspace-Setup fehlgeschlagen — Schritt/Ursache steht im workspace.failed-Event" };
    session.workspace = { phase: "ready", manifestHash: approval.manifestHash, baseSha: approval.baseSha, pendingApprovalId: null };
    await this.launchAdapter(session, startSpec);
    return { ok: true, detail: "Workspace bereit, Agent gestartet" };
  }

  /**
   * EPIC-P29: menschlicher Retry nach `failed`/`needs_attention` — nie
   * automatisch (ADR-0051 §3). Nach Erfolg ist die Session über einen
   * Prompt wieder steuerbar (stopped, nicht working).
   */
  async retryWorkspaceSetup(sessionId: string, actor?: string): Promise<Ack> {
    const session = this.openStopped(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    if (!session.workspace) {
      const folded = foldWorkspaceState(await this.store.replay(sessionId));
      if (!folded) return { ok: false, detail: "kein Workspace für diese Session" };
      session.workspace = { phase: folded.phase, manifestHash: folded.manifestHash ?? "", baseSha: session.record.worktreeSha ?? "", pendingApprovalId: null };
    }
    const phase = session.workspace.phase;
    if (phase !== "failed" && phase !== "needs_attention") {
      return { ok: false, detail: `Retry nur nach Fehler oder unklarem Zustand (Phase: ${phase})` };
    }
    const baseSha = session.record.worktreeSha ?? session.workspace.baseSha;
    const resolved = await resolveManifest(session.record.project, baseSha);
    if (resolved.status === "none") return { ok: false, detail: "am Basis-SHA existiert kein Manifest mehr" };
    if (resolved.status === "invalid") return { ok: false, detail: `Manifest ungültig: ${resolved.reason}` };
    const gate = gateManifest(resolved, session.record.project, baseSha, this.manifestApprovals);
    if (!gate.ok) {
      return { ok: false, detail: gate.kind === "invalid" ? gate.reason : "der Manifest-Hash braucht erst eine neue Freigabe (neuer Sessionstart)" };
    }
    const ok = await this.runWorkspaceSetup(session, gate.manifest, gate.manifestHash, baseSha, actor ?? null, "retry");
    if (!ok) return { ok: false, detail: "Setup erneut fehlgeschlagen — Ursache im workspace.failed-Event" };
    if (session.record.status === "error") await this.setStatus(session, "stopped"); // steuerbar für den nächsten Prompt
    return { ok: true, detail: "Workspace bereit — Session ist per Prompt wieder steuerbar" };
  }

  /** EPIC-P29: Agenten-Launches sind gesperrt, solange der Workspace nicht bereit ist. */
  private workspaceBlocked(session: LiveSession): string | null {
    if (!session.workspace || session.workspace.phase === "ready") return null;
    return `Workspace ist nicht bereit (${session.workspace.phase}) — erst Freigabe/Retry (EPIC-P29)`;
  }

  // ---------------------------------------------------------------------
  // EPIC-P67 / ADR-0088 T67.4: Main-Sync — Messung, Probelauf, Anwenden.
  // Gating: ein Merge läuft NIE in eine arbeitende Session (AC-P67-6).
  // ---------------------------------------------------------------------

  private mainSyncTargets(sessionId: string): { session: LiveSession } | { error: string } {
    const session = this.live.get(sessionId);
    if (!session) return { error: "Session nicht gefunden oder nicht live" };
    if (!session.worktreeIsolated || session.record.workspaceMode !== "worktree") {
      return { error: "Session arbeitet ohne Worktree-Isolation — Main-Sync greift nicht (session.no_worktree_isolation im Verlauf)" };
    }
    return { session };
  }

  /** Gating (AC-P67-6): angewendet wird nur auf wartende Sessions — kein offener Zug, kein offener Prozess, keine offene Aktivität. */
  private mainSyncSessionWaiting(session: LiveSession): boolean {
    const openWork = (session.activeWorkers ?? 0) > 0 || Boolean(session.persistentWorker) || session.activities.size > 0;
    return !openWork && (session.record.status === "idle" || session.record.status === "parked" || session.record.status === "interrupted");
  }

  /** EPIC-P67 T67.5: Live-Sessions mit Worktree-Isolation als Sync-Kandidaten — der Scheduler fragt das je Takt ab. */
  mainSyncCandidates(): MainSyncCandidate[] {
    const out: MainSyncCandidate[] = [];
    for (const session of this.live.values()) {
      if (!session.worktreeIsolated || session.record.workspaceMode !== "worktree") continue;
      out.push({
        sessionId: session.record.id,
        projectPath: session.record.project,
        workdir: session.workdir,
        waiting: this.mainSyncSessionWaiting(session),
      });
    }
    return out;
  }

  private async mainSyncSettingsFor(project: string): Promise<MainSyncSettings> {
    return this.mainSyncSettings?.(project) ?? MAIN_SYNC_DEFAULTS;
  }

  /** Zeitstempel des letzten erfolgreichen Abgleichs — aus Events gefaltet (K7), null = noch nie. */
  private async lastMainSyncAt(sessionId: string): Promise<string | null> {
    const events = await this.store.replay(sessionId);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const payload = events[i]!.payload as { kind?: string };
      if (payload.kind === "workspace.main_sync_applied") return events[i]!.ts;
    }
    return null;
  }

  /**
   * Messung + Probelauf (GET-Sicht): fetcht den Hauptbranch (hart begrenzt),
   * zählt behind/ahead und probiert den Merge lesend (`merge-tree`). Das
   * Ergebnis wird als `main_sync_checked` gejournalt; ein Fetch-Fehler als
   * `main_sync_failed` — und dann geworfen, damit die Route ehrlich 502 sagt
   * statt einen Zustand zu erfinden.
   */
  async mainSyncCheck(sessionId: string): Promise<MainSyncCheckResult> {
    const targets = this.mainSyncTargets(sessionId);
    if ("error" in targets) throw new Error(targets.error);
    const { session } = targets;
    const settings = await this.mainSyncSettingsFor(session.record.project);
    const branch = await resolveMainBranch(session.record.project, settings);
    const engine = new MainSyncEngine();
    try {
      await fetchMainBranch(session.record.project, branch, settings.fetchTimeoutSec);
    } catch (err) {
      const failure = classifyFetchError(err);
      await this.emitSystem(session, "workspace.main_sync_failed", { reason: failure.reason, ...(failure.detail ? { detail: failure.detail } : {}) });
      throw new Error(`Fetch von origin/${branch} gescheitert (${failure.reason})`, { cause: err });
    }
    const measure = await engine.measure(session.workdir, branch);
    const dry = await engine.dryRun(session.workdir, branch);
    await this.emitSystem(session, "workspace.main_sync_checked", {
      behind: measure.behind,
      ahead: measure.ahead,
      clean: measure.clean,
      checkedAt: measure.checkedAt,
    });
    return {
      sessionId,
      branch,
      behind: measure.behind,
      ahead: measure.ahead,
      clean: measure.clean,
      conflicts: dry.clean ? null : dry.conflicts,
      checkedAt: measure.checkedAt,
      lastSyncedAt: await this.lastMainSyncAt(sessionId),
    };
  }

  /**
   * Anwenden (POST-Sicht): merge `origin/<Hauptbranch>` in den Session-Branch —
   * nur auf wartender Session mit sauberem Worktree, bei Konflikt/Fehler sofort
   * abgebrochen (Worktree unverändert, AC-P67-7). Ergebnis als Event im
   * Verlauf; der nächste Zug sieht den neuen Stand (kein Prompt-Eingriff).
   */
  async mainSyncApply(sessionId: string, opts: { skipFetch?: boolean } = {}): Promise<MainSyncApplyResult> {
    const targets = this.mainSyncTargets(sessionId);
    if ("error" in targets) throw new Error(targets.error);
    const { session } = targets;
    if (!this.mainSyncSessionWaiting(session)) {
      const skipped = { outcome: "skipped" as const, reason: "session-busy", detail: `Session ist ${session.record.status} — Merge nur auf wartender Session (AC-P67-6)` };
      await this.emitSystem(session, "workspace.main_sync_skipped", { reason: skipped.reason, detail: skipped.detail });
      return skipped;
    }
    const settings = await this.mainSyncSettingsFor(session.record.project);
    const branch = await resolveMainBranch(session.record.project, settings);
    const engine = new MainSyncEngine();
    if (!opts.skipFetch) {
      try {
        await fetchMainBranch(session.record.project, branch, settings.fetchTimeoutSec);
      } catch (err) {
        const failure = classifyFetchError(err);
        const failed = { outcome: "failed" as const, reason: failure.reason, ...(failure.detail ? { detail: failure.detail } : {}) };
        await this.emitSystem(session, "workspace.main_sync_failed", { reason: failed.reason, ...(failed.detail ? { detail: failed.detail } : {}) });
        return failed;
      }
    }
    let result: MainSyncApplyResult;
    try {
      result = (await engine.apply(session.workdir, branch)) as MainSyncApplyResult;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      result = { outcome: "failed", reason: "unknown", detail: detail.slice(0, 500) };
    }
    if (result.outcome === "applied") {
      await this.emitSystem(session, "workspace.main_sync_applied", { from: result.from, to: result.to, files: result.files });
    } else if (result.outcome === "conflict") {
      await this.emitSystem(session, "workspace.main_sync_conflict", { files: result.files });
    } else {
      await this.emitSystem(session, "workspace.main_sync_skipped", { reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) });
    }
    return result;
  }

  /**
   * EPIC-P29 T29.4: Workspace-Status einer Session — Faltung aus den Events
   * (K7) plus Service-Zeilen; `null` ohne Manifest (Migrationsregel). Die
   * Route/Anzeige (T29.6) serviert genau das.
   */
  async workspaceStatus(sessionId: string): Promise<WorkspaceStatus | null> {
    const folded = foldWorkspaceState(await this.store.replay(sessionId));
    if (!folded) return null;
    const session = this.live.get(sessionId);
    const record = this.get(sessionId);
    const services = this.workspaceServices.list(sessionId);
    return {
      sessionId,
      phase: (session?.workspace?.phase ?? folded.phase) as WorkspaceStatus["phase"],
      baseSha: record?.worktreeSha ?? session?.workspace?.baseSha ?? "",
      manifestHash: folded.manifestHash ?? session?.workspace?.manifestHash ?? "",
      services: services.map((row) => ({
        id: row.service_id,
        state: row.state as WorkspaceServiceStatus["state"],
        port: row.port,
        pid: row.pid,
        ...(folded.serviceFailures[row.service_id] ? { failure: folded.serviceFailures[row.service_id] } : {}),
        updatedAt: row.updated_at,
      })),
      ...(folded.failure ? { failure: folded.failure } : {}),
      operationId: this.workspaces.listJournal(sessionId).at(-1)?.id ?? null,
      updatedAt: services.at(-1)?.updated_at ?? "",
    };
  }

  /**
   * EPIC-P29 T29.6: ein registrierter Service (Proxy-Ziel) oder null.
   */
  workspaceService(sessionId: string, serviceId: string): { serviceId: string; state: string; port: number | null; pid: number | null } | null {
    return this.workspaceServices.service(sessionId, serviceId);
  }

  /**
   * EPIC-P29 T29.6: gekappter Log-Schwanz eines Service (K5) — null ohne Zeile.
   */
  async workspaceServiceLogs(sessionId: string, serviceId: string): Promise<{ serviceId: string; tail: string; truncated: boolean; updatedAt: string } | null> {
    return this.workspaceServices.logs(sessionId, serviceId);
  }

  /**
   * Read-only mirror (ADR-0011 Erweiterung): a read-only chat view of an
   * externally observed opencode session. No adapter runs — history and
   * updates come from opencode's own store (same source as the discovery
   * scan). `refreshMirror()` pulls the delta; the observed control mode
   * keeps every steer out.
   */
  private async createMirror(parsed: { adapter: string; project: string; mirrorNativeSessionId?: string | undefined }, actor?: string): Promise<SessionRecord> {
    const nativeId = parsed.mirrorNativeSessionId;
    if (!nativeId) throw new Error("Spiegel ohne native Session-ID");
    const first = readOpenCodeMirrorDelta(this.mirrorDataDir, nativeId, 0);
    if (!first) {
      throw new Error(`Spiegel nicht möglich: keine lesbare opencode-Session „${nativeId}" in ${this.mirrorDataDir}`);
    }
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      adapter: parsed.adapter,
      project: first.info.project ?? parsed.project,
      worktreeSha: null,
      workspaceMode: "unknown",
      workspaceBaseline: null,
      model: null,
      permissionMode: null,
      status: "idle",
      createdAt: now,
      budgetUsd: null,
      adapterVersion: "0.0.0-mirror",
      lastSeq: 0,
      costUsd: 0,
      updatedAt: now,
      tokensEst: 0,
      metrics: metricsState(emptyMetricCounters()),
      lastActivity: null,
      pinned: false,
      autoResumeOnLimit: false,
      parkReason: null,
      controlMode: "mirror",
      harness: "cli",
      hostId: DEFAULT_HOST_ID,
      nativeSessionId: nativeId,
      resumeVersion: RESUME_SCHEMA_VERSION,
      logOffset: null,
      parentSessionId: null,
      observedAt: now,
      fork: false,
      inputRevision: 0,
      writerClient: null,
      writerLeaseUntil: null,
      archived: false,
      title: first.info.title ?? sessionTitle(nativeId),
      titleSource: "auto",
      persistentWorker: false,
    };
    await this.store.initSession(record.id);
    this.persist(record);
    const session: LiveSession = {
      record,
      adapter: null as unknown as Adapter,
      handle: null,
      activities: new Map(),
      abort: new AbortController(),
      subscribers: new Set(),
      workdir: record.project,
      worktreeIsolated: false,
      budgetWarned: false,
    };
    this.live.set(record.id, session);
    await this.emitEvents(session, first.events);
    await this.emitSystem(session, "session.mirror", {
      nativeSessionId: nativeId,
      events: first.events.length,
      actor: actor ?? null,
      read_only: true,
    });
    await this.emitEvents(session, [{ type: "system", summary: "Spiegel steht", payload: { kind: "opencode.mirror_delta", watermark: first.watermark } }]);
    this.logger.info("session mirrored", { sessionId: record.id, nativeSessionId: nativeId });
    return { ...record };
  }

  /** Delta pull for a mirror session: everything opencode wrote since the
   * last watermark becomes chat events (pushed to subscribers live). */
  async refreshMirror(sessionId: string): Promise<void> {
    const record = this.get(sessionId);
    if (!record || record.controlMode !== "mirror" || !record.nativeSessionId) return;
    let session = this.live.get(sessionId);
    if (!session) {
      // after a hub restart the mirror comes back lazily, like stopped runs
      session = {
        record,
        adapter: null as unknown as Adapter,
        handle: null,
        activities: new Map(),
        abort: new AbortController(),
        subscribers: new Set(),
        workdir: record.project,
        worktreeIsolated: false,
        budgetWarned: false,
      };
      this.live.set(sessionId, session);
    }
    const tail = await this.store.replay(sessionId);
    const marker = [...tail].reverse().find((e) => (e.payload as { kind?: string }).kind === "opencode.mirror_delta");
    const since = typeof (marker?.payload as { watermark?: unknown })?.watermark === "number" ? (marker!.payload as { watermark: number }).watermark : 0;
    const delta = readOpenCodeMirrorDelta(this.mirrorDataDir, record.nativeSessionId, since);
    if (!delta) {
      await this.emitSystem(session, "session.mirror_lost", { reason: "opencode-Store nicht mehr lesbar" });
      return;
    }
    if (delta.events.length > 0) await this.emitEvents(session, delta.events);
    await this.emitEvents(session, [{ type: "system", summary: "Spiegel aktualisiert", payload: { kind: "opencode.mirror_delta", watermark: delta.watermark } }]);
    const last = tail.at(-1) ?? null;
    record.updatedAt = new Date().toISOString();
    record.lastActivity = last !== null ? activityOf(last) : null;
    this.persist(record);
  }

  /** BUG-0018: a stopped session enters `live` only once someone opens it
   * (tail subscription or steer), never at recovery. The shell is cheap:
   * skill and provider id are read from the log only when the run
   * actually continues (continueStopped). */
  private openStopped(sessionId: string): LiveSession | undefined {
    const existing = this.live.get(sessionId);
    if (existing) return existing;
    const record = this.get(sessionId);
    // "error" too: a dead run (hub restart, crashed worker) must stay
    // continuable — the user's way back into a session is a new prompt.
    if (!record || (record.status !== "stopped" && record.status !== "error" && record.status !== "interrupted")) return undefined;
    const registered = this.registry.get(record.adapter);
    if (!registered) return undefined;
    const isolated =
      record.worktreeSha !== null && this.worktrees !== undefined && existsSync(this.worktrees.pathFor(record.id));
    const workdir = isolated && this.worktrees ? this.worktrees.pathFor(record.id) : record.project;
    const session: LiveSession = {
      record,
      adapter: registered.adapter,
      handle: null,
      activities: new Map(),
      abort: new AbortController(),
      subscribers: new Set(),
      workdir,
      worktreeIsolated: isolated,
      budgetWarned: record.budgetUsd !== null && record.costUsd >= record.budgetUsd * 0.8,
    };
    this.live.set(sessionId, session);
    return session;
  }

  private async promptWithSkill(session: LiveSession, text: string, opts: { resumed?: boolean } = {}): Promise<string> {
    if (!session.skillName) return text;
    // ADR-0100 (EPIC-P72): nativeSkills-Adapter expandieren selbst — nie
    // injizieren. Bei fortbestehendem Kontext wird der Block nur einmal
    // geliefert; ein Neustart ohne Resume (resumed === false) ist neu.
    const caps = this.registry.get(session.record.adapter)?.capabilities;
    if (caps?.nativeSkills === true) return text;
    if (caps?.nativeResume !== "none" && session.skillChainInjected && opts.resumed !== false) return text;
    const chain = await resolveSkillChain(session.record.project, session.skillName);
    if (!chain) {
      await this.emitSystem(session, "session.skill_chain_missing", { skill: session.skillName });
      return text;
    }
    return withSkillChain(text, chain.block);
  }

  /** The worktree of an isolated session can be gone (EPIC-P14: archiving
   * frees clean ones). Its path is fixed per session, so bringing it back
   * keeps `ctx.workdir` valid; the base moves to the project's current HEAD,
   * which loses nothing because only clean worktrees are ever removed.
   * EPIC-P29: returns whether the worktree was (re-)created — a fresh
   * worktree lacks the workspace's declared files and steps. */
  private async ensureWorkdir(session: LiveSession): Promise<boolean> {
    // ADR-0057: ein direkter Arbeitsort wird nie angelegt, ersetzt oder durch einen Worktree ausgetauscht.
    if (session.record.workspaceMode === "direct") return false;
    if (!this.worktrees || existsSync(session.workdir)) return false;
    let recreated = false;
    try {
      const created = await this.worktrees.create(session.record.id, session.record.project, {
        mainSync: this.mainSyncSettings?.(session.record.project),
      });
      if (created) {
        session.workdir = created.path;
        session.worktreeIsolated = true;
        session.record.worktreeSha = created.baseSha;
        recreated = true;
        await this.emitMainSyncBaseEvent(session, created.base);
      } else {
        session.workdir = session.record.project;
        session.worktreeIsolated = false;
      }
    } catch (err) {
      session.workdir = session.record.project;
      session.worktreeIsolated = false;
      await this.emitSystem(session, "session.worktree_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return recreated;
  }

  /**
   * EPIC-P29: Setup nach Worktree-Neuanlage — nur mit bereits genehmigtem
   * Hash am aktuellen Basis-SHA. Ein geändertes Manifest braucht einen neuen
   * Start (neue Zustimmung), nie einen Strohmann-Retry. Läuft nie im
   * Projektordner des Nutzers (dann gilt der Workspace als nicht
   * reproduzierbar).
   */
  private async reprepareWorkspace(session: LiveSession, actor?: string): Promise<Ack> {
    if (!session.worktreeIsolated) return { ok: false, detail: "Worktree nicht mehr vorhanden — Workspace nicht reproduzierbar" };
    const baseSha = session.record.worktreeSha ?? session.workspace?.baseSha ?? null;
    const resolved = await resolveManifest(session.record.project, baseSha);
    if (resolved.status === "none") return { ok: true }; // kein Manifest mehr: alter Pfad
    if (resolved.status === "invalid") return { ok: false, detail: `Manifest ungültig: ${resolved.reason}` };
    const gate = gateManifest(resolved, session.record.project, baseSha, this.manifestApprovals);
    if (!gate.ok) {
      return { ok: false, detail: gate.kind === "invalid" ? gate.reason : "geändertes Manifest braucht eine neue Freigabe — bitte neuen Start" };
    }
    const ok = await this.runWorkspaceSetup(session, gate.manifest, gate.manifestHash, baseSha ?? "", actor ?? null, "retry");
    return ok ? { ok: true, detail: "Workspace erneut vorbereitet" } : { ok: false, detail: "Setup nach Worktree-Neuanlage fehlgeschlagen" };
  }

  /** A stopped run keeps its provider session id. A new prompt spawns the CLI again. */
  private async continueStopped(
    session: LiveSession,
    input: Extract<SteerInput, { kind: "prompt" }>,
    actor?: string,
  ): Promise<Ack> {
    session.abort.abort();
    session.abort = new AbortController();
    session.activeWorkers = 0;
    session.persistentWorker = false;
    const continuationSignal = session.abort.signal;
    session.turnFailed = false;
    session.mainTurnIdle = false;
    if (session.activities.size) {
      // Ein toter Provider kann keine offenen Provider-Aktivitäten mehr
      // beenden — die ends stehen im Journal, damit die K7-Faltung (ADR-0074)
      // sie nach einem Neustart nicht wieder als offen falten kann.
      for (const [id, work] of [...session.activities]) {
        if (work.source === "external") continue;
        session.activities.delete(id);
        await this.emitSystem(session, "session.activity_end", { id, code: 1 });
      }
      await this.emitSystem(session, "session.activities_reset", {});
    }
    const events = await this.store.replay(session.record.id);
    // EPIC-P29: der Workspace-Zustand einer wiedergeöffneten Session kommt
    // aus den Events (K7-Faltung) — nie aus Erinnerung.
    if (session.workspace === undefined) {
      const folded = foldWorkspaceState(events);
      if (folded) {
        session.workspace = { phase: folded.phase, manifestHash: folded.manifestHash ?? "", baseSha: session.record.worktreeSha ?? "", pendingApprovalId: null };
      }
    }
    const wsBlocked = this.workspaceBlocked(session);
    if (wsBlocked) return { ok: false, detail: wsBlocked };
    if (!session.skillName || !session.record.nativeSessionId) {
      if (!session.skillName) {
        const skill = skillNameFromEvents(events);
        if (skill) session.skillName = skill;
      }
      if (!session.record.nativeSessionId) {
        const native = nativeIdFromEvents(events) ?? (await nativeIdFromWorkerLog(this.store.directory(), session.record.id));
        if (native) session.record.nativeSessionId = native;
      }
    }
    const occupied = this.claimDirectCheckout(session);
    if (occupied) return { ok: false, detail: occupied };
    const recreated = await this.ensureWorkdir(session);
    // EPIC-P29: ein frisch wiederangelegter Worktree hat die deklarierten
    // Dateien/Schritte nicht — Setup (gleicher, bereits genehmigter Hash)
    // läuft erneut, bevor der Agent etwas sieht.
    if (recreated && session.workspace) {
      const reprepared = await this.reprepareWorkspace(session, actor);
      if (!reprepared.ok) return reprepared;
    }
    const converted = this.withAttachments(session, { text: await this.promptWithSkill(session, input.text, { resumed: Boolean(session.record.nativeSessionId) }), attachments: input.attachments });
    const text = converted.text;
    await this.setStatus(session, "working");
    const native = session.record.nativeSessionId;
    if (!native) {
      await this.emitSystem(session, "session.resume_without_native_id", {
        detail: "Provider-Session unbekannt, der Prompt startet einen neuen Lauf",
      });
    }
    try {
      const handle = await session.adapter.start(
        {
          adapter: session.record.adapter,
          project: session.record.project,
          prompt: text,
          ...(converted.attachments ? { attachments: converted.attachments } : {}),
          ...(session.record.model ? { model: session.record.model } : {}),
          args: {
            ...(session.record.permissionMode ? { permissionMode: session.record.permissionMode } : {}),
            ...(session.skillName ? { skill: session.skillName } : {}),
            ...(native ? { resumeSessionId: native } : {}),
          },
        },
        this.makeContext(session),
      );
      if (this.shuttingDown || continuationSignal.aborted || continuationSignal !== session.abort.signal) return { ok: false, detail: "Fortsetzung wurde beendet." };
      session.handle = handle;
      await this.emitSystem(session, "session.continued", { actor: actor ?? null, nativeSessionId: native });
      return { ok: true };
    } catch (err) {
      if (this.shuttingDown || continuationSignal.aborted || continuationSignal !== session.abort.signal) return { ok: false, detail: "Fortsetzung wurde beendet." };
      await this.setStatus(session, "error");
      await this.emitSystem(session, "session.start_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** ADR-0044: serialize native resume with every other session input. */
  resume(sessionId: string, actor?: string): Promise<Ack> {
    const previous = this.steerQueue.get(sessionId) ?? Promise.resolve();
    const run = previous.then(() => this.resumeNow(sessionId, actor));
    const settled = run.then(() => undefined, () => undefined);
    this.steerQueue.set(sessionId, settled);
    void settled.then(() => { if (this.steerQueue.get(sessionId) === settled) this.steerQueue.delete(sessionId); });
    return run;
  }

  private automaticResume(session: LiveSession): Promise<Ack> {
    const id = session.record.id;
    const previous = this.steerQueue.get(id) ?? Promise.resolve();
    const run = previous.then(async (): Promise<Ack> => {
      await this.interruption.settled(id);
      if (session.record.status !== "interrupted") return { ok: false, detail: "Zustand inzwischen geändert." };
      await this.emitSystem(session, "session.resumed", { actor: "auto-resume", nativeSessionId: session.record.nativeSessionId });
      const ack = await this.submitAndWait(session, undefined, null, "auto-resume", "prompt", () => this.continueStopped(session, { kind: "prompt", text: "Die Arbeit wurde technisch unterbrochen. Setze den bestehenden Auftrag mit seinem bisherigen Kontext fort. Prüfe zuerst bereits erledigte Schritte und laufende Hintergrundarbeit; führe erledigte oder noch laufende Aktionen nicht doppelt aus." }, "auto-resume"));
      if (!ack.ok && !this.shuttingDown && ["working"].includes(session.record.status)) await this.setStatus(session, "error");
      return ack;
    });
    const settled = run.then(() => undefined, () => undefined);
    this.steerQueue.set(id, settled);
    void settled.then(() => { if (this.steerQueue.get(id) === settled) this.steerQueue.delete(id); });
    return run;
  }

  private async resumeNow(sessionId: string, actor?: string): Promise<Ack> {
    if (actorKind(actor) !== "human" && actorKind(actor) !== "fleet") return { ok: false, detail: "Nur Menschen dürfen unterbrochene Sessions fortsetzen." };
    await this.interruption.settled(sessionId);
    const session = this.openStopped(sessionId);
    if (!session || session.record.status !== "interrupted") return { ok: false, detail: "Session ist nicht unterbrochen." };
    const declaration = this.registry.get(session.record.adapter)?.capabilities.resume;
    // ADR-0044: natives hub-Resume nur mit Deklaration; sonst Prompt-Fallback
    // (Mensch tippt Weitermachen → Fortsetzungsnachricht, ggf. mit native id).
    if (!declaration?.hub || declaration.ref !== "native") {
      const detail = "Adapter ohne natives Hub-Resume — fortsetzen mit Fortsetzungsnachricht.";
      await this.emitSystem(session, "session.resume_fallback", { detail, adapter: session.record.adapter });
      await this.emitPrompt(session, "Bitte setze die unterbrochene Arbeit fort.", actor);
      return this.continueStopped(session, { kind: "prompt", text: "Bitte setze die unterbrochene Arbeit fort." }, actor);
    }
    const native = session.record.nativeSessionId;
    if (!native) {
      // Hub sagt „kann native“, ID fehlt trotzdem: ehrlich fallbacken statt Button-Tot.
      await this.emitSystem(session, "session.resume_fallback", {
        detail: "Provider-Session unbekannt — fortsetzen mit Fortsetzungsnachricht.",
        adapter: session.record.adapter,
      });
      await this.emitPrompt(session, "Bitte setze die unterbrochene Arbeit fort.", actor);
      return this.continueStopped(session, { kind: "prompt", text: "Bitte setze die unterbrochene Arbeit fort." }, actor);
    }
    session.abort.abort();
    session.abort = new AbortController();
    session.activeWorkers = 0;
    session.persistentWorker = false;
    const resumeSignal = session.abort.signal;
    const occupied = this.claimDirectCheckout(session);
    if (occupied) return { ok: false, detail: occupied };
    const recreated = await this.ensureWorkdir(session);
    // EPIC-P29: natives Fortsetzen braucht ebenfalls einen vorbereiteten
    // Workspace — bei Neuanlage des Worktree läuft das genehmigte Setup
    // erneut, ein verändertes Manifest blockiert (neue Freigabe = neuer Start).
    if (session.workspace) {
      const wsBlocked = this.workspaceBlocked(session);
      if (wsBlocked) return { ok: false, detail: wsBlocked };
      if (recreated) {
        const reprepared = await this.reprepareWorkspace(session, actor);
        if (!reprepared.ok) return reprepared;
      }
    }
    await this.setStatus(session, "working");
    await this.emitSystem(session, "session.resumed", { actor: actor ?? null, nativeSessionId: native });
    try {
      const handle = await session.adapter.start({
        adapter: session.record.adapter, project: session.record.project,
        ...(session.record.model ? { model: session.record.model } : {}),
        args: { resumeSessionId: native, ...(session.record.permissionMode ? { permissionMode: session.record.permissionMode } : {}) },
      }, this.makeContext(session));
      if (resumeSignal.aborted || resumeSignal !== session.abort.signal || this.shuttingDown) return { ok: false, detail: "Fortsetzung wurde beendet." };
      session.handle = handle;
      session.record.controlMode = "controllable";
      this.persist(session.record);
      // Promptless resume (cursor -p would be an empty turn) starts no worker.
      // Leaving the status on "working" looks like a hang with no error (BUG-0149).
      // ADR-0074: offene Aktivitäten sind echte Arbeit — kein Hang, kein idle.
      if ((session.activeWorkers ?? 0) === 0 && !session.persistentWorker && session.activities.size === 0 && (session.record.status as string) === "working") {
        await this.setStatus(session, "idle");
      }
      return { ok: true };
    } catch (err) {
      if (resumeSignal.aborted || resumeSignal !== session.abort.signal || this.shuttingDown) return { ok: false, detail: "Fortsetzung wurde beendet." };
      const detail = err instanceof Error ? err.message : String(err);
      await this.emitSystem(session, "session.resume_failed", { detail });
      if (classifyProviderError(detail).category !== "unknown") {
        await this.emitEvents(session, [providerErrorEvent(session.record.adapter, detail)]);
      }
      // Nach Crash/Neustart: natives Resume kann scheitern — Prompt-Fallback statt sticky error
      // (ADR-0044: kein stilles Zurück auf interrupted; Status bleibt working → continueStopped).
      await this.emitSystem(session, "session.resume_fallback", {
        detail: "Natives Resume fehlgeschlagen — fortsetzen mit Fortsetzungsnachricht.",
        cause: detail,
        adapter: session.record.adapter,
      });
      await this.emitPrompt(session, "Bitte setze die unterbrochene Arbeit fort.", actor);
      return this.continueStopped(session, { kind: "prompt", text: "Bitte setze die unterbrochene Arbeit fort." }, actor);
    }
  }

  /** BUG-0126 (ADR-0070): repair a session whose native binding went stale
   * (the agent lost the provider session). Drops the dead binding, visibly,
   * and continues in the SAME session with the handover draft as the next
   * prompt — the hub tail is the only surviving context, so it is rebuilt
   * from there. Serialized like every other session input. */
  repair(sessionId: string, actor?: string): Promise<Ack> {
    const previous = this.steerQueue.get(sessionId) ?? Promise.resolve();
    const run = previous.then(() => this.repairNow(sessionId, actor));
    const settled = run.then(() => undefined, () => undefined);
    this.steerQueue.set(sessionId, settled);
    void settled.then(() => { if (this.steerQueue.get(sessionId) === settled) this.steerQueue.delete(sessionId); });
    return run;
  }

  private async repairNow(sessionId: string, actor?: string): Promise<Ack> {
    if (actorKind(actor) !== "human" && actorKind(actor) !== "fleet") return { ok: false, detail: "Nur Menschen dürfen eine Session reparieren." };
    const session = this.openStopped(sessionId);
    if (!session) {
      const record = this.get(sessionId);
      if (!record) return { ok: false, detail: "unknown session" };
      return { ok: false, detail: `Session mit Status „${record.status}" ist nicht reparierbar — Adapter registriert?` };
    }
    const draft = await this.handoverDraft(sessionId);
    // The one live shape that may repair: idle right after the adapter
    // degraded a lost native id (promptless resume/adoption) — the binding
    // is already fresh, only the context feed was missing.
    const idleLost = session.record.status === "idle" && session.handle !== null && draft.reason?.category === "session";
    if (!idleLost && session.record.status !== "stopped" && session.record.status !== "error" && session.record.status !== "interrupted") {
      return { ok: false, detail: `Session läuft gerade (Status „${session.record.status}") — Reparieren gilt für steckengebliebene Sessions.` };
    }
    if (idleLost) {
      await this.emitPrompt(session, draft.prompt, actor);
      return this.submitAndWait(session, undefined, null, actor, "prompt", () =>
        session.adapter.steer(session.handle!, { kind: "prompt", text: draft.prompt }, this.makeContext(session)));
    }
    const stale = session.record.nativeSessionId;
    if (stale) {
      // Field name `staleNativeId` on purpose: the record fold pins every
      // payload field `nativeSessionId` — that one must not resurrect.
      await this.emitSystem(session, "session.native_binding_dropped", {
        staleNativeId: stale,
        actor: actor ?? null,
        detail: "Provider-Session nicht mehr vorhanden — Kontext wird aus dem Verlauf neu aufgebaut",
      });
      session.record.nativeSessionId = null;
      this.persist(session.record);
    }
    await this.emitPrompt(session, draft.prompt, actor);
    return this.continueStopped(session, { kind: "prompt", text: draft.prompt }, actor);
  }

  /** Steers of one session run one after another. Input-id, revision and
   * lease checks only hold if no second steer passes them while the first
   * is still awaiting (BUG-0017: two clients reopened a stopped run twice). */
  steer(sessionId: string, input: SteerInput, actor?: string, meta?: SteerMeta): Promise<Ack> {
    const previous = this.steerQueue.get(sessionId) ?? Promise.resolve();
    const run = previous.then(() => this.steerNow(sessionId, input, actor, meta));
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.steerQueue.set(sessionId, settled);
    void settled.then(() => {
      if (this.steerQueue.get(sessionId) === settled) this.steerQueue.delete(sessionId);
    });
    return run;
  }

  private async steerNow(sessionId: string, input: SteerInput, actor?: string, meta?: SteerMeta): Promise<Ack> {
    // A mirror is a read-only view (ADR-0011 Erweiterung): nothing may be
    // steered, stopped or parked into opencode's session — loudly refused.
    if (input.kind === "prompt" || input.kind === "resume") await this.interruption.settled(sessionId);
    const mirrorRecord = this.get(sessionId);
    if (mirrorRecord?.controlMode === "mirror") {
      return { ok: false, detail: "Spiegel-Session ist nur lesbar — zum Weiterarbeiten übernehmen" };
    }
    const session = this.openStopped(sessionId);
    if (!session) {
      const record = this.get(sessionId);
      if (record?.status === "stopped") return { ok: false, detail: `adapter "${record.adapter}" not registered` };
      return { ok: false, detail: "session not live" };
    }
    // EPIC-P29 (AC-P29-3): kein Prompt erreicht einen Agenten, dessen
    // Workspace nicht bereit ist — weder wartender noch fehlerhafter.
    const wsBlocked = this.workspaceBlocked(session);
    if (wsBlocked) return { ok: false, detail: wsBlocked };
    if (session.record.status === "interrupted") {
      if (actorKind(actor) !== "human" && actorKind(actor) !== "fleet") return { ok: false, detail: "Nur Menschen dürfen unterbrochene Sessions fortsetzen." };
      if (input.kind === "resume") return this.resumeNow(sessionId, actor);
    }
    if (!session.handle && input.kind !== "prompt" && input.kind !== "configure") return { ok: false, detail: "session not live" };
    if (meta?.inputId && this.hasSeenInput(sessionId, meta.inputId)) {
      return { ok: true, detail: "duplicate input ignored" };
    }
    // T17.4: the first attempt may still be running after its wait timed
    // out — its outcome is unknown, so the same input id must not be
    // submitted twice (AC-P17-3).
    if (meta?.inputId && this.inputInFlight(sessionId, meta.inputId)) {
      return { ok: false, detail: "input in flight — outcome of the earlier attempt is unknown" };
    }
    if (meta?.revision !== undefined && meta.revision !== session.record.inputRevision) {
      return { ok: false, detail: "revision conflict" };
    }
    const leaseUntil = session.record.writerLeaseUntil ? Date.parse(session.record.writerLeaseUntil) : 0;
    const foreignWriter =
      meta?.clientId && session.record.writerClient && session.record.writerClient !== meta.clientId && leaseUntil > Date.now()
        ? session.record.writerClient
        : null;
    if (foreignWriter && !meta?.takeover) return { ok: false, detail: "writer lease held" };
    const features = this.registry.get(session.record.adapter)?.capabilities.features;
    const refused = features ? refuseSteer(features, session.record.adapter, input) : null;
    if (refused) return { ok: false, detail: refused };
    if (input.kind === "stop") {
      if (session.record.status === "stopped") return { ok: true };
      return this.stop(sessionId, actor);
    }
    if (input.kind === "park") {
      // EPIC-P15 T15.3: the phone's Pause. Reaches the adapter AND sets the status — a bare adapter
      // steer used to kill the process and leave the session "working".
      if (session.record.status === "parked") return { ok: true };
      const done = await this.park(sessionId, actor);
      if (done.ok) await this.commitSteer(session, meta, foreignWriter, actor);
      return done;
    }
    if (input.kind === "configure") {
      const done = await this.configure(session, input, actor);
      if (done.ok) await this.commitSteer(session, meta, foreignWriter, actor);
      return done;
    }
    // EPIC-P15 T15.3: "Vormerken" — the prompt waits for the running turn instead of starting a second process.
    const caps = this.registry.get(session.record.adapter)?.capabilities;
    const nextTurn = caps?.promptDelivery === "next-turn";
    // ADR-0085: "jetzt nicht vormerken" ist eine ausdrueckliche Wahl des Nutzers. Sie ist
    // nur dort erlaubt, wo der Adapter Eingaben mitten im laufenden Zug zusichert.
    const wantsNow = meta?.queue === false && caps?.midTurnInput === true;
    if (input.kind === "prompt" && !wantsNow && (meta?.queue || nextTurn) && !meta?.fromQueue && session.handle && ["starting", "working", "waiting_approval"].includes(session.record.status)) {
      const item = this.queue.add(sessionId, input.text, input.attachments, actor ?? null);
      await this.emitSystem(session, "session.queued", { queueId: item.id, position: this.queue.count(sessionId), actor: actor ?? null });
      await this.commitSteer(session, meta, foreignWriter, actor);
      if (this.canDrain(session)) this.scheduleDrain(sessionId);
      return { ok: true, detail: "queued" };
    }
    let delivered = input;
    // BUG-0100: Ein Zug, dessen letzter Worker beendet ist, während die
    // Abschluss-Klassifizierung (250 ms) noch läuft, würde einen Prompt an
    // das tote Handle verlieren (CI-Lauf 3038014959). Erst den abgeschnittenen
    // Zug sauber abschließen (turn_end), dann normal weitermachen.
    // workerExitPending unterscheidet den toten Zwischenzustand von
    // in-proc-Adaptern, die nie einen Worker-Prozess haben.
    if (input.kind === "prompt" && session.workerExitPending && (session.record.status === "working" || session.record.status === "starting")) {
      await this.interruption.interrupt(session, "worker_exit");
      session.workerExitPending = false;
    }
    const reopening = input.kind === "prompt" && (session.record.status === "stopped" || !session.handle);
    if (input.kind === "prompt" && session.skillName && !reopening) {
      delivered = { ...input, text: await this.promptWithSkill(session, input.text) };
    }
    const gated = await this.flow.gateSteer(session, input, delivered, actor);
    if (gated) return gated;
    if (input.kind === "prompt") await this.emitPrompt(session, input.text, actor, input.attachments);
    if (delivered.kind === "prompt") delivered = this.withAttachments(session, delivered);
    if (reopening && delivered.kind === "prompt") {
      // BUG-0016: the reopen is a steer like any other — without the
      // commit, a retried input id started the provider a second time.
      // T17.4: same hard wait as every submission (see submitAndWait).
      const reopened = await this.submitAndWait(
        session,
        meta,
        foreignWriter,
        actor,
        "prompt",
        () => this.continueStopped(session, delivered, actor),
      );
      if (reopened.ok) await this.commitSteer(session, meta, foreignWriter, actor);
      return reopened;
    }
    if (delivered.kind === "prompt") {
      const occupied = this.claimDirectCheckout(session);
      if (occupied) return { ok: false, detail: occupied };
      await this.ensureWorkdir(session);
    }
    const ack = await this.submitAndWait(
      session,
      meta,
      foreignWriter,
      actor,
      input.kind,
      () => session.adapter.steer(session.handle!, delivered, this.makeContext(session)),
    );
    // EPIC-P15 T15.3: a prompt after a manual Pause starts the next turn — the status follows.
    // (Budget and daily-cap parks keep their own rules.)
    if (ack.ok && delivered.kind === "prompt" && session.record.status === "parked" && session.record.parkReason === "manual") {
      session.record.parkReason = null;
      await this.setStatus(session, "working");
    }
    // BUG found via T2.8's own audit test: emitSystem() builds
    // `{ kind, ...payload }`, where `kind` is this call's own event-kind
    // string ("session.steer") — a payload field ALSO named `kind` (the
    // steer input's kind, e.g. "resume") silently overwrote it, so every
    // non-"prompt" steer's audit event had payload.kind === "resume"/
    // "park" instead of "session.steer" ever since T2.4 introduced this
    // call. Named `steerKind` here to never collide again.
    await this.emitSystem(session, "session.steer", { steerKind: input.kind, ok: ack.ok, actor: actor ?? null, ...(ack.ok ? {} : { detail: ack.detail ?? null }) });
    if (ack.ok) await this.commitSteer(session, meta, foreignWriter, actor);
    return ack;
  }

  /**
   * ADR-0033: model and permission mode of a session. A live adapter applies it
   * at the latest on the next turn; a stopped session passes it on when it is
   * continued. The change is an event, so recovery finds it again (K7).
   */
  private async configure(session: LiveSession, input: Extract<SteerInput, { kind: "configure" }>, actor?: string): Promise<Ack> {
    if (session.handle && session.record.status !== "stopped") {
      const ack = await session.adapter.steer(session.handle, input, this.makeContext(session));
      if (!ack.ok) return ack;
    }
    if (input.model !== undefined) session.record.model = input.model;
    if (input.permissionMode !== undefined) session.record.permissionMode = input.permissionMode;
    session.record.updatedAt = new Date().toISOString();
    this.persist(session.record);
    await this.emitSystem(session, "session.configured", {
      model: session.record.model,
      permissionMode: session.record.permissionMode,
      actor: actor ?? null,
    });
    return { ok: true };
  }

  /** The user's own input as a chat message — as typed, without the skill
   * chain the hub puts in front for the provider. The hub is the one source
   * for these; adapters no longer echo prompts as `user` events. */
  private async emitPrompt(session: LiveSession, text: string, actor?: string, attachments?: readonly PromptAttachment[]): Promise<void> {
    // A session that had no start prompt takes its first reply as title.
    if (!session.record.title) session.record.title = sessionTitle(text);
    session.titlePrompt ??= text;
    // T7.10: references only (K5) — never the bytes or the extracted text.
    const refs = attachments?.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, kind: a.kind, bytes: a.bytes, method: a.method }));
    await this.emitEvents(session, [
      { type: "user", summary: text.slice(0, 200) || `${refs?.length ?? 0} Anhang/Anhänge`, payload: { kind: "session.prompt", text, actor: actor ?? null, ...(refs && refs.length > 0 ? { attachments: refs } : {}) } },
    ]);
  }

  /**
   * T7.10 (ADR-0022): a harness that takes files or images itself gets the
   * attachments; any other gets their text inside the prompt.
   */
  private withAttachments<T extends { text: string; attachments?: PromptAttachment[] | undefined }>(session: LiveSession, input: T): T {
    if (!input.attachments || input.attachments.length === 0) return input;
    const f = this.registry.get(session.record.adapter)?.capabilities.features;
    if (f?.images || f?.files) return input;
    const { attachments, ...rest } = input;
    return { ...rest, text: promptWithAttachments(input.text, attachments) } as T;
  }

  private readonly notificationListeners: ((n: HubNotification) => unknown)[] = [];

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

  /**
   * "Ins Projekt übernehmen": the session's worktree work lands in the
   * project checkout as one merge. Only between turns — never while an
   * agent may still write.
   */
  async applyToProject(
    sessionId: string,
    actor?: string,
  ): Promise<{ ok: true; into: string; commit: string; files: number } | { ok: false; detail: string }> {
    const record = this.get(sessionId);
    if (!record) return { ok: false, detail: "Session unbekannt." };
    if (record.status === "working" || record.status === "starting") {
      return { ok: false, detail: "Die Session arbeitet gerade. Bitte warten, bis der Zug fertig ist." };
    }
    const session = this.openStopped(sessionId) ?? this.live.get(sessionId);
    if (!this.worktrees || record.worktreeSha === null || !existsSync(this.worktrees.pathFor(sessionId)) || !session) {
      return { ok: false, detail: "Diese Session arbeitet direkt im Projektordner, es gibt nichts zu übernehmen." };
    }
    const message = `AncientVoid: ${record.title ?? `Session ${sessionId.slice(0, 8)}`}`;
    const result = await this.worktrees.apply(sessionId, record.project, message);
    if (result.ok) {
      await this.emitSystem(session, "session.applied", { into: result.into, commit: result.commit, files: result.files, actor: actor ?? null });
    }
    return result;
  }

  /** Newest first. With `afterId`, only newer ones (polling). */
  notifications(afterId = 0, limit = 50): { items: HubNotification[]; lastId: number } {
    const rows = this.db
      .prepare("SELECT * FROM notifications WHERE id > ? ORDER BY id DESC LIMIT ?")
      .all(afterId, Math.min(Math.max(limit, 1), 200)) as unknown as {
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

  /** Records a delivered steer and, for a takeover, who handed over to whom. */
  private async commitSteer(session: LiveSession, meta: SteerMeta | undefined, foreignWriter: string | null, actor?: string): Promise<void> {
    this.commitSteerMeta(session, meta);
    if (foreignWriter && meta?.clientId) {
      await this.emitSystem(session, "session.writer_takeover", { from: foreignWriter, to: meta.clientId, actor: actor ?? null });
    }
  }

  /**
   * EPIC-P17 T17.4: every prompt submission waits at most `steerWaitMs`.
   * A timeout answers "outcome unknown" (visible as session.steer_timeout)
   * and NEVER resubmits: the input id stays reserved for the still-running
   * attempt, and a late success still commits it — a retry with the same
   * id then dedups against the store like any delivered input.
   */
  private async submitAndWait(
    session: LiveSession,
    meta: SteerMeta | undefined,
    foreignWriter: string | null,
    actor: string | undefined,
    steerKind: SteerInput["kind"],
    submit: () => Promise<Ack>,
  ): Promise<Ack> {
    const sessionId = session.record.id;
    const inputId = meta?.inputId;
    if (inputId) {
      const ids = this.inFlightInputs.get(sessionId) ?? new Set<string>();
      ids.add(inputId);
      this.inFlightInputs.set(sessionId, ids);
    }
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const expired = new Promise<{ expired: true }>((resolve) => {
      timer = setTimeout(() => resolve({ expired: true }), this.steerWaitMs);
    });
    const attempt = submit();
    const outcome = await Promise.race([attempt.then((ack) => ({ ack })), expired]);
    clearTimeout(timer);
    if ("ack" in outcome) {
      this.releaseInFlight(sessionId, inputId);
      return outcome.ack;
    }
    // The wait is over, the attempt is not — its late result still counts.
    void attempt
      .then(async (ack) => {
        if (ack.ok) await this.commitSteer(session, meta, foreignWriter, actor).catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => this.releaseInFlight(sessionId, inputId));
    await this.emitSystem(session, "session.steer_timeout", {
      steerKind,
      inputId: inputId ?? null,
      waitedMs: this.steerWaitMs,
      detail: STEER_TIMEOUT_DETAIL,
    });
    return { ok: false, detail: STEER_TIMEOUT_DETAIL };
  }

  /** T17.4: the attempt settled — free its input id for retries. */
  private releaseInFlight(sessionId: string, inputId: string | undefined): void {
    if (!inputId) return;
    const ids = this.inFlightInputs.get(sessionId);
    if (!ids) return;
    ids.delete(inputId);
    if (ids.size === 0) this.inFlightInputs.delete(sessionId);
  }

  private inputInFlight(sessionId: string, inputId: string): boolean {
    return this.inFlightInputs.get(sessionId)?.has(inputId) ?? false;
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

  async stop(sessionId: string, actor?: string): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    session.record.parkReason = null; // ADR-0008: leaving "parked" (if it was) for good, never a stale reason
    await this.setStatus(session, "stopping");
    for (const item of this.queue.list(sessionId)) this.uncertainQueue.delete(item.id);
    this.queue.clear(sessionId); // Stop heißt: nichts mehr senden, auch nichts Vorgemerktes
    session.abort.abort();
    try {
      if (session.handle) await session.adapter.stop(session.handle, this.makeContext(session));
    } finally {
      // EPIC-P29 T29.4: eigene Services zuerst beenden — nur nachgewiesen
      // eigene Prozesse (ADR-0051 §4); ihr cwd liegt im Worktree und würde
      // jede saubere Entsorgung als "in Benutzung" blocken.
      await this.workspaceServices
        .stopAll(sessionId, (kind, payload) => this.emitSystem(session, kind, payload))
        .catch((err) => this.logger.warn("service stop failed", { sessionId, err: err instanceof Error ? err.message : String(err) }));
      // EPIC-P29 T29.5: genehmigter Teardown läuft hier, solange der
      // Worktree existiert — Scheitern hält ihn fest (workspace.cleanup_failed).
      const teardown = await this.teardownWorkspaceOnce(sessionId, actor).catch(() => "failed" as const);
      // T2.1: clean up the isolated worktree once the adapter is done with
      // it — but only a clean one. BUG-0027: `remove --force` + `branch -D`
      // destroyed every uncommitted file and commit an agent had made.
      // A worktree with work stays, and "Weiter" continues in it.
      // Removal failures are a disk-hygiene problem to surface, not a
      // reason to leave the session stuck in "stopping".
      if (session.worktreeIsolated && this.worktrees) {
        try {
          if (teardown === "failed") {
            await this.emitSystem(session, "session.worktree_kept", {
              path: this.worktrees.pathFor(session.record.id),
              branch: this.worktrees.branchFor(session.record.id),
              reason: "teardown",
            });
          } else if (await this.worktrees.hasWork(session.record.id, session.record.worktreeSha, session.record.project)) {
            await this.emitSystem(session, "session.worktree_kept", {
              path: this.worktrees.pathFor(session.record.id),
              branch: this.worktrees.branchFor(session.record.id),
            });
          } else {
            await this.worktrees.remove(session.record.id, session.record.project);
          }
        } catch (err) {
          await this.emitSystem(session, "session.worktree_cleanup_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await this.setStatus(session, "stopped");
      this.checkoutLeases.release(sessionId); // ADR-0057: Stop gibt nur die Lease frei, nie das Projekt
      await this.emitSystem(session, "session.stopped", { actor: actor ?? null });
      this.metrics?.inc("sessions_stopped");
      this.logger.info("session stopped", { sessionId, adapter: session.record.adapter });
      this.dispatchDigest(session);
    }
    return { ok: true };
  }

  /**
   * Delete a session for good — events, snapshot, worktree and row.
   * An archived run may still have a worker, so stop it before deleting.
   * Uncommitted agent work in a kept worktree goes with it.
   */
  delete(sessionId: string, actor?: string): Promise<Ack> {
    return this.chainWork(sessionId, () => this.deleteNow(sessionId, actor));
  }

  private async deleteNow(sessionId: string, actor?: string): Promise<Ack> {
    await this.interruption.settled(sessionId);
    const record = this.get(sessionId);
    if (!record) return { ok: true };
    const live = this.live.get(sessionId);
    if (live && record.status === "stopping") return { ok: false, detail: "Die Session wird gerade gestoppt. Bitte danach erneut löschen." };
    if (live && record.status !== "error" && record.status !== "stopped" && record.status !== "parked") {
      if (!record.archived) return { ok: false, detail: "Die Session läuft noch — erst stoppen, dann löschen." };
      const stopped = await this.stop(sessionId, actor);
      if (!stopped.ok) return stopped;
    }
    live?.abort.abort();
    // EPIC-P29: Services gehören zur Session — auch beim Löschen werden nur
    // nachweisbar eigene Prozesse beendet, dann erst der Worktree entfernt.
    try {
      await this.workspaceServices.stopAll(sessionId, (kind, payload) => (live ? this.emitSystem(live, kind, payload) : Promise.resolve()));
      // BUG-0246: auch ohne worktreeSha aufräumen, falls der Ordner noch liegt;
      // remove ist resilient gegen tote/fehlende Projekt-Repos.
      if (this.worktrees && (record.worktreeSha !== null || existsSync(this.worktrees.pathFor(sessionId)))) {
        await this.worktrees.remove(sessionId, record.project);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn("workspace cleanup on delete failed", { sessionId, err: detail });
      return { ok: false, detail: `Workspace konnte nicht aufgeräumt werden: ${detail}` };
    }
    this.checkoutLeases.release(sessionId);
    await this.store.destroySession(sessionId);
    this.live.delete(sessionId);
    for (const item of this.queue.list(sessionId)) this.uncertainQueue.delete(item.id);
    this.queue.clear(sessionId);
    // T17.4: no attempt can settle for a deleted session — its reserved
    // input ids would leak into the map forever.
    this.inFlightInputs.delete(sessionId);
    // EPIC-P29 / BUG-0246: alle session-gebundenen Zeilen und Dateien mitnehmen.
    this.purgeSessionSidecars(sessionId);
    await this.purgeSessionFiles(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    this.metrics?.inc("sessions_deleted");
    this.logger.info("session deleted", { sessionId, adapter: record.adapter });
    return { ok: true };
  }

  /** SQLite-Zeilen, die sonst nach dem Löschen als Orphans wachsen. */
  private purgeSessionSidecars(sessionId: string): void {
    for (const table of [
      "workspace_services",
      "workspace_operations",
      "notifications",
      "drafts",
      "session_inputs",
      "approvals",
      "operations",
      "turn_metrics",
      "session_stat_facts",
      "gate_wait_facts",
      "tool_stat_facts",
      "recovery_facts",
      "checkout_tenants",
    ] as const) {
      this.db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
    }
  }

  /** Worker-Logs und MCP-Bridge-Dateien der Session unter dem Datadir. */
  private async purgeSessionFiles(sessionId: string): Promise<void> {
    const root = this.store.directory();
    const workers = join(root, "workers");
    const bridges = join(root, "bridges");
    try {
      for (const name of await readdir(workers)) {
        if (name === `ancientvoid-${sessionId}.log` || name.startsWith(`ancientvoid-${sessionId}.`)) {
          await rm(join(workers, name), { force: true }).catch(() => undefined);
        }
      }
    } catch {
      /* workers-Dir fehlt — nichts zu tun */
    }
    await rm(join(bridges, `${sessionId}.mcp.json`), { force: true }).catch(() => undefined);
  }

  /** ADR-0009: fire-and-forget, best-effort. A throwing/rejecting sink
   * must never affect the (already-returned) stop() result — errors are
   * caught per-sink and surfaced as a real system event instead of a
   * silent drop (AGENTS.md Regel 6 "fail loud"). */
  private dispatchDigest(session: LiveSession): void {
    if (this.reportingSinks.length === 0) return;
    // A resume may begin while the journal flushes; the digest belongs to this boundary.
    const record = { ...session.record };
    void (async () => {
      await this.store.flush(record.id);
      const events = (await this.store.replay(record.id)).filter(e => e.seq <= record.lastSeq);
      const summary = buildSessionSummary(record, events);
      for (const sink of this.reportingSinks) {
        try {
          await sink(summary);
        } catch (err) {
          await this.emitSystem(session, "session.digest_sink_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
  }

  async park(sessionId: string, actor?: string): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    await this.parkFor(session, "manual", actor);
    return { ok: true };
  }

  /** T2.7/ADR-0008: the one place any kind of park actually happens —
   * records WHY, so a later budget top-up knows whether it's the right
   * reason to auto-resume (see applyBudgetTopUp). */
  private async parkFor(session: LiveSession, reason: SessionRecord["parkReason"], actor?: string): Promise<void> {
    // Real bug found live-testing T2.7: this used to only flip the hub's
    // OWN status label — an adapter with any free-running work (a real
    // CLI process still streaming, a generator loop like adapter-dummy's)
    // kept right on going and kept right on costing money, since nothing
    // ever told it to stop. "Fail-closed" requires actually reaching the
    // adapter, not just relabeling it: SteerInput{kind:"park"} is the
    // real, existing adapter-level pause mechanism (adapter-dummy already
    // implements it) — every park (manual, budget, daily-cap) now uses it
    // before the hub status changes underneath it.
    session.parkGeneration = (session.parkGeneration ?? 0) + 1;
    if (!session.handle) session.abort.abort();
    if (session.handle) {
      try {
        await session.adapter.steer(session.handle, { kind: "park" }, this.makeContext(session));
      } catch (err) {
        await this.emitSystem(session, "session.park_signal_failed", {
          reason,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    session.record.parkReason = reason;
    await this.setStatus(session, "parked");
    await this.emitSystem(session, "session.parked", { reason, actor: actor ?? null });
  }







  async tail(sessionId: string, afterSeq: number, limit?: number): Promise<NormalizedEvent[]> {
    return this.store.tail(sessionId, afterSeq, limit);
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
    const created = await this.create({ adapter: input.adapter, project: source.project, prompt: input.prompt, ...(input.model ? { model: input.model } : {}) }, actor);
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

  async recoverAll(): Promise<{ recovered: number; failed: number; reaped: string[]; uncontrolled: number }> {
    const t0 = performance.now();
    const persisted = this.list();
    const keepWorkers: string[] = [];
    let recovered = 0;
    let failed = 0;
    let uncontrolled = 0;

    type Outcome = "recovered" | "failed" | "uncontrolled";
    const recoverOne = async (record: SessionRecord): Promise<Outcome> => {
      if (record.status === "stopped") {
        // Loaded when opened (openStopped), so recovery time does not grow
        // with the history of finished runs.
        return "recovered";
      }
      if (record.controlMode === "mirror") {
        // A mirror is a read-only view with no adapter of its own — nothing
        // to recover, it refreshes from opencode's store when opened.
        return "recovered";
      }
      const events = await this.store.replay(record.id);
      const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
      const registered = this.registry.get(record.adapter);
      // T2.1: a session that had real worktree isolation before the crash
      // gets the same deterministic path back — the worktree itself is
      // still on disk (only the hub process died), so this is a real
      // re-attach, not a re-creation.
      const workdir =
        record.worktreeSha !== null && this.worktrees ? this.worktrees.pathFor(record.id) : record.project;
      const recoveredSkill = skillNameFromEvents(events);
      const session: LiveSession = {
        record: { ...record, lastSeq },
        adapter: registered?.adapter ?? null as unknown as Adapter,
        handle: null,
      activities: new Map(),
        abort: new AbortController(),
        subscribers: new Set(),
        workdir,
        worktreeIsolated: workdir !== record.project,
        ...(recoveredSkill ? { skillName: recoveredSkill } : {}),
        // Not itself persisted (no JSONL/system-event replay here) — but
        // honestly recomputable from the record's own real numbers, so a
        // recovered session that was already past 80% before the crash
        // doesn't spuriously re-fire the warning on its first post-
        // recovery event.
        budgetWarned: record.budgetUsd !== null && record.costUsd >= record.budgetUsd * 0.8,
      };
      // ADR-0074 (BUG-0155, K7): offene Aktivitäten aus dem JSONL falten —
      // Recovery lügt nicht über Arbeit, die vor dem Crash angemeldet war.
      session.activities = foldActivities(events);
      this.live.set(record.id, session);
      for (const event of events) {
        const id = event.payload.queueId;
        if (typeof id !== "string") continue;
        if (event.payload.kind === "session.queue_submitting") this.uncertainQueue.add(id);
        if (event.payload.kind === "session.queue_ack" || event.payload.kind === "session.unqueued") this.uncertainQueue.delete(id);
      }
      for (const item of this.queue.list(record.id)) {
        if (this.hasSeenInput(record.id, item.id)) {
          this.queue.remove(record.id, item.id);
          this.uncertainQueue.delete(item.id);
        }
      }
      const lastMain = events.findLast(e => e.payload.kind === "session.main_turn_end" || e.payload.kind === "session.main_turn_start");
      session.mainTurnIdle = lastMain?.payload.kind === "session.main_turn_end";
      // BUG-0209: nach dem Hauptzugende offene Werkzeugaufrufe sind verwaist; steht die
      // Session deshalb noch auf working, ist der Zug fertig — nicht ein Fall für Adoption.
      if (session.mainTurnIdle && session.activities.size > 0) {
        await this.dropOrphanedTools(session);
        if (session.activities.size === 0 && record.status === "working") {
          await this.setStatus(session, "idle");
          await this.emitSystem(session, "session.turn_end", { code: 0 });
        }
      }
      // EPIC-P29 (K7, ADR-0051 §5): Workspace-Phase aus den Events falten
      // und hängengebliebene Operationen als unklar markieren — genau ein
      // needs_attention-Event je Operation, kein automatischer Re-Run.
      const foldedWorkspace = foldWorkspaceState(events);
      if (foldedWorkspace) {
        session.workspace = { phase: foldedWorkspace.phase, manifestHash: foldedWorkspace.manifestHash ?? "", baseSha: record.worktreeSha ?? "", pendingApprovalId: null };
      }
      const unclear = await this.workspaces.reconcileAfterCrash(record.id, (kind, payload) => this.emitSystem(session, kind, payload));
      if (unclear > 0 && session.workspace) session.workspace.phase = "needs_attention";
      // EPIC-P29 T29.4: Services als `probing` markieren und asynchron
      // adoptieren/prüfen — blockiert den Restore nicht (ADR-0051 §5, K7).
      if (this.workspaceServices.list(record.id).length > 0) {
        this.workspaceServices.reconcile(record.id, (kind, payload) => this.emitSystem(session, kind, payload));
      }
      if (foldedWorkspace && record.status === "waiting_approval") {
        // EPIC-P29: eine auf Manifest-Freigabe wartende Session hat nichts
        // zu adoptieren — Journal/Phase wiederherstellen, dem Menschen
        // steuerbar lassen (kein "observed", kein Auto-Re-Run).
        await this.emitSystem(session, "session.recovered", { events: events.length, lastSeq, controllable: true });
        return "recovered";
      }
      if (record.status === "interrupted") {
        await this.interruption.repair(session);
        if (this.autoResumeInterrupted || record.autoResumeOnLimit) this.recovery.schedule(session);
        return "recovered";
      }
      if (record.status === "error" && registered) {
        await this.emitSystem(session, "session.recovered", { events: events.length, lastSeq, controllable: true });
        return "recovered";
      }
      if (session.mainTurnIdle && session.activities.size > 0 && [...session.activities.values()].every(work => work.source === "external")) {
        await this.emitSystem(session, "session.recovered", { events: events.length, lastSeq, controllable: true, background: true });
        return "recovered";
      }
      // ADR-0050/BUG-0092: Bei beendeten Zügen ohne persistenten Adapter-
      // Prozess (idle, geparkt) lief vor dem Crash nichts, das adoptiert
      // werden könnte — adapter.recover() hätte dem Adapter einen NEUEN
      // Lauf gestartet. Journal/Status wiederherstellen, steuerbar lassen;
      // ein neuer Prompt startet normal über steer.
      if (!record.persistentWorker && (record.status === "idle" || record.status === "parked")) {
        await this.emitSystem(session, "session.recovered", { events: events.length, lastSeq, controllable: true });
        return "recovered";
      }

      // ADR-0074 (BUG-0155): Externe Aktivitäten laufen unabhängig vom Hub
      // weiter (registrierte Jobs mit eigenem Herzschlag) — Recovery unter-
      // bricht sie nicht, die Session bleibt ehrlich `working`. Das gilt
      // aber nur für Arbeit, die den Hub-Crash überleben kann: Provider-
      // Aktivitäten sterben mit dem Worker, und ein nachweisbar offener Zug
      // (main_turn_start ohne Ende) ist abgeschnitten, egal was außen
      // weiterläuft — beides davon gehört zur Adoption/Unterbrechung unten,
      // nicht dauerhaft `working` (BUG-0165).
      const externalOnly = session.activities.size > 0 && [...session.activities.values()].every((work) => work.source === "external");
      if (externalOnly && session.mainTurnIdle !== false) {
        await this.emitSystem(session, "session.recovered", {
          events: events.length,
          lastSeq,
          controllable: false,
          openActivities: [...session.activities.values()].map((a) => a.label),
        });
        return "recovered";
      }

      if (!registered) {
        await this.setStatus(session, "error");
        await this.emitSystem(session, "session.recovery_failed", {
          reason: `adapter "${record.adapter}" not registered`,
        });
        return "failed";
      }
      try {
        if (registered.adapter.recover) {
          const handle = await registered.adapter.recover(
            record.id,
            lastSeq,
            this.makeContext(session),
          );
          session.handle = handle;
        }
        if ((record.status === "working" || record.status === "starting") && (session.adopted === false || !session.handle)) {
          await this.interruption.interrupt(session, "hub_restart");
          // BUG-0165: Provider-Aktivitäten starben mit dem Worker — niemand
          // meldet ihr Ende mehr. Ehrlich schließen, sonst blockiert der
          // tote Eintrag nach jeder Wiederaufnahme das Laufende (closeIfLast
          // sieht activities.size > 0). Externe Arbeit läuft weiter und
          // blockiert die Wiederaufnahme bewusst (ADR-0076).
          for (const entry of [...session.activities.values()]) {
            if (entry.source !== "external") await this.endActivity(record.id, entry.id, 1);
          }
        }
        if (session.handle) keepWorkers.push(record.id);
        if (!session.handle) {
          session.record.controlMode = "observed";
          this.persist(session.record);
          await this.emitSystem(session, "session.recovered", {
            events: events.length,
            lastSeq,
            controllable: false,
            // 2026-10-25: whether the session was mid-turn — only then is
            // "nur noch lesbar" a real loss worth a bell warning.
            wasWorking: session.record.status === "working",
          });
          return "uncontrolled";
        }
        await this.emitSystem(session, "session.recovered", {
          events: events.length,
          lastSeq,
          controllable: true,
        });
        return "recovered";
      } catch (err) {
        await this.setStatus(session, "error");
        await this.emitSystem(session, "session.recovery_failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
        return "failed";
      }
    };
    // BUG-0050: sessions are independent and `adapter.recover` mostly waits for a process or a
    // handshake — one after the other that was 12–14 s for 25 sessions (K7: < 3 s).
    const timings: { id: string; adapter: string; ms: number }[] = [];
    const outcomes = await mapLimit(persisted, RECOVERY_CONCURRENCY, async (record) => {
      const started = performance.now();
      const outcome = await recoverOne(record);
      timings.push({ id: record.id, adapter: record.adapter, ms: Math.round(performance.now() - started) });
      return outcome;
    });
    for (const outcome of outcomes) {
      if (outcome === "recovered") recovered++;
      else if (outcome === "failed") failed++;
      else uncontrolled++;
    }
    const sessionsMs = Math.round(performance.now() - t0);

    const tailStart = performance.now();
    await this.flow.reconcile();
    const reconcileMs = Math.round(performance.now() - tailStart);
    for (const live of this.live.values()) await this.healWaitingApproval(live, true);
    const healMs = Math.round(performance.now() - tailStart) - reconcileMs;
    for (const sessionId of this.queue.sessionsWithEntries()) this.scheduleDrain(sessionId);
    const reapStart = performance.now();
    const reaped = await this.runner.reapOrphans(keepWorkers).catch(() => []);
    const reapMs = Math.round(performance.now() - reapStart);
    const elapsed = performance.now() - t0;
    this.metrics?.gauge("recovery_ms", elapsed);
    if (elapsed > this.recoveryBudgetMs) {
      // Where the time goes: without this a slow start is only "12 s", never "which adapter".
      const perAdapter: Record<string, { sessions: number; totalMs: number; maxMs: number }> = {};
      for (const t of timings) {
        const entry = (perAdapter[t.adapter] ??= { sessions: 0, totalMs: 0, maxMs: 0 });
        entry.sessions++;
        entry.totalMs += t.ms;
        entry.maxMs = Math.max(entry.maxMs, t.ms);
      }
      const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5).map((t) => ({ session: t.id.slice(0, 8), adapter: t.adapter, ms: t.ms }));
      this.logger.warn("recovery exceeded K7 budget", { elapsedMs: Math.round(elapsed), budgetMs: this.recoveryBudgetMs });
      this.logger.info("recovery detail", { sessionsMs, reconcileMs, healMs, reapMs, perAdapter, slowest });
    }
    return { recovered, failed, reaped, uncontrolled };
  }





  /**
   * `keepWorkers`: a planned restart with a runner whose workers outlive
   * the hub (tmux). Sessions keep their status and running turns go on;
   * the next start adopts them like after a crash (ADR-0014). Without it,
   * every session is stopped — workers that die with the hub.
   */
  async shutdown(options: { keepWorkers?: boolean } = {}): Promise<void> {
    this.shuttingDown = true;
    clearInterval(this.heartbeatTimer);
    this.recovery.close();
    if (options.keepWorkers) {
      await this.store.flush();
      return;
    }
    for (const [id, session] of this.live) {
      if (session.record.status === "stopped" || session.record.status === "stopping") continue;
      await this.stop(id).catch(() => undefined);
    }
    await this.store.flush();
  }

  private makeContext(session: LiveSession): AdapterContext {
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
    return {
      sessionId: session.record.id,
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

  private async emitEvents(session: LiveSession, emitted: EmittedEvent[]): Promise<void> {
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
  private async healWaitingApproval(session: LiveSession, afterRestart: boolean): Promise<void> {
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

  /** EPIC-P15 T15.5: once per session, after the first real answer. Fire and forget: a slow or
   * failing model never holds up the stream, and the prompt-based title stays when it fails. */
  private maybeTitleWithModel(session: LiveSession, events: readonly NormalizedEvent[]): void {
    if (!this.titleModel || session.aiTitleTried || session.record.titleSource !== "auto") return;
    const answer = events.find((e) => e.type === "assistant" && typeof (e.payload as { text?: unknown }).text === "string" && (e.payload as { text: string }).text.trim());
    const prompt = session.titlePrompt ?? session.record.title;
    if (!answer || !prompt) return;
    session.aiTitleTried = true;
    const text = (answer.payload as { text: string }).text;
    void (async () => {
      const title = await askTitleModel(this.titleModel!, prompt, text);
      if (!title || session.record.titleSource !== "auto") return; // none, or renamed meanwhile
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
  private async emitMainSyncBaseEvent(session: LiveSession, base: WorktreeBaseChoice): Promise<void> {
    if (base.source === "origin" || base.reason === "off") return;
    if (base.reason === "not-main-branch") {
      await this.emitSystem(session, "workspace.main_sync_skipped", { reason: base.reason, ...(base.detail ? { detail: base.detail } : {}) });
      return;
    }
    await this.emitSystem(session, "workspace.main_sync_failed", {
      reason: base.reason === "no-remote" ? "no-remote" : base.fetchReason,
      ...(base.detail ? { detail: base.detail } : {}),
    });
  }

  private async emitSystem(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void> {
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
  private async dropOrphanedTools(session: LiveSession): Promise<void> {
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

  private async setStatus(session: LiveSession, status: SessionStatus): Promise<void> {
    const allowed = VALID_TRANSITIONS[session.record.status] ?? [];
    if (!allowed.includes(status) && session.record.status !== status) {
      throw new Error(
        `illegal session transition ${session.record.status} → ${status} (${session.record.id})`,
      );
    }
    session.record.status = status;
    session.record.updatedAt = new Date().toISOString();
    this.persist(session.record);
    await this.store.saveSnapshot(session.record.id, this.snapshotOf(session));
    if (status === "idle") this.scheduleDrain(session.record.id);
  }

  /** EPIC-P15 T15.3: the turn ended — send the oldest queued prompt. One at a time:
   * its own turn end sends the next. */
  private scheduleDrain(sessionId: string): void {
    if (this.draining.has(sessionId) || this.queue.count(sessionId) === 0) return;
    this.draining.add(sessionId);
    setTimeout(() => {
      this.draining.delete(sessionId);
      void this.drainNext(sessionId)
        .catch((err) => this.logger.warn("queue drain failed", { sessionId, err: err instanceof Error ? err.message : String(err) }));
    }, 0);
  }

  /** Serializes queue work and workspace cleanup with session input, so a
   * prompt cannot reopen a worktree while archive or delete removes it. */
  private chainWork<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.steerQueue.get(sessionId) ?? Promise.resolve();
    const run = previous.then(
      () => work(),
      () => work(),
    );
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.steerQueue.set(sessionId, settled);
    void settled.then(() => {
      if (this.steerQueue.get(sessionId) === settled) this.steerQueue.delete(sessionId);
    });
    return run;
  }

  /** T17.4: check, take and submit run as one task inside the session's
   * steer chain. A prompt steer that came in mid-flight has fully settled
   * by then (its status flip can lag behind its own spawn), so a queued
   * entry is never sent into a turn it was never queued for — the wait
   * stays pinned to the turn that ended (occupant pinning). */
  private drainNext(sessionId: string): Promise<void> {
    return this.chainWork(sessionId, () => this.drainSlot(sessionId));
  }

  private canDrain(session: LiveSession): boolean {
    return session.record.status === "idle" ||
      (session.record.status === "working" && session.mainTurnIdle === true && !session.turnFailed &&
        this.registry.get(session.record.adapter)?.capabilities.midTurnInput === true);
  }

  private async drainSlot(sessionId: string): Promise<void> {
    const session = this.live.get(sessionId);
    if (!session || !this.canDrain(session)) return;
    // BUG-0163: Auf langsamen Maschinen kann der Working-Flip eines eben
    // abgeschlossenen Steers noch in einem parallelen Microtask nachlaufen
    // (sein Adapter-Callback feuert turn("working") knapp vor resolve).
    // Ein Macrotask-Yield + Re-Check schließt das Fenster, bevor etwas
    // Gesendetes in einen längst begonnenen Zug läuft (Occupant-Pinning).
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!this.canDrain(session)) return;
    const item = this.queue.list(sessionId)[0];
    if (!item) return;
    if (this.uncertainQueue.has(item.id)) {
      if (this.hasSeenInput(sessionId, item.id)) {
        this.queue.remove(sessionId, item.id);
        this.uncertainQueue.delete(item.id);
        this.scheduleDrain(sessionId);
      } else {
        await this.setStatus(session, "error");
        await this.emitSystem(session, "session.recovery_blocked", { detail: "Annahme einer vorgemerkten Nachricht ist unklar. Verlauf prüfen; nicht automatisch erneut senden.", queueId: item.id });
      }
      return;
    }
    await this.deliverQueued(session, item);
  }

  /** EPIC-P15 T15.3: what is waiting in this session. */
  queued(sessionId: string): QueuedPrompt[] {
    return this.queue.list(sessionId).map(item => this.uncertainQueue.has(item.id) ? { ...item, delivery: "unknown" as const } : item);
  }

  /** BUG-0114: einen vorgemerkten Prompt sofort steuern — mitten in den
   * laufenden Zug statt am Zugende. Ablehnung stellt die Vormerkung wieder
   * her (hinten, ehrlich sichtbar) — der Text geht nie verloren. */
  async sendQueuedNow(sessionId: string, queueId: string, actor?: string): Promise<Ack> {
    return this.chainWork(sessionId, async () => {
      const item = this.queue.list(sessionId).find(q => q.id === queueId);
      if (!item) return { ok: false, detail: "nicht mehr in der Warteschlange" };
      const session = this.live.get(sessionId);
      if (!session) return { ok: false, detail: "Session nicht aktiv" };
      if (this.uncertainQueue.has(queueId)) return { ok: false, detail: "Annahme unklar — zuerst den Verlauf prüfen." };
      // ADR-0085: "now" ist erlaubt, wenn der Adapter lenken kann — auch wenn er Meldungen
      // erst im naechsten Zug annimmt (Pi). Abgelehnt wird nur, was weder lenken kann noch
      // im laufenden Zug annehmen wuerde.
      const caps = this.registry.get(session.record.adapter)?.capabilities;
      if (caps?.promptDelivery === "next-turn" && caps?.midTurnInput !== true && session.record.status !== "idle")
        return { ok: false, detail: "Dieser Adapter kann während des laufenden Zugs keine weitere Nachricht annehmen. Die Nachricht bleibt vorgemerkt." };
      return this.deliverQueued(session, item, actor);
    });
  }

  private async deliverQueued(session: LiveSession, item: QueuedPrompt, actor?: string): Promise<Ack> {
    this.uncertainQueue.add(item.id);
    await this.emitSystem(session, "session.queue_submitting", { queueId: item.id });
    let ack: Ack;
    try {
      ack = await this.steerNow(session.record.id, { kind: "prompt", text: item.text, ...(item.attachments ? { attachments: item.attachments } : {}) }, actor ?? item.actor ?? undefined, { fromQueue: true, inputId: item.id });
    } catch (err) {
      ack = { ok: false, detail: STEER_TIMEOUT_DETAIL };
      await this.emitSystem(session, "session.queue_uncertain", { queueId: item.id, detail: String(err).slice(0, 500) });
    }
    if (ack.detail === STEER_TIMEOUT_DETAIL) {
      if (["working", "idle"].includes(session.record.status)) await this.setStatus(session, "error");
      await this.emitSystem(session, "session.recovery_blocked", { queueId: item.id, detail: "Nachrichtenannahme unklar — Verlauf prüfen, abbrechen oder übergeben. Kein automatisches erneutes Senden." });
    }
    if (ack.ok) this.queue.remove(session.record.id, item.id);
    if (ack.detail !== STEER_TIMEOUT_DETAIL) {
      await this.emitSystem(session, "session.queue_ack", { queueId: item.id, ok: ack.ok });
      this.uncertainQueue.delete(item.id);
    }
    await this.emitSystem(session, "session.dequeued", { queueId: item.id, ok: ack.ok, ...(ack.ok ? {} : { detail: ack.detail ?? null }) });
    return ack;
  }

  /** EPIC-P15 T15.3: drop one waiting prompt before it is sent. */
  async unqueue(sessionId: string, queueId: string, actor?: string): Promise<boolean> {
    const removed = this.queue.remove(sessionId, queueId);
    if (removed) this.uncertainQueue.delete(queueId);
    const session = this.live.get(sessionId);
    if (removed && session) await this.emitSystem(session, "session.unqueued", { queueId, actor: actor ?? null });
    return removed;
  }

  /**
   * ADR-0085: eine vorgemerkte Meldung nachtraeglich aendern — ihr Text und/oder ihre
   * Stelle in der Reihe. Solange sie noch nicht unterwegs ist, ist die Warteschlange die
   * einzige Quelle; eine Annahme mit unklarem Ausgang (uncertainQueue) ist tabu, weil der
   * Prompt dann laeuft und sein Wort bereits beim Adapter liegt.
   */
  async editQueued(sessionId: string, queueId: string, patch: { text?: string | undefined; move?: "front" | "back" | undefined }, actor?: string): Promise<Ack> {
    return this.chainWork(sessionId, async () => {
      const entry = this.queue.list(sessionId).find(q => q.id === queueId);
      if (!entry) return { ok: false, detail: "nicht mehr in der Warteschlange" };
      if (this.uncertainQueue.has(queueId)) return { ok: false, detail: "Annahme dieses Prompts ist unklar — Verlauf prüfen, nicht nachträglich ändern." };
      const text = patch.text === undefined ? undefined : patch.text.trim();
      if (text !== undefined && text === "") return { ok: false, detail: "leerer Text wird nicht vorgemerkt" };
      if (text === undefined && !patch.move) return { ok: false, detail: "nichts zu ändern" };
      if (text !== undefined && text !== entry.text) {
        if (!this.queue.updateText(sessionId, queueId, text)) return { ok: false, detail: "nicht mehr in der Warteschlange" };
      }
      if (patch.move) this.queue.moveTo(sessionId, queueId, patch.move);
      const position = this.queue.list(sessionId).findIndex(q => q.id === queueId);
      const session = this.live.get(sessionId);
      if (session) {
        if (text !== undefined && text !== entry.text) await this.emitSystem(session, "session.queue_edited", { queueId, actor: actor ?? null });
        if (patch.move) await this.emitSystem(session, "session.queue_moved", { queueId, position: position + 1, actor: actor ?? null });
      }
      return { ok: true, ...(position >= 0 ? { detail: `position ${position + 1}` } : {}) };
    });
  }

  private persist(record: SessionRecord): void {
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

  private hasSeenInput(sessionId: string, inputId: string): boolean {
    const row = this.db
      .prepare("SELECT input_id FROM session_inputs WHERE session_id = ? AND input_id = ?")
      .get(sessionId, inputId) as { input_id: string } | undefined;
    return row !== undefined;
  }

  private commitSteerMeta(session: LiveSession, meta: SteerMeta | undefined): void {
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
