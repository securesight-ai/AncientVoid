import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { TTS_MAX_TEXT_BYTES } from "@ancientvoid/contracts";
import { createHubApp } from "../../../src/app.ts";
import { makeTtsProbe } from "../../../src/modules/voice/tts.routes.ts";

/** What Hivemind would answer — the hub only passes WAV bytes through. */
const WAV = Buffer.from("RIFF-fake-tts-wav-bytes");

interface UpstreamCall {
  method: string;
  url: string;
  body: string;
  /** Multipart-Felder, wenn der Body FormData ist (sonst leer). */
  fields: Record<string, string>;
}

/** Poll a real condition instead of sleeping a guessed duration. */
async function until(check: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * EPIC-P75 (ADR-0097): read-aloud through the hub proxy — error codes, FIFO
 * serialisation, honest probe, and nothing of it in the EventStore (K5).
 */
describe("TTS proxy routes (T75.2/T75.3)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let settings: SettingsStore;
  let human: string;
  let agent: string;
  let display: string;
  let upstream: { status: number; body: Buffer };
  /** POST handler holds every request until the gate opens (or aborts). */
  let hang: boolean;
  let probeDead: boolean;
  let gate: Promise<void> | null;
  const calls: UpstreamCall[] = [];
  let active = 0;
  let maxActive = 0;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-tts-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const tokens = new TokenService(db);
    settings = new SettingsStore(db);
    sessions = new SessionManager(db, new EventStore(join(dir, ".data")), registry, new ProcessRunner());
    const ttsFetch = (async (url: string, init: RequestInit = {}) => {
      const target = String(url);
      const fields: Record<string, string> = {};
      if (typeof FormData !== "undefined" && init.body instanceof FormData) {
        for (const [key, value] of init.body.entries()) fields[key] = String(value);
      }
      calls.push({ method: init.method ?? "GET", url: target, body: init.body === undefined ? "" : String(init.body), fields });
      // Probe (GET) answers immediately — a living service, any status counts (405 incl.).
      if ((init.method ?? "GET") === "GET") {
        if (probeDead) throw new TypeError("fetch failed");
        return new Response("alive", { status: 405 });
      }
      if (hang) return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted"))));
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (gate) await gate;
      active -= 1;
      return new Response(new Uint8Array(upstream.body), { status: upstream.status });
    }) as unknown as typeof fetch;
    app = await createHubApp({ sessions, tokens, registry, approvals: new ApprovalService(db), auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [], settings, ttsFetch });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
    display = tokens.issue("display:kiosk").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    upstream = { status: 200, body: WAV };
    hang = false;
    probeDead = false;
    gate = null;
    calls.length = 0;
    active = 0;
    maxActive = 0;
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const status = (token: string) => app.inject({ method: "GET", url: "/api/tts", headers: auth(token) });
  const putSettings = (token: string, body: unknown) => app.inject({ method: "PUT", url: "/api/settings/tts", headers: { ...auth(token), "content-type": "application/json" }, payload: JSON.stringify(body) });
  const speak = (token: string, text: string) => app.inject({ method: "POST", url: "/api/tts", headers: { ...auth(token), "content-type": "application/json" }, payload: JSON.stringify({ text }) });

  it("ohne Konfiguration ist die Auskunft ehrlich: available:false statt Behauptung (AC-P75-3/4)", async () => {
    expect((await status(human)).statusCode).toBe(200);
    expect((await status(human)).json()).toEqual({ available: false, reason: expect.stringContaining("nicht eingerichtet") });
    const post = await speak(human, "Hallo");
    expect(post.statusCode).toBe(501);
    expect(calls).toHaveLength(0);
  });

  it("Settings-Roundtrip: PUT speichert zod-validiert, GET reflektiert, invalid wird 400 (T75.3)", async () => {
    expect((await putSettings(human, { speed: 9 })).statusCode).toBe(400);
    expect((await putSettings(human, { url: "keine-url" })).statusCode).toBe(400);
    const ok = await putSettings(human, { url: "http://tts.box:8080/tts", engine: "Voxtral de_female", language: "en", speed: 1.2, timeoutMs: 5_000 });
    expect(ok.statusCode).toBe(200);
    const expected = { tts: { url: "http://tts.box:8080/tts", engine: "Voxtral de_female", language: "en", speed: 1.2, timeoutMs: 5_000 } };
    expect(ok.json()).toEqual(expected);
    expect((await app.inject({ method: "GET", url: "/api/settings/tts", headers: auth(human) })).json()).toEqual(expected);
    // null räumt Felder weg, der Rest bleibt stehen.
    const cleared = await putSettings(human, { url: null, engine: null });
    expect(cleared.json()).toEqual({ tts: { url: null, engine: null, language: "en", speed: 1.2, timeoutMs: 5_000 } });
  });

  it("die Auskunft entsteht aus einer Probe — toter Port heißt available:false mit checkedMsAgo (AC-P75-4)", async () => {
    const dead = makeTtsProbe(() => "http://127.0.0.1:9/tts", {
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect((await dead.check()).ok).toBe(false);
    expect((await dead.check()).configured).toBe(true);

    await putSettings(human, { url: "http://tts.box:8080/tts", engine: "Qwen3-TTS" });
    const res = await status(human);
    // Der Attrappen-Dienst antwortet 405 auf GET — jedes Lebenszeichen zählt.
    expect(res.json()).toMatchObject({ available: true, engine: "Qwen3-TTS", language: "de", checkedMsAgo: expect.any(Number) });
    expect(calls[0]).toMatchObject({ method: "GET", url: "http://tts.box:8080/tts" });
    // Probe-Cache: der zweite Statusgriff geht nicht nochmal auf die Leitung.
    await status(human);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
    // URL-Wechsel zur Laufzeit verwirft das Cache-Urteil (SettingsStore, kein Restart).
    await putSettings(human, { url: "http://tts2.box:9000/tts" });
    await status(human);
    expect(calls.filter((c) => c.method === "GET").map((c) => c.url)).toContain("http://tts2.box:9000/tts");
  });

  it("POST synthetisiert über die Hivemind-Form und reicht WAV durch — nichts landet im EventStore (K5)", async () => {
    await putSettings(human, { url: "http://tts.box:8080/tts" });
    const res = await speak(human, "Lauf fertig. Noch eine Frage?");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/wav");
    expect(Buffer.from(res.rawPayload).equals(WAV)).toBe(true);
    expect(calls.find((c) => c.method === "POST")!.fields).toEqual({ text: "Lauf fertig. Noch eine Frage?", speed: "1", language: "German" });
    expect(sessions.list()).toHaveLength(0);
  });

  it("der Upstream-Aufruf spricht Multipart, nicht JSON — der echte Dienst (pocket-tts) weist JSON mit 422 ab (BUG-0254)", async () => {
    await putSettings(human, { url: "http://tts.box:8080/tts" });
    await speak(human, "Dialekt-Probe");
    const call = calls.find((c) => c.method === "POST")!;
    // Der Hub muss FormData senden: ein JSON-String-Body wäre am echten Dienst 422.
    expect(call.body.startsWith("{")).toBe(false);
    expect(call.fields).toEqual({ text: "Dialekt-Probe", speed: "1", language: "German" });
  });

  it("leerer Text ist 400, über das Cap ist 413 — Multi-Byte mitgerechnet (AC-P75-6)", async () => {
    await putSettings(human, { url: "http://tts.box:8080/tts" });
    expect((await speak(human, "  ")).statusCode).toBe(400);
    expect((await speak(human, "")).statusCode).toBe(400);
    expect((await speak(human, "ä".repeat(TTS_MAX_TEXT_BYTES))).statusCode).toBe(413); // 2 Bytes/Zeichen → 8000 Bytes
    expect((await speak(human, "a".repeat(TTS_MAX_TEXT_BYTES))).statusCode).toBe(200); // genau am Cap
    expect((await speak(human, `a${"ä".repeat(TTS_MAX_TEXT_BYTES / 2)}`)).statusCode).toBe(413);
  });

  it("Synthesen serialisieren FIFO — der zweite erreicht den Dienst erst nach dem ersten (AC-P75-6)", async () => {
    await putSettings(human, { url: "http://tts.box:8080/tts" });
    let resolve!: () => void;
    gate = new Promise<void>((r) => { resolve = r; });
    const first = speak(human, "eins");
    await until(() => calls.filter((c) => c.method === "POST").length === 1, "erster Auftrag beim Dienst");
    const second = speak(human, "zwei");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.fields.text)).toEqual(["eins"]);
    resolve();
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    expect(maxActive).toBe(1);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.fields.text)).toEqual(["eins", "zwei"]);
  });

  it("über den Wartebereich hinaus fliegt sofort genau einer raus — 429 statt heimlicher Warteschlange (AC-P75-6)", async () => {
    await putSettings(human, { url: "http://tts.box:8080/tts" });
    let resolve!: () => void;
    gate = new Promise<void>((r) => { resolve = r; });
    const running = speak(human, "läuft");
    await until(() => calls.filter((c) => c.method === "POST").length === 1, "laufender Auftrag beim Dienst");
    // Vier weitere: drei warten, einer fliegt raus. Welche Einsprungreihenfolge
    // inject wählt, ist offen — deshalb geprüft: genau ein 429, und er kommt
    // sofort (das Rennen gewinnt er gegen die drei wartenden 200er).
    const four = [1, 2, 3, 4].map((i) => speak(human, `w${i}`).then((r) => r.statusCode));
    const firstSettled = await Promise.race(four);
    expect(firstSettled).toBe(429);
    resolve();
    expect((await Promise.all(four)).sort()).toEqual([200, 200, 200, 429]);
    expect((await running).statusCode).toBe(200);
    expect(maxActive).toBe(1);
  });

  it("TTS-Dienst down oder zu langsam heißt 502 mit Grund (AC-P75-1/6)", async () => {
    await putSettings(human, { url: "http://tts.box:8080/tts" });
    upstream = { status: 503, body: Buffer.from("busy") };
    const down = await speak(human, "Test");
    expect(down.statusCode).toBe(502);
    expect(down.json()).toMatchObject({ error: expect.stringContaining("nicht erreichbar") });
    // Timeout-Pfad: echt über AbortSignal — bewusst ein kurzer echter Lauf statt
    // Fake-Timern, weil hier das Abbruchverhalten des fetch-Signals selbst geprüft wird.
    settings.set("tts.timeoutMs", "60");
    hang = true;
    const slow = await speak(human, "Test");
    expect(slow.statusCode).toBe(502);
    // BUG-0214-Lektion: Die gescheiterte Synthese verwirft das Probe-Urteil —
    // der Status lügt danach nicht weiter „verfügbar", sondern fragt neu nach.
    const frisch = await status(human);
    expect(frisch.json()).toMatchObject({ available: true }); // der Attrappen-Dienst antwortet der Probe noch
    probeDead = true;
    expect((await speak(human, "Test")).statusCode).toBe(502); // scheitern + invalidieren
    expect((await status(human)).json()).toMatchObject({ available: false, reason: expect.stringContaining("nicht erreichbar"), checkedMsAgo: expect.any(Number) });
  });

  it("Agenten- und Display-Tokens bekommen auf allen TTS-Flächen 403 (AC-P75-7)", async () => {
    await putSettings(human, { url: "http://tts.box:8080/tts" });
    for (const token of [agent, display]) {
      expect((await status(token)).statusCode).toBe(403);
      expect((await speak(token, "Side-Channel")).statusCode).toBe(403);
      expect((await putSettings(token, { url: "http://evil/tts" })).statusCode).toBe(403);
    }
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});
