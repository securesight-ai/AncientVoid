import { existsSync } from "node:fs";
import type { PromptAttachment, Adapter, SessionRecord, SteerInput, Ack } from "@ancientvoid/contracts";
import { isCompactionCommand, actorKind, classifyProviderError, promptWithAttachments, providerErrorEvent } from "@ancientvoid/contracts";
import { foldWorkspaceState, gateManifest, resolveManifest } from "../workspace/index.ts";
import { refuseSteer } from "../harness/index.ts";
import { resolveSkillChain, withSkillChain } from "../skills/index.ts";
import { type QueuedPrompt } from "./session-queue.ts";
import { type SteerMeta, type LiveSession, sessionTitle, skillNameFromEvents, nativeIdFromEvents, nativeIdFromWorkerLog, foldActivities } from "./session-state.ts";
import { SessionManagerWorkspace } from "./session-manager-workspace.ts";

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

/** Session lifecycle manager (K7): recover, resume, steer, stop and drain prompts. */
export class SessionManager extends SessionManagerWorkspace {

  /** BUG-0018: a stopped session enters `live` only once someone opens it
   * (tail subscription or steer), never at recovery. The shell is cheap:
   * skill and provider id are read from the log only when the run
   * actually continues (continueStopped). */
  protected openStopped(sessionId: string): LiveSession | undefined {
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
    if (!session.skillName || isCompactionCommand(text)) return text;
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
  protected async continueStopped(
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

  protected automaticResume(session: LiveSession): Promise<Ack> {
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
    const compact = input.kind === "prompt" && isCompactionCommand(input.text);
    if (compact) {
      const command = caps?.commands?.find((entry) => entry.name === "/compact");
      if (!command || command.scope === "start") return { ok: false, detail: `${session.record.adapter}: /compact wird nicht unterstützt` };
      if (input.attachments?.length) return { ok: false, detail: "/compact nimmt keine Anhänge an" };
      if (command.scope === "steer" && (!session.handle || ["stopped", "parked"].includes(session.record.status))) {
        return { ok: false, detail: "/compact erfordert eine laufende Session" };
      }
    }
    const nextTurn = compact || caps?.promptDelivery === "next-turn";
    // ADR-0085: "jetzt nicht vormerken" ist eine ausdrueckliche Wahl des Nutzers. Sie ist
    // nur dort erlaubt, wo der Adapter Eingaben mitten im laufenden Zug zusichert.
    const wantsNow = !compact && meta?.queue === false && caps?.midTurnInput === true;
    // BUG-0272 (ADR-0116): auch ein belegter Einzelslot-Endpoint vormerken — die
    // Meldung wartet im Hub, statt dass zwei Sitzungen sich im KV verdrängen.
    const endpointBelegt = input.kind === "prompt" && !wantsNow && !meta?.fromQueue && this.inferenzVoll(session);
    if (
      input.kind === "prompt" && !wantsNow && (meta?.queue || nextTurn || endpointBelegt) &&
      !meta?.fromQueue && session.handle &&
      (["starting", "working", "waiting_approval"].includes(session.record.status) || endpointBelegt)
    ) {
      const item = this.queue.add(sessionId, input.text, input.attachments, actor ?? null);
      await this.emitSystem(session, "session.queued", { queueId: item.id, position: this.queue.count(sessionId), actor: actor ?? null });
      if (endpointBelegt) {
        // Der Grund steht in der Akte: Wartende sehen "Modell besetzt", nicht "nichts passiert".
        await this.emitSystem(session, "inference.slot_wait", {
          endpoint: this.inferenzEndpoint(session),
          inhaber: session.record.id,
          grund: "modell_besetzt",
        });
      }
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
      this.reserviereInferenz(session);
      const reopened = await this.submitAndWait(
        session,
        meta,
        foreignWriter,
        actor,
        "prompt",
        () => this.continueStopped(session, delivered, actor),
      );
      if (!reopened.ok) this.gebeInferenzFrei(session);
      if (reopened.ok) await this.commitSteer(session, meta, foreignWriter, actor);
      return reopened;
    }
    if (delivered.kind === "prompt") {
      const occupied = this.claimDirectCheckout(session);
      if (occupied) return { ok: false, detail: occupied };
      await this.ensureWorkdir(session);
    }
    if (delivered.kind === "prompt") this.reserviereInferenz(session);
    const ack = await this.submitAndWait(
      session,
      meta,
      foreignWriter,
      actor,
      input.kind,
      () => session.adapter.steer(session.handle!, delivered, this.makeContext(session)),
    );
    if (!ack.ok && delivered.kind === "prompt") this.gebeInferenzFrei(session);
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
  protected async emitPrompt(session: LiveSession, text: string, actor?: string, attachments?: readonly PromptAttachment[]): Promise<void> {
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
  protected withAttachments<T extends { text: string; attachments?: PromptAttachment[] | undefined }>(session: LiveSession, input: T): T {
    if (!input.attachments || input.attachments.length === 0) return input;
    const f = this.registry.get(session.record.adapter)?.capabilities.features;
    if (f?.images || f?.files) return input;
    const { attachments, ...rest } = input;
    return { ...rest, text: promptWithAttachments(input.text, attachments) } as T;
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

  async park(sessionId: string, actor?: string): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    await this.parkFor(session, "manual", actor);
    return { ok: true };
  }

  /** T2.7/ADR-0008: the one place any kind of park actually happens —
   * records WHY, so a later budget top-up knows whether it's the right
   * reason to auto-resume (see applyBudgetTopUp). */
  protected async parkFor(session: LiveSession, reason: SessionRecord["parkReason"], actor?: string): Promise<void> {
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

  /** EPIC-P15 T15.3: the turn ended — send the oldest queued prompt. One at a time:
   * its own turn end sends the next. */
  protected scheduleDrain(sessionId: string): void {
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
  protected chainWork<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
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

  /** BUG-0272 (ADR-0116): welches Modell diese Session nutzt — der Endpoint, dessen
   * Pforte gilt. Ohne Pforten-Eintrag (Cloud) ist der Endpoint ungedeckelt. */
  protected inferenzEndpoint(session: LiveSession): string | null {
    const ausKonfig = this.registry.get(session.record.adapter)?.config?.["model"];
    const modell = session.record.model ?? (typeof ausKonfig === "string" ? ausKonfig : null);
    return modell ?? null;
  }

  /** Ist der Modell-Endpoint dieser Session gerade belegt (oder ihr Lease weg)? */
  private inferenzVoll(session: LiveSession): boolean {
    const endpoint = this.inferenzEndpoint(session);
    if (!endpoint || !this.pforte) return false;
    return !this.pforte.frei(endpoint, session.record.id);
  }

  /** Zug begins: hold the endpoint for the whole turn, not just the steer call. */
  private reserviereInferenz(session: LiveSession): void {
    const endpoint = this.inferenzEndpoint(session);
    if (!endpoint || !this.pforte) return;
    this.pforte.reservieren({
      endpoint,
      inhaber: session.record.id,
      priorität: "interaktiv",
      warum: "Zug",
      promptToken: null,
      maxToken: null,
    });
  }

  /** Turn ends (any direction): give the endpoint back, keep the KV lease. */
  protected gebeInferenzFrei(session: LiveSession): void {
    const endpoint = this.inferenzEndpoint(session);
    if (!endpoint || !this.pforte) return;
    this.pforte.freigeben(endpoint, session.record.id);
  }

  protected canDrain(session: LiveSession): boolean {
    // BUG-0272: ein gedeckelter Endpoint, der gerade einer anderen Sitzung gehört,
    // ist für diese Session geschlossen — die Meldung bleibt in der Warteschlange
    // und kommt, sobald der Weckruf der Pforte diese Session weckt.
    if (this.inferenzVoll(session)) return false;
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
        return { ok: false, detail: "Dieser Adapter kann während des laufenden Zugs keine weitere Nachricht annehmen (Pi lenkt erst im nächsten Zug — ein zweiter Lauf auf derselben Sitzung überschreibt die Dateien). Die Nachricht bleibt vorgemerkt und geht automatisch raus, wenn der Zug fertig ist." };
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
    if (ack.ok) {
      this.queue.remove(session.record.id, item.id);
      if (isCompactionCommand(item.text) && this.canDrain(session)) this.scheduleDrain(session.record.id);
    }
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
}
