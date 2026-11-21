import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { test, expect } from "../support/fixtures.ts";
import { freePort } from "../support/ports.ts";

/**
 * T10.2 (ADR-0028): push to talk with local recognition. A stand-in for
 * whisper-server that only accepts what the real one needs — 16 kHz mono
 * 16-bit WAV — so the test proves the hub converted the phone's recording.
 */
const port = await freePort();
const streamPort = await freePort();
let server: Server;
let streamServer: WebSocketServer;
const received: { rate: number; channels: number; bytes: number; prompt: boolean; language: string }[] = [];

// ADR-0092: dieselbe Aufnahme kann mehrfach erkannt werden. Der Ersatz-Fluesterer
// antwortet deshalb unterschiedlich – und kann auf Ausfall gestellt werden.
let antwort = "Starte die Tests im Worktree";
let kaputt = false;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const riff = body.indexOf("RIFF");
      const wav = riff >= 0 ? body.subarray(riff) : Buffer.alloc(0);
      const text = body.toString("latin1");
      const info = { rate: wav.length > 28 ? wav.readUInt32LE(24) : 0, channels: wav.length > 24 ? wav.readUInt16LE(22) : 0, bytes: wav.length, prompt: text.includes('name="prompt"') && text.includes("Worktree"), language: /name="language"\r\n\r\n(\w+)/.exec(text)?.[1] ?? "" };
      received.push(info);
      if (kaputt) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Spracherkennung nicht erreichbar (fake)" }));
        return;
      }
      const ok = info.rate === 16_000 && info.channels === 1 && info.bytes > 3000;
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { text: antwort } : { error: "not 16k mono wav" }));
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  streamServer = new WebSocketServer({ host: "127.0.0.1", port: streamPort });
  await new Promise<void>((resolve) => streamServer.once("listening", resolve));
  streamServer.on("connection", (socket) => {
    let sentPartial = false;
    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        if (!sentPartial) {
          sentPartial = true;
          socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: "Nicht stoppen" }));
        }
        return;
      }
      const event = JSON.parse(raw.toString()) as { type?: string };
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
      if (event.type === "input_audio_buffer.commit") socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "Bitte weiter" }));
    });
  });
});
test.afterAll(async () => {
  server?.close();
  if (streamServer) await new Promise<void>((resolve) => streamServer.close(() => resolve()));
});

test.use({
  hubOptions: { sttUrl: `http://127.0.0.1:${port}/inference` },
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (globalThis as unknown as { __testMicTrack?: MediaStreamTrack | undefined }).__testMicTrack = stream.getAudioTracks()[0];
      return stream;
    };
  });
});

test.describe("Lokale Spracherkennung (T10.2)", () => {

  test.describe("Live-Streaming", () => {
    test.use({ hubOptions: { sttUrl: `http://127.0.0.1:${port}/inference`, sttStreamingUrl: `ws://127.0.0.1:${streamPort}/v1/audio/transcriptions/realtime` } });

  test("Live-Teiltranskript bleibt Vorschau; nur der finale Text landet editierbar im Feld", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").click();
    const fab = app.locator('[data-testid=nyx-fab]');
    await expect(fab).toHaveAttribute("data-tip", /Spracheingabe lokal/);
    await fab.click();
    await expect(app.getByText(/Aufnahme läuft \d+:\d+ — erneut tippen stoppt/)).toBeVisible();
    const partial = app.getByTestId("nyx-fab-words");
    await expect(partial).toHaveText("Nicht stoppen", { timeout: 10_000 });
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("");
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(1);
    await fab.click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Bitte weiter");
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(1);
  });
  });

  test("Nyx-FAB nimmt auf, der Hub erkennt lokal, der Text landet editierbar im Feld — mit K6-Zeit", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").click();
    const fab = app.locator('[data-testid=nyx-fab]');
    await expect(fab).toHaveAttribute("data-tip", /lokal \(whisper-e2e\)/);
    await fab.click();
    await expect(app.getByText(/Aufnahme läuft \d+:\d+ — erneut tippen stoppt/)).toBeVisible();
    await app.waitForTimeout(1200);
    await fab.click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Starte die Tests im Worktree");
    await expect(app.locator('[data-testid=nyx-fab-toast]').filter({ hasText: /lokal · whisper-e2e · \d+\.\d s/ })).toBeVisible();
    expect(received.at(-1)).toMatchObject({ rate: 16_000, channels: 1, prompt: true, language: "de" });
    // Nothing was sent to the session — the text only sits in the field.
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(1);
  });

  test("Gesperrter Bildschirm lässt die Aufnahme weiterlaufen — Mikrofonverlust bricht sichtbar ab (BUG-0177)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const before = received.length;
    await app.getByPlaceholder("Antworten…").click();
    await app.locator('[data-testid=nyx-fab]').click();
    await expect(app.getByText(/Aufnahme läuft \d+:\d+ — erneut tippen stoppt/)).toBeVisible();
    await app.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(app.getByText(/Bildschirm gesperrt — Aufnahme läuft weiter/)).toBeVisible();
    await expect(app.getByTestId("nyx-fab")).toHaveClass(/recording/);
    // Merely hiding the document must not send a recording for transcription.
    expect(received.length).toBe(before);
    await app.evaluate(() => {
      const track = (globalThis as unknown as { __testMicTrack: MediaStreamTrack }).__testMicTrack;
      track.stop();
      track.dispatchEvent(new Event("ended"));
    });
    await expect(app.getByText(/Aufnahme abgebrochen — Mikrofon nicht mehr verfügbar/)).toBeVisible();
    await expect(app.getByTestId("nyx-fab")).not.toHaveClass(/recording/);
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("");
    expect(received.length).toBe(before);
  });

  test("Feedbackblende blendet nach dem Ende automatisch aus — sie steht nicht dauerhaft (BUG-0159)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").click();
    const fab = app.locator('[data-testid=nyx-fab]');
    await fab.click();
    await expect(app.getByText(/Aufnahme läuft \d+:\d+ — erneut tippen stoppt/)).toBeVisible();
    await app.waitForTimeout(1200);
    await fab.click();
    const toast = app.locator('[data-testid=nyx-fab-toast]');
    await expect(toast.filter({ hasText: /lokal · whisper-e2e · \d+\.\d s/ })).toBeVisible();
    // Der Fehlerfall bleibt sichtbar (AC-P10-5), aber nicht für alle Zeit: nach dem
    // Feedbackfenster muss die Blende weg sein, solange nichts aufgenommen wird.
    await expect(toast).toHaveCount(0, { timeout: 20_000 });
  });

  test("Bei schon verborgenem Dokument ist das Mikrofon-Signal maßgeblich (BUG-0177)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const before = received.length;
    // Gesperrt, bevor die Aufnahme beginnt (z. B. während des Mikrofon-Dialogs):
    // es kommt kein weiteres visibilitychange-Event mehr.
    await app.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    });
    await app.getByPlaceholder("Antworten…").click();
    await app.locator('[data-testid=nyx-fab]').click();
    await expect(app.getByTestId("nyx-fab")).toHaveClass(/recording/);
    expect(received.length).toBe(before);
    await app.evaluate(() => {
      const track = (globalThis as unknown as { __testMicTrack: MediaStreamTrack }).__testMicTrack;
      track.stop();
      track.dispatchEvent(new Event("ended"));
    });
    await expect(app.getByText(/Aufnahme abgebrochen — Mikrofon nicht mehr verfügbar/)).toBeVisible();
    await expect(app.getByTestId("nyx-fab")).not.toHaveClass(/recording/);
    expect(received.length).toBe(before);
  });

  test.describe("Neu-Erkennung der gemerkten Sprachnachricht (ADR-0092, Nachtrag)", () => {
    test.beforeEach(() => {
      kaputt = false;
      antwort = "Starte die Tests im Worktree";
    });

    test("die Sprachnachricht in der Ablage wird neu erkannt und ersetzt den unveraenderten Text", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByPlaceholder("Antworten…").click();
      const fab = app.locator('[data-testid=nyx-fab]');
      await fab.click();
      await expect(app.getByText(/Aufnahme läuft \d+:\d+ — erneut tippen stoppt/)).toBeVisible();
      await app.waitForTimeout(1200);
      await fab.click();
      await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Starte die Tests im Worktree");
      // Nutzerentscheidung 21.11.2026: keine Zeile am Eingabefeld — die Ablage trägt die Aufnahme.
      await app.getByTestId("clipboard-open").click();
      const zeile = app.getByTestId("shelf-voice-row");
      await expect(zeile).toContainText("Sprachnachricht");
      const vor = received.length;
      antwort = "Starte die Tests — jetzt mit Protokoll";
      await app.getByTestId("shelf-voice-run").click();
      await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Starte die Tests — jetzt mit Protokoll");
      expect(received.length).toBe(vor + 1);
      // Die wartende Aufnahme ist verbraucht; was bleibt, ist der ehrliche Hinweis im Blatt.
      await expect(app.getByTestId("shelf-voice-row")).toHaveCount(0);
      await expect(app.getByTestId("shelf-note")).toContainText("ersetzt");
    });

    test("ein fehlgeschlagener Durchlauf wirft die Aufnahme nicht weg — spaeter laeuft sie doch", async ({ app, hub }) => {
      kaputt = true;
      const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByPlaceholder("Antworten…").click();
      const fab = app.locator('[data-testid=nyx-fab]');
      await fab.click();
      await app.waitForTimeout(1200);
      await fab.click();
      await expect(app.locator('[data-testid=nyx-fab-toast] .err')).toBeVisible();
      await expect(app.getByPlaceholder("Antworten…")).toHaveValue("");
      await app.getByTestId("clipboard-open").click();
      await expect(app.getByTestId("shelf-voice-row")).toContainText("Sprachnachricht");
      kaputt = false;
      antwort = "Doch, jetzt klar";
      const vor = received.length;
      await app.getByTestId("shelf-voice-run").click();
      await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Doch, jetzt klar");
      expect(received.length).toBe(vor + 1);
    });
  });
});
