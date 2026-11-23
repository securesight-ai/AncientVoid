import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import WebSocket from "ws";
import type { FleetStore, SessionManager, TokenService } from "@ancientvoid/core";
import type { HubMetrics } from "@ancientvoid/contracts";
import { isFleetRoutable } from "@ancientvoid/contracts";
import { createTailHandler } from "../sessions/ws.ts";

const FORWARD_TIMEOUT_MS = 10_000;
/** Enhance/optimizer calls spawn a CLI model call (10–30 s measured) — the
 * generic 10 s forward timeout killed them (observed 2026-10-24, gpubox via
 * fleet). Slow-path allowlist instead of raising the global limit. */
const FORWARD_TIMEOUT_SLOW_MS = 90_000;
const SLOW_PATHS = /^\/api\/(prompt-enhance|prompt-recommendation|prompt-optimizer|skills\/revise|sessions\/[^/]+\/(steer|apply|stop|archive|budget|workspace\/retry))$/;
const MAX_FORWARD_BYTES = 16 * 1024 * 1024;

interface Forwarded {
  status: number;
  contentType: string;
  body: Buffer;
}

function forward(url: string, method: string, token: string, body: unknown, timeoutOverrideMs?: number): Promise<Forwarded> {
  const target = new URL(url);
  const payload = body === undefined || body === null || method === "GET" ? undefined : JSON.stringify(body);
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method,
        agent: false,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_FORWARD_BYTES) req.destroy(new Error("response too large"));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          clearTimeout(deadline);
          resolve({ status: res.statusCode ?? 502, contentType: String(res.headers["content-type"] ?? "application/json"), body: Buffer.concat(chunks) });
        });
      },
    );
    const deletingSession = method === "DELETE" && /^\/api\/sessions\/[^/]+$/.test(target.pathname);
    const timeoutMs = timeoutOverrideMs ?? (deletingSession || SLOW_PATHS.test(target.pathname) ? FORWARD_TIMEOUT_SLOW_MS : FORWARD_TIMEOUT_MS);
    // 2026-11-20: hard wall-clock deadline — req.setTimeout never fires during
    // TCP connect, an unreachable peer hung proxies for the kernel SYN budget.
    const deadline = setTimeout(() => req.destroy(new Error(`no answer within ${timeoutMs / 1000} s`)), timeoutMs);
    req.on("error", (err) => { clearTimeout(deadline); reject(err); });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** GET auf einem gekoppelten Peer mit dessen Fleet-Token — die gemeinsame Tür
 * für Hub-zu-Hub-Lesung (Suche Fächerung nutzt sie, der hosts-Proxy nutzt
 * `forward` direkt). Liefert Status und, wenn JSON dahintersteht, das geparste
 * Objekt; Fehler werfen wie bei `forward` (Zeitlimit, Verbindungsablehnung). */
export async function peerGetJson(
  peer: { url: string; token: string },
  pathWithQuery: string,
  timeoutMs = FORWARD_TIMEOUT_MS,
): Promise<{ status: number; json: unknown } | { status: number; json: null; note: string }> {
  const target = new URL(pathWithQuery, peer.url);
  const res = await forward(target.toString(), "GET", peer.token, undefined, timeoutMs);
  if (res.contentType.includes("json")) {
    try {
      return { status: res.status, json: JSON.parse(res.body.toString("utf8")) as unknown };
    } catch {
      return { status: res.status, json: null, note: "antwort war kein json" };
    }
  }
  return { status: res.status, json: null, note: `antwort: ${res.contentType || "unbekannt"}` };
}

/** `/api/<rest>` if it is a clean, routable path — no `..`, no `//`. */
function routablePath(rest: string): string | null {
  const path = `/api/${rest}`;
  if (new URL(path, "http://hub").pathname !== path || path.includes("//")) return null;
  return isFleetRoutable(path) ? path : null;
}

/**
 * T6.4 / ADR-0017: `/api/hosts/<hostId>/<path>` reaches exactly that host —
 * locally for this hub's own id, else the paired peer's stored URL with its
 * fleet token, only for routable paths. Events stream through as well.
 */
export function registerFleetProxy(
  app: FastifyInstance,
  deps: { fleet: FleetStore; hostId: string; sessions: SessionManager; tokens: TokenService; metrics?: HubMetrics },
): void {
  const local = createTailHandler(deps.sessions, deps.metrics, deps.tokens);

  app.get("/api/hosts/:hostId/events/:id/tail", { websocket: true }, (socket, req) => {
    const { hostId, id } = req.params as { hostId: string; id: string };
    if (hostId === deps.hostId) {
      local(socket, req);
      return;
    }
    const peer = deps.fleet.peer(hostId);
    if (!peer) {
      socket.close(4404, "unknown host");
      return;
    }
    const upstream = new WebSocket(`${peer.url.replace(/^http/, "ws")}/api/events/${encodeURIComponent(id)}/tail?token=${encodeURIComponent(peer.token)}`);
    const pending: string[] = [];
    socket.on("message", (data: Buffer) => {
      const text = data.toString();
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else pending.push(text);
    });
    upstream.on("open", () => {
      for (const text of pending.splice(0)) upstream.send(text);
    });
    upstream.on("message", (data: Buffer) => {
      if (socket.readyState === socket.OPEN) socket.send(data.toString());
    });
    upstream.on("close", (code) => socket.close(code >= 4000 ? code : 1011, "host stream ended"));
    upstream.on("error", () => socket.close(1011, "host unreachable"));
    socket.on("close", () => upstream.close());
  });

  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { hostId, "*": rest } = req.params as { hostId: string; "*": string };
    const path = routablePath(rest);
    if (!path) return reply.code(403).send({ error: "path not routable to other hosts", hostId });
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    if (hostId === deps.hostId) {
      const res = await app.inject({
        method: req.method as "GET",
        url: `${path}${query}`,
        headers: { authorization: String(req.headers.authorization ?? "") },
        ...(req.body === undefined ? {} : { payload: req.body as object }),
      });
      return reply.code(res.statusCode).type(String(res.headers["content-type"] ?? "application/json")).send(res.rawPayload);
    }
    const peer = deps.fleet.peer(hostId);
    if (!peer) return reply.code(404).send({ error: "unknown host", hostId });
    try {
      const res = await forward(`${peer.url}${path}${query}`, req.method, peer.token, req.body);
      if (res.status === 401 || res.status === 403) {
        return reply.code(502).send({ error: `${hostId} lehnt den Zugriff ab (Kopplung widerrufen?)`, hostId, state: "unauthorized" });
      }
      return reply.code(res.status).type(res.contentType).send(res.body);
    } catch (err) {
      return reply.code(502).send({ error: `${hostId} nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, hostId, state: "offline" });
    }
  };
  app.route({ method: ["GET", "POST", "PUT", "DELETE"], url: "/api/hosts/:hostId/*", handler });
}
