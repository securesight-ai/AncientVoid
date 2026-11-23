import type { FastifyInstance } from "fastify";
import { CompactionSettings, compactionSettingsKey, compactionSettingsPath } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

export function registerCompactionSettingsRoutes(app: FastifyInstance, { deps: { settings } }: RouteContext): void {
  app.get(compactionSettingsPath, async (_req, reply) => {
    if (!settings) return reply.code(501).send({ error: "settings not configured" });
    return { enabled: settings.get(compactionSettingsKey) === "true" };
  });

  app.put(compactionSettingsPath, async (req, reply) => {
    if (!settings) return reply.code(501).send({ error: "settings not configured" });
    const body = CompactionSettings.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid compaction settings" });
    settings.set(compactionSettingsKey, String(body.data.enabled));
    return body.data;
  });
}
