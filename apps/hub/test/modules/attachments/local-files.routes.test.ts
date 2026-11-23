import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, AttachmentStore, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../../../src/app.ts";

/** Echtes 1×1-PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

let app: FastifyInstance;
let token: string;
let agentToken: string;
let wurzel: string;
let aussen: string;

beforeAll(async () => {
  wurzel = await mkdtemp(join(tmpdir(), "ancientvoid-lokale-dateien-"));
  aussen = await mkdtemp(join(tmpdir(), "ancientvoid-fremdordner-"));
  await writeFile(join(wurzel, "bild.png"), PNG);
  await writeFile(join(wurzel, "attrappe.txt"), "Das ist KEIN PNG, nur Text.");
  await writeFile(join(wurzel, "attrappe.png"), "Das ist KEIN PNG, nur Text.");
  await writeFile(join(aussen, "fremd.png"), PNG);
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, { eventsPerSecond: 20, autoStopAfterEvents: 0 });
  const sessions = new SessionManager(db, new EventStore(wurzel), registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const settings = new SettingsStore(db);
  const attachments = new AttachmentStore(db, join(wurzel, "attachments"));
  token = tokens.issue("pc").token;
  agentToken = tokens.issue("agent:pi").token;
  app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId: "test", projectRoots: [wurzel], settings, attachments });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await rm(wurzel, { recursive: true, force: true });
  await rm(aussen, { recursive: true, force: true });
});

const holen = (pfad: string, bearer = token) =>
  app.inject({ method: "POST", url: "/api/local-files/bytes", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, payload: { path: pfad } });

describe("Bild aus dem lokalen Dateisystem holen (Linux/Wayland-Einfügen)", () => {
  it("Datei innerhalb der erlaubten Wurzel kommt als echtes Bild zurück", async () => {
    const res = await holen(join(wurzel, "bild.png"));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(String(res.headers["content-disposition"])).toContain("filename*=UTF-8''bild.png");
  });

  it("file://-URI aus dem Datei-Manager wird akzeptiert", async () => {
    const res = await holen(`file://${encodeURIComponent(join(wurzel, "bild.png")).replace(/%2F/g, "/")}`);
    expect(res.statusCode).toBe(200);
  });

  it("außerhalb der erlaubten Ordner: 403 mit Grund, keine Bytes", async () => {
    const res = await holen(join(aussen, "fremd.png"));
    expect(res.statusCode).toBe(403);
    expect(String(res.json().error)).toContain("außerhalb der erlaubten Ordner");
  });

  it("Endung allein reicht nicht — die Magic Bytes müssen passen", async () => {
    const res = await holen(join(wurzel, "attrappe.png"));
    expect(res.statusCode).toBe(415);
    expect(String(res.json().error)).toContain("kein Bild");
  });

  it("relative Pfade und fehlende Dateien werden sauber abgelehnt", async () => {
    expect((await holen("bild.png")).statusCode).toBe(400);
    expect((await holen(join(wurzel, "fehlt.png"))).statusCode).toBe(404);
    expect((await holen(join(wurzel, "bild.txt"))).statusCode).toBe(404);
    expect((await holen(join(wurzel, "attrappe.txt"))).statusCode).toBe(415);
  });

  it("Agenten kommen nicht an die lokale Platte — nur ein Mensch an diesem Hub", async () => {
    expect((await holen(join(wurzel, "bild.png"), agentToken)).statusCode).toBe(403);
  });
});
