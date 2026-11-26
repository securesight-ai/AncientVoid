import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";
import type { TeamPairingService } from "./team-pairing-service.ts";

/**
 * EPIC-P83 T83.3 (Feinkonzept §1.1/§2.1, ADR-0118 §7): Kopplungs-Routen.
 * Policy: `team.manage` für alles Steuernde (Mensch), `team.read` für Status.
 * Die Einladung ist Text (Präfix `avteam1.`), nie eine URL; die Codes werden
 * nie übertragen — jede Seite leitet sie aus dem TLS-Exporter ab.
 * `POST /api/teams/pairings/current/confirm` nimmt die Code-Eingabe der
 * eigenen Seite entgegen (A tippt Code B; B tippt Code A — B bestätigt über
 * `join/confirm`). Passkey-Fluss (WebAuthn) folgt mit der PWA-Ansicht V6.
 */
export function registerTeamPairingRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const pairing: TeamPairingService | undefined = ctx.deps.teamPairing;

  app.get("/api/teams/pairing", async () => {
    if (!pairing) {
      return { state: "idle", teamId: "", codeA: null, peerLabel: null, peerInstanceId: null, error: null, inviteText: null, configured: false };
    }
    return { ...pairing.status(), configured: true };
  });

  app.get("/api/teams/pins", async () => {
    if (!pairing) return { pins: [] as const };
    return { pins: pairing.pins() };
  });

  app.post("/api/teams", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pairing) return reply.code(503).send({ error: "Team-Kopplung nicht konfiguriert (team.listen fehlt)" });
    const body = z.object({ label: z.string().min(1).max(80).default("Team") }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "label ungültig" });
    const opened = await pairing.openInvitation(body.data.label);
    // `joined` ist ein internes Signal — nicht über JSON transportieren.
    return reply.code(201).send({ teamId: opened.teamId, inviteText: opened.inviteText });
  });

  app.post("/api/teams/pairings/current/confirm", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pairing) return reply.code(503).send({ error: "Team-Kopplung nicht konfiguriert" });
    const body = z.object({ code: z.string().regex(/^\d{8}$/) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Achtstelliger Code erforderlich." });
    const result = pairing.typeCodeB(body.data.code);
    if (!result.ok) return reply.code(422).send({ error: result.error ?? "Code abgelehnt" });
    return reply.code(200).send(pairing.status());
  });

  app.post("/api/teams/join", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pairing) return reply.code(503).send({ error: "Team-Kopplung nicht konfiguriert (team.listen fehlt)" });
    const body = z.object({ inviteText: z.string().min(8).max(4096), label: z.string().min(1).max(80).default("Mein Hub") }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "inviteText und label erforderlich." });
    const result = await pairing.joinFromInvite(body.data.inviteText, body.data.label);
    if (!result.ok) return reply.code(422).send({ error: result.error ?? "Beitritt abgelehnt" });
    return reply.code(200).send(pairing.status());
  });

  app.post("/api/teams/join/confirm", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pairing) return reply.code(503).send({ error: "Team-Kopplung nicht konfiguriert" });
    const body = z.object({ code: z.string().regex(/^\d{8}$/) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Achtstelliger Code erforderlich." });
    const result = await pairing.typeCodeA(body.data.code);
    if (!result.ok) return reply.code(422).send({ error: result.error ?? "Code abgelehnt" });
    // A pinnt erst, wenn der Confirm-Frame dort angekommen ist.
    return reply.code(200).send(pairing.status());
  });

  app.post("/api/teams/pairings/current/complete", async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!pairing) return reply.code(503).send({ error: "Team-Kopplung nicht konfiguriert" });
    const result = await pairing.complete();
    if (!result.ok) return reply.code(422).send({ error: result.error ?? "Kopplung unvollständig" });
    return reply.code(200).send({ ok: true, pins: pairing.pins().length });
  });
}
