import type { FastifyInstance, FastifyReply } from "fastify";
import { COMPONENT_POWER_KEY, HOST_METRIC_RANGES, HostMetricsDetail, HostMetricsHistory, HostMetricsReport, type HostMetricsHost } from "@ancientvoid/contracts";
import type { FleetPeer } from "@ancientvoid/core";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P81 (ADR-0117): jeder Hub misst und speichert sich selbst; der Home-Hub
 * führt beim Lesen zusammen. `scope=local` verhindert, dass Peers sich im Kreis fragen.
 */
const PEER_TIMEOUT_MS = 2_500;

const Scope = z.object({ scope: z.enum(["local"]).optional() });
const HostQuery = Scope.extend({ id: z.string().min(1).max(130) });
const HistoryQuery = HostQuery.extend({ range: z.enum(HOST_METRIC_RANGES).default("24h"), key: z.string().min(1).max(200).default(COMPONENT_POWER_KEY) });

async function fetchPeer<T>(peer: FleetPeer, path: string, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${peer.url.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${peer.token}` }, signal: AbortSignal.timeout(PEER_TIMEOUT_MS) });
  } catch {
    throw new Error("nicht erreichbar");
  }
  // Alte Hubs kennen den Pfad nicht oder lassen ihn für Fleet-Token nicht zu.
  if (res.status === 404 || res.status === 403) throw new Error("Version zu alt — Hub auf diesem Host aktualisieren");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new Error("unbekanntes Antwortformat");
  return parsed.data;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 200);

export function registerHostMetricsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const lastKnown = new Map<string, HostMetricsHost[]>();
  const peers = (scope: "local" | undefined): FleetPeer[] => (scope === "local" || ctx.deps.hostMetricsMergePeers === false ? [] : (ctx.deps.fleet?.peers() ?? []));

  async function peerHosts(peer: FleetPeer): Promise<HostMetricsHost[]> {
    try {
      const report = await fetchPeer(peer, "/api/hostmetrics?scope=local", HostMetricsReport);
      // Nur der eigene Host des Peers: eine ID gehört dem Hub, mit dem gekoppelt wurde.
      const hosts = report.hosts.filter((h) => h.kind === "hub").slice(0, 1).map((h) => ({ ...h, id: peer.hostId, kind: "peer" }));
      if (hosts.length === 0) throw new Error("Peer misst seinen Host nicht");
      lastKnown.set(peer.hostId, hosts);
      return hosts;
    } catch (err) {
      const status = { ok: false as const, error: message(err) };
      const known = lastKnown.get(peer.hostId);
      if (known) return known.map((h) => ({ ...h, status }));
      return [{ id: peer.hostId, label: peer.hostId, kind: "peer", status, ts: null, intervalSec: 0, summary: null, spark: [], today: null }];
    }
  }

  app.get("/api/hostmetrics", async (req, reply): Promise<HostMetricsReport | FastifyReply> => {
    const q = Scope.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    const remote = await Promise.all(peers(q.data.scope).map(peerHosts));
    return { generatedAt: new Date().toISOString(), hosts: [...(ctx.deps.hostMetrics?.hosts() ?? []), ...remote.flat()].slice(0, 64) };
  });

  /** Eigene ID des Peers: er kennt sich unter seinem Namen, nicht unter unserem. */
  async function peerSelf(peer: FleetPeer): Promise<string> {
    const report = await fetchPeer(peer, "/api/hostmetrics?scope=local", HostMetricsReport);
    const self = report.hosts.find((h) => h.kind === "hub");
    if (!self) throw new Error("Peer misst seinen Host nicht");
    return self.id;
  }

  app.get("/api/hostmetrics/host", async (req, reply) => {
    const q = HostQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    const local = ctx.deps.hostMetrics?.detail(q.data.id);
    if (local) return local;
    const peer = peers(q.data.scope).find((p) => p.hostId === q.data.id);
    if (!peer) return reply.code(404).send({ error: "unknown host" });
    try {
      const id = await peerSelf(peer);
      const detail = await fetchPeer(peer, `/api/hostmetrics/host?scope=local&id=${encodeURIComponent(id)}`, HostMetricsDetail);
      return { ...detail, host: { ...detail.host, id: peer.hostId, kind: "peer" } };
    } catch (err) {
      return reply.code(502).send({ error: message(err) });
    }
  });

  app.get("/api/hostmetrics/history", async (req, reply) => {
    const q = HistoryQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    const { id, key, range, scope } = q.data;
    const local = ctx.deps.hostMetrics?.history(id, key, range);
    if (local) return local;
    const peer = peers(scope).find((p) => p.hostId === id);
    if (!peer) return reply.code(404).send({ error: "unknown host" });
    try {
      const self = await peerSelf(peer);
      return await fetchPeer(peer, `/api/hostmetrics/history?scope=local&id=${encodeURIComponent(self)}&range=${range}&key=${encodeURIComponent(key)}`, HostMetricsHistory);
    } catch (err) {
      return reply.code(502).send({ error: message(err) });
    }
  });
}
