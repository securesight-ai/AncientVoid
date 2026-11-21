import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService, createInferenceTracker, type InferenceTracker } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { InferenceSnapshot, InferenceSourceList } from "@ancientvoid/contracts";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/**
 * EPIC-P79 (ADR-0102): GET /api/inference/sources und /api/inference/snapshot —
 * Contract-Stabilität, ehrliche leere Liste ohne Konfiguration, keine stillen
 * Rückfälle bei unbekannter Quellen-Id.
 */

const STRATA = {
  engine: { model: "Qwen3.8-Flash", version: "0.9", max_context: 131072 },
  live: { state: "generating", tok_s: 48.2, queued: 0, generated: 120, elapsed_s: 3 },
  totals: { requests: 12, prompt_tokens: 90000, reused: 84000, output_tokens: 9000, prompt_ms: 40000, decode_ms: 180000 },
  hardware: { gpu_util: 0.8, gpu_temp: 66, gpu_mem_used: 30_000_000_000, gpu_mem_total: 34_000_000_000 },
  hardware_static: { gpu_name: "RX 7900 XTX" },
  conversation_cache: { bytes: 1, evictions: 0 },
  history: { tok_s: [40, 41], prefill_tok_s_mean: [500], ram_used: [60_000_000_000] },
  requests: [
    { id: "a1", prompt_tokens: 9000, reused: 8900, prompt_read: 100, output_tokens: 300, prompt_ms: 400, decode_ms: 6000, first_engine_token_s: 0.6, finish: "stop" },
  ],
};

describe("GET /api/inference/* (EPIC-P79)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let token: string;

  async function buildApp(inference?: InferenceTracker): Promise<FastifyInstance> {
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    token = tokens.issue("pixel").token;
    return await createHubApp({ sessions, tokens, registry, ...(inference ? { inference } : {}), auth: { tokens, enforceTailnetIdentity: false } });
  }

  function tracker(): InferenceTracker {
    return createInferenceTracker(
      {
        fetch: async (url) => ({
          status: url.endsWith("/metrics") ? 200 : 404,
          ok: url.endsWith("/metrics"),
          text: async () => JSON.stringify(STRATA),
        }),
        readFile: async () => null,
        appendFile: async () => {},
        now: () => new Date("2026-11-21T12:00:00.000Z"),
        logger: { info() {}, warn() {}, error() {} },
      },
      [{ id: "s1", kind: "strata", url: "http://127.0.0.1:8080/metrics", label: "Strata" }],
      { storeFile: join(dir, "requests.jsonl"), windowHours: 24 },
    );
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-inference-"));
    app = await buildApp();
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("liefert ohne Konfiguration eine leere Quellen-Liste statt Nullen", async () => {
    const res = await app.inject({ method: "GET", url: "/api/inference/sources", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(InferenceSourceList.parse(res.json()).quellen).toEqual([]);
  });

  it("listet konfigurierte Quellen mit_contract-konformer Kurzform", async () => {
    const t = tracker();
    const tApp = await buildApp(t);
    await t.tickNow();
    const res = await tApp.inject({ method: "GET", url: "/api/inference/sources", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const liste = InferenceSourceList.parse(res.json());
    expect(liste.quellen.map((q) => q.id)).toEqual(["s1"]);
    expect(liste.quellen[0]?.features.perRequest).toBe(true);
    await tApp.close();
  });

  it("gibt einen Snapshot mit Verteilung und begrenzter Request-Liste zurück", async () => {
    const t = tracker();
    const tApp = await buildApp(t);
    await t.tickNow();
    const res = await tApp.inject({ method: "GET", url: "/api/inference/snapshot?id=s1&fenster=6", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const snap = InferenceSnapshot.parse(res.json());
    expect(snap.kind).toBe("strata");
    expect(snap.fensterH).toBe(6);
    expect(snap.requests.length).toBe(1);
    expect(snap.perf?.schwelleGelesen).toBeGreaterThanOrEqual(0);
    // K5: die Antwort bleibt klein genug für ein Handy
    expect(JSON.stringify(snap).length).toBeLessThan(8_192);
    await tApp.close();
  });

  it("unbekannte Quellen-Id ist ein 404 mit Liste der möglichen Ids, kein Rückfall", async () => {
    const t = tracker();
    const tApp = await buildApp(t);
    await t.tickNow();
    const res = await tApp.inject({ method: "GET", url: "/api/inference/snapshot?id=phantom", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string; verfuegbare: string[] };
    expect(body.error).toContain("phantom");
    expect(body.verfuegbare).toEqual(["s1"]);
    await tApp.close();
  });

  it("fehlt das id-Argument, ist die Antwort 400 (kein Raten)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/inference/snapshot", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
  });
});
