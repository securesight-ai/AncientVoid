import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CommandContext, TRANSFORMS, type CommandPlan, type PlanStep, type StepResult } from "@ancientvoid/contracts";
import { hintergrundAnfrage, parseCommand, planCommand, resolveIntent, type Intent, type PlannerModelConfig, type ResolveData } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/**
 * T9.2/T9.3 (ADR-0027): text in, a plan out; a plan is executed through
 * the hub's own routes with the caller's token — the same validation,
 * policy and idempotency as a tap. No second execution engine.
 */
export interface CommandDeps {
  /** Local model for plans the rules do not know, and for text edits. */
  model?: PlannerModelConfig;
}

const PLAN_TTL_MS = 10 * 60_000;

interface StoredPlan {
  plan: CommandPlan;
  device: string | null;
  results: StepResult[] | null;
}

const TRANSFORM_PROMPT: Record<(typeof TRANSFORMS)[number], string> = {
  correct: "Korrigiere Rechtschreibung, Grammatik und Tippfehler. Ändere nichts am Inhalt oder Ton.",
  shorten: "Kürze den Text deutlich, ohne Inhalt zu verlieren. Gleiche Sprache.",
  translate_en: "Translate the text to English. Keep code, names and formatting.",
  translate_de: "Übersetze den Text ins Deutsche. Code, Namen und Formatierung bleiben.",
  improve: "Formuliere den Text klarer und präziser als Auftrag an einen Coding-Agenten. Gleiche Sprache, kein neuer Inhalt.",
};

export function registerCommandRoutes(app: FastifyInstance, ctx: RouteContext, deps: CommandDeps = {}): void {
  const { callerLabel, hostId: selfHost } = ctx;
  const plans = new Map<string, StoredPlan>();

  const call = async <T>(req: FastifyRequest, method: "GET" | "POST", url: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await app.inject({ method, url, headers: { authorization: String(req.headers.authorization ?? ""), "content-type": "application/json" }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
    let parsed: unknown;
    try {
      parsed = res.json();
    } catch {
      parsed = null;
    }
    return { status: res.statusCode, body: parsed as T };
  };
  const on = (host: string, path: string) => (host === selfHost ? path : `/api/hosts/${encodeURIComponent(host)}${path}`);

  /** Names, states and IDs across the fleet — the caller's own view. */
  async function gather(req: FastifyRequest): Promise<ResolveData> {
    const fleet = await call<{ hosts?: { hostId: string; state: string }[]; sessions?: (Record<string, unknown> & { id: string })[] }>(req, "GET", "/api/fleet");
    const hosts = (fleet.body?.hosts ?? [{ hostId: selfHost, state: "reachable" }]).filter((h) => h.state === "reachable" || h.hostId === selfHost).map((h) => h.hostId);
    const sessions = (fleet.body?.sessions ?? []).map((s) => ({
      id: s.id,
      hostId: String(s.hostId ?? selfHost),
      title: (s.title as string | null) ?? null,
      project: String(s.project ?? ""),
      adapter: String(s.adapter ?? ""),
      status: String(s.status ?? ""),
      inputRevision: Number(s.inputRevision ?? 0),
      archived: s.archived === true,
    }));
    const per = await Promise.all(
      hosts.map(async (h) => {
        const [p, a] = await Promise.all([call<{ projects?: { path: string }[] }>(req, "GET", on(h, "/api/projects")), call<{ id: string }[]>(req, "GET", on(h, "/api/adapters"))]);
        return { projects: (p.body?.projects ?? []).map((x) => ({ hostId: h, path: x.path })), adapters: (Array.isArray(a.body) ? a.body : []).map((x) => ({ hostId: h, id: x.id })) };
      }),
    );
    return { selfHost, sessions, projects: per.flatMap((x) => x.projects), adapters: per.flatMap((x) => x.adapters) };
  }

  app.post("/api/commands/plan", async (req, reply) => {
    const body = z
      .object({ text: z.string().max(4000), context: CommandContext, answers: z.record(z.string(), z.string().max(500)).optional(), planId: z.string().optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "text and context required" });
    // A follow-up answer re-plans the same text with the choice filled in.
    const data = await gather(req);
    let intent: Intent | undefined;
    const parsed = parseCommand(body.data.text);
    if (parsed.kind === "intent" && parsed.intent.op === "action.run") {
      // Actions depend on the session: resolve it first, then list its actions.
      const first = resolveIntent({ op: "session.open", slots: parsed.intent.slots }, body.data.context, data, body.data.answers);
      const step = first.steps[0];
      if (step) {
        const acts = await call<{ actions?: { id: string; label: string; kind: string }[] }>(req, "GET", on(String(step.args.hostId), `/api/sessions/${String(step.args.sessionId)}/actions`));
        data.actions = acts.body?.actions ?? [];
      }
      intent = parsed.intent;
    }
    const planned = await planCommand(body.data.text, body.data.context, data, { model: deps.model, ...(body.data.answers ? { answers: body.data.answers } : {}), ...(intent ? { intent } : {}) });
    const plan: CommandPlan = { ...planned, id: randomUUID(), createdAt: new Date().toISOString() };
    plans.set(plan.id, { plan, device: callerLabel(req), results: null });
    for (const [id, p] of plans) if (Date.now() - Date.parse(p.plan.createdAt) > PLAN_TTL_MS) plans.delete(id);
    return plan;
  });

  /** Where a hub step goes — the same route a tap uses. */
  function route(step: PlanStep, planId: string, index: number): { url: string; body: unknown } | null {
    const a = step.args;
    const host = String(a.hostId ?? selfHost);
    const sid = String(a.sessionId ?? "");
    switch (step.op) {
      case "session.create":
        return { url: on(host, "/api/sessions"), body: { adapter: a.adapter, project: a.project, ...(a.text ? { prompt: a.text } : {}) } };
      case "session.prompt":
        // inputId = plan step: a retried execution never sends twice (K7).
        return { url: on(host, `/api/sessions/${sid}/steer`), body: { kind: "prompt", text: a.text, inputId: `plan-${planId}-${index}`, revision: a.revision } };
      case "session.stop":
        return { url: on(host, `/api/sessions/${sid}/stop`), body: {} };
      case "session.park":
        return { url: on(host, `/api/sessions/${sid}/steer`), body: { kind: "park" } };
      case "session.archive":
        return { url: on(host, `/api/sessions/${sid}/archive`), body: { archived: a.on !== false } };
      case "session.pin":
        return { url: on(host, `/api/sessions/${sid}/meta`), body: { pinned: a.on !== false } };
      case "session.rename":
        return { url: on(host, `/api/sessions/${sid}/meta`), body: { title: a.text } };
      case "session.budget":
        return { url: on(host, `/api/sessions/${sid}/budget`), body: { budgetUsd: a.amount, reason: "per Textauftrag" } };
      case "session.apply":
        return { url: on(host, `/api/sessions/${sid}/apply`), body: {} };
      case "media.analyze":
        return { url: on(selfHost, "/api/media/jobs"), body: { url: a.text } };
      case "action.run":
        return { url: on(host, `/api/sessions/${sid}/actions/${encodeURIComponent(String(a.action))}`), body: {} };
      default:
        return null;
    }
  }

  app.post("/api/commands/:id/execute", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ context: CommandContext }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "context required" });
    const stored = plans.get(id);
    if (!stored || Date.now() - Date.parse(stored.plan.createdAt) > PLAN_TTL_MS) return reply.code(410).send({ error: "Plan abgelaufen — bitte neu planen." });
    if (stored.device !== callerLabel(req)) return reply.code(403).send({ error: "Dieser Plan gehört einem anderen Gerät." });
    // Premortem 1 / AC-P9-3: the view changed after the preview → re-plan.
    const was = stored.plan.context;
    const now = body.data.context;
    if (was.sessionId !== now.sessionId || was.hostId !== now.hostId || was.page !== now.page) return reply.code(409).send({ error: "Das Ziel hat sich seit der Vorschau geändert — bitte neu planen." });
    if (stored.results) return { planId: id, results: stored.results, repeated: true };
    if (stored.plan.question || stored.plan.refusal || stored.plan.steps.length === 0) return reply.code(422).send({ error: stored.plan.refusal ?? "Der Plan braucht noch eine Antwort." });
    const results: StepResult[] = [];
    for (const [i, step] of stored.plan.steps.entries()) {
      if (step.runner === "client") {
        results.push({ op: step.op, ok: true, detail: "in der App", client: { op: step.op, ...step.args } });
        continue;
      }
      const r = route(step, id, i);
      if (!r) {
        results.push({ op: step.op, ok: false, detail: "unbekannter Schritt" });
        break;
      }
      const res = await call<Record<string, unknown>>(req, "POST", r.url, r.body);
      const ok = res.status >= 200 && res.status < 300 && res.body?.ok !== false;
      const detail = res.status === 202 && res.body?.approvalId ? "wartet auf Freigabe" : ok ? "erledigt" : String(res.body?.error ?? res.body?.detail ?? `Fehler ${res.status}`);
      results.push({ op: step.op, ok, detail, ...(step.op === "session.create" && typeof res.body?.id === "string" ? { client: { op: "session.open", sessionId: res.body.id, hostId: String(step.args.hostId ?? selfHost) } } : {}), ...(step.op === "media.analyze" && ok ? { client: { op: "nav.open", page: "media" } } : {}) });
      if (!ok) break; // partial failure: stop, report what ran
    }
    stored.results = results;
    return { planId: id, results, repeated: false };
  });

  app.post("/api/commands/transform", async (req, reply) => {
    const body = z.object({ text: z.string().min(1).max(20_000), transform: z.enum(TRANSFORMS) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "text and transform required" });
    if (!deps.model) return reply.code(501).send({ error: "Kein lokales Modell konfiguriert (assistant/gatekeeper.model) — Text bleibt unverändert." });
    const started = Date.now();
    try {
      const res = await hintergrundAnfrage(deps.model.pforte, deps.model.model, deps.model.url, "text", "Text umformulieren", () =>
        (deps.model!.fetch ?? fetch)(`${deps.model!.url.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(deps.model!.timeoutMs ?? 30_000),
          headers: { "content-type": "application/json", ...(deps.model!.apiKey ? { authorization: `Bearer ${deps.model!.apiKey}` } : {}) },
          body: JSON.stringify({
            model: deps.model!.model,
            temperature: 0.2,
            max_tokens: 2000,
            messages: [
              { role: "system", content: `${TRANSFORM_PROMPT[body.data.transform]} Antworte nur mit dem neuen Text, ohne Einleitung.` },
              { role: "user", content: body.data.text },
            ],
          }),
        }));
      if (!res.ok) throw new Error(`Modell ${res.status}`);
      const out = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = (out.choices?.[0]?.message?.content ?? "").trim();
      if (!text) throw new Error("leere Antwort");
      return { text, model: deps.model.model, provider: "lokal", latencyMs: Date.now() - started };
    } catch (err) {
      return reply.code(502).send({ error: `Lokales Modell nicht erreichbar (${err instanceof Error ? err.message.slice(0, 80) : "Fehler"}) — Text bleibt unverändert.` });
    }
  });
}
