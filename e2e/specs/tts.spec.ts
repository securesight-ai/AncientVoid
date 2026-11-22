import { createServer, type Server } from "node:http";
import { expect, test } from "../support/fixtures.ts";
import { freePort } from "../support/ports.ts";
import type { Page } from "@playwright/test";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P75 (ADR-0097): Chat vorlesen über den Hub-Proxy. Ein Attrappen-Hivemind
 * am Test-Hub steht für den echten TTS-Dienst; statt Lautsprecher hört ein
 * Audio-Spy mit (P65-Muster). Die echte Stimme am Gerät bleibt Menschenabnahme
 * (T75.8 → P000).
 */
const WAV = Buffer.from("RIFF-e2e-tts-wav");

interface TtsSpy {
  plays: string[];
  all: Array<{ src: string; paused: boolean }>;
}

async function installAudioSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spy: TtsSpy = { plays: [], all: [] };
    (window as unknown as Record<string, unknown>).__ttsSpy = spy;
    class SpyAudio {
      src: string;
      paused = true;
      private endedListeners: Array<() => void> = [];
      constructor(src?: string) {
        this.src = src ?? "";
        spy.all.push(this);
      }
      play(): Promise<void> {
        this.paused = false;
        spy.plays.push(this.src);
        // Ein echter Clip endet von selbst — die Hörprobe wartet darauf (busy-Reset).
        setTimeout(() => this.fireEnded(), 300);
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
      addEventListener(_type: string, listener: () => void): void {
        this.endedListeners.push(listener);
      }
      fireEnded(): void {
        this.paused = true;
        for (const listener of this.endedListeners) listener();
      }
    }
    (window as unknown as Record<string, unknown>).Audio = SpyAudio;
  });
  await page.reload();
}

async function spy(page: Page): Promise<TtsSpy> {
  return (await page.evaluate(() => (window as unknown as Record<string, TtsSpy | undefined>).__ttsSpy))!;
}

const port = await freePort();

test.describe("Sprachausgabe: Chat vorlesen (EPIC-P75)", () => {
  let server: Server;
  const received: Array<{ method: string; body: string }> = [];
  let kaputt = false;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        received.push({ method: req.method ?? "GET", body: Buffer.concat(chunks).toString("utf8") });
        if (req.method === "GET") {
          if (kaputt) {
            // Dienst weg heißt: keine Antwort, auch nicht für die Probe.
            res.socket?.destroy();
            return;
          }
          // Lebenszeichen: der Attrappendienst antwortet auf GET mit 405 — zählt als erreichbar.
          res.writeHead(405).end("method not allowed");
          return;
        }
        if (kaputt) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "TTS-Dienst überlastet (Attrappe)" }));
          return;
        }
        res.writeHead(200, { "content-type": "audio/wav", "content-length": WAV.length });
        res.end(WAV);
      });
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  });

  test.afterAll(async () => {
    server?.close();
  });

  const ttsUrl = `http://127.0.0.1:${port}/tts`;

  async function konfigurieren(hub: TestHub, url: string): Promise<void> {
    const res = await hub.api("/api/settings/tts", { method: "PUT", body: { url } });
    expect(res.status).toBe(200);
  }

  test("ohne Eintrag ist der Knopf aus und nennt den Weg; nach Settings-Eintrag spielt die Hörprobe (AC-P75-3)", async ({ app, hub }) => {
    await installAudioSpy(app);
    const id = await hub.createSession({ adapter: "dummy", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const knopf = app.locator(".event.assistant [data-testid=tts-play]").first();
    await expect(knopf).toBeVisible({ timeout: 15_000 });
    await expect(knopf).toBeDisabled({ timeout: 10_000 });
    await expect(knopf).toHaveAttribute("data-tip", /nicht eingerichtet/);
    await expect(knopf).toContainText(/einrichten/);

    await app.goto(`${hub.origin}/#/einstellungen`);
    await expect(app.getByTestId("settings-tts")).toBeVisible();
    await expect(app.getByTestId("tts-availability")).toContainText(/nicht eingerichtet/, { timeout: 10_000 });
    await app.getByTestId("tts-url-input").fill(ttsUrl);
    await app.getByTestId("tts-save").click();
    await expect(app.getByTestId("tts-availability")).toContainText(/verfügbar/);
    await app.getByTestId("tts-probe").click();
    await expect.poll(async () => (await spy(app)).plays.length).toBeGreaterThan(0);
    // Die Probe lief über den Hub zum Attrappendienst — Sprache „German", wie eingestellt.
    expect(received.some((r) => r.method === "POST" && r.body.includes("Hörprobe") && r.body.includes('"German"'))).toBe(true);
    // PUT validiert: eine kaputte URL wird sichtbar abgewiesen, nicht still korrigiert.
    await app.getByTestId("tts-url-input").fill("keine-url");
    await app.getByTestId("tts-save").click();
    await expect(app.getByTestId("tts-message")).toContainText(/Ungültig/);
  });

  test("Vorlesen spielt die Assistant-Antwort, Stopp pausiert, Wiederholung kommt aus dem Cache (AC-P75-1, K5)", async ({ app, hub }) => {
    await installAudioSpy(app);
    await konfigurieren(hub, ttsUrl);
    const id = await hub.createSession({ adapter: "dummy", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const knopf = app.locator(".event.assistant [data-testid=tts-play]").first();
    await expect(knopf).toBeVisible({ timeout: 15_000 });
    await expect(knopf).not.toBeDisabled({ timeout: 10_000 });

    await knopf.click();
    await expect(knopf).toHaveAttribute("data-phase", "playing", { timeout: 10_000 });
    expect((await spy(app)).plays.length).toBeGreaterThan(0);
    expect((await spy(app)).all.at(-1)!.paused).toBe(false);

    // Stop: derselbe Knopf beendet die Wiedergabe.
    await knopf.click();
    await expect(knopf).toHaveAttribute("data-phase", "idle", { timeout: 10_000 });
    expect((await spy(app)).all.at(-1)!.paused).toBe(true);

    // Erneutes Vorlesen desselben Texts: keine zweite Synthese (LRU), aber spielt wieder.
    const synthenVorher = received.filter((r) => r.method === "POST").length;
    await knopf.click();
    await expect(knopf).toHaveAttribute("data-phase", "playing", { timeout: 10_000 });
    expect(received.filter((r) => r.method === "POST").length).toBe(synthenVorher);

    // K5: nichts davon landete im EventStore — kein WAV-Marker, kein Synthese-Rest.
    const verlauf = await hub.events(id);
    expect(verlauf.some((e) => JSON.stringify(e).includes("RIFF") || JSON.stringify(e).includes("audio/wav"))).toBe(false);
  });

  test("der Dienst erhält den vollen Antworttext — und im 502-Fall bleibt der Grund sichtbar (AC-P75-1/6)", async ({ app, hub }) => {
    await installAudioSpy(app);
    await konfigurieren(hub, ttsUrl);
    const id = await hub.createSession({ adapter: "dummy", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const knopf = app.locator(".event.assistant [data-testid=tts-play]").first();
    await expect(knopf).toBeVisible({ timeout: 15_000 });
    await expect(knopf).not.toBeDisabled({ timeout: 10_000 });
    await knopf.click();
    await expect(knopf).toHaveAttribute("data-phase", "playing", { timeout: 10_000 });

    // Was der Dienst bekam, ist der volle Antworttext aus dem Event, nicht die UUID.
    const antworten = (await hub.events(id)).filter((e) => e.type === "assistant").map((e) => (typeof e.payload.text === "string" && e.payload.text ? e.payload.text : e.summary));
    const gesendet = received.filter((r) => r.method === "POST").map((r) => (JSON.parse(r.body) as { text: string }).text);
    expect(antworten.some((text) => text.length > 0 && gesendet.includes(text))).toBe(true);

    // Fehlerpfad: der Dienst stirbt — die Hörprobe (neuer Text, kein Cache) nennt den Grund.
    kaputt = true;
    try {
      await app.goto(`${hub.origin}/#/einstellungen`);
      await app.getByTestId("tts-probe").click();
      await expect(app.getByTestId("tts-message")).toContainText(/nicht erreichbar/, { timeout: 15_000 });
      await expect(app.getByTestId("tts-availability")).toContainText(/nicht erreichbar/);
    } finally {
      kaputt = false;
    }
  });
});
