import { readFile } from "node:fs/promises";
import { STT_STREAM_MAX_ACTIVE, STT_STREAM_MAX_AUDIO_BYTES, STT_STREAM_MAX_AUDIO_SECONDS, STT_STREAM_MAX_BUFFERED_BYTES, STT_STREAM_MAX_EVENT_BYTES, STT_STREAM_MAX_PENDING_TICKETS, STT_STREAM_MAX_TEXT_BYTES, STT_STREAM_TICKET_TTL_MS, type SttStreamEvent, type SttStreamTicket } from "@ancientvoid/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import WebSocket, { type RawData } from "ws";
import { extractToken } from "../../platform/auth.ts";
import { StreamTickets } from "../../platform/stream-tickets.ts";

export interface SttStreamingConfig {
  url: string;
  engine: string;
  language: string;
  vocabulary: string;
  endpointingMs: number;
  apiKeyFile?: string;
  apiKey?: string;
  apiKeyUnreadable?: boolean;
  speechContext: () => Promise<string[]>;
}

function sttPreviewEvent(socket: WebSocket, event: SttStreamEvent): void {
  const payload = JSON.stringify(event);
  if (socket.readyState === WebSocket.OPEN && Buffer.byteLength(payload) <= STT_STREAM_MAX_EVENT_BYTES && socket.bufferedAmount <= STT_STREAM_MAX_BUFFERED_BYTES) {
    socket.send(payload);
  } else if (socket.readyState === WebSocket.OPEN) {
    socket.close(1013, "STT stream backpressure");
  }
}

function parseRaw(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

export function registerSttStreamRoutes(app: FastifyInstance, config: SttStreamingConfig | undefined): void {
  if (!config) return;

  const tickets = new StreamTickets<true>(STT_STREAM_TICKET_TTL_MS, STT_STREAM_MAX_PENDING_TICKETS);
  let active = 0;

  app.addHook("preClose", async () => {
    tickets.clear();
  });

  app.post("/api/stt/stream-ticket", async (req: FastifyRequest, reply) => {
    const token = extractToken(req);
    if (!token) return reply.code(401).send({ error: "device token required" });
    const result: SttStreamTicket | undefined = tickets.issue(true);
    if (!result) return reply.code(503).send({ error: "Zu viele offene STT-Streams." });
    return reply.header("cache-control", "no-store").code(201).send(result);
  });

  app.get("/api/stt/stream", { websocket: true }, (browser, req) => {
    const query = req.query as { ticket?: unknown } | undefined;
    if (!tickets.consume(query?.ticket)) {
      browser.close(4401, "invalid or expired STT ticket");
      return;
    }
    if (active >= STT_STREAM_MAX_ACTIVE) {
      browser.close(1013, "too many STT streams");
      return;
    }
    active += 1;

    let upstream: WebSocket | undefined;
    let audioBytes = 0;
    let transcriptBytes = 0;
    let finished = false;
    let cleaned = false;
    // Hard backstop for the whole utterance (BUG-0215): not an inactivity timer —
    // it fires while audio is still flowing, so it must match the byte bound below.
    let hardStop: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      active = Math.max(0, active - 1);
      clearTimeout(hardStop);
      if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.close();
    };
    const fail = (message: string): void => {
      if (finished) return;
      finished = true;
      sttPreviewEvent(browser, { type: "error", message });
      browser.close(1011, "local STT stream failed");
      cleanup();
    };

    const connect = async (): Promise<void> => {
      try {
        let apiKey = config.apiKey;
        if (!apiKey && config.apiKeyFile) apiKey = (await readFile(config.apiKeyFile, "utf8")).split("\n")[0]?.trim();
        if (config.apiKeyUnreadable || (config.apiKeyFile && !apiKey)) throw new Error("key unavailable");
        const speechContext = await config.speechContext();
        if (cleaned) return;
        const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : undefined;
        upstream = new WebSocket(config.url, { ...(headers ? { headers } : {}), maxPayload: STT_STREAM_MAX_BUFFERED_BYTES });
        upstream.once("open", () => {
          if (cleaned) {
            upstream?.close();
            return;
          }
          upstream?.send(JSON.stringify({ type: "session.update", session: {
            sample_rate: 16_000,
            language: config.language,
            endpointing_ms: config.endpointingMs,
            ...(speechContext.length ? { speech_contexts: [{ phrases: speechContext, boost: 2 }] } : {}),
          } }));
        });
      } catch {
        fail("Lokale Streaming-Erkennung konnte nicht gestartet werden.");
        return;
      }

      const socket = upstream;
      const opening = setTimeout(() => fail("Lokale Streaming-Erkennung antwortet nicht."), 10_000);
      socket.on("open", () => {
        clearTimeout(opening);
      });
      socket.on("message", (raw, isBinary) => {
        if (isBinary) return fail("Unbekannte Antwort der lokalen Streaming-Erkennung.");
        let event: { type?: unknown; delta?: unknown; transcript?: unknown };
        try {
          event = JSON.parse(parseRaw(raw)) as typeof event;
        } catch {
          return fail("Ungültige Antwort der lokalen Streaming-Erkennung.");
        }
        if (event.type === "session.created") return;
        if (event.type === "session.updated") {
          sttPreviewEvent(browser, { type: "ready" });
          hardStop = setTimeout(() => fail(`Sprachaufnahme dauerte länger als ${STT_STREAM_MAX_AUDIO_SECONDS} Sekunden.`), STT_STREAM_MAX_AUDIO_SECONDS * 1_000);
          return;
        }
        if (event.type === "conversation.item.input_audio_transcription.delta") {
          if (typeof event.delta !== "string") return fail("Ungültiges Teiltranskript der lokalen Erkennung.");
          transcriptBytes += Buffer.byteLength(event.delta);
          if (transcriptBytes > STT_STREAM_MAX_TEXT_BYTES || Buffer.byteLength(JSON.stringify({ type: "partial", text: event.delta })) > STT_STREAM_MAX_EVENT_BYTES) return fail("Das Teiltranskript überschritt die Textgrenze.");
          if (event.delta) sttPreviewEvent(browser, { type: "partial", text: event.delta });
          return;
        }
        if (event.type === "conversation.item.input_audio_transcription.completed") {
          if (typeof event.transcript !== "string") return fail("Ungültiges Endtranskript der lokalen Erkennung.");
          if (Buffer.byteLength(event.transcript) > STT_STREAM_MAX_TEXT_BYTES || Buffer.byteLength(JSON.stringify({ type: "final", text: event.transcript.trim(), engine: config.engine })) > STT_STREAM_MAX_EVENT_BYTES) return fail("Das Endtranskript überschritt die Textgrenze.");
          finished = true;
          sttPreviewEvent(browser, { type: "final", text: event.transcript.trim(), engine: config.engine });
          browser.close(1000, "transcription complete");
          cleanup();
          return;
        }
        if (event.type === "input_audio_buffer.committed" || event.type === "input_audio_buffer.cleared") return;
        fail("Unbekannte Antwort der lokalen Streaming-Erkennung.");
      });
      socket.on("error", () => fail("Lokale Streaming-Erkennung ist nicht erreichbar."));
      socket.on("close", () => {
        clearTimeout(opening);
        if (!finished && browser.readyState === WebSocket.OPEN) fail("Verbindung zur lokalen Streaming-Erkennung wurde unterbrochen.");
        cleanup();
      });
    };

    browser.on("message", (raw, isBinary) => {
      if (finished) return;
      if (!upstream || upstream.readyState !== WebSocket.OPEN) return fail("Lokale Streaming-Erkennung ist noch nicht bereit.");
      if (isBinary) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        audioBytes += chunk.length;
        if (chunk.length === 0 || chunk.length % 2 !== 0 || audioBytes > STT_STREAM_MAX_AUDIO_BYTES || upstream.bufferedAmount + chunk.length > STT_STREAM_MAX_BUFFERED_BYTES) {
          return fail(`Sprachaufnahme überschritt die Streamgrenze von ${STT_STREAM_MAX_AUDIO_SECONDS} Sekunden.`);
        }
        upstream.send(chunk);
        return;
      }
      let message: { type?: unknown };
      try {
        message = JSON.parse(parseRaw(raw)) as typeof message;
      } catch {
        return fail("Ungültige Nachricht des Diktats.");
      }
      if (message.type === "finish") {
        finished = true;
        upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        // The final transcript is still expected after a finish signal.
        finished = false;
        return;
      }
      if (message.type === "cancel") {
        finished = true;
        cleanup();
        browser.close(1000, "recording cancelled");
        return;
      }
      fail("Unbekannte Nachricht des Diktats.");
    });
    browser.on("close", cleanup);
    void connect();
  });
}
