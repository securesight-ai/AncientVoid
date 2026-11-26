import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SwarmStart } from "@ancientvoid/contracts";
import { SwarmError } from "@ancientvoid/core";
import { createHubSwarm } from "./index.ts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P40 (ADR-0064), EPIC-P60 (ADR-0077), EPIC-P83 (ADR-0123): Swarm-Routen. Policy
 * (platform/policy.ts) mappt Schreiben auf `swarm.manage` (Mensch) und Lesen
 * auf `swarm.read` — Agenten dürfen zuschauen, aber keine Swarms steuern
 * (AC-P40-3/4). Der Session-Port verdrahtet den echten SessionManager;
 * Blobs liegen im EventStore (K5/K7). `/api/teams` existiert bis zur neuen
 * Team-Bedeutung nicht (404, kein stiller Alias, ADR-0123 §5).
 */
export function registerSwarmRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  const runtime = deps.swarm ?? createHubSwarm(deps);
  const { store, coordinator } = runtime;
  void runtime.ready.catch(err => app.log.error({ err }, "swarm recovery failed"));
  app.addHook("onReady", async () => { await runtime.ready; });
  app.addHook("onClose", async () => coordinator.stopLoop());

  const fail = (reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof SwarmError) {
      const status = err.code === "not_found" ? 404 : err.code === "stale_delivery" || err.code === "gate_closed" ? 409 : 422;
      return reply.code(status).send({ error: err.message, code: err.code });
    }
    return reply.code(500).send({ error: err instanceof Error ? err.message : "Swarm-Fehler" });
  };

  app.get("/api/swarms", async () => store.list());

  app.post("/api/swarms", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = SwarmStart.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Swarm-Start ungültig", issues: body.error.issues.slice(0, 5) });
    // Adapter-Rahmen und Tiefe 1 erzwingt validatePlan im Coordinator; Loop-Adapter
    // zusätzlich hier abweisen (ADR-0064 §1: keine zweite Steuerungsebene über Swarms).
    if (body.data.frame.adapters.some((a) => a.startsWith("loop:"))) {
      return reply.code(422).send({ error: "Loop-Adapter sind als Swarm-Worker nicht freigegeben.", code: "adapter_not_allowed" });
    }
    try {
      const swarm = await coordinator.start(body.data, req.policy?.actor ?? "human");
      return reply.code(201).send(swarm);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/swarms/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const swarm = store.get(id);
    if (!swarm) return reply.code(404).send({ error: "Swarm unbekannt." });
    return swarm;
  });

  app.post("/api/swarms/:id/answer", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ gateId: z.string().min(1), label: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "gateId und label erforderlich." });
    try {
      const swarm = await coordinator.answer(id, body.data.gateId, body.data.label, req.policy?.actor ?? "human");
      if (!swarm) return reply.code(404).send({ error: "Swarm unbekannt." });
      return swarm;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/swarms/:id/cancel", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.string().max(500).default("") }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "reason ungültig." });
    const swarm = await coordinator.cancel(id, body.data.reason || "Über die Oberfläche gestoppt.", req.policy?.actor ?? "human");
    if (!swarm) return reply.code(404).send({ error: "Swarm unbekannt." });
    return swarm;
  });
}
