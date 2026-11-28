import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService, type KnowledgeService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P90 T90.5/AC-P90-4: gepinnte Engine über die echte Route — die pi-Stufe
 * antwortet, ein Ausfall fällt sichtbar auf auto zurück. T90.6: Wissensquelle
 * nur im Angebotsmodus, still, wenn sie nicht angebunden ist. */
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Ein pi-Ersatz als echtes CLI: antwortet je nach Modell-Flag unterschiedlich —
 * derselbe One-Shot-Bauart-Aufruf, den auch `piOneShot` macht. */
async function fakePi(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ancientvoid-fakepi-"));
  const file = join(dir, "fake-pi");
  await writeFile(file, script);
  await chmod(file, 0o755);
  cleanups.push(async () => { await rm(dir, { recursive: true, force: true }); });
  return file;
}

interface Setup {
  app: Awaited<ReturnType<typeof createHubApp>>;
  project: string;
  seen: { messages: { role: string; content: string }[] }[];
  headers: { authorization: string };
  knowledge: { sources: { id: string; label: string }[]; hits: { title: string; snippet: string }[] };
}

async function setup(piCommand: string): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), "ancientvoid-pin-route-"));
  const project = join(root, "demo");
  await mkdir(join(project, "src"), { recursive: true });
  await writeFile(join(project, "AGENTS.md"), "Tests: npm run test:fast");
  await writeFile(join(project, "src", "login.ts"), "export function login() {}");
  const db = new HubDatabase(":memory:");
  const store = new EventStore(root);
  const registry = new AdapterRegistry();
  const sessions = new SessionManager(db, store, registry, new ProcessRunner());
  registry.register("pi", () => ({
    id: "pi",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: { followUp: false, interrupt: false, handover: false, attachments: false, thinking: false, images: false, tools: false } }),
    async start(_s: unknown, ctx: { sessionId: string }) { return { sessionId: ctx.sessionId }; },
    async stop() {},
  }) as never, { command: piCommand }, "@ancientvoid/adapter-pi");
  const tokens = new TokenService(db);
  const token = tokens.issue("phone").token;
  const seen: { messages: { role: string; content: string }[] }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/slots")) return Response.json([{ is_processing: false }]);
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
    seen.push(body);
    return Response.json({ choices: [{ message: { content: "Ziel: Login über lokal" } }] });
  }) as typeof fetch;
  const knowledge = { sources: [{ id: "11111111-2222-4333-8444-555555555555", label: "Brain" }], hits: [{ title: "Login-Regel", snippet: "Login geht über src/login.ts" }] };
  const app = await createHubApp({
    sessions,
    settings: new SettingsStore(db),
    tokens,
    registry,
    auth: { tokens, enforceTailnetIdentity: false },
    projectRoots: [root],
    assistantModel: { url: "http://127.0.0.1:9/v1", model: "qwen3-coder", fetch: fakeFetch },
    knowledge: {
      list: () => knowledge.sources.map((source) => ({ id: source.id, label: source.label, url: "http://m", auth: "none", hasSecret: false, tools: { search: true }, createdAt: new Date().toISOString(), status: "ok" })),
      search: async () => ({ ok: true, result: { hits: knowledge.hits.map((hit) => ({ ref: "r", ...hit })), truncated: false } }),
    } as unknown as KnowledgeService,
  });
  cleanups.push(async () => {
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  return { app, project, seen, headers: { authorization: `Bearer ${token}` }, knowledge };
}

describe("POST /api/prompt-enhance mit gepinnter Engine (EPIC-P90, AC-P90-4)", () => {
  it("eine gepinnte pi-Auswahl mit freiem Modell antwortet über die pi-Stufe, nicht über OpenCode", async () => {
    const pi = await fakePi('#!/bin/sh\nfor arg in "$@"; do [ "$arg" = "local/qwen" ] && echo "Ziel: Login über pi und local/qwen" && exit 0; done\necho "Ziel: Login über pi ohne Modell"\n');
    const { app, project, headers, seen } = await setup(pi);
    expect((await app.inject({ method: "PUT", url: "/api/settings/prompt-enhancer", headers, payload: { engine: { kind: "adapter", id: "pi", model: "local/qwen" }, scan: false } })).statusCode).toBe(200);
    const res = await app.inject({ method: "POST", url: "/api/prompt-enhance", headers, payload: { adapter: "pi", text: "Login schneller in src/login.ts", project } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enhanced: "Ziel: Login über pi und local/qwen", engine: { kind: "adapter", id: "pi", model: "local/qwen" } });
    expect(seen).toHaveLength(0); // die lokale Stufe wurde nie gefragt
  });

  it("fällt die gepinnte Engine aus, antwortet auto sichtbar mit dem Grund (K10)", async () => {
    const pi = await fakePi("#!/bin/sh\necho kaputt 1>&2\nexit 1\n");
    const { app, project, headers, seen } = await setup(pi);
    expect((await app.inject({ method: "PUT", url: "/api/settings/prompt-enhancer", headers, payload: { engine: { kind: "adapter", id: "pi" }, scan: false } })).statusCode).toBe(200);
    const res = await app.inject({ method: "POST", url: "/api/prompt-enhance", headers, payload: { adapter: "pi", text: "Login schneller in src/login.ts", project } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enhanced: string; engine: { kind: string; model: string }; skipped: { engine: string; reason: string }[] };
    expect(body.engine).toMatchObject({ kind: "local", model: "qwen3-coder" });
    expect(body.skipped[0]!.engine).toBe("pi");
    expect(body.skipped[0]!.reason).toContain("Command failed");
    expect(seen).toHaveLength(1);
  });
});

describe("Wissensquelle im Angebotsmodus (EPIC-P90 T90.6, AC-P90-5)", () => {
  it("liefert Treffer nur bei angebundener Quelle — und bleibt still, wenn sie verschwindet", async () => {
    const pi = await fakePi("#!/bin/sh\necho egal\nexit 1\n");
    const { app, project, headers, seen, knowledge } = await setup(pi);
    expect((await app.inject({ method: "PUT", url: "/api/settings/prompt-enhancer", headers, payload: { engine: { kind: "auto" }, scan: true, knowledgeSource: "11111111-2222-4333-8444-555555555555" } })).statusCode).toBe(200);
    const ask = () => app.inject({ method: "POST", url: "/api/prompt-enhance", headers, payload: { adapter: "pi", text: "Login schneller in src/login.ts", project } });
    expect((await ask()).statusCode).toBe(200);
    expect(seen[0]!.messages[0]!.content).toContain("WISSENSDATEN");
    expect(seen[0]!.messages[0]!.content).toContain("Login-Regel");
    // Die Quelle ist nicht mehr angebunden: kein Fehler, kein Block — still (AC-P90-5).
    knowledge.sources.splice(0, knowledge.sources.length);
    expect((await ask()).statusCode).toBe(200);
    expect(seen[1]!.messages[0]!.content).not.toContain("WISSENSDATEN");
  });
});
