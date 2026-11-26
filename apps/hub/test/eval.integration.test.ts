import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createAdapter } from "@ancientvoid/adapter-dummy";
import { EVAL_COMPLETE_EVENT, type EvalRunInput } from "@ancientvoid/contracts";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../src/app.ts";

it("P84 saves 20 parallellaufende Abnahmen ohne Lücken und liest sie nach Neustart mit leerem Turn-Cache", async () => {
  const dir = await mkdtemp(join(tmpdir(), "p84-route-"));
  const dbPath = join(dir, "hub.db");
  const registry = new AdapterRegistry();
  const dummy = createAdapter();
  registry.register("metered", () => ({
    ...dummy,
    capabilities: () => ({ ...dummy.capabilities(), features: { ...dummy.capabilities().features!, modelChoice: "start" } }),
    async start(_spec, ctx) {
      ctx.emit({ type: "system", summary: EVAL_COMPLETE_EVENT, payload: { kind: EVAL_COMPLETE_EVENT } });
      ctx.emit({ type: "system", summary: "metered", payload: { usage: { input: 20, output: 10 }, cacheInputTokens: 100 }, tokensEst: 130 });
      ctx.emit({ type: "system", summary: "metered-aggregated", payload: { usage: { input: 120, output: 10 }, cacheInputTokens: 100, cacheIncluded: true }, tokensEst: 130 });
      ctx.emit({ type: "system", summary: "finished", payload: { kind: "session.turn_end", code: 0 } });
      return { sessionId: ctx.sessionId };
    },
  }));
  async function create() {
    const db = new HubDatabase(dbPath);
    const store = new EventStore(dir);
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const app = await createHubApp({ sessions, tokens, registry, store, projectRoots: [dir], auth: { tokens, enforceTailnetIdentity: false } });
    return { app, db, store, sessions, tokens };
  }

  let hub = await create();
  try {
    const authorise = (token: string) => ({ authorization: `Bearer ${token}` });
    const headers = authorise(hub.tokens.issue("p84-operator").token);
    const agent = authorise(hub.tokens.issue("agent:p84").token);
    const response = await hub.app.inject({ method: "POST", url: "/api/sessions/unknown/evaluation", headers, payload: {} });
    expect(response.statusCode).toBe(400);

    const start = async (index: number) => {
      const project = join(dir, `repo-${index}`);
      await mkdir(project);
      const created = await hub.app.inject({
        method: "POST", url: "/api/sessions", headers,
        payload: { adapter: "metered", model: "test/model", project, workspaceMode: "direct", prompt: "Task" },
      });
      expect(created.statusCode, created.body).toBe(201);
      const { id } = created.json();
      await expect.poll(() => hub.sessions.turnMetrics(id).length).toBe(1);
      expect((await hub.app.inject({ method: "POST", url: `/api/sessions/${id}/stop`, headers, payload: {} })).statusCode).toBe(200);
      return id as string;
    };
    const ids = await Promise.all(Array.from({ length: 20 }, (_, index) => start(index)));
    const records = await Promise.all(ids.map(async (id, index) => {
      const hash = "a".repeat(64);
      const payload: EvalRunInput = {
        series: "fixture", arm: "metered", task: "task", repetition: index + 1, attempt: 1,
        corpusHash: hash, protocolHash: hash, rulesHash: hash, skillHash: null,
        skills: false, acceptance: true, baseline: 1, lint: true, typecheck: true,
        phases: [{ sessionId: id, phase: "build", modelFingerprint: "v1", harnessVersion: "1.0.0", wallMs: 20,
          billing: index % 2 === 0
            ? { kind: "cloud", date: "2026-11-25", source: "https://example.com/prices", inputUsdPerMillion: 2, cacheInputUsdPerMillion: 0.5, outputUsdPerMillion: 4 }
            : { kind: "local", date: "2026-11-25", source: "p81:power:components", host: "test", kwh: 0.01, usdPerKwh: 0.25 },
        }],
      };
      const url = `/api/sessions/${id}/evaluation`;
      const request = { method: "POST" as const, url, headers, payload };
      expect((await hub.app.inject({ ...request, headers: agent })).statusCode).toBe(403);
      const first = await hub.app.inject(request);
      expect(first.statusCode, first.body).toBe(200);
      const record = first.json();
      expect(record.phases[0]).toMatchObject({ inputTokens: 240, cacheInputTokens: 200, outputTokens: 20, costUsd: index % 2 === 0 ? 0.00026 : 0.0025 });
      expect((await hub.app.inject(request)).json()).toEqual(record);
      expect((await hub.app.inject({ ...request, payload: { ...payload, acceptance: false } })).statusCode).toBe(422);
      expect((await hub.store.replay(id)).filter((event) => event.summary === EVAL_COMPLETE_EVENT)).toHaveLength(1);
      return { url, record, id };
    }));

    await hub.app.close();
    hub.db.prepare("DELETE FROM turn_metrics").run();
    hub.db.close();
    hub = await create();
    await hub.sessions.recoverAll();
    for (const { url, record, id } of records) {
      expect(hub.sessions.turnMetrics(id)).toEqual([]);
      expect((await hub.app.inject({ method: "GET", url, headers })).json()).toEqual(record);
    }
    // P84: dieselbe Zusammenfassung für PWA und Report — nach dem Neustart aus den Journalen (K7).
    const listed = (await hub.app.inject({ method: "GET", url: "/api/evaluation/series", headers })).json();
    expect(listed.series).toEqual([{ series: "fixture", runs: 20, lastRecordedAt: expect.any(String) }]);
    const summary = (await hub.app.inject({ method: "GET", url: "/api/evaluation/series/fixture", headers })).json();
    expect(summary).toMatchObject({ series: "fixture", runs: 20, consistent: true });
    expect(summary.rows.map((row: { task: string }) => row.task)).toEqual(["task", "gesamt"]);
    const total = summary.rows.find((row: { task: string }) => row.task === "gesamt");
    expect(total.n).toBe(20);
    expect(total.metrics.cacheTokens.median).toBe(200);
    expect(total.metrics.energyKwh).toMatchObject({ min: 0, max: 0.01 });
    expect((await hub.app.inject({ method: "GET", url: "/api/evaluation/series/unbekannt", headers })).statusCode).toBe(404);
  } finally {
    await hub.app.close();
    hub.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
