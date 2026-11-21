import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { InferenceSnapshot, InferenceSourceList } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P79 T79.3: Les-API für die Token-Tempo-Seite — REST, keine EventBus-Payloads
 * (K5). Ohne konfigurierte Engines antwortet die Liste leer und die Seite erklärt
 * die Konfiguration, statt Nullen zu erfinden (ADR-0023). Eine unbekannte
 * Quellen-Id ist ein Fehler mit Liste der möglichen Ids, nie ein stiller Rückfall.
 */

const SnapshotQuery = z.object({
  id: z.string().min(1).max(80),
  /** Zeitfenster für die Verteilungen in Stunden (UI-Pills). */
  fenster: z.coerce.number().min(0.25).max(720).optional(),
});

export function registerInferenceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get("/api/inference/sources", async (): Promise<InferenceSourceList> => {
    const tracker = ctx.deps.inference;
    if (!tracker) {
      return { generatedAt: new Date().toISOString(), fensterH: 0, schwelleGelesen: 0, quellen: [] };
    }
    return tracker.sources();
  });

  app.get("/api/inference/snapshot", async (req, reply): Promise<InferenceSnapshot | { error: string; verfuegbare: string[] }> => {
    const parsed = SnapshotQuery.safeParse(req.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: `id (und optional fenster 0,25…720) fehlt oder ist ungültig: ${parsed.error.issues.map((i) => i.message).join("; ")}`, verfuegbare: ctx.deps.inference?.sources().quellen.map((q) => q.id) ?? [] };
    }
    const tracker = ctx.deps.inference;
    if (!tracker) {
      reply.code(503);
      return { error: "inference ist nicht konfiguriert (Abschnitt `inference.engines`)", verfuegbare: [] };
    }
    const snap = tracker.snapshot(parsed.data.id, parsed.data.fenster);
    if (!snap) {
      reply.code(404);
      return { error: `unbekannte Quelle: ${parsed.data.id}`, verfuegbare: tracker.sources().quellen.map((q) => q.id) };
    }
    return snap;
  });
}
