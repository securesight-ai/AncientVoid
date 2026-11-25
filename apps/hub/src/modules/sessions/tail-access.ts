import type { SessionTailTicket } from "@ancientvoid/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { TokenService } from "@ancientvoid/core";
import { StreamTickets } from "../../platform/stream-tickets.ts";

const TICKET_TTL_MS = 30_000;
const MAX_PENDING_TICKETS = 512;
/** ADR-0017: an open stream stops within this time after its token is revoked. */
const TOKEN_RECHECK_MS = 2_000;

interface PendingTicket {
  target: string;
  tokenHash: string;
}

function requestPath(req: FastifyRequest): string {
  return req.url.split("?", 1)[0]!;
}

export class TailAccess {
  private readonly tokens: TokenService;
  private readonly tickets = new StreamTickets<PendingTicket>(TICKET_TTL_MS, MAX_PENDING_TICKETS);

  constructor(app: FastifyInstance, tokens: TokenService) {
    this.tokens = tokens;
    app.addHook("preClose", async () => this.tickets.clear());
  }

  registerTicket(app: FastifyInstance, streamPath: string, missingTarget: (req: FastifyRequest) => string | null): void {
    app.post(`${streamPath}-ticket`, { config: { sessionTail: "ticket" } }, async (req, reply) => {
      const tokenHash = req.authenticatedTokenHash;
      if (!tokenHash) return reply.code(401).send({ error: "device bearer token required" });
      const missing = missingTarget(req);
      if (missing) return reply.code(404).send({ error: missing });
      const target = requestPath(req).slice(0, -"-ticket".length);
      const result: SessionTailTicket | undefined = this.tickets.issue({ target, tokenHash });
      if (!result) return reply.code(503).send({ error: "too many pending tail tickets" });
      return reply.header("cache-control", "no-store").code(201).send(result);
    });
  }

  authorize(socket: WebSocket, req: FastifyRequest): boolean {
    const query = req.query as { token?: unknown; ticket?: unknown };
    const tokenHash = query.token === undefined
      ? req.authenticatedTokenHash ?? this.tickets.consume(query.ticket, (entry) => entry.target === requestPath(req))?.tokenHash
      : undefined;
    if (!tokenHash || !this.tokens.hasHash(tokenHash)) {
      socket.close(4401, "invalid or expired tail ticket");
      return false;
    }
    const recheck = setInterval(() => {
      if (!this.tokens.hasHash(tokenHash)) socket.close(4401, "token revoked");
    }, TOKEN_RECHECK_MS);
    recheck.unref();
    socket.once("close", () => clearInterval(recheck));
    return true;
  }
}
