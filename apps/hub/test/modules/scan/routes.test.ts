import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, ScanService, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/**
 * EPIC-P80 T80.3 (ADR-0118) über die echte HTTP-Naht: Menschen-Scan läuft
 * direkt, Agenten-Scan geht über die Freigabe-Queue und wird nach der
 * Entscheidung wirklich ausgeführt (D4), Nicht-Liste wird sichtbar abgelehnt
 * (D5), und ohne Konfiguration erklärt die Lesewege sichtbar die Lage (K10).
 * Das SiLenT-Deck ist hier ein injizierter Fake — kein echter Port nach außen.
 */

const TARGET = "100.200.300.40";

interface Body {
  configured?: boolean;
  state?: string;
  detail?: string;
  jobs?: { id: string; state: string }[];
  job?: { id: string; state: string };
  parsed?: { parsed?: { hosts?: { ip: string; status: string }[] } } | null;
  approvalId?: string;
  error?: string;
  summary?: string;
  decision?: string;
  status?: string;
}

function fakeDeck(): { fetch: (url: string, init?: RequestInit) => Promise<Response> } {
  return {
    async fetch(url: string, init?: RequestInit) {
      const u = new URL(url);
      if (u.pathname === "/api/health") {
        return Response.json({ ok: true, llm: "kein LLM gesetzt", host: "fake" });
      }
      if (u.pathname === "/api/scan" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { target: string; profile: string };
        return Response.json({
          code: 0,
          parsed: { hosts: [{ ip: body.target, hostname: null, status: "Up", ports: ["22/tcp:open"] }] },
          output: "Nmap scan report",
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  };
}

describe("Pentest-Routen (/api/pentest)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let human: string;
  let agent: string;

  async function build(withScan: boolean): Promise<void> {
    const db = new HubDatabase(":memory:");
    tokens = new TokenService(db);
    const registry = new AdapterRegistry();
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const approvals = new ApprovalService(db);
    let scan: ScanService | undefined;
    if (withScan) {
      const fs = await import("node:fs/promises");
      scan = new ScanService(
        {
          backendUrl: "http://deck.fake",
          credentialsFile: null,
          enabled: true,
          probeIntervalMs: 30_000,
          timeoutMs: 10_000,
          windowHours: 720,
          targets: [{ label: "Test", target: TARGET, kind: "frei" }],
          tools: [],
        },
        {
          readFile: async (path: string) => fs.readFile(path, "utf8").catch(() => null),
          appendFile: async (path: string, data: string) => {
            await fs.appendFile(path, data, "utf8");
          },
          writeFile: async (path: string, data: string) => {
            await fs.mkdir(join(path, ".."), { recursive: true });
            await fs.writeFile(path, data, "utf8");
          },
          now: () => new Date(),
          approvals,
          operations: sessions.operations(),
          fetch: fakeDeck().fetch,
        },
        join(dir, "scan"),
      );
      await scan.load();
      await scan.load();
    }
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots: [dir],
      approvals,
      ...(scan ? { scan } : {}),
    });
  }

  async function call(method: "GET" | "POST", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Body };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-scan-route-"));
    await build(true);
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("AC-P80-2: ohne Konfiguration erklärt der Status sichtbar die Lage", async () => {
    await sessions.shutdown();
    await app.close();
    await build(false);
    const res = await call("GET", "/api/pentest/status", tokens.issue("pixel").token);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.state).toBe("config");
    expect(res.body.detail).toMatch(/pentest/i);
  });

  it("AC-P80-1 (HTTP-Naht): Menschen-Scan läuft direkt und ist danach voll da", async () => {
    const res = await call("POST", "/api/pentest/scan", human, { target: TARGET, profile: "quick" });
    expect(res.status).toBe(202);
    expect(res.body.job?.state).toBe("done");
    const jobs = await call("GET", "/api/pentest/jobs", human);
    expect(jobs.body.jobs?.[0]?.state).toBe("done");
    const detail = await call("GET", `/api/pentest/jobs/${res.body.job?.id}`, human);
    expect(detail.body.parsed?.parsed?.hosts?.[0]?.ip).toBe(TARGET);
  });

  it("D4 (HTTP-Naht): Agenten-Scan geht über die Freigabe und läuft erst nach dem Ja", async () => {
    const res = await call("POST", "/api/pentest/scan", agent, { target: TARGET, profile: "quick" });
    expect(res.status).toBe(202);
    expect(res.body.approvalId).toBeTruthy();
    expect((await call("GET", "/api/pentest/jobs", human)).body.jobs?.length ?? 0).toBe(0);
    const decided = await call("POST", `/api/approvals/${res.body.approvalId}/decide`, human, { decision: "approve" });
    expect(decided.status).toBe(200);
    const jobs = await call("GET", "/api/pentest/jobs", human);
    expect(jobs.body.jobs?.[0]?.state).toBe("done");
  });

  it("AC-P80-5 (HTTP-Naht): Ziel außerhalb der Liste wird sichtbar abgelehnt", async () => {
    const res = await call("POST", "/api/pentest/scan", human, { target: "8.8.8.8", profile: "quick" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Allowliste/i);
  });

  it("Status mit Backend: Kopfprobe erreicht den Fake und meldet ok", async () => {
    const res = await call("GET", "/api/pentest/status", human);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.state).toBe("ok");
  });
});
