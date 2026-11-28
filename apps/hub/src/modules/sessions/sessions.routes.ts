import { ActivityReport, AttachmentId, LOOP_ARG, LoopSpec, SaveDraftInput, WorkspaceMode, loopAdapterId, ToolPermissionRequest, type SteerInput } from "@ancientvoid/contracts";
import type { FastifyInstance } from "fastify";
import { DraftStore, isProjectPathAllowed, ensureProjectDir, toStartSpec } from "@ancientvoid/core";
import { getSessionDiff, getSessionFileHunks } from "./diff.ts";
import { ENV_VAR_NAME } from "@ancientvoid/contracts";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

const CreateSessionBody = z.object({
  // Mit `loop` bestimmt der Loop den internen Adapter; ohne `loop` ist `adapter` Pflicht (unten geprüft).
  adapter: z.string().min(1).optional(),
  project: z.string().min(1),
  prompt: z.string().optional(),
  model: z.string().optional(),
  budgetUsd: z.number().positive().nullable().optional(),
  // ENV_VAR_NAME (@ancientvoid/contracts): rejects a malicious env KEY here,
  // early, with a clean 400 — see SessionSpec's own doc comment and
  // TmuxRunner.spawn()'s matching runtime guard (defense in depth, same
  // pattern, same regex, single source of truth).
  env: z.record(z.string().regex(ENV_VAR_NAME), z.string()).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  /** Adoption (ADR-0011): continue an externally discovered session. */
  adoptNativeSessionId: z.string().min(1).optional(),
  /** ADR-0040: continue as a copy with its own id; overview title of the adoption. */
  adoptFork: z.boolean().optional(),
  title: z.string().min(1).max(120).optional(),
  /** Read-only mirror (ADR-0011 Erweiterung): show an observed opencode
   * session's conversation without adopting or running anything. */
  mirrorNativeSessionId: z.string().min(1).optional(),
  /** T7.10: uploaded files for the first prompt. */
  attachmentIds: z.array(AttachmentId).max(20).optional(),
  /** ADR-0057: Arbeitsort; ohne Angabe eigener Worktree. `confirmDirty` bestätigt einen Start in ungesicherten Änderungen. */
  workspaceMode: WorkspaceMode.optional(),
  confirmDirty: z.boolean().optional(),
  /** ADR-0081: bestätigt paralleles Schreiben in einem Nicht-Git-Ordner. */
  confirmSharedFolder: z.boolean().optional(),
  /** EPIC-P19: Loop / Dark Factory. Ohne Angabe verhält sich der Start wie vorher. */
  loop: LoopSpec.optional(),
});

const SteerBody = z.intersection(
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("prompt"), text: z.string(), attachmentIds: z.array(AttachmentId).max(20).optional() }),
    z.object({ kind: z.literal("stop") }),
    z.object({ kind: z.literal("park") }),
    z.object({ kind: z.literal("resume") }),
    z.object({ kind: z.literal("configure"), model: z.string().min(1).max(200).optional(), permissionMode: z.string().min(1).max(60).optional() }),
  ]),
  z.object({
    inputId: z.string().min(1).optional(),
    revision: z.number().int().nonnegative().optional(),
    clientId: z.string().min(1).optional(),
    takeover: z.boolean().optional(),
    /** EPIC-P15 T15.3: hold a prompt back until the running turn ends. ADR-0085: aus-
     * druecklich `false` heisst "nicht vormerken, sondern jetzt lenken" — erlaubt bei
     * Adaptern mit steer (Pi), auch wenn sie Meldungen erst im naechsten Zug annehmen. */
    queue: z.boolean().optional(),
  }),
);

/** ADR-0085: was an einer vorgemerkten Meldung geaendert werden darf — Wortwahl und Stelle. */
const QueueEditRequest = z
  .object({
    text: z.string().min(1).max(20_000).optional(),
    move: z.enum(["front", "back"]).optional(),
  })
  .strict();

/** Session lifecycle, events, steering, diff and budget. */
export function registerSessionsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  /** T7.10: uploaded ids → what the adapter gets (waits for extraction). */
  async function resolveAttachments(ids: string[]) {
    if (!ctx.deps.attachments) throw new Error("Anhänge sind auf diesem Hub nicht eingerichtet.");
    return ctx.deps.attachments.resolve(ids);
  }
  const { deps, projectRoots, hostId, catalogRootFor, callerLabel, withAttachCmd } = ctx;

  app.get("/api/sessions", async () => Promise.all(deps.sessions.list().map((session) => withAttachCmd(session))));
  app.post("/api/sessions/:id/activity", async (req, reply) => {
    const parsed = ActivityReport.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid activity" });
    const ack = await deps.sessions.activity((req.params as { id: string }).id, parsed.data);
    return reply.code(ack.ok ? 200 : 422).send(ack);
  });


  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // A mirror session pulls its delta on read (ADR-0011 Erweiterung):
    // the PWA polls this route while the chat is open — new opencode
    // messages become events and go out over the WS immediately.
    if (deps.sessions.get(id)?.controlMode === "mirror") {
      await deps.sessions.refreshMirror(id).catch(() => undefined);
    }
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    const originIntent = await deps.sessions.sessionOrigin(session);
    return { ...(await withAttachCmd(session)), originIntent, openActivities: deps.sessions.openActivities(id) };
  });


  app.post("/api/sessions", async (req, reply) => {
    const parsed = CreateSessionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid session spec", issues: parsed.error.issues });
    }
    if (!parsed.data.adapter && !parsed.data.loop) {
      return reply.code(400).send({ error: "invalid session spec: adapter oder loop ist Pflicht" });
    }
    if (parsed.data.adapter && parsed.data.loop) {
      return reply.code(400).send({ error: "invalid session spec: entweder adapter oder loop, nicht beides" });
    }
    // T1.5-4/AC-P1.5-5: a client (a phone on the tailnet) never gets to
    // start a session outside the configured roots — ADR-0001's allowlist
    // pattern ("never trust a client-supplied path at face value").
    // Symlink escapes are resolved away, not just string-prefix-checked.
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    // BUG-0171: ein Ziel innerhalb einer erlaubten Wurzel darf noch fehlen. Vorher
    // war die Antwort "outside the configured projectRoots" — nachweislich falsch.
    // Jetzt: eine Ordner-Ebene anlegen, oder ehrlich sagen, was fehlt.
    try {
      await ensureProjectDir(parsed.data.project, projectRoots);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "Projektpfad nicht verwendbar" });
    }
    // AC-P19-8: `loops.start` ist in der Policy-Tabelle nur für Menschen erlaubt (der Hook hat den Rest schon mit 403 beendet).
    // Der Loop wird zur Session des internen Adapters `loop:<id>`; seine Auswahl steht in `args.loop`.
    let body: typeof parsed.data & { adapter: string } = { ...parsed.data, adapter: parsed.data.adapter ?? "" };
    if (parsed.data.loop) {
      try {
        ctx.loops.assertStartable(parsed.data.loop);
      } catch (err) {
        return reply.code(422).send({ error: err instanceof Error ? err.message : "loop not startable" });
      }
      const { loop, ...rest } = parsed.data;
      body = { ...rest, adapter: loopAdapterId(loop.id), args: { ...rest.args, [LOOP_ARG]: toStartSpec(loop, { project: rest.project, goal: rest.prompt }) } };
    }
    // T7.4: an agent only requests — a human starts it from the queue.
    if (req.policy?.decision === "approve") {
      const ack = await deps.sessions.requestAgentAction("session.create", null, body, req.policy.actor);
      return reply.code(ack.approvalId ? 202 : 422).send(ack);
    }
    try {
      await catalogRootFor(body.project);
      const { attachmentIds, ...spec } = body;
      const attachments = attachmentIds?.length ? await resolveAttachments(attachmentIds) : undefined;
      const record = await deps.sessions.create({ ...spec, ...(attachments ? { attachments } : {}) }, callerLabel(req) ?? undefined);
      return reply.code(201).send({ ...record, hostId });
    } catch (err) {
      return reply.code(422).send({
        error: err instanceof Error ? err.message : "session creation failed",
      });
    }
  });


  // ADR-0057: Arbeitsort vor dem Start prüfen (read-only) — Pfad nur innerhalb der projectRoots.
  app.get("/api/workspace/preview", async (req, reply) => {
    const { project } = req.query as { project?: string };
    if (!project) return reply.code(400).send({ error: "project fehlt" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    try {
      return await deps.sessions.workplacePreview(project);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "Projekt nicht lesbar" });
    }
  });

  app.get("/api/sessions/:id/workplace", async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = await deps.sessions.workplaceStatus(id);
    return status ?? reply.code(404).send({ error: "unknown session" });
  });

  app.get("/api/sessions/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { afterSeq?: string; limit?: string };
    const afterSeq = Number(q.afterSeq ?? 0);
    const limit = Math.min(Number(q.limit ?? 500), 2000);
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return deps.sessions.tail(id, Number.isFinite(afterSeq) ? afterSeq : 0, limit);
  });

  /** ADR-0084: Token-Bilanz — „erzeugt“ und „verarbeitet“ getrennt, abgeleitet aus
   * dem EventStore. lastSeq ist nur der Cache-Schlüssel des Clients, keine Wahrheit. */
  app.get("/api/sessions/:id/tokens", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = deps.sessions.get(id);
    if (!record) return reply.code(404).send({ error: "unknown session" });
    return { ...(await deps.sessions.tokenTotals(id)), lastSeq: record.lastSeq };
  });


  app.get("/api/sessions/:id/diff", async (req, reply) => {
    // T1.6-4/T1.6-5: session.project already passed the containment check
    // at session-creation time — no client-supplied path here, so no
    // second isProjectPathAllowed() call is needed (unlike /api/skills or
    // /api/prompt-enhance, which take project fresh from the request body).
    // T2.2: diff the session's real live workdir (the T2.1 worktree when
    // isolation succeeded) against its real base_sha, not always the raw
    // project path against HEAD.
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    const workdir = deps.sessions.workdirOf(id) ?? session.project;
    // ADR-0057: bei direktem Arbeitsort ist die Start-HEAD die Basis, bestehende Dirty-Pfade werden gekennzeichnet.
    const baseline = session.workspaceBaseline;
    const diff = await getSessionDiff(workdir, session.worktreeSha ?? baseline?.head ?? null);
    return baseline
      ? { ...diff, baseline: { dirtyAtStart: baseline.dirty, dirtyTruncated: baseline.dirtyTruncated, headAtStart: baseline.head, branchAtStart: baseline.branch } }
      : diff;
  });


  app.get("/api/sessions/:id/diff/hunk", async (req, reply) => {
    // T2.2 expand-on-tap: re-fetch one file's hunks in full after the main
    // /diff response collapsed them under K3. Same trust boundary as
    // /diff above (session.project/workdir are already vetted; `path` is
    // only ever passed to `execFile` with an argument array, never a
    // shell, so it cannot inject a command — it can only ask git about a
    // path that doesn't exist, which git reports as an empty result).
    // AC-P2-1: `commit` expandiert einen Hunk aus einem Commit-Abschnitt
    // gegen genau diesen Commit. Nur Format-Prüfung, keine
    // Bereichs-Mitgliedschaft: Der Token-Inhaber darf den gesamten
    // Worktree des Projekts ohnehin über /api/code/file lesen — ein
    // beliebiges sha^..sha im selben Repo legt nichts offen, was dieser
    // Pficht nicht schon freigibt (BUG-0013-Lektion: nie interpolieren,
    // hier reine Argument-Übergabe an execFile).
    const { id } = req.params as { id: string };
    const q = req.query as { path?: string; commit?: string };
    if (!q.path || q.path.includes("..")) return reply.code(400).send({ error: "invalid path" });
    if (q.commit !== undefined && !/^[0-9a-f]{6,40}$/.test(q.commit)) {
      return reply.code(422).send({ error: "commit muss ein SHA (6–40 Hex-Zeichen) sein" });
    }
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    const workdir = deps.sessions.workdirOf(id) ?? session.project;
    const hunks = await getSessionFileHunks(workdir, q.path, session.worktreeSha, q.commit);
    return { path: q.path, hunks };
  });


  app.get("/api/sessions/:id/blobs/:hash", async (req, reply) => {
    const { id, hash } = req.params as { id: string; hash: string };
    if (!/^[a-f0-9]{64}$/.test(hash)) return reply.code(400).send({ error: "invalid hash" });
    try {
      const buf = await deps.sessions.readBlob(id, hash);
      return reply.type("application/octet-stream").send(buf);
    } catch {
      return reply.code(404).send({ error: "unknown blob" });
    }
  });


  // T7.2 / ADR-0018 §3: a provider asks before a tool runs (called by the
  // permission bridge with its session-bound token). Answer by polling:
  // survives a hub restart, and no HTTP request is held for minutes.
  app.post("/api/sessions/:id/tool-permissions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ToolPermissionRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid tool permission request" });
    const res = await deps.sessions.requestToolPermission(id, parsed.data);
    return res.ok ? reply.code(201).send({ id: res.id }) : reply.code(422).send({ error: res.detail });
  });

  app.get("/api/sessions/:id/tool-permissions/:pid", async (req, reply) => {
    const { id, pid } = req.params as { id: string; pid: string };
    const waitMs = Math.min(Math.max(Number((req.query as { waitMs?: string }).waitMs ?? 0) || 0, 0), 25_000);
    const deadline = Date.now() + waitMs;
    for (;;) {
      const poll = await deps.sessions.pollToolPermission(id, pid);
      if (!poll) return reply.code(404).send({ error: "unknown tool permission request" });
      if (poll.state === "answered" || Date.now() >= deadline) return poll;
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  app.post("/api/sessions/:id/steer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SteerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid steer input" });
    }
    const { inputId, revision, clientId, takeover, queue, ...raw } = parsed.data;
    let input: SteerInput;
    if (raw.kind === "prompt") {
      const { attachmentIds, ...prompt } = raw;
      if (!prompt.text.trim() && !attachmentIds?.length) return reply.code(400).send({ error: "invalid steer input" });
      try {
        input = attachmentIds?.length ? { ...prompt, attachments: await resolveAttachments(attachmentIds) } : prompt;
      } catch (err) {
        return reply.code(422).send({ ok: false, detail: err instanceof Error ? err.message : "Anhang fehlt" });
      }
    } else if (raw.kind === "configure") {
      input = { kind: "configure", ...(raw.model !== undefined ? { model: raw.model } : {}), ...(raw.permissionMode !== undefined ? { permissionMode: raw.permissionMode } : {}) };
    } else input = raw;
    if (req.policy?.decision === "approve") {
      if (!deps.sessions.get(id)) return reply.code(404).send({ ok: false, detail: "unknown session" });
      const ack =
        input.kind === "prompt"
          ? await deps.sessions.requestAgentAction("steer.prompt", id, { input, typed: input.text }, req.policy.actor)
          : input.kind === "park" || input.kind === "stop"
            ? await deps.sessions.requestAgentAction(input.kind === "park" ? "session.park" : "session.stop", id, {}, req.policy.actor)
            : { ok: false, detail: "Agenten können eine Session nur mit einem Prompt fortsetzen." };
      return reply.code("approvalId" in ack && ack.approvalId ? 202 : 422).send(ack);
    }
    const ack = await deps.sessions.steer(id, input, callerLabel(req) ?? undefined, {
      ...(inputId !== undefined ? { inputId } : {}),
      ...(revision !== undefined ? { revision } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
      ...(takeover ? { takeover } : {}),
      // ADR-0085: `false` ist eine Aussage ("nicht vormerken, jetzt lenken") — sie darf nicht
      // wie "nicht angegeben" verschwinden.
      ...(queue !== undefined ? { queue } : {}),
    });
    return ack.ok ? ack : reply.code(422).send(ack);
  });

  /**
   * EPIC-P15 T15.4: is this session open in a terminal at the PC? The interactive
   * Claude Code does not re-read its transcript, so what the phone sends shows there
   * only after reopening — the app says so instead of leaving the PC looking stale.
   */
  app.get("/api/sessions/:id/pc", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = deps.sessions.get(id);
    if (!record) return reply.code(404).send({ error: "unknown session" });
    if (!record.nativeSessionId || !deps.claudeLive) return { open: false };
    const live = await deps.claudeLive.find(record.nativeSessionId);
    if (!live) return { open: false };
    return { open: true, kind: live.kind, name: live.name, state: live.state, nativeSessionId: record.nativeSessionId };
  });

  /** EPIC-P15 T15.3: prompts waiting for the running turn. */
  app.get("/api/sessions/:id/queue", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return deps.sessions.queued(id).map(({ id: queueId, text, createdAt, actor, attachments, delivery, position }) => ({ id: queueId, text, createdAt, actor, position, attachments: attachments?.length ?? 0, ...(delivery ? { delivery } : {}) }));
  });

  app.delete("/api/sessions/:id/queue/:queueId", async (req, reply) => {
    const { id, queueId } = req.params as { id: string; queueId: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return (await deps.sessions.unqueue(id, queueId, callerLabel(req) ?? undefined))
      ? { ok: true }
      : reply.code(404).send({ ok: false, detail: "nicht mehr in der Warteschlange" });
  });

  /** BUG-0114: einen vorgemerkten Prompt sofort steuern — in die laufende Unterhaltung. */
  app.post("/api/sessions/:id/queue/:queueId/send", async (req, reply) => {
    const { id, queueId } = req.params as { id: string; queueId: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const ack = await deps.sessions.sendQueuedNow(id, queueId, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });

  /** ADR-0085: eine vorgemerkte Meldung nachtraeglich aendern — Text und/oder Stelle. */
  app.patch("/api/sessions/:id/queue/:queueId", async (req, reply) => {
    const { id, queueId } = req.params as { id: string; queueId: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const parsed = QueueEditRequest.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(422).send({ ok: false, detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    if (parsed.data.text === undefined && !parsed.data.move) return reply.code(422).send({ ok: false, detail: "weder Text noch Stelle angegeben" });
    const ack = await deps.sessions.editQueued(id, queueId, parsed.data, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });


  // "Ins Projekt übernehmen": commit the session worktree and merge it
  // into the project checkout. 409 with a reason the user can act on.
  app.post("/api/sessions/:id/apply", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ ok: false, detail: "unknown session" });
    const result = await deps.sessions.applyToProject(id, callerLabel(req) ?? undefined);
    return result.ok ? result : reply.code(409).send(result);
  });


  app.post("/api/sessions/:id/resume", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ ok: false, detail: "unknown session" });
    const ack = await deps.sessions.resume(id, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });

  /** BUG-0126 (ADR-0070): repair a session whose native binding went stale —
   * drop the binding, rebuild the agent context from the hub tail. */
  app.post("/api/sessions/:id/repair", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ ok: false, detail: "unknown session" });
    // An agent never rewrites its own binding silently — that is a person's call.
    if (req.policy?.decision === "approve") return reply.code(403).send({ error: "Reparieren braucht einen Menschen, nicht einen Agenten" });
    const ack = await deps.sessions.repair(id, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });

  app.post("/api/sessions/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.policy?.decision === "approve") {
      if (!deps.sessions.get(id)) return reply.code(404).send({ ok: false, detail: "unknown session" });
      const pending = await deps.sessions.requestAgentAction("session.stop", id, {}, req.policy.actor);
      return reply.code(pending.approvalId ? 202 : 422).send(pending);
    }
    const ack = await deps.sessions.stop(id, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });


  app.post("/api/sessions/:id/archive", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ archived: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "archived boolean required" });
    try {
      return { ...(await deps.sessions.archive(id, body.data.archived, callerLabel(req) ?? undefined)), hostId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "archive failed";
      if (message.startsWith("unknown session")) return reply.code(404).send({ error: message });
      throw err;
    }
  });

  // Delete for good — events, worktree, row. The PWA asks before calling.
  app.delete("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ack = await deps.sessions.delete(id, callerLabel(req) ?? undefined);
    if (!ack.ok) return reply.code(409).send({ error: ack.detail ?? "delete refused" });
    return reply.code(204).send();
  });


  // T8.4 (ADR-0025): the shared, revisioned draft of a session.
  const drafts = new DraftStore(deps.tokens.database);
  app.get("/api/sessions/:id/draft", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return drafts.get(id);
  });
  app.put("/api/sessions/:id/draft", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const body = SaveDraftInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "text, attachmentIds, baseRevision required" });
    const result = drafts.save(id, body.data, callerLabel(req));
    return result.ok ? result.draft : reply.code(409).send({ error: "Ein anderes Gerät hat den Entwurf inzwischen geändert.", current: result.conflict });
  });

  // T8.6: rename and pin — overview metadata, same class as archive.
  app.post("/api/sessions/:id/meta", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ title: z.string().max(200).nullable().optional(), pinned: z.boolean().optional(), autoResumeOnLimit: z.boolean().optional() }).strict().safeParse(req.body);
    if (!body.success || (body.data.title === undefined && body.data.pinned === undefined && body.data.autoResumeOnLimit === undefined)) return reply.code(400).send({ error: "title, pinned or autoResumeOnLimit required" });
    try {
      // ADR-0076 Nachtrag: die Limit-Wiederaufnahme ist eine Verhaltens-
      // entscheidung — der Manager lehnt Agenten-Akteure ab (403-artig).
      if (body.data.autoResumeOnLimit !== undefined) {
        const record = await deps.sessions.setAutoResumeOnLimit(id, body.data.autoResumeOnLimit, callerLabel(req) ?? undefined);
        return { ...record, hostId };
      }
      return { ...await deps.sessions.setMeta(id, { ...(body.data.title !== undefined ? { title: body.data.title } : {}), ...(body.data.pinned !== undefined ? { pinned: body.data.pinned } : {}) }), hostId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "update failed";
      if (message.startsWith("unknown session")) return reply.code(404).send({ error: message });
      if (message.startsWith("Nur Menschen")) return reply.code(403).send({ error: message });
      throw err;
    }
  });
  app.post<{ Params: { id: string } }>("/api/sessions/:id/focus", async (req, reply) => {
    const { id } = req.params;
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    try {
      return { ...await deps.sessions.suggestFocus(id, callerLabel(req) ?? undefined), hostId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "focus update failed";
      return reply.code(message.startsWith("Nur Menschen") ? 403 : 422).send({ error: message });
    }
  });


  app.post("/api/sessions/:id/budget", async (req, reply) => {
    // T2.7 (EPIC-P2 §3 "Budget-Top-up (write-Klasse)"). Same shape as
    // /steer: 422 (not 200) when it's parked pending approval, since
    // ack.ok is false in that case too — the client already knows how to
    // handle that from the steer route.
    const { id } = req.params as { id: string };
    const body = z.object({ budgetUsd: z.number().positive(), reason: z.string().min(1).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid budget" });
    if (req.policy?.decision === "approve") {
      const pending = await deps.sessions.requestAgentAction("budget.increase", id, { newBudgetUsd: body.data.budgetUsd, reason: body.data.reason ?? null }, req.policy.actor);
      return reply.code(pending.approvalId ? 202 : 422).send(pending);
    }
    const ack = await deps.sessions.requestBudgetTopUp(id, body.data.budgetUsd, body.data.reason, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });
}
