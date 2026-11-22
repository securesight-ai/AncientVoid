import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

function chatJson(content: string): unknown {
  return { choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 12, completion_tokens: 3 } };
}

/**
 * BUG-0258: manuelle Modell-Anbindung — Settings-Roundtrip über den
 * SettingsStore, echte Probe, und die Frage-Route gegen einen Attrappen-Dienst
 * (OpenAI-kompatibel). Der Schlüssel liegt nur in der Datei und erscheint in
 * keiner Antwort (ADR-0011).
 */
describe("Inference-Modell-Routen (BUG-0258)", () => {
  let dir: string;
  let app: FastifyInstance;
  let tokens: TokenService;
  let sessions: SessionManager;
  let human: string;
  let keyPath: string;
  const KEY = "e2e-geheimer-inferenz-key";
  const calls: Array<{ method: string; url: string; auth?: string; body?: unknown }> = [];
  let upstream: { status: number; json: unknown } = { status: 200, json: chatJson("angebunden") };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-inference-"));
    keyPath = join(dir, "evox2.key");
    await writeFile(keyPath, KEY, "utf8");
    const db = new HubDatabase(":memory:");
    const settings = new SettingsStore(db);
    const registry = new AdapterRegistry();
    tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, ".data")), registry, new ProcessRunner());
    calls.length = 0;
    upstream = { status: 200, json: chatJson("angebunden") };
    const inferenceFetch = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", url: String(url), auth: init.headers ? (init.headers as Record<string, string>)["authorization"] : undefined, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(upstream.status === 200 ? JSON.stringify(upstream.json) : "{}", { status: upstream.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    app = await createHubApp({ sessions, tokens, registry, approvals: new ApprovalService(db), auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [], settings, inferenceFetch });
    human = tokens.issue("pixel").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("ohne Anbindung: Status ungebunden, Frage endet 501 mit Wegbeschreibung (fail loud)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ bound: false, url: null, model: null, probe: null });

    const ask = await app.inject({ method: "POST", url: "/api/inference/ask", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ text: "Hallo?" }) });
    expect(ask.statusCode).toBe(501);
    expect(ask.json().error).toContain("Kein Inferenz-Modell angebunden");
  });

  it("PUT bindet URL/Modell/Schlüsseldatei, GET meldet gebunden mit erfolgreicher Probe", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1:8100/v1", model: "halogen-qwen3.8-flash-next-uncensored-iq4xs", apiKeyFile: keyPath }) });
    expect(put.statusCode).toBe(200);
    expect(put.json().inference).toEqual({ url: "http://127.0.0.1:8100/v1", model: "halogen-qwen3.8-flash-next-uncensored-iq4xs", apiKeyFile: keyPath });

    const res = await app.inject({ method: "GET", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}` } });
    expect(res.json()).toMatchObject({ bound: true, model: "halogen-qwen3.8-flash-next-uncensored-iq4xs", probe: { ok: true } });
    expect(calls[0]?.url).toBe("http://127.0.0.1:8100/v1/models");
    expect(calls[0]?.auth).toBe(`Bearer ${KEY}`);
  });

  it("ask ruft chat/completions mit Bearer aus der Datei und liefert die Antwort des Modells", async () => {
    await app.inject({ method: "PUT", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1:8100/v1", model: "halogen-qwen3.8-flash-next-uncensored-iq4xs", apiKeyFile: keyPath }) });
    upstream = { status: 200, json: chatJson("Der Hub ist erreichbar.") };

    const res = await app.inject({ method: "POST", url: "/api/inference/ask", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ text: "Antworte kurz." }) });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.answer).toBe("Der Hub ist erreichbar.");
    expect(json.model).toBe("halogen-qwen3.8-flash-next-uncensored-iq4xs");
    expect(json.tokens).toEqual({ prompt: 12, completion: 3 });
    expect(typeof json.ms).toBe("number");

    const chat = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect(chat.method).toBe("POST");
    expect(chat.auth).toBe(`Bearer ${KEY}`);
    expect(chat.body).toMatchObject({ model: "halogen-qwen3.8-flash-next-uncensored-iq4xs", stream: false });
    // ADR-0011: der Schlüssel erscheint in keiner Antwort.
    expect(JSON.stringify(json)).not.toContain(KEY);
  });

  it("totes Modell: 502 mit Grund, leere Antwort wird abgelehnt — nie still", async () => {
    await app.inject({ method: "PUT", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1:8100/v1", model: "m", apiKeyFile: keyPath }) });
    upstream = { status: 500, json: {} };
    let res = await app.inject({ method: "POST", url: "/api/inference/ask", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ text: "?" }) });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("HTTP 500");

    upstream = { status: 200, json: chatJson("") };
    res = await app.inject({ method: "POST", url: "/api/inference/ask", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ text: "?" }) });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("ohne Text");
  });

  it("ungültige Eingaben: PUT 400, Frage ohne Text 400", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ url: "kein-url" }) });
    expect(put.statusCode).toBe(400);

    await app.inject({ method: "PUT", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1:8100/v1", model: "m" }) });
    const leer = await app.inject({ method: "POST", url: "/api/inference/ask", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ text: "   " }) });
    expect(leer.statusCode).toBe(400);
  });

  it("Löschen der Anbindung (null) stellt ungebunden her", async () => {
    await app.inject({ method: "PUT", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1:8100/v1", model: "m" }) });
    await app.inject({ method: "PUT", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, body: JSON.stringify({ url: null, model: null, apiKeyFile: null }) });
    const res = await app.inject({ method: "GET", url: "/api/settings/inference", headers: { authorization: `Bearer ${human}` } });
    expect(res.json()).toMatchObject({ bound: false, url: null, model: null });
  });
});
