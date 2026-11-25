#!/usr/bin/env node
/**
 * EPIC-P62 T62.3: Demo-Hub-Seed — die EINZIGE erlaubte Datenquelle für
 * Guide-Screenshots (T62.4) und Video-Szenen (T62.5, docs/demo-media.md).
 * Startet einen echten Hub in-process und befüllt ihn deterministisch:
 * Fake-Projekte aus der Allowlist, Sessions über adapter-dummy, Fake-Hosts,
 * eine wartende Freigabe, ein Medien- und ein Automation-Beispiel.
 *
 * `npm run demo:seed [-- --port 4567] [--data <dir>]` — Standard: Port 4567,
 * Daten unter data/demo-hub (gitignored). Strg+C beendet.
 *
 * Der Test (scripts/demo-seed.test.mjs) ist der Maßstab: der Seed erzeugt
 * ausschließlich Allowlist-Werte — die Allowlist steht hier, nicht in der
 * Intuition des Aufnehmenden.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, AttachmentStore, EventStore, FleetStore, HubDatabase, MediaJobs, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../apps/hub/src/app.ts";

/** BUG-0183: `apps/pwa/dist` ist das Bündel, das ein laufender Hub am Handy servt.
 * Der Guide baut sein eigenes (`dist-guide`) — wer trotzdem den Guide-Datenraum startet,
 * bekommt beides: das Guide-Bündel, falls vorhanden, sonst das ausgelieferte. */
function pwaDistDir(): string {
  const guide = resolve("apps/pwa/dist-guide");
  return existsSync(guide) ? guide : resolve("apps/pwa/dist");
}

export const DEMO_PROJECTS = ["demo-website", "demo-api", "demo-tooling"] as const;
export const DEMO_HOSTS = ["demo-gpubox", "demo-laptop"] as const;
export const DEMO_PROMPTS = [
  "Refactor the login flow and add tests",
  "Sketch a REST endpoint for user profiles",
  "Audit the dependency list for known CVEs",
  "Draft a migration plan for the config format",
] as const;
export const DEMO_AUTOMATION = {
  name: "demo-weekly-audit",
  kind: "swarm",
  schedule: "weekly",
} as const;

/** deterministischer Mini-PNG (1×1, keine Metadaten) für das Medien-Beispiel */
export const DEMO_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6200010000050001" +
    "0d0a2db40000000049454e44ae426082",
  "hex",
);

export function buildDemoWorkspace(root: string): string[] {
  const dirs: string[] = [];
  for (const name of DEMO_PROJECTS) {
    const dir = join(root, name);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
      execFileSync("git", ["-C", dir, "config", "user.email", "demo@ancientvoid.local"]);
      execFileSync("git", ["-C", dir, "config", "user.name", "demo seed"]);
      writeFileSync(join(dir, "README.md"), `# ${name}\n\nDeterministic demo project (EPIC-P62 T62.3).\n`);
      execFileSync("git", ["-C", dir, "add", "-A"]);
      execFileSync("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
    }
    dirs.push(dir);
  }
  return dirs;
}

async function call(app: FastifyInstance, token: string, method: "GET" | "POST", url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, body: res.json() };
}

/** befüllt den Hub — rückgabefrei, wirft bei Abweichung von der Allowlist. */
export async function seedDemoHub(
  app: FastifyInstance,
  token: string,
  fleet: FleetStore,
  sessions: SessionManager,
  workspace: string[],
): Promise<string[]> {
  const created: string[] = [];
  // Fake-Hosts (Fleet-Ansicht): nur Allowlist-IDs, nie echte Namen.
  for (const host of DEMO_HOSTS) {
    fleet.savePeer({ hostId: host, url: `http://127.0.0.1:9/${host}`, token: `fleet-demo-${host}`, protocolVersion: 1, pairedAt: new Date().toISOString() });
  }
  // Sessions: drei Projekte, vier Prompts — ein Zug läuft weiter (dummy 5 ev/s),
  // einer wird gestoppt, einer bittet um Freigabe.
  let i = 0;
  for (const prompt of DEMO_PROMPTS) {
    const project = workspace[i % workspace.length]!;
    const res = await call(app, token, "POST", "/api/sessions", { adapter: "dummy", project, prompt });
    if (res.status !== 201) throw new Error(`demo-seed: session create failed (${res.status}): ${JSON.stringify(res.body)}`);
    created.push(res.body.id);
    i++;
  }
  const [running, finished, approval, queued] = created;
  await call(app, token, "POST", `/api/sessions/${running}/steer`, { kind: "prompt", text: DEMO_PROMPTS[0] });
  await call(app, token, "POST", `/api/sessions/${finished}/stop`, {});
  await sessions.requestAgentAction("steer.prompt", approval ?? created[0]!, { input: { kind: "prompt", text: DEMO_PROMPTS[1] }, typed: DEMO_PROMPTS[1] }, "agent:demo");
  await call(app, token, "POST", `/api/sessions/${queued}/steer`, { kind: "prompt", text: DEMO_PROMPTS[3], queue: true });
  // Medien-Beispiel: der deterministische Demo-PNG.
  const upload = await app.inject({
    method: "POST",
    url: "/api/media/upload",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
    payload: DEMO_PNG,
  });
  if (upload.statusCode >= 400) throw new Error(`demo-seed: media upload failed (${upload.statusCode})`);
  return created;
}

async function main() {
  const port = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 4567);
  const dataArg = process.argv.includes("--data") ? process.argv[process.argv.indexOf("--data") + 1] : null;
  const root = resolve(dataArg ?? "data/demo-hub");
  rmSync(join(root, "events"), { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const workspace = buildDemoWorkspace(root);

  const db = new HubDatabase(join(root, "hub.db"));
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
  const eventsDir = join(root, "events");
  mkdirSync(eventsDir, { recursive: true });
  const sessions = new SessionManager(db, new EventStore(eventsDir), registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const { token } = tokens.issue("demo-camera");
  const fleet = new FleetStore(db, tokens);
  const attachments = new AttachmentStore(db, join(root, "attachments"));
  const media = new MediaJobs(db, { dir: join(root, "media"), attachments, log: () => undefined });
  const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId: "demo-hub", fleet, media: { media, capabilities: { stt: false, summary: false, vision: false } }, pwaDir: pwaDistDir() });


  await seedDemoHub(app, token, fleet, sessions, workspace);
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`Demo-Hub (EPIC-P62 T62.3): http://127.0.0.1:${port}/#/  — Token: ${token}`);
  console.log(`Daten: ${root} — Strg+C beendet. Nur Allowlist-Inhalt (docs/demo-media.md).`);
  const stop = async () => {
    await app.close().catch(() => undefined);
    await sessions.shutdown().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1]?.endsWith("demo-seed.ts")) {
  await main();
}
