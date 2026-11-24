import type { FastifyInstance } from "fastify";
import { isProjectPathAllowed, readProjectArtifact, recommendForPrompt, updateProjectArtifact, writeProjectArtifact } from "@ancientvoid/core";
import { enhancePrompt, rewriteWithChain, RewriteFailed, type LocalRewriteModel } from "./enhance.ts";
import { projectContext } from "./project-context.ts";
import { applyVerdict, judgeRecommendation } from "./skill-judge.ts";
import { appendOptimizerFeedback } from "./optimizer-feedback.ts";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

const EnhancePromptBody = z.object({
  adapter: z.string().min(1),
  text: z.string().min(1),
  project: z.string().min(1),
});

const OptimizerFeedbackBody = z.object({
  adapter: z.string().min(1),
  project: z.string().min(1),
  original: z.string().min(1),
  enhanced: z.string().min(1),
  decision: z.enum(["accepted", "rejected"]),
  /** EPIC-P68: which stage wrote the suggestion ("local" or an adapter id). */
  engine: z.string().max(80).optional(),
  costUsd: z.number().optional(),
  latencyMs: z.number(),
});

const ArtifactKind = z.enum(["skill", "agent", "workflow"]);
const ArtifactName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** EPIC-P68 T68.5: the file is rewritten as a whole; frontmatter and name stay. */
const REVISE_INSTRUCTION =
  "You maintain a skill/agent/workflow file for coding agents. Revise the file below so it also serves the request. Keep the frontmatter block (between the --- lines) and its name exactly; adjust the description only if the scope changes. Keep what still applies, stay concise, use the project context only as background facts and never invent paths or commands. Output ONLY the complete new file content, no preamble, no code fences.";

/** A model that drops the frontmatter must not cost the file its name. */
function keepFrontmatter(draft: string, current: string): string {
  const head = current.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)?.[0];
  const text = draft.replace(/^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/i, "$1").trim();
  if (!head || text.startsWith("---")) return text;
  return `${head.trimEnd()}\n\n${text}`;
}

const ARTIFACT_ERRORS: Record<string, number> = {
  "invalid artifact name": 400,
  "draft too large": 400,
  "artifact name mismatch": 400,
  "artifact not found": 404,
  "artifact path escapes the project": 422,
  "artifact changed": 409,
  "artifact already exists": 409,
};

/** Prompt enhancer, optimizer feedback, skills and recommendations (T1.5, T3.9, T5.10, EPIC-P68). */
export function registerPromptsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, projectRoots, skillsFor } = ctx;
  // EPIC-P68 (ADR-0089): same local model as text commands (T9.2), with
  // its own budget — the planner's 12s timeout is for one JSON intent.
  const local: LocalRewriteModel | undefined = deps.assistantModel
    ? {
        url: deps.assistantModel.url,
        model: deps.assistantModel.model,
        ...(deps.assistantModel.apiKey ? { apiKey: deps.assistantModel.apiKey } : {}),
        ...(deps.assistantModel.fetch ? { fetch: deps.assistantModel.fetch } : {}),
      }
    : undefined;
  const registrationOf = (adapter: string) => {
    const registered = deps.registry.get(adapter);
    return {
      ...(registered?.module !== undefined ? { module: registered.module } : {}),
      ...(registered?.config !== undefined ? { config: registered.config as Record<string, unknown> } : {}),
    };
  };

  app.post("/api/prompt-enhance", async (req, reply) => {
    // T1.5-8: never automatic, only on explicit request (this route is
    // the "on request" — nothing else calls it). Real cost/latency come
    // back to the caller so the UI can show what this click actually
    // spent, per-call — see enhance.ts's own doc comment for why this
    // isn't folded into ADR-0004's aggregate usage cache.
    const parsed = EnhancePromptBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid enhance request", issues: parsed.error.issues });
    }
    // Same containment rule as session creation (T1.5-4) — the enhance
    // call's cwd is this path (found necessary via a real test, see
    // enhance.ts), so it needs the identical guard against an
    // outside-the-roots path.
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    try {
      // BUG-0061: the adapter one-shot is picked from the registration
      // (module + config), not the free-form adapter id — a dsh ACP
      // registration can carry any id ("deepseek", …).
      const context = await projectContext(parsed.data.project, await skillsFor(parsed.data.project));
      return await enhancePrompt(parsed.data.adapter, parsed.data.text, parsed.data.project, {
        registration: registrationOf(parsed.data.adapter),
        ...(local ? { local } : {}),
        context,
      });
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "prompt enhancement failed",
        ...(err instanceof RewriteFailed ? { skipped: err.skipped } : {}),
      });
    }
  });


  app.post("/api/prompt-optimizer/feedback", async (req, reply) => {
    // T3.9 (EPIC-P3 §3 Learning-Loop): fire-and-forget from the PWA's own
    // Composer, once per shown suggestion (accepted or discarded) — a
    // plain local JSONL append, never sent anywhere else ("niemals Cloud,
    // niemals Telemetrie").
    if (!deps.dataDir) return reply.code(501).send({ error: "prompt-optimizer feedback storage not configured" });
    const parsed = OptimizerFeedbackBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid feedback body", issues: parsed.error.issues });
    const { costUsd, engine, ...rest } = parsed.data;
    await appendOptimizerFeedback(deps.dataDir, { ...rest, ...(costUsd !== undefined ? { costUsd } : {}), ...(engine !== undefined ? { engine } : {}) });
    return { ok: true };
  });


  app.get("/api/skills", async (req, reply) => {
    // T1.5-10/ADR-0005: source is the target project itself, not a
    // hub-wide registry (Nutzer-Rückfrage 1). Same containment guard as
    // sessions/enhance — a phone client never gets to read arbitrary
    // filesystem paths outside the configured roots.
    const q = req.query as { project?: string };
    if (!q.project) return reply.code(400).send({ error: "project query param required" });
    if (!(await isProjectPathAllowed(q.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    return { items: await skillsFor(q.project) };
  });


  app.post("/api/prompt-recommendation", async (req, reply) => {
    const parsed = z.object({ project: z.string().min(1), text: z.string().min(1).max(8000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid recommendation request" });
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    // null = nothing worth suggesting; sent as JSON so clients can tell.
    const items = await skillsFor(parsed.data.project);
    const heuristic = recommendForPrompt(parsed.data.text, items);
    // EPIC-P68: a free local model refines it; busy/absent → heuristic alone.
    const verdict = local ? await judgeRecommendation(local, parsed.data.text, items) : null;
    return reply.type("application/json").send(JSON.stringify(applyVerdict(verdict, heuristic, items)));
  });


  app.get("/api/skills/artifact", async (req, reply) => {
    // EPIC-P68: show what exists before anyone writes a near-duplicate.
    const q = z.object({ project: z.string().min(1), kind: ArtifactKind, name: ArtifactName }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "project, kind and name required" });
    if (!(await isProjectPathAllowed(q.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    const own = await readProjectArtifact(q.data.project, q.data.kind, q.data.name);
    if (own) return { kind: q.data.kind, name: q.data.name, ...own };
    // A base skill is readable (it shapes the chain) but never written from here.
    const root = await ctx.catalogRootFor(q.data.project);
    const base = root && q.data.kind === "skill" ? await readProjectArtifact(root, "skill", q.data.name) : null;
    if (base) return { kind: q.data.kind, name: q.data.name, ...base, layer: "base" };
    return reply.code(404).send({ error: "artifact not found" });
  });


  app.put("/api/skills", async (req, reply) => {
    const parsed = z
      .object({ project: z.string().min(1), kind: ArtifactKind, name: ArtifactName, draft: z.string().min(1).max(8000), baseHash: z.string().regex(/^[0-9a-f]{64}$/) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid artifact update" });
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    try {
      return await updateProjectArtifact(parsed.data.project, parsed.data, parsed.data.baseHash);
    } catch (err) {
      const message = err instanceof Error ? err.message : "artifact update failed";
      const code = ARTIFACT_ERRORS[message];
      if (code) return reply.code(code).send({ error: message });
      throw err;
    }
  });


  app.post("/api/skills/revise", async (req, reply) => {
    // EPIC-P68 T68.5: a proposal only — nothing is written here; saving is
    // the separate PUT above with the hash this answer carries.
    const parsed = z
      .object({ project: z.string().min(1), kind: ArtifactKind, name: ArtifactName, prompt: z.string().min(1).max(8000), adapter: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid revise request" });
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    const current = await readProjectArtifact(parsed.data.project, parsed.data.kind, parsed.data.name);
    if (!current) return reply.code(404).send({ error: "artifact not found" });
    try {
      const context = await projectContext(parsed.data.project, await skillsFor(parsed.data.project));
      const result = await rewriteWithChain(
        parsed.data.adapter,
        { instruction: REVISE_INSTRUCTION, context, user: `Anfrage:\n${parsed.data.prompt}\n\nAktuelle Datei (${current.path}):\n${current.content}` },
        parsed.data.project,
        { registration: registrationOf(parsed.data.adapter), ...(local ? { local } : {}) },
      );
      return {
        draft: keepFrontmatter(result.text, current.content).slice(0, 8000),
        baseHash: current.hash,
        engine: result.engine,
        skipped: result.skipped,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        latencyMs: result.latencyMs,
      };
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "revise failed",
        ...(err instanceof RewriteFailed ? { skipped: err.skipped } : {}),
      });
    }
  });


  app.post("/api/skills", async (req, reply) => {
    const parsed = z
      .object({
        project: z.string().min(1),
        kind: z.enum(["skill", "agent", "workflow"]),
        name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().min(1).max(500),
        draft: z.string().min(1).max(8000),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid artifact" });
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    try {
      const written = await writeProjectArtifact(parsed.data.project, parsed.data);
      return reply.code(201).send(written);
    } catch (err) {
      const message = err instanceof Error ? err.message : "artifact write failed";
      if (message === "artifact already exists") return reply.code(409).send({ error: message });
      if (message === "invalid artifact name" || message === "draft too large") return reply.code(400).send({ error: message });
      throw err;
    }
  });
}
