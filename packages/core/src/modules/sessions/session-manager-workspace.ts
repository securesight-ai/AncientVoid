import { join, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import type { Adapter, SessionRecord, SessionSpec, Ack, PendingOperation, WorkspaceManifest, WorkspaceServiceStatus, WorkspaceSetupApproval, WorkspaceStatus, MainSyncSettings, MainSyncApplyResult, MainSyncCheckResult } from "@ancientvoid/contracts";
import { isCompactionCommand, actorKind, emptyMetricCounters, metricsState, DEFAULT_HOST_ID, MAIN_SYNC_DEFAULTS, RESUME_SCHEMA_VERSION, SessionSpec as SessionSpecSchema, isLoopAdapter } from "@ancientvoid/contracts";
import type { WorktreeBaseChoice } from "../workspace/index.ts";
import { MainSyncEngine, resolveMainBranch, fetchMainBranch, classifyFetchError, originRemoteUrl } from "../workspace/index.ts";
import type { MainSyncCandidate } from "../workspace/index.ts";
import { canonicalCheckout, checkoutState, foldWorkspaceState, gateManifest, resolveManifest } from "../workspace/index.ts";
import { refuseSpec } from "../harness/index.ts";
import { buildSessionSummary } from "../reporting/index.ts";
import { resolveSkillChain, withSkillChain } from "../skills/index.ts";
import { type LiveSession, sessionTitle, activityOf, readSkillName, limitFailureInEvents, limitWindow } from "./session-state.ts";
import { readOpenCodeMirrorDelta } from "../discovery/index.ts";
import { SessionManagerRuntime } from "./session-manager-runtime.ts";

/** 2026-10-26: a registration's `config.model` (the same field
 * /api/adapters/:id/models reports as defaultModel). */
function defaultModelOf(registered: { config?: Readonly<Record<string, unknown>> }): string | null {
  const model = registered.config?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}

/** Creation, workspace setup, mirror management and archival. */
export abstract class SessionManagerWorkspace extends SessionManagerRuntime {
  protected abstract chainWork<T>(sessionId: string, work: () => Promise<T>): Promise<T>;


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
  protected async teardownWorkspaceOnce(sessionId: string, actor?: string): Promise<"none" | "ok" | "failed"> {
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
    if (requested.prompt && isCompactionCommand(requested.prompt)) {
      if (!registered.capabilities.commands?.some((command) => command.name === "/compact" && command.scope !== "steer")) {
        throw new Error(`${requested.adapter}: /compact ist beim Sessionstart nicht verfügbar`);
      }
      if (requested.attachments?.length) throw new Error("/compact nimmt keine Anhänge an");
    }
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
        const hubInjects = registered.capabilities.nativeSkills !== true && !(parsed.prompt && isCompactionCommand(parsed.prompt));
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
  protected claimDirectCheckout(session: LiveSession): string | null {
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
  protected async runWorkspaceSetup(
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
  protected async failWorkspace(
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
  protected workspaceBlocked(session: LiveSession): string | null {
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
    // BUG-0260: „kein Haupt-Fern“ ist eine benannte Lage, kein Fehler. Stufe 1
    // (worktree.ts) behandelt sie schon so — hier durfte die Sessions-Akte
    // trotzdem mit `main_sync_failed` vollgemuellert werden, weil der Fetch
    // unbedingt versucht wurde.
    if ((await originRemoteUrl(session.record.project)) === null) {
      throw new Error(`Main-Sync nicht moeglich: Projekt ${session.record.project} hat kein Haupt-Fern 'origin'`);
    }
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
   * nur auf wartender Session mit sauberem Worktree. Default bricht bei
   * Konflikt sofort ab (Worktree unverändert, AC-P67-7); `favor-session`
   * löst Konflikt-Hunks automatisch gunsten des Session-Branchs und nennt
   * die Dateien (ADR-0102). Ergebnis als Event im Verlauf; der nächste Zug
   * sieht den neuen Stand (kein Prompt-Eingriff).
   */
  async mainSyncApply(sessionId: string, opts: { skipFetch?: boolean; conflictStrategy?: "abort" | "favor-session" } = {}): Promise<MainSyncApplyResult> {
    const targets = this.mainSyncTargets(sessionId);
    if ("error" in targets) throw new Error(targets.error);
    const { session } = targets;
    if (!this.mainSyncSessionWaiting(session)) {
      const skipped = { outcome: "skipped" as const, reason: "session-busy", detail: `Session ist ${session.record.status} — Merge nur auf wartender Session (AC-P67-6)` };
      await this.emitSystem(session, "workspace.main_sync_skipped", { reason: skipped.reason, detail: skipped.detail });
      return skipped;
    }
    const settings = await this.mainSyncSettingsFor(session.record.project);
    // BUG-0260: ohne Haupt-Fern gibt es nichts anzuwenden — gleicher Grund wie im
    // Check, damit die Route nicht auf 502 faellt und die Akte fuellt.
    if ((await originRemoteUrl(session.record.project)) === null) {
      throw new Error(`Main-Sync nicht moeglich: Projekt ${session.record.project} hat kein Haupt-Fern 'origin'`);
    }
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
      result = (await engine.apply(session.workdir, branch, ...(opts.conflictStrategy ? [{ conflictStrategy: opts.conflictStrategy }] : []))) as MainSyncApplyResult;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      result = { outcome: "failed", reason: "unknown", detail: detail.slice(0, 500) };
    }
    if (result.outcome === "applied") {
      await this.emitSystem(session, "workspace.main_sync_applied", { from: result.from, to: result.to, files: result.files, ...(result.autoResolved && result.autoResolved.length > 0 ? { autoResolved: result.autoResolved } : {}) });
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
    // SQL table names must come from this fixed allowlist. Bind the session id separately.
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
  protected dispatchDigest(session: LiveSession): void {
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
}
