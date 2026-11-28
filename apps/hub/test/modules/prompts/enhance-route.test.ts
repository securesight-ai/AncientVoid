import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup(chat: (body: { messages: { role: string; content: string }[] }) => Response) {
  const root = await mkdtemp(join(tmpdir(), "ancientvoid-enhance-route-"));
  const project = join(root, "demo");
  await mkdir(join(project, ".claude", "skills", "bugfix"), { recursive: true });
  await writeFile(join(project, "AGENTS.md"), "Tests: npm run test:fast");
  await writeFile(join(project, ".claude", "skills", "bugfix", "SKILL.md"), "---\nname: bugfix\ndescription: Defekt reproduzieren und fixen\n---\nBody\n");
  const db = new HubDatabase(":memory:");
  const store = new EventStore(root);
  const registry = new AdapterRegistry();
  const sessions = new SessionManager(db, store, registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const token = tokens.issue("phone").token;
  const seen: { messages: { role: string; content: string }[] }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/slots")) return Response.json([{ is_processing: false }]);
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
    seen.push(body);
    return chat(body);
  }) as typeof fetch;
  const app = await createHubApp({
    sessions,
    settings: new SettingsStore(db),
    tokens,
    registry,
    auth: { tokens, enforceTailnetIdentity: false },
    projectRoots: [root],
    assistantModel: { url: "http://127.0.0.1:9/v1", model: "qwen3-coder", fetch: fakeFetch },
  });
  cleanups.push(async () => {
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  return { app, project, seen, headers: { authorization: `Bearer ${token}` } };
}

describe("POST /api/prompt-enhance with a local model (EPIC-P68)", () => {
  it("P90 persists the opt-in repo scan and uses it in the next rewrite", async () => {
    const { app, project, seen, headers } = await setup(() => Response.json({ choices: [{ message: { content: "Ziel: schneller Login" } }] }));
    const url = "/api/settings/prompt-enhancer";
    const ask = () => app.inject({ method: "POST", url: "/api/prompt-enhance", headers, payload: { adapter: "aider", text: "Prüfe AGENTS.md und nutze bugfix", project } });
    expect((await ask()).statusCode).toBe(200);
    expect(seen[0]?.messages[0]?.content).not.toContain("REPO_FAKTEN");
    expect((await app.inject({ method: "PUT", url, headers, payload: { engine: { kind: "auto" }, scan: true } })).statusCode).toBe(200);
    expect((await app.inject({ url, headers })).json().settings.scan).toBe(true);
    expect((await ask()).statusCode).toBe(200);
    expect(seen[1]?.messages[0]?.content).toContain("REPO_FAKTEN");
  });
  it("answers from the local model with the project context in the system message", async () => {
    const { app, project, seen, headers } = await setup(() => Response.json({ choices: [{ message: { content: "Ziel: schneller Login" } }] }));
    const res = await app.inject({ method: "POST", url: "/api/prompt-enhance", headers, payload: { adapter: "aider", text: "login schneller", project } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enhanced: "Ziel: schneller Login", engine: { kind: "local", model: "qwen3-coder" }, skipped: [] });
    const system = seen[0]!.messages[0]!.content;
    expect(system).toContain("Tests: npm run test:fast");
    expect(system).toContain("- skill bugfix — Defekt reproduzieren und fixen");
  });

  it("502 names every stage when local is busy and the fallback fails", async () => {
    const { app, project, headers } = await setup(() => new Response("", { status: 503 }));
    const prev = process.env.PATH;
    process.env.PATH = ""; // no real opencode/claude on the way
    try {
      const res = await app.inject({ method: "POST", url: "/api/prompt-enhance", headers, payload: { adapter: "claude", text: "x", project } });
      expect(res.statusCode).toBe(502);
      const body = res.json() as { error: string; skipped: { engine: string; reason: string }[] };
      expect(body.skipped[0]).toEqual({ engine: "Lokales Modell (qwen3-coder)", reason: "ausgelastet (HTTP 503)" });
      expect(body.skipped[1]!.engine).toBe("Claude");
    } finally {
      process.env.PATH = prev;
    }
  });
});

describe("skill maintenance routes (EPIC-P68 T68.5, AC-P68-5/6/7)", () => {
  it("reads an existing skill, saves an edit against its hash and refuses a stale one", async () => {
    const { app, project, headers } = await setup(() => Response.json({ choices: [{ message: { content: "{}" } }] }));
    const read = await app.inject({ method: "GET", url: `/api/skills/artifact?project=${encodeURIComponent(project)}&kind=skill&name=bugfix`, headers });
    expect(read.statusCode).toBe(200);
    const artifact = read.json() as { content: string; hash: string; path: string };
    expect(artifact.content).toContain("Body");

    const draft = artifact.content.replace("Body", "Body\nAuch Logs sichern.");
    const saved = await app.inject({ method: "PUT", url: "/api/skills", headers, payload: { project, kind: "skill", name: "bugfix", draft, baseHash: artifact.hash } });
    expect(saved.statusCode).toBe(200);
    const stale = await app.inject({ method: "PUT", url: "/api/skills", headers, payload: { project, kind: "skill", name: "bugfix", draft, baseHash: artifact.hash } });
    expect(stale.statusCode).toBe(409);

    const missing = await app.inject({ method: "GET", url: `/api/skills/artifact?project=${encodeURIComponent(project)}&kind=agent&name=bugfix`, headers });
    expect(missing.statusCode).toBe(404);
    const outside = await app.inject({ method: "GET", url: `/api/skills/artifact?project=${encodeURIComponent(tmpdir())}&kind=skill&name=bugfix`, headers });
    expect(outside.statusCode).toBe(422);
  });

  it("revise proposes a full file with the frontmatter kept and writes nothing", async () => {
    const { app, project, headers, seen } = await setup(() => Response.json({ choices: [{ message: { content: "Reproduzieren, Logs sichern, fixen." } }] }));
    const res = await app.inject({ method: "POST", url: "/api/skills/revise", headers, payload: { project, kind: "skill", name: "bugfix", prompt: "Auch Logs sichern", adapter: "claude" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { draft: string; baseHash: string; engine: { kind: string } };
    expect(body.engine.kind).toBe("local");
    expect(body.draft.startsWith("---\nname: bugfix\n")).toBe(true);
    expect(body.draft).toContain("Logs sichern");
    expect(seen[0]!.messages[1]!.content).toContain("Aktuelle Datei");
    const read = await app.inject({ method: "GET", url: `/api/skills/artifact?project=${encodeURIComponent(project)}&kind=skill&name=bugfix`, headers });
    expect((read.json() as { content: string; hash: string }).hash).toBe(body.baseHash);
  });

  it("the local judge narrows to none, and an invented name falls back to the heuristic", async () => {
    let answer = '{"action":"none"}';
    const { app, project, headers } = await setup(() => Response.json({ choices: [{ message: { content: answer } }] }));
    const ask = () => app.inject({ method: "POST", url: "/api/prompt-recommendation", headers, payload: { project, text: "Bitte den Defekt reproduzieren und fixen" } });
    expect((await ask()).json()).toBeNull();
    answer = '{"action":"use","name":"gibts-nicht"}';
    expect((await ask()).json()).toMatchObject({ mode: "match", name: "bugfix" });
    answer = '{"action":"update","name":"bugfix","reason":"Logs fehlen"}';
    expect((await ask()).json()).toMatchObject({ mode: "update", name: "bugfix", reason: "Lokales Modell: Logs fehlen" });
  });
});
