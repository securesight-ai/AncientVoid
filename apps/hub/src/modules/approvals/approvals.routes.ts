import type { FastifyInstance } from "fastify";
import { extractToken } from "../../platform/auth.ts";
import { DecideApprovalInput, ApprovalStatus, actorKind, displayAnswerable, displayAnswersValid } from "@ancientvoid/contracts";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

/** Approval queue and decisions, signed or by passkey (ADR-0007, ADR-0019). */
export function registerApprovalsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, callerLabel, webauthnRoutes } = ctx;

  /** Die Fragen einer Provider-Rückfrage, wie der Agent sie gestellt hat. */
  const questionsOf = (id: string): unknown => {
    const op = deps.sessions.operation(id);
    return op?.kind === "tool.permission" ? (op.payload as { input?: { questions?: unknown } }).input?.questions : undefined;
  };

  // T2.4/T2.6 (EPIC-P2 §3 "Approval-Queue"): a hub that hasn't configured
  // an ApprovalService yet doesn't get these routes — a real 501, not a
  // silently missing feature the PWA would otherwise 404 into.
  app.get("/api/approvals", async (req, reply) => {
    if (!deps.approvals) return reply.code(501).send({ error: "approval queue not configured" });
    const q = req.query as { status?: string };
    const status = ApprovalStatus.safeParse(q.status);
    // ADR-0066: ein Display erfährt je Anfrage, ob es sie beantworten darf — damit
    // sein Companion die Policy nicht nachbaut. Andere Akteure bekommen das Feld nicht.
    const rawToken = extractToken(req);
    const caller = rawToken ? deps.tokens.identify(rawToken) : null;
    const forDisplay = caller !== null && actorKind(caller.label) === "display";
    // T7.3: what the decision released, and what became of it.
    return deps.approvals.list(status.success ? status.data : undefined).map((base) => {
      const r = forDisplay ? { ...base, displayAnswerable: displayAnswerable(base, questionsOf(base.id), caller.capabilities) } : base;
      const op = deps.sessions.operation(r.id);
      if (!op) return r;
      const operation = { state: op.state, outcome: op.outcome };
      if (op.kind !== "tool.permission") return { ...r, operation };
      // T7.2: what the provider wants to run, or what it asks.
      const { toolName, input } = op.payload as { toolName: string; input: Record<string, unknown> };
      const questions = Array.isArray(input.questions) ? input.questions : undefined;
      const shown = JSON.stringify(input);
      return {
        ...r,
        operation,
        tool: { name: toolName, input: shown.length > 2000 ? `${shown.slice(0, 1999)}…` : shown, ...(questions ? { questions } : {}) },
      };
    });
  });


  app.get("/api/approvals/:id", async (req, reply) => {
    if (!deps.approvals) return reply.code(501).send({ error: "approval queue not configured" });
    const { id } = req.params as { id: string };
    const found = deps.approvals.get(id);
    if (!found) return reply.code(404).send({ error: "unknown approval" });
    return found;
  });


  app.post("/api/approvals/:id/decide", async (req, reply) => {
    if (!deps.approvals) return reply.code(501).send({ error: "approval queue not configured" });
    const { id } = req.params as { id: string };
    const parsed = DecideApprovalInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid decision" });
    // AC-P2-5/ADR-0007: the signature proves possession of THIS caller's
    // already-verified bearer token — never the session-record's own
    // project path or anything client-supplied, so there is no way to
    // "sign" a decision without the credential authHook already required.
    const rawToken = extractToken(req);
    if (!rawToken) return reply.code(401).send({ error: "missing device token" });
    const identity = deps.tokens.identify(rawToken);
    if (!identity) return reply.code(401).send({ error: "invalid device token" });
    // T7.2: a provider question needs its answer before it can be released.
    const pendingRequest = deps.approvals.get(id);
    // ADR-0048: a display decides `write` approvals without a reason — a
    // `destructive` one (biometrics) or one that needs words stays on the phone.
    if (actorKind(identity.label) === "display") {
      const refuse = () => reply.code(403).send({ error: "Nicht am Display entscheidbar: bitte am Handy bestätigen." });
      // Policy vor Existenz: eine unbekannte ID verrät dem Display nichts.
      if (!pendingRequest || pendingRequest.class !== "write" || pendingRequest.reasonRequired) return refuse();
      if (pendingRequest.action === "tool.question") {
        // ADR-0066: nur beantworten (nie ablehnen), nur mit Fähigkeit, nur mit einer
        // Option je Frage, die der Agent wortgleich vorgegeben hat.
        const questions = questionsOf(id);
        if (parsed.data.decision !== "approve" || parsed.data.reason !== undefined) return refuse();
        // Ohne `status`: eine schon entschiedene Rückfrage soll unten als 422 „bereits
        // entschieden“ enden, nicht als Policy-Ablehnung — das Display zeigt den Unterschied.
        const { action, reasonRequired } = pendingRequest;
        if (!displayAnswerable({ action, class: pendingRequest.class, reasonRequired }, questions, identity.capabilities) || !displayAnswersValid(questions, parsed.data.answers)) return refuse();
      }
    }
    if (pendingRequest?.action === "tool.question" && parsed.data.decision === "approve") {
      const answers = parsed.data.answers ?? {};
      if (Object.keys(answers).length === 0) return reply.code(422).send({ ok: false, detail: "Antwort fehlt." });
      if (!deps.sessions.answerToolQuestion(id, answers)) return reply.code(422).send({ ok: false, detail: "Rückfrage ist nicht mehr offen." });
    }
    const result = deps.approvals.decide(id, parsed.data.decision, rawToken, identity.label, parsed.data.reason);
    if (!result.ok) return reply.code(422).send(result);
    // T2.8: every genuine decision (approved OR rejected) is recorded
    // onto the session's own tail, not just the separate approvals table
    // — a reviewer reading one session's history must see that an action
    // was requested and denied, not just its silent absence.
    await deps.sessions
      .recordApprovalDecision(result.request!.sessionId, result.request!.id, result.request!.action, result.request!.status as "approved" | "rejected", identity.label)
      .catch((err) => {
        req.log.error({ err }, "recordApprovalDecision failed after a real decision");
      });
    // T2.4/T2.7's ADR-0007 integration point: an approved write-class
    // steer or budget top-up gets actually applied now — see
    // SessionManager.applyApprovedSteer/applyApprovedBudgetTopUp's own
    // doc comments for why this is the one place either call happens.
    if (result.request!.status === "approved" && result.request!.action === "steer.prompt") {
      await deps.sessions.applyApprovedSteer(result.request!.id, identity.label).catch((err) => {
        req.log.error({ err }, "applyApprovedSteer failed after a real approval");
      });
    } else if (result.request!.status === "approved" && ["session.create", "session.stop", "session.park", "workspace.setup"].includes(result.request!.action)) {
      // T7.4: an agent's request, released by this human. EPIC-P29: auch die
      // Manifest-Freigabe — Setup läuft, dann startet der Agent (ADR-0051 §2).
      await deps.sessions.applyApproved(result.request!.id, identity.label).catch((err) => {
        req.log.error({ err }, "applyApproved failed after a real approval");
      });
    } else if (result.request!.status === "approved" && result.request!.action === "budget.increase") {
      await deps.sessions.applyApprovedBudgetTopUp(result.request!.id, identity.label).catch((err) => {
        req.log.error({ err }, "applyApprovedBudgetTopUp failed after a real approval");
      });
    } else if (result.request!.status === "approved" && result.request!.action === "knowledge.add") {
      // T74.6 (EPIC-P74): die freigegebene Wissens-Notiz — einmalig, über dieselbe
      // Service-Instanz, die den Antrag angelegt hat (RouteContext.knowledge).
      const ack = await ctx.knowledge?.applyApprovedAdd(result.request!.id).catch((err) => {
        req.log.error({ err }, "applyApprovedAdd failed after a real approval");
        return { ok: false, detail: "Ausführung gescheitert (siehe Status der Quelle)" };
      });
      if (ack && !ack.ok) req.log.warn({ detail: ack.detail }, "approved knowledge.add did not run");
    } else if (result.request!.status === "approved" && result.request!.action === "scan.run") {
      // EPIC-P80 (ADR-0118): der freigegebene Scan — einmalig, über dieselbe
      // Service-Instanz, die den Antrag angelegt hat (RouteContext.scan).
      const ack = await ctx.scan?.applyApprovedScan(result.request!.id).catch((err) => {
        req.log.error({ err }, "applyApprovedScan failed after a real approval");
        return { ok: false, detail: "Ausführung gescheitert (siehe Job-Liste)" };
      });
      if (ack && !ack.ok) req.log.warn({ detail: ack.detail }, "approved scan did not run");
    }
    return result.request;
  });


  app.post("/api/approvals/:id/webauthn/assert-options", async (req, reply) => {
    if (!webauthnRoutes) return reply.code(501).send({ error: "webauthn not configured" });
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    const result = await webauthnRoutes.assertOptions(label);
    return result.ok ? result.options : reply.code(422).send(result);
  });


  const DecideBiometricBody = z.object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().min(1).optional(),
    response: z.record(z.string(), z.unknown()),
  });

  app.post("/api/approvals/:id/webauthn/decide", async (req, reply) => {
    if (!webauthnRoutes || !deps.approvals) return reply.code(501).send({ error: "webauthn/approvals not configured" });
    const { id } = req.params as { id: string };
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    const parsed = DecideBiometricBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid biometric decision body" });
    const verified = await webauthnRoutes.assertVerify(label, parsed.data.response as never);
    if (!verified.ok) return reply.code(422).send(verified);
    const result = deps.approvals.decideBiometric(id, parsed.data.decision, verified.fingerprint, label, parsed.data.reason);
    if (!result.ok) return reply.code(422).send(result);
    // T2.8: same audit requirement as the write-class decide route above —
    // a destructive decision (approved or rejected) belongs on the
    // session's own tail too.
    await deps.sessions
      .recordApprovalDecision(result.request!.sessionId, result.request!.id, result.request!.action, result.request!.status as "approved" | "rejected", label)
      .catch((err) => {
        req.log.error({ err }, "recordApprovalDecision failed after a real biometric decision");
      });
    return result.request;
  });
}
