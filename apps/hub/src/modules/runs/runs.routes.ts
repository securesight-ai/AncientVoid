import { EvalRunInput } from "@ancientvoid/contracts";
import type { EvalSeriesList } from "@ancientvoid/contracts";
import { summariseSeries } from "@ancientvoid/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";
import { EvaluationLauncher } from "./evaluation-launcher.ts";

/** EPIC-P21 T21.3: measured turns and the estimate for a running one. */
export function registerRunsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const launcher = deps.dataDir ? new EvaluationLauncher(deps.dataDir) : null;
  if (launcher) app.addHook("onClose", async () => launcher.close());

  app.get("/api/evaluation/runs", async (_req, reply) => {
    try {
      return await launcher?.list() ?? { presets: [], runs: [] };
    } catch (error) {
      app.log.warn({ err: error }, "evaluation presets or journals could not be read");
      return reply.code(500).send({ error: "evaluation presets or journals could not be read" });
    }
  });

  app.post("/api/evaluation/runs", async (req, reply) => {
    const body = z.strictObject({ preset: z.string().max(48) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "evaluation preset required" });
    if (!launcher) return reply.code(501).send({ error: "evaluation launcher unavailable" });
    try {
      const started = await launcher.start(body.data.preset);
      return started ? reply.code(202).send(started) : reply.code(404).send({ error: "unknown evaluation preset" });
    } catch (error) {
      req.log.warn({ err: error }, "evaluation launch failed");
      return reply.code(409).send({ error: "evaluation could not be started" });
    }
  });

  app.get("/api/sessions/:id/turns", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return { turns: deps.sessions.turnMetrics(id) };
  });

  app.get("/api/sessions/:id/estimate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const estimate = deps.sessions.runEstimate(id);
    return estimate ?? reply.code(404).send({ error: "unknown session" });
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/evaluation", async (req, reply) => {
    if (!deps.sessions.get(req.params.id)) return reply.code(404).send({ error: "unknown session" });
    const result = await deps.sessions.evaluation(req.params.id);
    return result ?? reply.code(404).send({ error: "no evaluation recorded" });
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/evaluation", async (req, reply) => {
    const body = EvalRunInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid evaluation", issues: body.error.issues });
    if (!deps.sessions.get(req.params.id)) return reply.code(404).send({ error: "unknown session" });
    try {
      return await deps.sessions.recordEvaluation(req.params.id, body.data);
    } catch (error) {
      req.log.warn({ err: error }, "evaluation not recorded");
      return reply.code(422).send({ error: error instanceof Error ? error.message : "evaluation not recorded" });
    }
  });

  // P84: dieselbe Zusammenfassung speist PWA-Reiter und Markdown-Report.
  app.get("/api/evaluation/series", async (): Promise<EvalSeriesList> => {
    const results = await deps.sessions.listEvaluations();
    const entries = new Map<string, EvalSeriesList["series"][number]>();
    for (const { input, recordedAt } of results) {
      const repo = input.comparison?.repo;
      const key = JSON.stringify([repo, input.series]);
      const entry = entries.get(key);
      if (entry) {
        entry.runs++;
        if (!entry.lastRecordedAt || recordedAt > entry.lastRecordedAt) entry.lastRecordedAt = recordedAt;
      } else {
        entries.set(key, { series: input.series, ...(repo && { repo }), runs: 1, lastRecordedAt: recordedAt });
      }
    }
    return { series: [...entries.values()].sort((a, b) => a.series.localeCompare(b.series)) };
  });

  app.get<{ Params: { series: string }; Querystring: { repo?: string } }>("/api/evaluation/series/:series", async (req, reply) => {
    const summary = summariseSeries(req.params.series, await deps.sessions.listEvaluations(), req.query.repo);
    return summary.runs > 0 ? summary : reply.code(404).send({ error: "unknown evaluation series" });
  });

  app.get("/api/metrics/turns", async () => ({ groups: deps.sessions.turnMetricsSummary() }));
}
