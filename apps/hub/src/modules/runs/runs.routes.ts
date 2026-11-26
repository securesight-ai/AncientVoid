import { EvalRunInput } from "@ancientvoid/contracts";
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../../route-context.ts";

/** EPIC-P21 T21.3: measured turns and the estimate for a running one. */
export function registerRunsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

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

  app.get("/api/metrics/turns", async () => ({ groups: deps.sessions.turnMetricsSummary() }));
}
