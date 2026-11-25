import type { FastifyInstance } from "fastify";
import { PentestScanRequest, type PentestStatus } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P80 (ADR-0118): Pentest-Routen. Ohne Konfiguration erklären die
 * Lesewege sichtbar die Lage (K10: die Seite wird nicht still tot); der
 * Scan-Weg entscheidet die Policy — `approve` geht in die Freigabe-Queue
 * (D4: riskante Tools ohnehin), `allow` läuft direkt. PWA und hubctl teilen
 * sich diese Routen (D6).
 */

const UNCONFIGURED: PentestStatus = {
  configured: false,
  state: "config",
  detail: "pentest-Block fehlt in der Konfiguration — die Seite erklärt das, statt still zu sein.",
  checkedAt: null,
  probeIntervalMs: 30_000,
};

export function registerScanRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get("/api/pentest/status", async () => (ctx.scan ? await ctx.scan.probe() : UNCONFIGURED));

  app.get("/api/pentest/targets", async () => ({
    configured: ctx.scan !== undefined,
    targets: ctx.scan?.targets() ?? [],
    tools: ctx.scan?.tools() ?? [],
  }));

  app.get("/api/pentest/jobs", async () => ({
    configured: ctx.scan !== undefined,
    jobs: ctx.scan?.jobs() ?? [],
  }));

  app.get("/api/pentest/jobs/:id", async (req, reply) => {
    if (!ctx.scan) return reply.code(503).send({ error: "pentest ist nicht konfiguriert." });
    const { id } = req.params as { id: string };
    const detail = await ctx.scan.detail(id);
    return detail ?? reply.code(404).send({ error: "unbekannter Job" });
  });

  app.post("/api/pentest/scan", async (req, reply) => {
    const body = PentestScanRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: `${body.error.issues[0]?.path.join(".") || "body"}: ${body.error.issues[0]?.message ?? "ungültig"}` });
    if (!ctx.scan) return reply.code(503).send({ error: "pentest ist nicht konfiguriert — es gibt kein Backend, das scannen könnte." });
    if (req.policy?.decision === "approve") {
      const res = ctx.scan.requestScan(body.data, req.policy?.actor ?? null);
      if (!res) return reply.code(422).send({ error: "ohne Warteschlange ist hier nichts zu fragen" });
      if ("error" in res) return reply.code(422).send({ error: res.error });
      return reply.code(202).send({ ok: false, detail: `pending approval ${res.approvalId}`, approvalId: res.approvalId, summary: res.summary });
    }
    const res = await ctx.scan.scanNow(body.data, req.policy?.actor ?? null);
    if (!res.ok) return reply.code(422).send({ error: res.error });
    return reply.code(202).send({ job: res.job });
  });
}
