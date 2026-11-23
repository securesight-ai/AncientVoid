import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, FleetStore, HostMetricsHistoryStore, HubDatabase, SessionManager, TokenService, createHostMetricsService, type HostMetricsService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { HostMetricsDetail, HostMetricsHistory, HostMetricsReport, isFleetRoutable } from "@ancientvoid/contracts";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P81 T81.7 (ADR-0117 §6): lesen, zusammenführen, alte und tote Peers. */
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function service(id: string): Promise<HostMetricsService> {
  const s = createHostMetricsService({
    history: new HostMetricsHistoryStore(":memory:"),
    nowMs: () => Date.now(),
    logger: { warn: () => undefined },
    sources: [
      {
        id,
        label: id.toUpperCase(),
        kind: "hub",
        intervalSec: 5,
        collector: { collect: async () => ({ ts: new Date().toISOString(), errors: [], points: [{ key: "k", group: "power", device: "gpu", label: "PPT", unit: "W", value: 5, reason: null, source: "hwmon", powerDomain: "gpu:1" }] }) },
      },
    ],
  });
  await s.tick(id);
  cleanup.push(() => s.stop());
  return s;
}

async function hub(opts: { hostMetrics?: HostMetricsService; peers?: { hostId: string; url: string; token: string }[] }) {
  const dir = await mkdtemp(join(tmpdir(), "hm-routes-"));
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  const tokens = new TokenService(db);
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  const fleet = new FleetStore(db, tokens);
  fleet.peers = () => (opts.peers ?? []).map((p) => ({ ...p, protocolVersion: 1, pairedAt: "" }));
  const app = await createHubApp({ sessions, tokens, registry, fleet, ...(opts.hostMetrics ? { hostMetrics: opts.hostMetrics } : {}), auth: { tokens, enforceTailnetIdentity: false } });
  cleanup.push(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const token = tokens.issue("pixel").token;
  const fleetToken = tokens.issue("fleet:home").token;
  return { app, fleetToken, get: (url: string, t = token) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${t}` } }) };
}

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server: Server = createServer(handler!);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanup.push(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("GET /api/hostmetrics", () => {
  it("ohne Token 401, ohne Dienst leere Liste", async () => {
    const h = await hub({});
    expect((await h.app.inject({ method: "GET", url: "/api/hostmetrics" })).statusCode).toBe(401);
    expect(HostMetricsReport.parse((await h.get("/api/hostmetrics")).json()).hosts).toEqual([]);
  });

  it("eigener Host, Detail und Verlauf; Unbekanntes ist 404, Unsinn 400", async () => {
    const h = await hub({ hostMetrics: await service("home") });
    expect(HostMetricsReport.parse((await h.get("/api/hostmetrics")).json()).hosts[0]).toMatchObject({ id: "home", summary: { watts: 5 } });
    expect(HostMetricsDetail.parse((await h.get("/api/hostmetrics/host?id=home")).json()).sample!.points).toHaveLength(1);
    expect(HostMetricsHistory.parse((await h.get("/api/hostmetrics/history?id=home&range=7d")).json()).points).toEqual([]);
    expect((await h.get("/api/hostmetrics/host?id=x")).statusCode).toBe(404);
    expect((await h.get("/api/hostmetrics/history?id=home&range=1y")).statusCode).toBe(400);
  });

  it("führt einen echten Peer über dessen Fleet-Token zusammen, auch Detail und Verlauf", async () => {
    const peer = await hub({ hostMetrics: await service("peer-self") });
    await peer.app.listen({ port: 0, host: "127.0.0.1" });
    const url = `http://127.0.0.1:${(peer.app.server.address() as AddressInfo).port}`;
    const home = await hub({ hostMetrics: await service("home"), peers: [{ hostId: "zwei", url, token: peer.fleetToken }] });
    const report = HostMetricsReport.parse((await home.get("/api/hostmetrics")).json());
    expect(report.hosts.map((x) => [x.id, x.kind, x.status.ok])).toEqual([["home", "hub", true], ["zwei", "peer", true]]);
    expect(HostMetricsDetail.parse((await home.get("/api/hostmetrics/host?id=zwei")).json()).host.id).toBe("zwei");
    expect((await home.get("/api/hostmetrics/history?id=zwei&range=1h")).statusCode).toBe(200);
    expect(JSON.stringify(report)).not.toContain(peer.fleetToken);
  });

  it("alter Peer heißt „Version zu alt“, toter Peer behält den letzten Wert", async () => {
    const old = await listen((_req, res) => res.writeHead(404).end());
    let alive = true;
    const good = (await service("z")).hosts();
    const flaky = await listen((req, res) => {
      if (!alive) return void req.socket.destroy();
      res.setHeader("content-type", "application/json").end(JSON.stringify({ generatedAt: "", hosts: good }));
    });
    const home = await hub({ peers: [{ hostId: "alt", url: old, token: "t" }, { hostId: "wackel", url: flaky, token: "t" }] });
    await home.get("/api/hostmetrics");
    alive = false;
    const [a, b] = HostMetricsReport.parse((await home.get("/api/hostmetrics")).json()).hosts;
    expect(a!.status).toMatchObject({ ok: false, error: expect.stringContaining("Version zu alt") });
    expect(b).toMatchObject({ id: "wackel", status: { ok: false, error: "nicht erreichbar" }, summary: { watts: 5 } });
    expect(b!.ts).not.toBeNull();
  });

  it("scope=local fragt keine Peers; der Pfad ist für Fleet-Token frei", async () => {
    let asked = 0;
    const url = await listen((_req, res) => {
      asked += 1;
      res.writeHead(500).end();
    });
    const home = await hub({ hostMetrics: await service("home"), peers: [{ hostId: "p", url, token: "t" }] });
    expect((await home.get("/api/hostmetrics?scope=local")).json().hosts).toHaveLength(1);
    expect(asked).toBe(0);
    expect(isFleetRoutable("/api/hostmetrics/history?id=x")).toBe(true);
  });
});
