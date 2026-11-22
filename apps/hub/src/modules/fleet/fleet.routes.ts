import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { FleetStore, TokenService } from "@ancientvoid/core";
import { peerView } from "@ancientvoid/core";
import { FLEET_PROTOCOL_VERSION, FLEET_TOKEN_PREFIX, HOST_ID_PATTERN, type FleetHello, type FleetHostView, type SessionRecord } from "@ancientvoid/contracts";
import { hostname } from "node:os";
import { extractToken } from "../../platform/auth.ts";
import { httpJson } from "../../platform/http-json.ts";

/** How long the overview waits for each peer. */
const SYNC_TIMEOUT_MS = 3000;

/** Wrong codes per minute before /api/fleet/pair answers 429. */
const PAIR_ATTEMPTS_PER_MINUTE = 10;

/** http(s) origin only — no path, no credentials, no other scheme. */
function normalizePeerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/**
 * T6.2 / ADR-0017 pairing: this hub hands out one-time codes (invites) and
 * pairs with other hubs by redeeming theirs. Peer tokens never leave the
 * server.
 */
export function registerFleetRoutes(app: FastifyInstance, deps: { fleet: FleetStore; tokens: TokenService; hostId: string; hostLabel?: string }): void {
  let window = { start: Date.now(), failures: 0 };

  app.post("/api/fleet/invites", async (_req, reply) => reply.code(201).send(deps.fleet.createInvite()));

  // Public, guarded by the one-time code itself (see authHook).
  app.post("/api/fleet/pair", async (req, reply) => {
    const body = z.object({ code: z.string().min(4).max(40), hostId: z.string().regex(HOST_ID_PATTERN) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "code and hostId required" });
    if (Date.now() - window.start > 60_000) window = { start: Date.now(), failures: 0 };
    if (window.failures >= PAIR_ATTEMPTS_PER_MINUTE) return reply.code(429).send({ error: "too many attempts" });
    if (body.data.hostId === deps.hostId) return reply.code(422).send({ error: "a hub cannot pair with itself" });
    const result = deps.fleet.redeem(body.data.code, body.data.hostId);
    if ("error" in result) {
      window.failures += 1;
      return reply.code(422).send({ error: result.error });
    }
    return { token: result.token, hello: hello(deps.hostId) };
  });

  app.post("/api/fleet/peers", async (req, reply) => {
    const body = z.object({ url: z.string().min(1), code: z.string().min(4).max(40) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "url and code required" });
    const url = normalizePeerUrl(body.data.url);
    if (!url) return reply.code(400).send({ error: "url must be http(s)://host[:port]" });
    let remote: FleetHello;
    try {
      const res = await httpJson<FleetHello>(`${url}/api/fleet/hello`);
      if (res.status !== 200 || typeof res.body?.hostId !== "string") return reply.code(422).send({ error: `no AncientVoid hub at ${url}` });
      remote = res.body;
    } catch (err) {
      return reply.code(422).send({ error: `hub not reachable: ${err instanceof Error ? err.message : String(err)}` });
    }
    if (remote.protocolVersion !== FLEET_PROTOCOL_VERSION) {
      return reply.code(422).send({ error: `incompatible hub (protocol ${remote.protocolVersion}, expected ${FLEET_PROTOCOL_VERSION})` });
    }
    if (remote.hostId === deps.hostId) return reply.code(422).send({ error: "that is this hub" });
    const paired = await httpJson<{ token?: string; error?: string }>(`${url}/api/fleet/pair`, { body: { code: body.data.code, hostId: deps.hostId } });
    if (paired.status !== 200 || !paired.body?.token) {
      return reply.code(422).send({ error: paired.body?.error ?? `pairing failed (${paired.status})` });
    }
    const peer = { hostId: remote.hostId, url, token: paired.body.token, protocolVersion: remote.protocolVersion, pairedAt: new Date().toISOString() };
    deps.fleet.savePeer(peer);
    return reply.code(201).send(peerView(peer));
  });

  app.get("/api/fleet/peers", async () => deps.fleet.peers().map(peerView));

  // T6.3: last good session list per peer, shown with its own time when the
  // peer is away (AC-P6-3).
  const lastGood = new Map<string, { sessions: SessionRecord[]; syncedAt: string; label?: string }>();

  app.get("/api/fleet", async (req) => {
    const ownRes = await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: String(req.headers.authorization ?? "") } });
    const own = ownRes.statusCode === 200 ? (ownRes.json() as SessionRecord[]) : [];
    const now = new Date().toISOString();
    const hosts: FleetHostView[] = [
      { hostId: deps.hostId, label: deps.hostLabel ?? hostname(), self: true, url: null, state: "reachable", lastSyncAt: now, detail: null, sessions: own.length },
    ];
    const sessions: SessionRecord[] = [...own];
    const results = await Promise.all(
      deps.fleet.peers().map(async (peer) => {
        const cached = lastGood.get(peer.hostId);
        const away = (state: FleetHostView["state"], detail: string): { host: FleetHostView; sessions: SessionRecord[] } => ({
          host: {
            hostId: peer.hostId,
            ...(cached?.label ? { label: cached.label } : {}),
            self: false,
            url: peer.url,
            state: cached && state === "offline" ? "stale" : state,
            lastSyncAt: cached?.syncedAt ?? null,
            detail,
            sessions: cached?.sessions.length ?? 0,
          },
          sessions: state === "offline" ? (cached?.sessions ?? []) : [],
        });
        try {
          const [hello, list] = await Promise.all([
            httpJson<FleetHello>(`${peer.url}/api/fleet/hello`, { timeoutMs: SYNC_TIMEOUT_MS }),
            httpJson<SessionRecord[]>(`${peer.url}/api/sessions`, { token: peer.token, timeoutMs: SYNC_TIMEOUT_MS }),
          ]);
          // 2026-11-21 (kaisgamingdesk): `tailscale serve` answers 502 with an empty
          // body when the hub behind it is stopped. That is a dead host, not a
          // protocol mismatch — only a hub that identifies itself may be called
          // "incompatible", otherwise the fleet page blames the wrong thing.
          if (hello.status !== 200 || typeof hello.body?.hostId !== "string") {
            return away("offline", `kein Hub auf ${new URL(peer.url).host} (Antwort ${hello.status})`);
          }
          if (hello.body.protocolVersion !== FLEET_PROTOCOL_VERSION) {
            return away("incompatible", `Protokoll ${String(hello.body.protocolVersion)} statt ${FLEET_PROTOCOL_VERSION}`);
          }
          if (list.status === 401 || list.status === 403) return away("unauthorized", "Kopplung auf dem Host widerrufen");
          if (list.status !== 200 || !Array.isArray(list.body)) return away("offline", `Antwort ${list.status}`);
          const stamped = list.body.map((s) => ({ ...s, hostId: peer.hostId }));
          const syncedAt = new Date().toISOString();
          // 2026-10-26: the remote's OWN name (from its hello), not a URL
          // guess — peers behind 127.0.0.1 ports would all look alike.
          const remoteLabel = hello.body?.label;
          lastGood.set(peer.hostId, { sessions: stamped, syncedAt, ...(remoteLabel ? { label: remoteLabel } : {}) });
          return { host: { hostId: peer.hostId, ...(remoteLabel ? { label: remoteLabel } : {}), self: false, url: peer.url, state: "reachable" as const, lastSyncAt: syncedAt, detail: null, sessions: stamped.length }, sessions: stamped };
        } catch (err) {
          return away("offline", err instanceof Error ? err.message : String(err));
        }
      }),
    );
    for (const r of results) {
      hosts.push(r.host);
      sessions.push(...r.sessions);
    }
    return { self: deps.hostId, hosts, sessions };
  });

  app.delete("/api/fleet/peers/:hostId", async (req, reply) => {
    const { hostId } = req.params as { hostId: string };
    const peer = deps.fleet.peer(hostId);
    if (!peer) return reply.code(404).send({ error: "unknown host" });
    // Best effort: the peer drops our token; either way we forget it.
    await httpJson(`${peer.url}/api/fleet/pairing`, { method: "DELETE", token: peer.token }).catch(() => undefined);
    deps.fleet.removePeer(hostId);
    return { ok: true };
  });

  // Called by a home hub with its own fleet token: "forget me".
  app.delete("/api/fleet/pairing", async (req: FastifyRequest, reply) => {
    const raw = extractToken(req);
    const label = raw ? deps.tokens.identify(raw)?.label : undefined;
    if (!label?.startsWith(FLEET_TOKEN_PREFIX)) return reply.code(403).send({ error: "fleet token required" });
    deps.tokens.revoke(label);
    return { ok: true };
  });
}

function hello(hostId: string): FleetHello {
  return { hostId, protocolVersion: FLEET_PROTOCOL_VERSION, hubVersion: "0.1.0", serverTime: new Date().toISOString() };
}
