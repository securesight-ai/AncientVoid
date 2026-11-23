import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MainSyncApplyRequest, MainSyncProjectOverride, MainSyncSettings, mainSyncSettingsPath } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

const PutBody = z
  .object({
    /** Globale Einstellungen (vollständig — Teilupdates gäben einen Mischzustand, den keiner gemeint hat). */
    global: MainSyncSettings,
    /** Projekt-Overrides als ganze Map (idempotent, kein Patch-Protokoll nötig). */
    projects: z.record(z.string().min(1), MainSyncProjectOverride),
  })
  .strict();

/**
 * EPIC-P67 T67.3: `GET/PUT /api/settings/main-sync` (ADR-0088 §5). Die Route
 * liegt unter `/api/settings` und fällt damit unter die Policy `settings.manage`
 * (Agenten/Displays/Fleet: deny). Ohne Settings-Dep → 501, wie die PWA-Push-
 * und Vault-Routen es bei fehlender Dep auch tun.
 */
export function registerMainSyncSettingsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get(mainSyncSettingsPath, async (_req, reply) => {
    const mainSync = deps.mainSync;
    if (!mainSync) return reply.code(501).send({ error: "settings not configured" });
    return { global: mainSync.global(), projects: mainSync.overrides() };
  });

  app.put(mainSyncSettingsPath, async (req, reply) => {
    const mainSync = deps.mainSync;
    if (!mainSync) return reply.code(501).send({ error: "settings not configured" });
    const body = PutBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid main-sync settings", issues: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    mainSync.setGlobal(body.data.global);
    mainSync.setOverrides(body.data.projects);
    return { global: mainSync.global(), projects: mainSync.overrides() };
  });

  // EPIC-P67 T67.6/T67.8: Messung + Probelauf (GET) und Anwenden (POST) je
  // Session — derselbe Endpunkt für Menü, Benachrichtigungs-Knopf und hubctl.
  // GET ist generisches `read`; POST fällt unter `main-sync.apply` (Mensch +
  // Agent). Fehler sind ehrlich: 404 unbekannte Session, 409 ohne
  // Worktree-Isolation, 501 ohne Haupt-Fern (benannte Lage, BUG-0260),
  // 502 Fetch nicht möglich.
  app.get("/api/sessions/:id/main-sync", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    try {
      const check = await deps.sessions.mainSyncCheck(id);
      return reply.header("cache-control", "no-store").send(check);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Isolation/.test(message)) return reply.code(409).send({ error: message });
      if (/kein Haupt-Fern/.test(message)) return reply.code(501).send({ error: message, reason: "no_remote" });
      return reply.code(502).send({ error: message });
    }
  });

  app.post("/api/sessions/:id/main-sync", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    // ADR-0102: `conflictStrategy` `favor-session` löst Konflikte automatisch
    // gunsten des Session-Branchs; Default (auch leerer Body) bleibt `abort`.
    const body = MainSyncApplyRequest.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "invalid main-sync apply request", issues: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    try {
      const result = await deps.sessions.mainSyncApply(id, ...(body.data.conflictStrategy ? [{ conflictStrategy: body.data.conflictStrategy }] : []));
      return reply.header("cache-control", "no-store").send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Isolation/.test(message)) return reply.code(409).send({ error: message });
      if (/kein Haupt-Fern/.test(message)) return reply.code(501).send({ error: message, reason: "no_remote" });
      return reply.code(502).send({ error: message });
    }
  });
}
